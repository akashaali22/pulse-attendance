"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import QRCode from "qrcode";
import { ArrowLeft, Maximize2, ShieldCheck } from "lucide-react";
import { usePrefs } from "@/components/providers";
import { Logo } from "@/components/logo";

export function KioskDisplay({ company, lanIps }: { company: string; lanIps: string[] }) {
  const { t, lang } = usePrefs();
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
    <main className="kiosk-stage">
      <header className="kiosk-top">
        <div className="flex items-center gap-3"><Logo className="size-11" /><div><strong className="block text-lg">{company}</strong><span className="eyebrow mt-1 text-muted">Pulse · {t("Attendance terminal")}</span></div></div>
        <div className="flex gap-2">
          <Link href="/dashboard" aria-label={t("Dashboard")} className="btn btn-ghost btn-sm"><ArrowLeft className="size-4 rtl:rotate-180" /></Link>
          <button className="btn btn-ghost btn-sm" onClick={() => document.documentElement.requestFullscreen?.()} aria-label={t("Fullscreen")}><Maximize2 className="size-4" /></button>
        </div>
      </header>
      <div className="kiosk-layout">
        <section className="kiosk-welcome">
          <div className="eyebrow text-accent"><span className="signal-mark" aria-hidden><i /><i /><i /></span>{t("Your day starts here")}</div>
          <h1>{t("A great day.")}<br /><span>{t("One simple scan.")}</span></h1>
          <p>{t("Scan the code with your phone, then confirm your attendance in your workspace.")}</p>
          <div className="kiosk-clock">
            <time className="tabular" suppressHydrationWarning>{clock ? clock.toLocaleTimeString(lang === "ur" ? "ur-PK" : "en-GB", { hour: "2-digit", minute: "2-digit" }) : "--:--"}</time>
            <span>{clock ? clock.toLocaleDateString(lang === "ur" ? "ur-PK" : "en-GB", { weekday: "long", day: "numeric", month: "long" }) : " "}</span>
          </div>
          <ol className="kiosk-steps"><li><span>01</span>{t("Open your phone camera")}</li><li><span>02</span>{t("Scan to open your workspace")}</li><li><span>03</span>{t("Confirm your check-in")}</li></ol>
        </section>
        <section className="kiosk-console" aria-label={t("Scan to check in")}>
          <div className="kiosk-console-top"><span className="eyebrow">{t("Scan to check in")}</span><span className="flex items-center gap-2 text-xs"><span className={`size-1.5 rounded-full ${error ? "bg-warn" : qr ? "bg-good" : "bg-muted"}`} />{t(error ? "Reconnecting…" : qr ? "Connected" : "Connecting…")}</span></div>
          <div className="kiosk-scan-area">
            <div className="kiosk-qr">
              {qr ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img key={expiresAt} src={qr} alt="Check-in QR code" className="qr-enter" />
              ) : <div className="kiosk-qr-placeholder skeleton" />}
            </div>
          </div>
          <div className="kiosk-refresh"><div className="flex items-center justify-between gap-3"><span>{t("Code refreshes every 15 seconds")}</span><strong className="tabular">{Math.ceil(left / 1000)}s</strong></div><div className="kiosk-refresh-track"><div className="progress-fill" style={{ transform: `scaleX(${Math.min(1, left / 15000)})` }} /></div></div>
          {error && <p role="alert" className="px-6 pb-4 text-center text-sm text-bad">{error}</p>}
        </section>
      </div>
      <footer className="kiosk-footer"><span className="flex items-center gap-2"><ShieldCheck className="size-4 text-accent" />{t("A fresh code. A verified arrival.")}</span><span className="font-mono text-[10px]">{base}</span></footer>
    </main>
  );
}
