import type { Metadata } from "next";
import Link from "next/link";
import { headers } from "next/headers";
import { ArrowLeft } from "lucide-react";
import { getSetting } from "@/lib/db";
import { getPrefs } from "@/lib/prefs";
import { Logo } from "@/components/logo";
import { AgentBehaviour, AppDownloads, detectOs } from "@/components/app-downloads";

export const metadata: Metadata = { title: "Download the app" };
export const dynamic = "force-dynamic";

/** Public: reachable from the sign-in page, so a new employee can install the agent first. */
export default async function DownloadPage() {
  const { t } = await getPrefs();
  const company = getSetting("company_name", "My Company");
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  const origin = `${proto}://${host}`;

  return (
    <main className="mx-auto w-full max-w-6xl p-6">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <Logo />
          <div>
            <h1 className="text-xl font-semibold tracking-tight">{t("Download the app")}</h1>
            <p className="text-xs text-muted">{company} · {t("Choose your device")}</p>
          </div>
        </div>
        <Link href="/login" className="btn btn-ghost btn-sm">
          <ArrowLeft className="size-4 rtl:rotate-180" /> {t("Back to sign in")}
        </Link>
      </div>

      <AppDownloads origin={origin} host={host} secure={proto === "https" || host.startsWith("localhost")} first={detectOs(h.get("user-agent") ?? "")} />
      <AgentBehaviour t={t} footer="The app connects through your browser. If you are already signed in, confirm your account without entering your password again." />
    </main>
  );
}
