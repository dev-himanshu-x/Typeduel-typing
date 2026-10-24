import type { Metadata } from "next";
import { MtShell } from "@/components/mt/mt-shell";
import { VersusGame } from "@/components/versus/versus-game";

export const metadata: Metadata = { title: "1v1 | TypeDuel" };

export default async function VersusRoomPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  return (
    <MtShell active="versus">
      <VersusGame initialCode={code} />
    </MtShell>
  );
}
