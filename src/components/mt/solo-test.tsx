"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { DEFAULT_DURATION_SEC, DURATIONS } from "@shared/protocol";
import { generateWords, wordsForDuration } from "@shared/words";
import { TypingEngine, type TestResult } from "@/components/typing-engine";
import { ConfigBar } from "./config-bar";
import { TestArea, useTestFocus } from "./mt-shell";
import { ResultScreen } from "./result-screen";

const STORAGE_KEY = "typeduel.test.duration";

function readDuration(): number {
  try {
    const v = Number(window.localStorage.getItem(STORAGE_KEY));
    if ((DURATIONS as readonly number[]).includes(v)) return v;
  } catch {
    /* storage blocked: fall back to the default */
  }
  return DEFAULT_DURATION_SEC;
}

const randomSeed = () => crypto.getRandomValues(new Uint32Array(1))[0];

/** Solo typing test: config bar, the test itself, then the result screen. */
export function SoloTest() {
  const [duration, setDuration] = useState<number | null>(null); // null until the client has read its settings
  const [seed, setSeed] = useState(0);
  const [round, setRound] = useState(0); // bumps to remount the engine
  const [result, setResult] = useState<TestResult | null>(null);
  const { setFocusMode } = useTestFocus();

  useEffect(() => {
    setDuration(readDuration());
    setSeed(randomSeed());
  }, []);

  const words = useMemo(
    () => (duration === null ? null : generateWords(seed, wordsForDuration(duration))),
    [duration, seed],
  );

  const newTest = useCallback(() => {
    setResult(null);
    setFocusMode(false);
    setSeed(randomSeed());
    setRound((r) => r + 1);
  }, [setFocusMode]);

  const repeatTest = useCallback(() => {
    setResult(null);
    setFocusMode(false);
    setRound((r) => r + 1);
  }, [setFocusMode]);

  const changeDuration = (d: number) => {
    try {
      window.localStorage.setItem(STORAGE_KEY, String(d));
    } catch {
      /* ignore */
    }
    setDuration(d);
    newTest();
  };

  return (
    <>
      <div className={result ? "pointer-events-none opacity-0" : ""}>
        <ConfigBar duration={duration ?? DEFAULT_DURATION_SEC} onDuration={changeDuration} />
      </div>
      <TestArea>
        {result ? (
          <ResultScreen result={result} onNext={newTest} onRepeat={repeatTest} />
        ) : words && duration ? (
          <TypingEngine
            key={`${seed}:${round}:${duration}`}
            words={words}
            durationSec={duration}
            onRestart={newTest}
            onResult={setResult}
          />
        ) : (
          <div style={{ height: "calc(36px + var(--canvas-font-size) * var(--canvas-line-height) * 3 + 16px + 52px)" }} aria-hidden />
        )}
      </TestArea>
    </>
  );
}
