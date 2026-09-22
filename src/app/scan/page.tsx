import Link from "next/link";
import type { Metadata } from "next";
import { QrCode, XCircle } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { verifyKioskToken } from "@/lib/kiosk";
import { computeUserDay, getTz, todayLocal } from "@/lib/data";
import { getPrefs } from "@/lib/prefs";
import { shiftLabel, toClockState } from "@/lib/view";
import { ClockCard } from "@/components/clock-card";
import { Logo } from "@/components/logo";

export const metadata: Metadata = { title: "QR check-in" };
export const dynamic = "force-dynamic";

export default async function ScanPage({ searchParams }: { searchParams: Promise<{ t?: string }> }) {
  const me = await requireUser();
  const { t } = await getPrefs();
  const { t: token = "" } = await searchParams;
  const valid = verifyKioskToken(token, 1);
  const day = computeUserDay(me, todayLocal());

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-5 p-4">
      <div className="flex items-center gap-3">
        <Logo />
        <div>
          <div className="font-semibold">{me.name}</div>
          <div className="flex items-center gap-1 text-xs text-muted"><QrCode className="size-3.5" /> QR check-in</div>
        </div>
      </div>
      {valid ? (
        <ClockCard state={toClockState(day, getTz(), me.shift_id)} shiftLabel={shiftLabel(me.shift_id)} requireSelfie={!!me.require_selfie} kioskToken={token} compact />
      ) : (
        <div className="card flex flex-col items-center gap-3 p-8 text-center rise">
          <XCircle className="size-10 text-bad" />
          <p className="font-semibold">{t("Invalid or expired QR code")}</p>
          <p className="text-sm text-muted">Scan the code on the kiosk screen again.</p>
        </div>
      )}
      <Link href="/dashboard" className="text-center text-sm text-accent">{t("Dashboard")}</Link>
    </main>
  );
}
