import { getUser } from "@/lib/auth";
import { all } from "@/lib/db";

export const dynamic = "force-dynamic";

/** Unread notifications newer than ?after=<id>, polled by the shell for live alerts. */
export async function GET(req: Request) {
  const me = await getUser();
  if (!me) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const after = Number(new URL(req.url).searchParams.get("after")) || 0;
  const items = all<{ id: number; title: string; body: string | null; link: string | null }>(
    "SELECT id, title, body, link FROM notifications WHERE user_id = ? AND read = 0 AND id > ? ORDER BY id LIMIT 10",
    me.id,
    after,
  );
  return Response.json({ items }, { headers: { "Cache-Control": "no-store" } });
}
