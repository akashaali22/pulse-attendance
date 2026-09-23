import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { getSetting } from "@/lib/db";
import { getPrefs } from "@/lib/prefs";
import { Logo } from "@/components/logo";
import { ForgotForms } from "./forms";

export const metadata: Metadata = { title: "Forgot password" };
export const dynamic = "force-dynamic";

export default async function ForgotPage() {
  const { t } = await getPrefs();
  const company = getSetting("company_name", "My Company");
  // Only offered when the server actually has a recovery code configured.
  const recoveryAvailable = !!(process.env.ADMIN_RECOVERY_CODE ?? "").trim();

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-lg flex-col justify-center gap-6 p-6">
      <div className="flex items-center gap-3">
        <Logo />
        <div>
          <div className="font-semibold leading-tight">{t("Forgot password")}</div>
          <div className="text-xs text-muted">{company}</div>
        </div>
      </div>

      <ForgotForms recoveryAvailable={recoveryAvailable} />

      <Link href="/login" className="flex items-center justify-center gap-1.5 text-sm text-accent">
        <ArrowLeft className="size-4 rtl:rotate-180" /> {t("Back to sign in")}
      </Link>
    </main>
  );
}
