"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { FaBell, FaRegUser } from "react-icons/fa";
import { loadIdentity } from "@/lib/socket";
import { useTestFocus } from "./mt-shell";

export type NavKey = "test" | "versus" | "profile";

/** Our own mark and name, placed and sized exactly where Monkeytype puts its logo. */
export const BRAND = { name: "TypeDuel", tagline: "type to win" } as const;

export function LogoMark({ dim }: { dim: boolean }) {
  return (
    <svg
      width="32"
      height="20"
      viewBox="0 0 40 24"
      fill="none"
      aria-hidden
      className={`shrink-0 transition-colors duration-250 ${dim ? "text-sub" : "text-main"}`}
    >
      <rect x="1.25" y="1.25" width="37.5" height="21.5" rx="6" stroke="currentColor" strokeWidth="2.5" />
      <g stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
        <path d="M7 8.5h3M13.5 8.5h3M20 8.5h3M26.5 8.5h6" />
        <path d="M7 15.5h6M16.5 15.5h8M28 15.5h4" />
      </g>
    </svg>
  );
}

/** A text nav link, HUTS-style: plain built links, a trailing "+" on controls that aren't built yet. */
function NavLink({ href, label, active }: { href?: string; label: string; active?: boolean }) {
  const cls = "inline-flex items-center gap-1 px-3 py-1.5 text-sm transition-colors duration-125";
  if (!href) {
    return (
      <span className={`${cls} cursor-default text-sub`} role="img" aria-label={`${label} (not available yet)`} title={`${label}: not available yet`}>
        {label}
        <span aria-hidden className="text-xs text-text-muted">
          +
        </span>
      </span>
    );
  }
  return (
    <Link href={href} className={`${cls} ${active ? "text-text" : "text-sub hover:text-text"}`} aria-current={active ? "page" : undefined}>
      {label}
    </Link>
  );
}

export function SiteHeader({ active }: { active: NavKey }) {
  const { focus } = useTestFocus();
  const [name, setName] = useState<string | null>(null);
  useEffect(() => setName(loadIdentity().name), []);
  const fade = `transition-opacity duration-125 ${focus ? "pointer-events-none opacity-0" : "opacity-100"}`;

  return (
    <header className={`pill-surface z-5 flex h-14 items-center gap-1 px-2 transition-opacity duration-125 ${fade}`}>
      <Link href="/" className="flex h-9 shrink-0 items-center gap-2 px-2" aria-label={`${BRAND.name} home`}>
        <LogoMark dim={focus} />
        <span className={`font-[family-name:var(--font-logo)] text-xl leading-none transition-colors duration-250 ${focus ? "text-sub" : "text-text"}`}>
          {BRAND.name}
        </span>
      </Link>

      <nav className="flex items-center gap-0.5" aria-label="Main">
        <NavLink href="/" label="Typing test" active={active === "test"} />
        <NavLink label="Leaderboards" />
        <NavLink label="About" />
        <NavLink label="Settings" />
      </nav>

      <div className="grow" />

      <span
        className="hidden h-9 w-9 items-center justify-center rounded-pill text-sub sm:inline-flex"
        role="img"
        aria-label="Notifications (not available yet)"
        title="Notifications: not available yet"
      >
        <FaBell size={15} />
      </span>
      <Link
        href="/profile"
        className={`inline-flex h-9 items-center gap-2 rounded-pill px-3 text-sm transition-colors duration-125 hover:text-text ${
          active === "profile" ? "text-main" : "text-sub"
        }`}
        aria-label="Your profile"
        title="Your profile"
        data-testid="profile-link"
      >
        <FaRegUser size={15} />
        {name && <span className="hidden max-w-[10rem] truncate sm:inline">{name}</span>}
      </Link>
      <Link
        href="/versus"
        className="ml-1 inline-flex h-9 items-center rounded-pill bg-accent px-4 text-sm text-on-accent transition-[background-color,box-shadow] duration-125 hover:bg-accent hover:shadow-glow"
        aria-label="Play a 1v1 duel"
      >
        1v1 duel
      </Link>
    </header>
  );
}
