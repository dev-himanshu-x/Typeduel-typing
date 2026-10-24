"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { FaCode } from "react-icons/fa";
import { BRAND, LogoMark } from "./site-header";
import { useTestFocus } from "./mt-shell";

const Kbd = ({ children }: { children: string }) => (
  <kbd className="rounded-sm bg-text-muted px-1.5 py-[3px] font-[family-name:var(--font-mono)] text-[9px] leading-[10px] text-bg">
    {children}
  </kbd>
);

function FooterColumn({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="grid gap-2.5">
      <h2 className="text-[11px] tracking-wider text-text-muted uppercase">{title}</h2>
      <div className="grid gap-2">{children}</div>
    </div>
  );
}

function FooterLink({ href, label }: { href?: string; label: string }) {
  if (!href) {
    return (
      <span className="cursor-default text-text-muted" role="img" aria-label={`${label} (not available yet)`} title={`${label}: not available yet`}>
        {label}
      </span>
    );
  }
  return (
    <Link href={href} className="transition-colors duration-125 hover:text-text">
      {label}
    </Link>
  );
}

/** Thin decorative row of "keys" — a light nod to a keyboard, not a literal illustration. */
function KeyStrip() {
  const widths = [1, 1, 1.6, 1, 1, 2.4, 1, 1, 1.6, 1, 1];
  return (
    <svg aria-hidden className="h-2 w-full text-border" viewBox="0 0 220 8" preserveAspectRatio="none">
      {widths.reduce<{ x: number; nodes: ReactNode[] }>(
        (acc, w, i) => {
          const width = w * 14;
          acc.nodes.push(<rect key={i} x={acc.x} y={0} width={width} height={8} rx={2} fill="currentColor" />);
          return { x: acc.x + width + 4, nodes: acc.nodes };
        },
        { x: 0, nodes: [] },
      ).nodes}
    </svg>
  );
}

export function SiteFooter() {
  const { focus } = useTestFocus();
  const fade = `transition-opacity duration-125 ${focus ? "pointer-events-none opacity-0" : "opacity-100"}`;
  const year = new Date().getFullYear();

  return (
    <footer className={`panel text-xs text-sub ${fade}`}>
      <div className="grid gap-8 sm:grid-cols-[1.3fr_auto_auto]">
        <div className="grid content-start gap-3">
          <div className="flex items-center gap-2">
            <LogoMark dim={false} />
            <span className="font-[family-name:var(--font-logo)] text-lg leading-none text-text">{BRAND.name}</span>
          </div>
          <p className="max-w-[26rem] text-text-muted">
            {BRAND.tagline} — a pixel-tight typing test, head to head against a friend on the exact same text.
          </p>
          <div className="mt-1 grid gap-1.5">
            <div className="flex items-center gap-2">
              <Kbd>tab &gt; enter</Kbd>
              <span>restart test</span>
            </div>
            <div className="flex items-center gap-2">
              <Kbd>escape</Kbd>
              <span>or</span>
              <Kbd>cmd + shift + p</Kbd>
              <span>command line</span>
            </div>
          </div>
        </div>

        <FooterColumn title="Play">
          <FooterLink href="/" label="Typing test" />
          <FooterLink href="/versus" label="1v1 duel" />
          <FooterLink label="Leaderboards" />
        </FooterColumn>

        <FooterColumn title="Project">
          <a
            href="https://github.com/monkeytypegame/monkeytype"
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-[6px] transition-colors duration-125 hover:text-text"
          >
            <FaCode aria-hidden size={12} /> inspired by monkeytype
          </a>
          <FooterLink label="Themes" />
          <span className="font-[family-name:var(--font-mono)] text-text-muted">v0.1.0</span>
        </FooterColumn>
      </div>

      <div className="mt-6 flex items-center justify-between border-t border-border pt-4 text-text-muted">
        <span>
          © {year} {BRAND.name}
        </span>
        <span>violet dark</span>
      </div>

      <div className="mt-5">
        <KeyStrip />
      </div>
    </footer>
  );
}
