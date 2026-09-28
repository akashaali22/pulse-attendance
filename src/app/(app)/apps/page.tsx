import type { Metadata } from "next";
import { headers } from "next/headers";
import { requireUser } from "@/lib/auth";
import { getPrefs } from "@/lib/prefs";
import { PageHeader } from "@/components/ui";
import { AgentBehaviour, AppDownloads, detectOs } from "@/components/app-downloads";

export const metadata: Metadata = { title: "Get the app" };
export const dynamic = "force-dynamic";

export default async function AppsPage() {
  const me = await requireUser();
  const { t } = await getPrefs();
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  const origin = `${proto}://${host}`;

  return (
    <>
      <PageHeader title={t("Get the app")} subtitle={t("Install it once and your attendance is recorded automatically")} />
      <AppDownloads origin={origin} host={host} secure={proto === "https" || host.startsWith("localhost")} first={detectOs(h.get("user-agent") ?? "")} />
      <AgentBehaviour
        t={t}
        footer={`Signed in as ${me.name}. The agent only sends your own attendance — it cannot read anyone else’s data, and an admin can unlink any computer at any time.`}
      />
    </>
  );
}
