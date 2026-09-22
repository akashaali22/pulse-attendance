import type { Metadata, Viewport } from "next";
import { getPrefs } from "@/lib/prefs";
import { Providers } from "@/components/providers";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Pulse Attendance", template: "%s · Pulse Attendance" },
  description: "Workforce attendance, leave and time tracking",
  manifest: "/manifest.webmanifest",
};

export const viewport: Viewport = {
  themeColor: "#07080c",
  width: "device-width",
  initialScale: 1,
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const { lang, theme } = await getPrefs();
  return (
    <html
      lang={lang}
      dir={lang === "ur" ? "rtl" : "ltr"}
      className={theme === "dark" ? "dark" : ""}
      suppressHydrationWarning
    >
      <body className="ambient min-h-screen">
        <Providers lang={lang} theme={theme}>
          {children}
        </Providers>
      </body>
    </html>
  );
}
