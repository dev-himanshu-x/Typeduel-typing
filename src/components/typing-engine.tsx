"use client";

import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type ChangeEvent,
  type KeyboardEvent,
} from "react";
import { FaGlobeAmericas, FaMousePointer, FaRedoAlt } from "react-icons/fa";
import type { RaceFinishPayload } from "@shared/protocol";
import { accuracy, compareWord, consistency, progressFraction, toWpm, type Tally } from "@shared/scoring";
import { generateWords, wordsForDuration } from "@shared/words";
import { useTestFocus } from "@/components/mt/mt-shell";

const SOLO_SEED = 0xc0ffee;
const SOLO_WORDS = generateWords(SOLO_SEED, wordsForDuration(30)); // fixed, so SSR and client agree
const MAX_EXTRA_LETTERS = 10;
const VISIBLE_LINES = 3;
const PROGRESS_INTERVAL_MS = 150;
const TICK_MS = 50;
// Caret and line scroll share one duration and easing when the caret changes line, so the
// caret's on-screen position stays constant while the text scrolls under it (no bounce).
const LINE_MS = 150; // must match the `duration-150` on the scrolling container
const TYPE_MS = 100; // caret glide within a line
const BLINK_RESUME_MS = 1000; // the caret blinks again after this much idle time

/* ---------------------------------------------------------------------------
   State
   --------------------------------------------------------------------------- */
type State = {
  typed: string[]; // input per word; words before `active` are committed
  active: number;
  correctKeys: number; // keystroke accuracy: corrections never remove a past error
  totalKeys: number;
  startMs: number | null;
  lastMs: number | null;
  finished: boolean;
  /** Finished because time ran out: the word being typed is not committed. */
  timedOut: boolean;
};

type Action =
  | { type: "input"; value: string; now: number }
  | { type: "space"; now: number }
  | { type: "back" }
  | { type: "timeup"; now: number }
  | { type: "reset" };

const initialState = (words: readonly string[]): State => ({
  typed: words.map(() => ""),
  active: 0,
  correctKeys: 0,
  totalKeys: 0,
  startMs: null,
  lastMs: null,
  finished: false,
  timedOut: false,
});

function createReducer(words: readonly string[]) {
  const last = words.length - 1;
  return function reducer(state: State, action: Action): State {
    if (action.type === "reset") return initialState(words);
    if (state.finished) return state;
    if (action.type === "timeup") {
      return { ...state, finished: true, timedOut: true, lastMs: action.now, startMs: state.startMs ?? action.now };
    }
    const word = words[state.active];
    const prev = state.typed[state.active];

    switch (action.type) {
      case "input": {
        const value = action.value.replace(/\s/g, "").slice(0, word.length + MAX_EXTRA_LETTERS);
        let common = 0;
        while (common < prev.length && common < value.length && prev[common] === value[common]) common++;
        let correctKeys = state.correctKeys;
        let totalKeys = state.totalKeys;
        for (let i = common; i < value.length; i++) {
          totalKeys++;
          if (value[i] === word[i]) correctKeys++;
        }
        const typed = state.typed.slice();
        typed[state.active] = value;
        return {
          ...state,
          typed,
          correctKeys,
          totalKeys,
          startMs: state.startMs ?? action.now,
          lastMs: action.now,
          finished: state.active === last && value === word,
        };
      }
      case "space": {
        if (prev === "") return state; // ignore space on an empty word
        // As in Monkeytype: a space is "correct" only when it lands on the target's space.
        const spaceOk = prev.length === word.length;
        return {
          ...state,
          correctKeys: state.correctKeys + (spaceOk ? 1 : 0),
          totalKeys: state.totalKeys + 1,
          startMs: state.startMs ?? action.now,
          lastMs: action.now,
          active: state.active === last ? state.active : state.active + 1,
          finished: state.active === last,
        };
      }
      case "back": {
        // Only step back into a previous word that was typed wrong.
        if (state.active > 0 && prev === "" && state.typed[state.active - 1] !== words[state.active - 1]) {
          return { ...state, active: state.active - 1 };
        }
        return state;
      }
    }
  };
}

