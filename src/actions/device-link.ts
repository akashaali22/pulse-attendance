"use server";
import { clientIp, getUser } from "@/lib/auth";
import { approveDeviceLink } from "@/lib/device-link";
import { getSetting } from "@/lib/db";
import { ipAllowed } from "@/lib/geo";
export async function approveLink(code: string) {
  const user = await getUser();
  if (!user) return { error: "Your session expired. Sign in and try again." };
  if (!ipAllowed(await clientIp(), getSetting("allowed_ips"))) return { error: "This network is not allowed." };
  if (!approveDeviceLink(code, user.id)) return { error: "Link expired or already used. Start again in the app." };
  return { ok: true };
}
