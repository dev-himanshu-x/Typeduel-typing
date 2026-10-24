/* ---------------------------------------------------------------------------
   Scoring shared by the typing engine (live) and the server (final result).
   Transcribed from Monkeytype's logic: WPM credits only fully-correct words
   (plus the correct prefix of the word currently being typed).
   --------------------------------------------------------------------------- */

export type Tally = {
  allCorrect: number;
  correctWord: number;
  incorrect: number;
  extra: number;
  missed: number;
};

/** Compare one word's input to its target (both include the trailing space when committed). */
export function compareWord(input: string, target: string, finalizing: boolean): Tally {
  const t: Tally = { allCorrect: 0, correctWord: 0, incorrect: 0, extra: 0, missed: 0 };
  const exact = input === target;
  const prefix = target.startsWith(input);
  const len = Math.max(input.length, target.length);
  for (let i = 0; i < len; i++) {
    const typed = input[i];
    const want = target[i];
    if (typed === want) {
      if (want === " " && !exact) t.extra++;
      else t.allCorrect++;
      if (exact || (finalizing && prefix)) t.correctWord++;
    } else if (typed === undefined) {
      if (!finalizing) t.missed++;
    } else if (want === undefined || (want === " " && typed !== " " && !input.includes(" "))) {
      t.extra++;
    } else {
      t.incorrect++;
    }
  }
  return t;
}

/** wpm = chars / 5 / minutes */
export const toWpm = (chars: number, seconds: number) =>
  seconds <= 0 ? 0 : chars / 5 / (seconds / 60);

export const round2 = (n: number) => Math.round((n + 2 ** -52) * 100) / 100;

/** Keystroke accuracy in percent; corrections never remove a past error. */
export const accuracy = (correctKeys: number, totalKeys: number) =>
  totalKeys === 0 ? 100 : (correctKeys / totalKeys) * 100;

/** Final stats for a completed race where every word is committed. */
export function scoreRace(
  words: readonly string[],
  typed: readonly string[],
  correctKeys: number,
  totalKeys: number,
  elapsedMs: number,
) {
  const total: Tally = { allCorrect: 0, correctWord: 0, incorrect: 0, extra: 0, missed: 0 };
  words.forEach((word, i) => {
    const t = compareWord((typed[i] ?? "") + " ", word + " ", false);
    for (const k of Object.keys(total) as (keyof Tally)[]) total[k] += t[k];
  });
  const seconds = elapsedMs / 1000;
  return {
    wpm: round2(toWpm(total.correctWord, seconds)),
    raw: round2(toWpm(total.allCorrect + total.incorrect + total.extra, seconds)),
    acc: round2(accuracy(correctKeys, totalKeys)),
  };
}

/**
 * Final stats for a timed test. Words before `activeIndex` are committed (typed + space); the word
 * being typed when time ran out is scored on its correct prefix and is not counted as missed.
 */
export function scoreTimed(
  words: readonly string[],
  typed: readonly string[],
  activeIndex: number,
  correctKeys: number,
  totalKeys: number,
  durationMs: number,
) {
  const tally = tallyTimed(words, typed, activeIndex);
  const seconds = durationMs / 1000;
  return {
    wpm: round2(toWpm(tally.correctWord, seconds)),
    raw: round2(toWpm(tally.allCorrect + tally.incorrect + tally.extra, seconds)),
    acc: round2(accuracy(correctKeys, totalKeys)),
    tally,
  };
}

export function tallyTimed(words: readonly string[], typed: readonly string[], activeIndex: number): Tally {
  const total: Tally = { allCorrect: 0, correctWord: 0, incorrect: 0, extra: 0, missed: 0 };
  for (let i = 0; i <= activeIndex && i < words.length; i++) {
    const committed = i < activeIndex;
    const t = compareWord(committed ? (typed[i] ?? "") + " " : (typed[i] ?? ""), words[i] + " ", !committed);
    for (const k of Object.keys(total) as (keyof Tally)[]) total[k] += t[k];
  }
  return total;
}

/** 0..1 share of the passage completed, for progress bars. */
export function progressFraction(words: readonly string[], wordIndex: number, charIndex: number) {
  let done = 0;
  let total = 0;
  words.forEach((w, i) => {
    total += w.length + 1;
    if (i < wordIndex) done += w.length + 1;
    else if (i === wordIndex) done += Math.min(charIndex, w.length);
  });
  return total === 0 ? 0 : Math.min(1, done / total);
}

/* ---- Consistency (Monkeytype's formula) ---------------------------------- */

export const mean = (a: readonly number[]) => (a.length === 0 ? 0 : a.reduce((s, x) => s + x, 0) / a.length);

export function stdDev(a: readonly number[]) {
  if (a.length === 0) return 0;
  const m = mean(a);
  return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / a.length);
}

/** Squashes the coefficient of variation into 0-100 (0 variation = 100). */
export const kogasa = (cov: number) => 100 * (1 - Math.tanh(cov + cov ** 3 / 3 + cov ** 5 / 5));

/** Per-second WPM stability, 0-100. Leading seconds before the first sample are ignored. */
export function consistency(series: readonly number[]) {
  const first = series.findIndex((v) => v > 0);
  const used = first < 0 ? [] : series.slice(first);
  if (used.length < 2) return 0;
  return round2(kogasa(stdDev(used) / mean(used)));
}
