"use client";
import { useState, useTransition } from "react";
import { approveLink } from "@/actions/device-link";
export function ConfirmLink({ code, name }: { code: string; name: string }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);
  if (done) return <p role="status" className="text-good">Approved. Return to Pulse Attendance; it will finish connecting automatically.</p>;
  return <div className="space-y-3">
    {error && <p role="alert" className="text-bad">{error}</p>}
    <button className="btn btn-primary w-full" disabled={pending} onClick={() => start(async () => {
      try { const result = await approveLink(code); if (result.ok) setDone(true); else setError(result.error ?? "Please try again."); }
      catch { setError("Could not connect. Please try again."); }
    })}>{pending ? "Connecting…" : `Continue as ${name}`}</button>
  </div>;
}
