import "server-only";
import { cookies } from "next/headers";
import { translator, type Lang } from "./i18n";

export async function getPrefs() {
  const jar = await cookies();
  const lang: Lang = jar.get("lang")?.value === "ur" ? "ur" : "en";
  const theme: "light" | "dark" = jar.get("theme")?.value === "light" ? "light" : "dark";
  return { lang, theme, t: translator(lang) };
}
