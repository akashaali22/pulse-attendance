import os from "node:os";
import type { Metadata } from "next";
import { requireUser } from "@/lib/auth";
import { getSetting } from "@/lib/db";
import { KioskDisplay } from "./kiosk-display";

export const metadata: Metadata = { title: "QR Kiosk" };
export const dynamic = "force-dynamic";

export default async function KioskPage() {
  await requireUser(["admin", "manager"]);
  // LAN addresses so phones on the office Wi-Fi can reach this server even if the kiosk was opened via localhost.
  const lan = Object.values(os.networkInterfaces())
    .flat()
    .filter((i): i is os.NetworkInterfaceInfo => !!i && i.family === "IPv4" && !i.internal)
    .map((i) => i.address);
  return <KioskDisplay company={getSetting("company_name")} lanIps={lan} />;
}
