import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getUser } from "@/lib/auth";
import { getSetting } from "@/lib/db";
import { LoginForm } from "./login-form";
import { Fingerprint, MapPin, QrCode, ShieldCheck } from "lucide-react";
import { getPrefs } from "@/lib/prefs";
import { Logo } from "@/components/logo";

export const metadata: Metadata = { title: "Sign in" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  if (await getUser()) redirect(next?.startsWith("/") && !next.startsWith("//") ? next : "/dashboard");
  const { t } = await getPrefs();
  const company = getSetting("company_name", "My Company");

  return (
    <main className="grid min-h-screen lg:grid-cols-[1.1fr_1fr]">
      <section className="auth-brand relative hidden overflow-hidden border-e border-line p-12 lg:flex lg:flex-col lg:justify-between">
        <div className="auth-orbit" aria-hidden />
        <div className="relative flex items-center gap-3">
          <Logo />
          <span className="text-lg font-semibold tracking-tight">Pulse</span>
        </div>
        <div className="relative max-w-lg">
          <p className="auth-eyebrow">{t("People. Time. In sync.")}</p>
          <h1 className="text-5xl font-semibold leading-[1.05] tracking-tight">
            {t("A clearer view of every working day.")}
          </h1>
          <p className="mt-5 text-ink-2">
            {t("Attendance, leave and your entire team. Connected in one workspace.")}
          </p>
          <div className="mt-10 grid grid-cols-2 gap-3 text-sm">
            {[
              [MapPin, "Geofenced check-in"],
              [QrCode, "Rotating QR kiosk"],
              [Fingerprint, "Selfie verification"],
              [ShieldCheck, "Hash-chained audit log"],
            ].map(([Icon, label]) => {
              const I = Icon as typeof MapPin;
              return (
                <div key={label as string} className="card flex items-center gap-3 px-4 py-3">
                  <I className="size-4 text-accent" />
                  <span className="text-ink-2">{t(label as string)}</span>
                </div>
              );
            })}
          </div>
        </div>
        <p className="text-xs text-muted">© {new Date().getFullYear()} {company}</p>
      </section>

      <section className="flex items-center justify-center p-6">
        <div className="auth-form-surface w-full max-w-[420px] rise">
          <div className="mb-8 flex items-center gap-3 lg:hidden">
            <Logo />
            <span className="text-lg font-semibold">Pulse</span>
          </div>
          <h2 className="text-2xl font-semibold tracking-tight">{t("Welcome back")}</h2>
          <p className="mt-1 text-sm text-muted">{t("Sign in to your workspace")}</p>
          <LoginForm next={next ?? ""} />
        </div>
      </section>
    </main>
  );
}
