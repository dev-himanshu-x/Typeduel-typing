import { MtShell } from "@/components/mt/mt-shell";
import { SoloTest } from "@/components/mt/solo-test";

export default function Home() {
  return (
    <MtShell active="test">
      <SoloTest />
    </MtShell>
  );
}
