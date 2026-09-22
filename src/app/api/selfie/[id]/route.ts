import fs from "node:fs";
import path from "node:path";
import { canManage, getUser } from "@/lib/auth";
import { DATA_DIR, get } from "@/lib/db";

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const me = await getUser();
  if (!me) return new Response("Unauthorized", { status: 401 });
  const { id } = await params;
  const p = get<{ user_id: number; selfie_path: string | null }>("SELECT user_id, selfie_path FROM punches WHERE id = ?", Number(id));
  if (!p?.selfie_path) return new Response("Not found", { status: 404 });
  if (p.user_id !== me.id && !canManage(me, p.user_id)) return new Response("Forbidden", { status: 403 });
  const file = path.join(DATA_DIR, "selfies", path.basename(p.selfie_path));
  if (!fs.existsSync(file)) return new Response("Not found", { status: 404 });
  const type = file.endsWith(".png") ? "image/png" : file.endsWith(".webp") ? "image/webp" : "image/jpeg";
  return new Response(fs.readFileSync(file), { headers: { "Content-Type": type, "Cache-Control": "private, max-age=3600" } });
}
