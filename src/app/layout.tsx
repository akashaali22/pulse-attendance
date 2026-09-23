import type { Metadata, Viewport } from "next";
import { getPrefs } from "@/lib/prefs";
import { Providers } from "@/components/providers";
import { RegisterServiceWorker } from "@/components/pwa";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Pulse Attendance", template: "%s · Pulse Attendance" },
  description: "Workforce attendance, leave and time tracking",
  manifest: "/manifest.webmanifest",
  applicationName: "Pulse",
  appleWebApp: { capable: true, title: "Pulse", statusBarStyle: "black-translucent" },
  icons: {
    icon: [
      { url: "/icon.svg", type: "image/svg+xml" },
      { url: "/icon-192.png", sizes: "192x192", type: "image/png" },
    ],
    apple: [{ url: "/apple-touch-icon.png", sizes: "180x180" }],
  },
  formatDetection: { telephone: false },
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
          <RegisterServiceWorker />
        </Providers>
      </body>
    </html>
  );
}
