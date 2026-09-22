import { getUser } from "@/lib/auth";
import { currentKioskToken } from "@/lib/kiosk";

export const dynamic = "force-dynamic";

export async function GET() {
  const me = await getUser();
  if (!me || me.role === "employee") return Response.json({ error: "Forbidden" }, { status: 403 });
  return Response.json(currentKioskToken(), { headers: { "Cache-Control": "no-store" } });
}