function tallyOf(s: State, words: readonly string[]): Tally {
  const total: Tally = { allCorrect: 0, correctWord: 0, incorrect: 0, extra: 0, missed: 0 };
  for (let i = 0; i <= s.active; i++) {
    const committed = i < s.active || (s.finished && !s.timedOut);
    const t = compareWord(
      committed ? s.typed[i] + " " : s.typed[i],
      words[i] + " ",
      !committed, // the word being typed gets prefix credit (live tick behaviour)
    );
    for (const k of Object.keys(total) as (keyof Tally)[]) total[k] += t[k];
  }
  return total;
}

/** `clockStartMs` (performance.now() scale) overrides the first-keystroke start, e.g. a race's GO time. */
function computeStats(s: State, words: readonly string[], clockStartMs?: number) {
  const total = tallyOf(s, words);
  const from = clockStartMs ?? s.startMs;
  const seconds = from !== null && s.lastMs !== null ? Math.max(0, (s.lastMs - from) / 1000) : 0;
  return {
    wpm: toWpm(total.correctWord, seconds),
    raw: toWpm(total.allCorrect + total.incorrect + total.extra, seconds),
    acc: accuracy(s.correctKeys, s.totalKeys),
    tally: total,
  };
}

/* ---------------------------------------------------------------------------
   Public types
   --------------------------------------------------------------------------- */
export interface EngineProgress {
  wordIndex: number;
  charIndex: number;
  wpm: number;
  raw: number;
  acc: number;
  errors: number;
}

/** Everything the result screen needs after a timed solo test. */
export interface TestResult {
  durationSec: number;
  wpm: number;
  raw: number;
  acc: number;
  consistency: number;
  /** correct / incorrect / extra / missed characters (Monkeytype's "characters" stat). */
  chars: { correct: number; incorrect: number; extra: number; missed: number };
  /** Per-second series (index 0 = second 1). */
  perSecond: { wpm: number[]; raw: number[]; errors: number[] };
}

export interface TypingEngineProps {
  /** Text to type. Defaults to a fixed solo passage. Changing it requires remounting (use `key`). */
  words?: readonly string[];
  /** Time mode: seconds on the clock. The timer starts at the first keystroke (or at `clockStartMs`). */
  durationSec?: number;
  /** Blocks all input (countdown, or the race is over). */
  locked?: boolean;
  /** Freezes the visible clock (a race paused while a player reconnects). */
  frozen?: boolean;
  /** The server says time is up: stop and submit even if the local clock disagrees. */
  timeUpSignal?: boolean;
  /** Shows the restart button (solo). Tab focuses it; Enter restarts. */
  onRestart?: () => void;
  /** `performance.now()` timestamp of the race's GO; WPM and the clock run from it instead of the first key. */
  clockStartMs?: number;
  /** Opponent position, rendered as a ghost caret and a progress bar. */
  opponent?: { name: string; wordIndex: number; charIndex: number } | null;
  /** Throttled to once per 150ms, and immediately on word completion. Never called per raw keydown. */
  onProgress?: (progress: EngineProgress) => void;
  /** Called once when the test ends (time up or last word), with the raw input for server-side scoring. */
  onFinish?: (result: RaceFinishPayload) => void;
  /** Called once when the test ends, with the full result for the solo result screen. */
  onResult?: (result: TestResult) => void;
}

/* ---------------------------------------------------------------------------
   Component
   --------------------------------------------------------------------------- */
