import type { Metadata } from "next";
import { MtShell } from "@/components/mt/mt-shell";
import { VersusGame } from "@/components/versus/versus-game";

export const metadata: Metadata = { title: "1v1 | TypeDuel" };

export default function VersusPage() {
  return (
    <MtShell active="versus">
      <VersusGame />
    </MtShell>
  );
}
