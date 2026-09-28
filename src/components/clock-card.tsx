"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import clsx from "clsx";
import { Camera, Coffee, Loader2, LogIn, LogOut, MapPin, Play, X } from "lucide-react";
import { punch, type PunchPayload } from "@/actions/punch";
import type { DayStatus, PunchType } from "@/lib/engine";
import { usePrefs } from "./providers";
import { StatusBadge } from "./ui";
import { Dialog } from "./dialog";

export interface ClockState {
  status: DayStatus;
  workedMin: number;
  targetMin: number;
  breakMin: number;
  firstIn: string;
  lastOut: string;
  late: boolean;
  lateMin: number;
  renderedAt: number;
  manualBreak: boolean;
  breakStartTs: number | null; // today's fixed company break (auto-deducted)
  breakEndTs: number | null;
}

function fmtClock(totalSec: number) {
  const s = Math.max(0, Math.floor(totalSec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return [h, m, sec].map((n) => String(n).padStart(2, "0")).join(":");
}

function getLocation(): Promise<GeolocationPosition | null> {
  return new Promise((resolve) => {
    if (!("geolocation" in navigator)) return resolve(null);
    navigator.geolocation.getCurrentPosition(resolve, () => resolve(null), { enableHighAccuracy: true, timeout: 10000, maximumAge: 30000 });
  });
}

export function ClockCard({
  state,
  shiftLabel,
  requireSelfie,
  kioskToken,
  compact,
}: {
  state: ClockState;
  shiftLabel: string;
  requireSelfie: boolean;
  kioskToken?: string;
  compact?: boolean;
}) {
  const { t, toast } = usePrefs();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [phase, setPhase] = useState<string | null>(null);
  // Start from the server's timestamp so the first client render matches the server HTML,
  // then tick from the real clock. (A Date.now() seed here causes a hydration mismatch.)
  const [now, setNow] = useState(state.renderedAt);
  const [selfieFor, setSelfieFor] = useState<PunchType | null>(null);

  const open = state.status === "WORKING" || state.status === "ON_BREAK";
  useEffect(() => {
    if (!open) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [open]);

  // The company break switches on and off by the clock, without any button press.
  const { breakStartTs: bs, breakEndTs: be } = state;
  const inAutoBreak = open && !state.manualBreak && bs !== null && be !== null && now >= bs && now < be;
  const onBreak = state.manualBreak || inAutoBreak;
  const status: DayStatus = open ? (onBreak ? "ON_BREAK" : "WORKING") : state.status;

  // Live seconds since render, excluding any time inside the fixed break window (or a manual break).
  let elapsed = 0;
  if (open && !state.manualBreak) {
    elapsed = (now - state.renderedAt) / 1000;
    if (bs !== null && be !== null) {
      const overlap = Math.max(0, Math.min(now, be) - Math.max(state.renderedAt, bs));
      elapsed -= overlap / 1000;
    }
  }
  const workedSec = state.workedMin * 60 + Math.max(0, elapsed);
  const target = Math.max(1, state.targetMin) * 60;
  const pct = Math.min(100, (workedSec / target) * 100);
  const live = status === "WORKING";

  // Alert when the break starts / ends while the page is open.
  const wasAutoBreak = useRef(inAutoBreak);
  useEffect(() => {
    if (wasAutoBreak.current === inAutoBreak) return;
    wasAutoBreak.current = inAutoBreak;
    toast(inAutoBreak ? t("Break started") : t("Break over — back to work"));
    router.refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inAutoBreak]);

  async function doPunch(type: PunchType, selfie?: string) {
    if (requireSelfie && type === "IN" && !selfie) {
      setSelfieFor(type);
      return;
    }
    setPhase(t("Getting location…"));
    const pos = await getLocation();
    setPhase(null);
    const payload: PunchPayload = {
      type,
      lat: pos?.coords.latitude ?? null,
      lng: pos?.coords.longitude ?? null,
      accuracy: pos?.coords.accuracy ?? null,
      selfie: selfie ?? null,
      kioskToken: kioskToken ?? null,
    };
    start(async () => {
      const r = await punch(payload);
      if (r.ok) toast(t(r.message ?? "Saved successfully"));
      else toast(t(r.error), "error");
      router.refresh();
    });
  }

  const busy = pending || !!phase;

  return (
    <div data-live={live} className={clsx("clock-hero card relative overflow-hidden rise", compact ? "p-5" : "p-6")}>
      <div className="clock-heading">
        <div className="eyebrow"><span className="signal-mark" aria-hidden><i /><i /><i /></span>{t("Your working day")}</div>
        <h2 key={status}>{t(live ? "You're on the clock." : onBreak ? "A moment to recharge." : workedSec > 0 ? "Your time, accounted for." : "Ready when you are.")}</h2>
      </div>
      <div className="relative flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <StatusBadge status={status} label={inAutoBreak ? t("Lunch break") : t(status)} />
          {state.late && <StatusBadge status="INCOMPLETE" label={`${t("Late")} ${state.lateMin}m`} />}
        </div>
        <span className="text-xs text-muted">
          {t("Shift today")}: <span className="text-ink-2">{shiftLabel}</span>
        </span>
      </div>

      <div className="relative mt-6 flex flex-col items-center">
        <div className="clock-orbit relative grid size-52 place-items-center">
          <svg className="absolute inset-0 -rotate-90" viewBox="0 0 200 200" aria-hidden>
            <circle cx="100" cy="100" r="98" fill="none" stroke="var(--muted)" strokeOpacity=".35" strokeWidth="2" strokeDasharray="1 9.26" />
            <circle cx="100" cy="100" r="90" fill="none" stroke="var(--surface-2)" strokeWidth="10" />
            <circle
              cx="100"
              cy="100"
              r="90"
              fill="none"
              className="clock-progress"
              stroke="var(--accent)"
              strokeWidth="10"
              strokeLinecap="round"
              strokeDasharray={2 * Math.PI * 90}
              strokeDashoffset={2 * Math.PI * 90 * (1 - pct / 100)}

            />
            <circle cx="100" cy="100" r="77" fill="none" stroke="var(--border)" strokeWidth="1" strokeDasharray="1 6" />
            <circle cx="100" cy="100" r="72" fill="none" stroke="var(--warn)" strokeOpacity=".65" strokeWidth="2" strokeDasharray={`${Math.min(1, state.breakMin / Math.max(1, state.targetMin)) * 452.39} 452.39`} />
          </svg>
          <div className="text-center">
            <div dir="ltr" className="font-mono text-[32px] font-semibold tracking-tight tabular">{fmtClock(workedSec)}</div>
            <div className="mt-1 text-[11px] uppercase tracking-[0.18em] text-muted">{t("Worked today")}</div>
          </div>
        </div>

        <div className="clock-target"><span className="tabular">{Math.round(pct)}%</span><span>{t("of daily target")}</span><span className="clock-target-line" aria-hidden /></div>

        <div className="clock-details mt-6 grid w-full grid-cols-3 gap-2 text-center">
          {[
            [t("First in"), state.firstIn],
            [t("Break time"), `${Math.round(state.breakMin)}m`],
            [t("Last out"), state.lastOut],
          ].map(([k, v]) => (
            <div key={k} className="rounded-xl bg-surface-2 px-2 py-2.5">
              <div className="text-[10px] uppercase tracking-wider text-muted">{k}</div>
              <div className="mt-0.5 text-sm font-semibold tabular">{v}</div>
            </div>
          ))}
        </div>

        <div className="mt-5 flex w-full gap-2">
          {!open && (
            <button className="btn btn-primary flex-1 py-3 text-base" disabled={busy} onClick={() => doPunch("IN")}>
              {busy ? <Loader2 className="size-5 animate-spin" /> : <LogIn className="size-5 rtl:rotate-180" />} {t("Check In")}
            </button>
          )}
          {open && (
            <>
              {inAutoBreak ? (
                <div className="flex flex-1 items-center justify-center gap-2 rounded-xl border border-warn/30 bg-warn/10 py-3 text-sm font-medium text-warn">
                  <Coffee className="size-4" /> {t("Lunch break")}
                </div>
              ) : (
                <button className="btn btn-ghost flex-1 py-3" disabled={busy} onClick={() => doPunch(state.manualBreak ? "BREAK_END" : "BREAK_START")}>
                  {state.manualBreak ? <Play className="size-4" /> : <Coffee className="size-4" />} {state.manualBreak ? t("End Break") : t("Start Break")}
                </button>
              )}
              <button className="btn btn-danger flex-1 py-3" disabled={busy} onClick={() => doPunch("OUT")}>
                {busy ? <Loader2 className="size-4 animate-spin" /> : <LogOut className="size-4 rtl:rotate-180" />} {t("Check Out")}
              </button>
            </>
          )}
        </div>
        {phase && (
          <p className="mt-3 flex items-center gap-1.5 text-xs text-muted">
            <MapPin className="size-3.5" /> {phase}
          </p>
        )}
      </div>

      {selfieFor && (
        <SelfieModal
          onCancel={() => setSelfieFor(null)}
          onCapture={(img) => {
            const type = selfieFor;
            setSelfieFor(null);
            doPunch(type, img);
          }}
        />
      )}
    </div>
  );
}

function SelfieModal({ onCapture, onCancel }: { onCapture: (dataUrl: string) => void; onCancel: () => void }) {
  const { t } = usePrefs();
  const video = useRef<HTMLVideoElement>(null);
  const [shot, setShot] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let stream: MediaStream | null = null;
    navigator.mediaDevices
      ?.getUserMedia({ video: { facingMode: "user", width: 480, height: 360 } })
      .then((s) => {
        stream = s;
        if (video.current) video.current.srcObject = s;
      })
      .catch(() => setErr("Camera permission denied or unavailable"));
    return () => stream?.getTracks().forEach((tr) => tr.stop());
  }, []);

  const capture = () => {
    const v = video.current;
    if (!v) return;
    const c = document.createElement("canvas");
    c.width = 320;
    c.height = Math.round((320 * v.videoHeight) / Math.max(1, v.videoWidth)) || 240;
    c.getContext("2d")!.drawImage(v, 0, 0, c.width, c.height);
    setShot(c.toDataURL("image/jpeg", 0.75));
  };

  return (
    <Dialog label={t("Take selfie")} onClose={onCancel} className="max-w-sm p-5">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="font-semibold">{t("Take selfie")}</h3>
          <button onClick={onCancel} aria-label={t("Close")}>
            <X className="size-4 text-muted" />
          </button>
        </div>
        <div className="relative aspect-[4/3] overflow-hidden rounded-xl bg-black">
          {shot ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={shot} alt="Selfie preview" className="size-full object-cover" />
          ) : (
            <video ref={video} autoPlay playsInline muted className="size-full -scale-x-100 object-cover" />
          )}
          {!shot && <div className="pointer-events-none absolute inset-[18%] rounded-[50%] border-2 border-dashed border-white/50" />}
        </div>
        {err && <p className="mt-2 text-sm text-bad">{err}</p>}
        <div className="mt-4 flex gap-2">
          {shot ? (
            <>
              <button className="btn btn-ghost flex-1" onClick={() => setShot(null)}>
                {t("Retake")}
              </button>
              <button className="btn btn-primary flex-1" onClick={() => onCapture(shot)}>
                {t("Check In")}
              </button>
            </>
          ) : (
            <button className="btn btn-primary flex-1" onClick={capture} disabled={!!err}>
              <Camera className="size-4" /> {t("Take selfie")}
            </button>
          )}
        </div>
    </Dialog>
  );
}
