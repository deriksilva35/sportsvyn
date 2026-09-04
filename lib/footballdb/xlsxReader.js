// lib/footballdb/xlsxReader.js — a minimal, zero-dependency .xlsx reader.
//
// WHY THIS EXISTS RATHER THAN A LIBRARY. Neither this repo's node_modules nor
// the environment carries an xlsx/exceljs package, and adding one for twenty
// static files that are never re-read after ingest is a dependency for a job
// that runs a handful of times. An .xlsx is a ZIP of XML parts; ZIP entries in
// these files are DEFLATE-compressed, which Node's own zlib already decodes
// (inflateRawSync). So this file is a ZIP central-directory walker plus a
// deliberately narrow OOXML cell reader — nothing styles, nothing formulas,
// nothing this ingest does not read.
//
// ATTRIBUTE ORDER IS NOT TRUSTED, ANYWHERE. The first version of the census
// script two turns ago assumed `<sheet name="X" ... r:id="Y">` and silently
// matched zero sheets, because the real tag is
// `<sheet xmlns:r="..." name="X" sheetId="N" state="visible" r:id="Y"/>` —
// xmlns:r sits before name. Every regex below extracts a whole tag first and
// then searches WITHIN it for each attribute, independent of position.

import { readFileSync } from 'node:fs';
import { inflateRawSync } from 'node:zlib';

// ---------------------------------------------------------------------------
// ZIP layer — central directory walk, not a full ZIP implementation. Reads
// exactly the fields needed to locate and inflate one named entry.
// ---------------------------------------------------------------------------
function readZipEntries(buf) {
  // End Of Central Directory record: fixed 22-byte tail (no comment expected
  // in an .xlsx), signature 0x06054b50.
  const eocdSig = 0x06054b50;
  let eocd = -1;
  for (let i = buf.length - 22; i >= 0; i--) {
    if (buf.readUInt32LE(i) === eocdSig) { eocd = i; break; }
  }
  if (eocd === -1) throw new Error('xlsxReader: not a ZIP (no End Of Central Directory record found)');
  const entryCount = buf.readUInt16LE(eocd + 10);
  const cdOffset = buf.readUInt32LE(eocd + 16);

  const entries = new Map(); // name -> { offset, compSize, uncompSize, method }
  let p = cdOffset;
  const cdSig = 0x02014b50;
  for (let i = 0; i < entryCount; i++) {
    if (buf.readUInt32LE(p) !== cdSig) throw new Error(`xlsxReader: bad central directory entry at ${p}`);
    const method = buf.readUInt16LE(p + 10);
    const compSize = buf.readUInt32LE(p + 20);
    const uncompSize = buf.readUInt32LE(p + 24);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const localHeaderOffset = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen);
    entries.set(name, { localHeaderOffset, compSize, uncompSize, method });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

function readZipFile(buf, entries, name) {
  const e = entries.get(name);
  if (!e) return null;
  const lfSig = 0x04034b50;
  const lp = e.localHeaderOffset;
  if (buf.readUInt32LE(lp) !== lfSig) throw new Error(`xlsxReader: bad local file header for ${name}`);
  const nameLen = buf.readUInt16LE(lp + 26);
  const extraLen = buf.readUInt16LE(lp + 28);
  const dataStart = lp + 30 + nameLen + extraLen;
  const compressed = buf.subarray(dataStart, dataStart + e.compSize);
  if (e.method === 0) return compressed; // stored, no compression
  if (e.method === 8) return inflateRawSync(compressed); // DEFLATE — the only other method .xlsx uses
  throw new Error(`xlsxReader: unsupported ZIP compression method ${e.method} for ${name}`);
}

// ---------------------------------------------------------------------------
// OOXML layer — sheet names, in workbook order, and one sheet's cells.
// ---------------------------------------------------------------------------

/** name -> { sheetId, target: "sheetN.xml" }, in workbook.xml's own order. */
function sheetMap(buf, entries) {
  const wb = readZipFile(buf, entries, 'xl/workbook.xml').toString('utf8');
  const rels = readZipFile(buf, entries, 'xl/_rels/workbook.xml.rels').toString('utf8');

  const relTags = rels.match(/<Relationship\b[^>]*\/>/g) ?? [];
  const ridToTarget = new Map();
  for (const tag of relTags) {
    const id = tag.match(/Id="(rId\d+)"/)?.[1];
    const target = tag.match(/Target="([^"]+)"/)?.[1];
    if (id && target) ridToTarget.set(id, target);
  }

  const sheetTags = wb.match(/<sheet\b[^>]*\/>/g) ?? [];
  const out = [];
  for (const tag of sheetTags) {
    const name = tag.match(/name="([^"]+)"/)?.[1];
    const rid = tag.match(/r:id="(rId\d+)"/)?.[1];
    if (!name || !rid) continue;
    const target = ridToTarget.get(rid) ?? '';
    const m = target.match(/sheet(\d+)\.xml$/);
    if (!m) continue;
    out.push({ name, file: `xl/worksheets/sheet${m[1]}.xml` });
  }
  return out;
}