export function TypingEngine({
  words = SOLO_WORDS,
  durationSec,
  locked = false,
  frozen = false,
  timeUpSignal = false,
  onRestart,
  clockStartMs,
  opponent = null,
  onProgress,
  onFinish,
  onResult,
}: TypingEngineProps) {
  const reducer = useMemo(() => createReducer(words), [words]);
  const [state, dispatch] = useReducer(reducer, words, initialState);
  const [focused, setFocused] = useState(false);
  const [caretReady, setCaretReady] = useState(false);
  const [typingNow, setTypingNow] = useState(false); // suppress the blink while keys are flying
  const { setFocusMode } = useTestFocus();

  const inputRef = useRef<HTMLTextAreaElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);
  const caretElRef = useRef<HTMLSpanElement>(null);
  const restartRef = useRef<HTMLButtonElement>(null);
  const wordRefs = useRef<(HTMLDivElement | null)[]>([]);
  const stateRef = useRef(state);
  stateRef.current = state;
  const [caret, setCaret] = useState({ x: 0, y: 0, scroll: 0, moveMs: TYPE_MS });
  const [ghost, setGhost] = useState<{ x: number; y: number } | null>(null);

  const focusInput = useCallback(() => inputRef.current?.focus({ preventScroll: true }), []);

  // Focus on mount (and when unlocked).
  useEffect(() => {
    focusInput();
  }, [focusInput, locked]);

  // Refocus on any key press when unfocused; Tab moves to the restart button (Enter then restarts).
  useEffect(() => {
    const onKeyDown = (e: globalThis.KeyboardEvent) => {
      if (e.key === "Tab") {
        e.preventDefault(); // never let Tab wander off the test
        restartRef.current?.focus();
        return;
      }
      if (document.activeElement === restartRef.current && (e.key === "Enter" || e.key === " ")) return;
      if (document.activeElement !== inputRef.current && !e.ctrlKey && !e.metaKey && !e.altKey) {
        focusInput();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [focusInput]);

  const activeLen = state.typed[state.active].length;
  const ghostWord = opponent?.wordIndex ?? -1;
  const ghostChar = opponent?.charIndex ?? 0;

  // Measure caret + ghost + line scroll from the real DOM, so letters can never drift from them.
  const measure = useCallback(() => {
    const inner = innerRef.current;
    const wordEl = wordRefs.current[state.active];
    if (!inner || !wordEl) return;
    const innerBox = inner.getBoundingClientRect();
    const wordBox = wordEl.getBoundingClientRect();
    const wordStyle = getComputedStyle(wordEl);
    const marginTop = parseFloat(wordStyle.marginTop) || 0;
    const pitch = wordBox.height + marginTop + (parseFloat(wordStyle.marginBottom) || 0); // one line, margins included
    // Keep the active word on the 2nd visible line once it passes the 1st. Measured from rects
    // (not integer offsetTop) so fractional line heights never accumulate rounding error; the
    // difference is scroll-free because both rects carry the same transform.
    const scroll = Math.max(0, wordBox.top - innerBox.top - marginTop - pitch);
    const caretH = caretElRef.current?.offsetHeight || parseFloat(getComputedStyle(inner).fontSize) * 1.2;

    // Letter and container rects share the same scroll transform, so their difference is scroll-free.
    const pointAt = (el: HTMLElement, index: number) => {
      const letters = el.querySelectorAll<HTMLElement>("[data-letter]");
      if (letters.length === 0) return null;
      const box =
        index < letters.length
          ? letters[index].getBoundingClientRect()
          : letters[letters.length - 1].getBoundingClientRect();
      const x = index < letters.length ? box.left : box.right;
      // Vertically centre the caret on the letter, like Monkeytype does.
      return { x: x - innerBox.left, y: box.top - innerBox.top + (box.height - caretH) / 2 };
    };

    const c = pointAt(wordEl, activeLen);
    if (c) {
      setCaret((prev) => {
        // A line change animates with the scroll's duration; moves within a line use the faster glide.
        const moveMs = Math.abs(c.y - prev.y) > 1 ? LINE_MS : TYPE_MS;
        const same =
          Math.abs(c.x - prev.x) < 0.01 && Math.abs(c.y - prev.y) < 0.01 && Math.abs(scroll - prev.scroll) < 0.01;
        return same ? prev : { ...c, scroll, moveMs };
      });
    }

    const gEl = ghostWord >= 0 ? wordRefs.current[ghostWord] : null;
    setGhost(gEl ? pointAt(gEl, ghostChar) : null);
  }, [state.active, activeLen, ghostWord, ghostChar]);

  useLayoutEffect(() => {
    measure();
  }, [measure, state.typed, state.finished]);

  // Enable the caret transition only after its first measured position has painted,
  // otherwise it would glide in from (0, 0).
  const measured = caret.x !== 0 || caret.y !== 0;
  useEffect(() => {
    if (measured) setCaretReady(true);
  }, [measured]);

  // Re-measure on resize (re-wrapping) and once the web font has loaded.
  useEffect(() => {
    const inner = innerRef.current;
    if (!inner) return;
    const ro = new ResizeObserver(measure);
    ro.observe(inner);
    document.fonts?.ready.then(measure);
    return () => ro.disconnect();
  }, [measure]);

  /* ---- Clock (time mode) ---- */
  const startAt = clockStartMs ?? state.startMs; // performance.now() scale
  const started = startAt !== null && startAt !== undefined;
  const [remaining, setRemaining] = useState(durationSec ?? 0);
  const samples = useRef<{ wpm: number[]; raw: number[]; errors: number[]; prevChars: number; prevErrors: number }>({
    wpm: [],
    raw: [],
    errors: [],
    prevChars: 0,
    prevErrors: 0,
  });

  /** Record one-second samples up to `upToSec` using the latest state. */
  const takeSamples = useCallback(
    (upToSec: number) => {
      if (!durationSec) return;
      const sm = samples.current;
      const s = stateRef.current;
      const t = computeStats({ ...s, finished: false, timedOut: false }, words, 0);
      const chars = t.tally.allCorrect + t.tally.incorrect + t.tally.extra;
      const errs = s.totalKeys - s.correctKeys;
      while (sm.wpm.length < Math.min(upToSec, durationSec)) {
        const sec = sm.wpm.length + 1;
        sm.wpm.push(Math.round(toWpm(t.tally.correctWord, sec) * 100) / 100);
        sm.raw.push(Math.round(toWpm(chars - sm.prevChars, 1) * 100) / 100); // burst: chars typed this second
        sm.errors.push(errs - sm.prevErrors);
        sm.prevChars = chars;
        sm.prevErrors = errs;
      }
    },
    [durationSec, words],
  );

  useEffect(() => {
    if (!durationSec || !started || state.finished || frozen || startAt == null) return;
    const total = durationSec * 1000;
    const tick = () => {
      const elapsed = performance.now() - startAt;
      takeSamples(Math.floor(elapsed / 1000));
      setRemaining(Math.max(0, Math.ceil((total - elapsed) / 1000)));
      if (elapsed >= total) dispatch({ type: "timeup", now: startAt + total });
    };
    tick();
    const id = setInterval(tick, TICK_MS);
    return () => clearInterval(id);
  }, [durationSec, started, startAt, state.finished, frozen, takeSamples]);

  // Server-initiated end (our clock lagged, e.g. a throttled background tab).
  useEffect(() => {
    if (timeUpSignal && durationSec && started && startAt != null && !stateRef.current.finished) {
      dispatch({ type: "timeup", now: startAt + durationSec * 1000 });
    }
  }, [timeUpSignal, durationSec, started, startAt]);

  /* ---- Focus mode (Monkeytype hides the chrome while you type) ---- */
  useEffect(() => {
    if (!started || state.finished) return;
    setFocusMode(true);
    return () => setFocusMode(false);
  }, [started, state.finished, setFocusMode]);

  const stats = computeStats(state, words, clockStartMs);

  /* ---- Throttled progress emission (driven by state changes, never by keydown) ---- */
  const onProgressRef = useRef(onProgress);
  const onFinishRef = useRef(onFinish);
  const onResultRef = useRef(onResult);
  useEffect(() => {
    onProgressRef.current = onProgress;
    onFinishRef.current = onFinish;
    onResultRef.current = onResult;
  });
  const emit = useRef<{
    last: number;
    word: number;
    timer: ReturnType<typeof setTimeout> | null;
    pending: EngineProgress | null;
  }>({ last: 0, word: 0, timer: null, pending: null });

  useEffect(() => {
    if (!onProgressRef.current || locked) return;
    const e = emit.current;
    const flush = () => {
      if (e.timer) clearTimeout(e.timer);
      e.timer = null;
      if (e.pending) {
        onProgressRef.current?.(e.pending);
        e.pending = null;
        e.last = performance.now();
      }
    };
    e.pending = {
      wordIndex: state.active,
      charIndex: state.typed[state.active].length,
      wpm: Math.round(stats.wpm * 100) / 100,
      raw: Math.round(stats.raw * 100) / 100,
      acc: Math.round(stats.acc * 100) / 100,
      errors: state.totalKeys - state.correctKeys,
    };
    const wordChanged = state.active !== e.word;
    e.word = state.active;
    const wait = PROGRESS_INTERVAL_MS - (performance.now() - e.last);
    if (wordChanged || state.finished || wait <= 0) flush();
    else if (!e.timer) e.timer = setTimeout(flush, wait);
  }, [state, locked, stats.wpm, stats.raw, stats.acc]);

  useEffect(() => {
    const e = emit.current;
    return () => {
      if (e.timer) clearTimeout(e.timer);
    };
  }, []);

  const finishedOnce = useRef(false);
  useEffect(() => {
    if (!state.finished || finishedOnce.current) return;
    finishedOnce.current = true;
    onFinishRef.current?.({
      typed: state.typed,
      activeIndex: state.active,
      correctKeys: state.correctKeys,
      totalKeys: state.totalKeys,
    });
    if (durationSec && onResultRef.current) {
      takeSamples(durationSec);
      const sm = samples.current;
      const final = computeStats(state, words, clockStartMs);
      const t = final.tally;
      onResultRef.current({
        durationSec,
        wpm: final.wpm,
        raw: final.raw,
        acc: final.acc,
        consistency: consistency(sm.raw),
        chars: { correct: t.allCorrect, incorrect: t.incorrect, extra: t.extra, missed: t.missed },
        perSecond: { wpm: sm.wpm, raw: sm.raw, errors: sm.errors },
      });
    }
  }, [state, durationSec, words, clockStartMs, takeSamples]);

  /* ---- Input handlers ---- */
  const blinkTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const noteTyping = () => {
    setTypingNow(true);
    if (blinkTimer.current) clearTimeout(blinkTimer.current);
    blinkTimer.current = setTimeout(() => setTypingNow(false), BLINK_RESUME_MS);
  };
  useEffect(
    () => () => {
      if (blinkTimer.current) clearTimeout(blinkTimer.current);
    },
    [],
  );

  const onChange = (e: ChangeEvent<HTMLTextAreaElement>) => {
    if (locked) return;
    noteTyping();
    dispatch({ type: "input", value: e.target.value, now: performance.now() });
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (locked) {
      if (e.key !== "Tab") e.preventDefault();
      return;
    }
    if (e.key === " ") {
      e.preventDefault();
      noteTyping();
      dispatch({ type: "space", now: performance.now() });
    } else if (e.key === "Backspace" && e.currentTarget.value === "") {
      // Consume the key: otherwise the browser would also delete the last char of the
      // previous word once React restores it into the input.
      e.preventDefault();
      noteTyping();
      dispatch({ type: "back" });
    } else if (e.key === "Enter" || e.key.startsWith("Arrow") || e.key === "Home" || e.key === "End") {
      e.preventDefault(); // caret movement inside the hidden input would desync the display
    }
  };

  const registerWord = useCallback((i: number, el: HTMLDivElement | null) => {
    wordRefs.current[i] = el;
  }, []);

  const myFraction = state.finished
    ? 1
    : progressFraction(words, state.active, state.typed[state.active].length);
  const oppFraction = opponent ? progressFraction(words, opponent.wordIndex, opponent.charIndex) : 0;
  const showClock = !!durationSec && started;

  return (
    <div className="relative w-full" data-testid="typing-test">
      {opponent && (
        <div className="mb-4 grid gap-1.5 text-sm text-sub" aria-label="Race progress">
          <ProgressRow label="you" value={myFraction} fill="bg-main" />
          <ProgressRow label={opponent.name} value={oppFraction} fill="bg-sub" />
        </div>
      )}

      {/* Language indicator, replaced by the clock once the test starts (same slot, like Monkeytype). */}
      <div className="relative flex h-9 items-center text-base text-sub">
        <div
          className={`pointer-events-none absolute inset-0 flex items-center justify-center gap-2 transition-opacity duration-125 ${
            started ? "opacity-0" : "opacity-100"
          }`}
        >
          <FaGlobeAmericas aria-hidden />
          <span>english</span>
        </div>
        {durationSec ? (
          <div
            className={`pl-[10px] text-[2rem] leading-none text-main transition-opacity duration-125 font-[family-name:var(--font-mono)] ${
              showClock ? "opacity-100" : "opacity-0"
            }`}
            data-testid="timer"
            aria-live="off"
          >
            {started ? remaining : durationSec}
          </div>
        ) : null}
      </div>

      {/* Click anywhere on the words to focus the hidden input. */}
      <div
        className="relative cursor-text overflow-hidden"
        style={{ height: `calc(var(--canvas-font-size) * var(--canvas-line-height) * ${VISIBLE_LINES})` }}
        onMouseDown={(e) => {
          e.preventDefault(); // keep focus on the textarea; no selection
          focusInput();
        }}
      >
        <textarea
          ref={inputRef}
          value={state.typed[state.active]}
          onChange={onChange}
          onKeyDown={onKeyDown}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          readOnly={locked}
          aria-label="Typing input"
          autoComplete="off"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          rows={1}
          className="pointer-events-none absolute top-0 left-0 h-px w-px resize-none overflow-hidden border-0 p-0 opacity-0 outline-none"
        />

        <div
          ref={innerRef}
          className={`relative flex flex-wrap px-[2px] font-[family-name:var(--font-mono)] text-[length:var(--canvas-font-size)] transition-[transform,opacity,filter] duration-150 ${
            focused || state.finished || locked ? "" : "opacity-25 blur-[4px]"
          }`}
          style={{ transform: `translateY(${-caret.scroll}px)` }}
        >
          {words.map((word, i) => (
            <Word
              key={i}
              index={i}
              word={word}
              input={state.typed[i]}
              wrong={(i < state.active || (state.finished && !state.timedOut && i === state.active)) && state.typed[i] !== word}
              register={registerWord}
            />
          ))}

          {/* Opponent ghost caret: dimmer, no blink. */}
          {opponent && ghost && (
            <span
              aria-hidden
              data-testid="ghost-caret"
              className="pointer-events-none absolute top-0 left-0 h-[1.2em] w-[.1em] rounded-[var(--radius)] bg-sub opacity-60"
              style={{
                transform: `translate3d(${ghost.x - 1}px, ${ghost.y}px, 0)`,
                transition: caretReady ? `transform ${LINE_MS}ms var(--ease)` : "none",
              }}
            />
          )}

          {/* Caret: absolutely positioned, moved with a CSS transform transition. */}
          {!state.finished && (
            <span
              ref={caretElRef}
              aria-hidden
              data-testid="caret"
              className={`pointer-events-none absolute top-0 left-0 h-[1.2em] w-[.1em] rounded-[var(--radius)] bg-main ${
                typingNow ? "" : "caret-blink"
              }`}
              style={{
                transform: `translate3d(${caret.x - 1}px, ${caret.y}px, 0)`,
                transition: caretReady ? `transform ${caret.moveMs}ms var(--ease)` : "none",
              }}
            />
          )}
        </div>

        {!focused && !state.finished && !locked && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center gap-3 text-base text-text">
            <FaMousePointer aria-hidden />
            <span>Click here or press any key to focus</span>
          </div>
        )}
      </div>

      {onRestart && (
        <div className="mt-4 flex justify-center">
          <button
            ref={restartRef}
            type="button"
            onClick={onRestart}
            aria-label="Restart test"
            data-testid="restart"
            className="inline-flex cursor-pointer items-center justify-center rounded-pill px-[2em] py-[1em] text-sub transition-colors duration-125 hover:bg-bg-elevated hover:text-text focus-visible:text-text focus-visible:outline-none"
          >
            <FaRedoAlt aria-hidden size={20} />
          </button>
        </div>
      )}
    </div>
  );
}

interface WordProps {
  index: number;
  word: string;
  input: string;
  wrong: boolean;
  register: (i: number, el: HTMLDivElement | null) => void;
}

/** One word. Memoised: a keystroke only re-renders the word it changes. */
const Word = memo(function Word({ index, word, input, wrong, register }: WordProps) {
  const extras = input.slice(word.length);
  return (
    <div
      ref={(el) => register(index, el)}
      className={`m-[.25em] whitespace-pre border-b-2 leading-[1.0375] ${wrong ? "border-incorrect" : "border-transparent"}`}
    >
      {word.split("").map((ch, j) => (
        <span
          key={j}
          data-letter
          className={j >= input.length ? "text-untyped" : input[j] === ch ? "text-correct" : "text-incorrect"}
        >
          {ch}
        </span>
      ))}
      {extras.split("").map((ch, j) => (
        <span key={`x${j}`} data-letter className="text-extra">
          {ch}
        </span>
      ))}
    </div>
  );
});

function ProgressRow({ label, value, fill }: { label: string; value: number; fill: string }) {
  return (
    <div className="grid grid-cols-[minmax(3rem,6rem)_1fr] items-center gap-3">
      <span className="truncate">{label}</span>
      <div className="h-1 overflow-hidden rounded-full bg-sub-alt">
        <div
          className={`h-full rounded-full ${fill} transition-[width] duration-150 ease-out`}
          style={{ width: `${Math.round(value * 100)}%` }}
        />
      </div>
    </div>
  );
}
