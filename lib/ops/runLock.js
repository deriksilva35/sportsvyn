// lib/ops/runLock.js - one run at a time, across processes (tue-2).
//
// A LOCK FILE CREATED WITH O_EXCL, holding the owner's pid. A second acquire
// while the owner is alive is refused; a lock whose pid is gone (the process
// crashed or was killed) is STALE and is taken over, so a crash never wedges
// the job until somebody deletes a file by hand. Release removes the file only
// if it is still ours.
import { openSync, writeSync, closeSync, readFileSync, unlinkSync } from 'node:fs';

const alive = (pid) => {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return true; } catch (e) { return e?.code === 'EPERM'; }
};

/** @returns {{ok: true, release: () => void} | {ok: false, holder: number}} */
export function acquireLock(path, { pid = process.pid } = {}) {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const fd = openSync(path, 'wx');
      writeSync(fd, String(pid)); closeSync(fd);
      return { ok: true, release: () => { try { if (Number(readFileSync(path, 'utf8')) === pid) unlinkSync(path); } catch { /* gone */ } } };
    } catch (e) {
      if (e?.code !== 'EEXIST') throw e;
      const holder = Number(String(readFileSafe(path)).trim());
      if (alive(holder)) return { ok: false, holder };
      try { unlinkSync(path); } catch { /* raced: someone else took it over */ }
    }
  }
  return { ok: false, holder: Number(String(readFileSafe(path)).trim()) || null };
}

function readFileSafe(path) { try { return readFileSync(path, 'utf8'); } catch { return ''; } }
