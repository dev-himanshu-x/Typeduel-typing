"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { SiteFooter } from "./site-footer";
import { SiteHeader, type NavKey } from "./site-header";

/* ---------------------------------------------------------------------------
   Page frame: floating pill header, centred 1280px content column, footer.
   While a test is running ("focus mode") the chrome fades out and comes back
   on mouse movement (kept from Monkeytype's typing-test UX).
   --------------------------------------------------------------------------- */

interface FocusApi {
  focus: boolean;
  setFocusMode: (on: boolean) => void;
}

const FocusContext = createContext<FocusApi>({ focus: false, setFocusMode: () => {} });
export const useTestFocus = () => useContext(FocusContext);

/** Content column: 1280px max, 2rem gutters (1rem on phones). */
export const contentWidth = "mx-auto w-[min(100%-2rem,1280px)] sm:w-[min(100%-4rem,1280px)]";

export function MtShell({ active, children }: { active: NavKey; children: ReactNode }) {
  const [focus, setFocus] = useState(false);
  const setFocusMode = useCallback((on: boolean) => setFocus(on), []);
  const api = useMemo(() => ({ focus, setFocusMode }), [focus, setFocusMode]);

  // Any real mouse movement brings the chrome back.
  useEffect(() => {
    if (!focus) return;
    let travelled = 0;
    const onMove = (e: MouseEvent) => {
      travelled += Math.abs(e.movementX) + Math.abs(e.movementY);
      if (travelled > 4) setFocus(false);
    };
    window.addEventListener("mousemove", onMove);
    return () => window.removeEventListener("mousemove", onMove);
  }, [focus]);

  return (
    <FocusContext.Provider value={api}>
      <div className="flex min-h-dvh flex-col" data-focus={focus ? "true" : "false"}>
        <div className={`${contentWidth} pt-6`}>
          <SiteHeader active={active} />
        </div>
        <main className={`${contentWidth} mt-10 flex flex-1 flex-col`}>{children}</main>
        <div className={`${contentWidth} pb-6`}>
          <SiteFooter />
        </div>
      </div>
    </FocusContext.Provider>
  );
}

/** Vertically centres the typing area between the config bar and the footer (Monkeytype's layout). */
export function TestArea({ children }: { children: ReactNode }) {
  return <div className="flex flex-1 flex-col justify-center pb-[72px]">{children}</div>;
}
