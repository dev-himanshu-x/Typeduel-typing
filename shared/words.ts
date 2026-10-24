/* ---------------------------------------------------------------------------
   Deterministic word generation: the same (seed, count, bankVersion) yields the
   same words on the server and on every client. Uses only integer maths for the
   PRNG state (Math.imul) and never Math.random.
   --------------------------------------------------------------------------- */

import { ENGLISH_WORDS } from "./english";

/** v1 = the original 50-word bank (kept so old persisted matches can still be regenerated); v2 = english 200. */
export const BANK_VERSION = 2;

const WORD_BANK_V1 = [
  "time", "year", "people", "way", "day", "man", "thing", "woman", "life", "child",
  "world", "school", "state", "family", "student", "group", "country", "problem", "hand", "part",
  "place", "case", "week", "company", "system", "program", "question", "work", "number", "night",
  "point", "home", "water", "room", "mother", "area", "money", "story", "fact", "month",
  "lot", "right", "study", "book", "eye", "job", "word", "business", "issue", "side",
] as const;

const BANKS: Record<number, readonly string[]> = { 1: WORD_BANK_V1, 2: ENGLISH_WORDS };

/** mulberry32: small, fast, well-distributed 32-bit PRNG. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function generateWords(seed: number, count: number, bankVersion = BANK_VERSION): string[] {
  const bank = BANKS[bankVersion];
  if (!bank) throw new Error(`Unknown word bank version: ${bankVersion}`);
  if (!Number.isInteger(count) || count < 1 || count > MAX_WORDS) {
    throw new RangeError(`count must be an integer between 1 and ${MAX_WORDS}`);
  }
  const rand = mulberry32(seed);

  if (bankVersion === 1) {
    if (count > bank.length) throw new RangeError(`v1 supports at most ${bank.length} words`);
    const idx = bank.map((_, i) => i);
    const words: string[] = [];
    // Partial Fisher-Yates: no repeated words within one race.
    for (let i = 0; i < count; i++) {
      const j = i + Math.floor(rand() * (idx.length - i));
      [idx[i], idx[j]] = [idx[j], idx[i]];
      words.push(bank[idx[i]]);
    }
    return words;
  }

  // v2 (Monkeytype-style): random with replacement, but never the same word twice in a row.
  const words: string[] = [];
  let prev = -1;
  for (let i = 0; i < count; i++) {
    let j = Math.floor(rand() * bank.length);
    if (j === prev) j = (j + 1 + Math.floor(rand() * (bank.length - 1))) % bank.length;
    prev = j;
    words.push(bank[j]);
  }
  return words;
}

export const MAX_WORDS = 1000;

/** How many words a timed test needs so even a very fast typist never runs out (~330 wpm). */
export const wordsForDuration = (seconds: number) => Math.max(100, Math.ceil(seconds * 5.5));

/** FNV-1a 32-bit over the space-joined words; lets clients verify they derived the same text. */
export function wordsChecksum(words: readonly string[]): number {
  const text = words.join(" ");
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}
