import { redirect } from "next/navigation";
import { getUser } from "@/lib/auth";
import { findDeviceLink } from "@/lib/device-link";
import { ConfirmLink } from "./confirm";
export const dynamic = "force-dynamic";
export const metadata = { title: "Connect desktop app", referrer: "no-referrer" };
export default async function LinkDevicePage({ searchParams }: { searchParams: Promise<{ code?: string }> }) {
  const { code = "" } = await searchParams;
  const user = await getUser();
  if (!user) redirect(`/login?next=${encodeURIComponent(`/link-device?code=${code}`)}`);
  const link = findDeviceLink(code);
  return <main className="mx-auto max-w-lg p-6 pt-16"><div className="card space-y-5 p-6">
    <h1 className="text-2xl font-semibold">Connect Pulse Attendance</h1>
    {!link || link.consumed || link.user_id ? <p>This link has expired or already been used. Return to the app to continue or start a new link.</p> : <>
      <p>Connect <strong>{link.name}</strong> to your account for automatic attendance.</p>
      <p className="text-sm text-muted">Only continue if you just opened the app on this computer. Match this code with the app:</p>
      <p className="font-mono text-2xl tracking-widest">{code.slice(0, 8).toUpperCase()}</p>
      <p className="text-sm">Signed in as {user.name} · {user.email}</p>
      <ConfirmLink code={code} name={user.name} />
      <a className="btn btn-ghost" href="/dashboard">Cancel</a>
    </>}
  </div></main>;
}
