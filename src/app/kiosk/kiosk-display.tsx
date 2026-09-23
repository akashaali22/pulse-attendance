"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import QRCode from "qrcode";
import { ArrowLeft, Maximize2, ShieldCheck } from "lucide-react";
import { usePrefs } from "@/components/providers";
import { Logo } from "@/components/logo";

export function KioskDisplay({ company, lanIps }: { company: string; lanIps: string[] }) {
  const { t } = usePrefs();
  const [qr, setQr] = useState<string | null>(null);
  const [expiresAt, setExpiresAt] = useState(0);
  // Rendered only after mount: the wall clock differs between server and browser.
  const [now, setNow] = useState<number | null>(null);
  const [base, setBase] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const { protocol, hostname, port } = window.location;
    const local = hostname === "localhost" || hostname === "127.0.0.1";
    setBase(local && lanIps[0] ? `${protocol}//${lanIps[0]}${port ? `:${port}` : ""}` : window.location.origin);
  }, [lanIps]);

  useEffect(() => {
    if (!base) return;
    let alive = true;
    let timer: ReturnType<typeof setTimeout>;
    const load = async () => {
      try {
        const r = await fetch("/api/kiosk/token", { cache: "no-store" });
        if (!r.ok) throw new Error("Session expired — sign in again");
        const { token, expiresAt: exp } = (await r.json()) as { token: string; expiresAt: number };
        const url = `${base}/scan?t=${encodeURIComponent(token)}`;
        const img = await QRCode.toDataURL(url, { margin: 1, width: 560, errorCorrectionLevel: "M", color: { dark: "#0b1020", light: "#ffffff" } });
        if (!alive) return;
        setQr(img);
        setExpiresAt(exp);
        setError(null);
        timer = setTimeout(load, Math.max(1000, exp - Date.now() + 200));
      } catch (e) {
        if (!alive) return;
        setError(e instanceof Error ? e.message : "Failed");
        timer = setTimeout(load, 5000);
      }
    };
    load();
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [base]);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(id);
  }, []);

  const left = now === null ? 0 : Math.max(0, expiresAt - now);
  const clock = now === null ? null : new Date(now);

  return (
    <main className="relative flex min-h-screen flex-col items-center justify-center gap-8 p-6">
      <div className="absolute start-4 top-4 flex gap-2">
        <Link href="/dashboard" className="btn btn-ghost btn-sm"><ArrowLeft className="size-4 rtl:rotate-180" /></Link>
        <button className="btn btn-ghost btn-sm" onClick={() => document.documentElement.requestFullscreen?.()} aria-label="Fullscreen">
          <Maximize2 className="size-4" />
        </button>
      </div>
      <div className="flex items-center gap-3">
        <Logo className="size-11" />
        <div>
          <div className="text-xl font-semibold">{company}</div>
          <div className="text-sm text-muted">{t("Scan to check in")}</div>
        </div>
      </div>

      <div className="text-center">
        <div className="font-mono text-6xl font-semibold tracking-tight tabular sm:text-7xl">
          {clock ? clock.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }) : "--:--:--"}
        </div>
        <div className="mt-1 text-muted">{clock ? clock.toLocaleDateString([], { weekday: "long", day: "numeric", month: "long" }) : " "}</div>
      </div>

      <div className="relative rounded-[28px] bg-white p-5 shadow-2xl shadow-accent/30">
        <div className="absolute -inset-[3px] -z-10 rounded-[30px] bg-gradient-to-br from-accent to-accent-2 opacity-80 blur-sm" />
        {qr ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={qr} alt="Check-in QR code" className="size-[min(70vw,380px)]" />
        ) : (
          <div className="size-[min(70vw,380px)] animate-pulse rounded-xl bg-slate-200" />
        )}
      </div>

      <div className="w-[min(70vw,380px)]">
        <div className="h-1.5 overflow-hidden rounded-full bg-surface-2">
          <div className="h-full rounded-full bg-gradient-to-r from-accent to-accent-2 transition-[width] duration-200" style={{ width: `${(left / 15000) * 100}%` }} />
        </div>
        <p className="mt-2 flex items-center justify-center gap-1.5 text-xs text-muted">
          <ShieldCheck className="size-3.5 text-good" /> {t("Code refreshes every 15 seconds")}
        </p>
        {error && <p className="mt-2 text-center text-sm text-bad">{error}</p>}
        <p className="mt-2 text-center font-mono text-[11px] text-muted">{base}</p>
      </div>
    </main>
  );
}
