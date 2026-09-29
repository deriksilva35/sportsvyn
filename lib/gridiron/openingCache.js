// lib/gridiron/openingCache.js - the opening spreads, cached for an hour in
// Next's data cache and shared by every request (see openingLine.js for why
// the read is whole-table). JSON round trip: the Map goes in as entries.
import { unstable_cache } from 'next/cache';
import { openingSpreads } from './openingLine.js';

export const OPENING_REVALIDATE_SEC = 3600;
const entries = unstable_cache(async () => [...(await openingSpreads()).entries()], ['scores:openingSpreads:v1'], { revalidate: OPENING_REVALIDATE_SEC, tags: ['scores-open'] });

export async function cachedOpeningSpreads() { return new Map(await entries()); }