const colOf = (ref) => ref.match(/^[A-Z]+/)[0];
const colIndex = (col) => [...col].reduce((v, ch) => v * 26 + (ch.charCodeAt(0) - 64), 0);

/** One worksheet's rows as arrays of cell text, header row (row 1) included. */
function parseSheetRows(xml) {
  const rowTags = xml.match(/<row r="\d+"[^>]*>[\s\S]*?<\/row>/g) ?? [];
  const rows = [];
  for (const rowTag of rowTags) {
    const cellTags = rowTag.match(/<c r="[A-Z]+\d+"[^>]*(?:\/>|>[\s\S]*?<\/c>)/g) ?? [];
    const byCol = new Map();
    let maxCol = 0;
    for (const cellTag of cellTags) {
      const ref = cellTag.match(/r="([A-Z]+\d+)"/)?.[1];
      if (!ref) continue;
      const col = colIndex(colOf(ref));
      maxCol = Math.max(maxCol, col);
      const tMatch = cellTag.match(/<t[^>]*>([\s\S]*?)<\/t>/);
      const vMatch = cellTag.match(/<v>([\s\S]*?)<\/v>/);
      const raw = tMatch ? tMatch[1] : (vMatch ? vMatch[1] : null);
      byCol.set(col, raw == null ? null : decodeXmlEntities(raw));
    }
    const arr = [];
    for (let c = 1; c <= maxCol; c++) arr.push(byCol.get(c) ?? null);
    rows.push(arr);
  }
  return rows;
}

function decodeXmlEntities(s) {
  return s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'").replace(/&amp;/g, '&');
}

/**
 * Read one .xlsx into { sheetName: { headers: [...], rows: [[...], ...] } },
 * skipping the "About" tab (prose, not data) if present.
 */
export function readWorkbook(path) {
  const buf = readFileSync(path);
  const entries = readZipEntries(buf);
  const sheets = sheetMap(buf, entries);
  const out = {};
  for (const { name, file } of sheets) {
    if (name === 'About') continue;
    const xml = readZipFile(buf, entries, file);
    if (!xml) continue;
    const rows = parseSheetRows(xml.toString('utf8'));
    const [headers, ...dataRows] = rows;
    out[name] = { headers: headers ?? [], rows: dataRows };
  }
  return out;
}

/** The About tab's prose lines, in document order — where the team count lives. */
export function readAboutLines(path) {
  const buf = readFileSync(path);
  const entries = readZipEntries(buf);
  const sheets = sheetMap(buf, entries);
  const about = sheets.find((s) => s.name === 'About');
  if (!about) return [];
  const xml = readZipFile(buf, entries, about.file).toString('utf8');
  const texts = xml.match(/<t[^>]*>([\s\S]*?)<\/t>/g) ?? [];
  return texts.map((t) => decodeXmlEntities(t.replace(/<t[^>]*>/, '').replace(/<\/t>$/, '')));
}
