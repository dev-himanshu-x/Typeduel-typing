"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { MtShell } from "@/components/mt/mt-shell";
import { loadIdentity } from "@/lib/socket";

/** `/profile` → your own profile, keyed by the player id stored in this browser. */
export default function MyProfileRedirect() {
  const router = useRouter();
  useEffect(() => {
    router.replace(`/profile/${loadIdentity().playerId}`);
  }, [router]);
  return (
    <MtShell active="profile">
      <p className="pt-16 text-center text-sm text-sub" role="status">
        loading your profile…
      </p>
    </MtShell>
  );
}
