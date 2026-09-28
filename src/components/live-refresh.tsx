"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw } from "lucide-react";
import { usePrefs } from "./providers";

export function LiveRefresh() {
  const { t } = usePrefs();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [online, setOnline] = useState(true);
  useEffect(() => {
    const sync = () => setOnline(navigator.onLine);
    sync();
    window.addEventListener("online", sync);
    window.addEventListener("offline", sync);
    const timer = setInterval(() => {
      if (document.visibilityState === "visible" && navigator.onLine && !document.querySelector('[role="dialog"]')) start(() => router.refresh());
    }, 30_000);
    return () => { clearInterval(timer); window.removeEventListener("online", sync); window.removeEventListener("offline", sync); };
  }, [router]);
  return <button className="btn btn-ghost btn-sm" disabled={pending || !online} onClick={() => start(() => router.refresh())} aria-label={t("Refresh attendance")}>
    <span className={`size-1.5 rounded-full ${online ? "bg-good" : "bg-warn"}`} />
    <span className="text-xs">{t(online ? "Live · 30s" : "Offline")}</span>
    <RefreshCw className={`size-3 ${pending ? "animate-spin" : ""}`} />
  </button>;
}
