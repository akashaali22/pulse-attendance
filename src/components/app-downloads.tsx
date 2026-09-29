import { Apple, Download, Laptop, Smartphone } from "lucide-react";
import type { T } from "@/lib/i18n";
import { Card } from "@/components/ui";
import { CopyBox } from "@/app/(app)/apps/copy-box";

export type Os = "windows" | "mac" | "phone";

/** Best guess from the browser's user agent, so the visitor's own platform comes first. */
export function detectOs(ua: string): Os {
  const s = ua.toLowerCase();
  if (/android|iphone|ipad|ipod/.test(s)) return "phone";
  if (/mac os x|macintosh/.test(s)) return "mac";
  return "windows";
}

function Windows({ origin }: { origin: string }) {
  return (
    <div className="space-y-4 p-5 text-sm text-ink-2">
      <p className="text-ink">Records attendance by itself — nothing to press.</p>
      <a href="/api/agent/download" className="btn btn-primary w-full" download>
        <Download className="size-4" /> Download PulseAgent.exe
      </a>
      <ol className="list-decimal space-y-1.5 ps-5">
        <li>Run the file. Windows may warn about an unknown publisher — choose <em>More info → Run anyway</em>.</li>
        <li>
          Server address: <code className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-xs">{origin}</code>
        </li>
        <li>Sign in with your own email and password. That is the only time you type it.</li>
      </ol>
      <p className="text-xs text-muted">Needs nothing installed — it uses what already ships with Windows 10 and 11.</p>
    </div>
  );
}

function Mac({ origin }: { origin: string }) {
  return (
    <div className="space-y-4 p-5 text-sm text-ink-2">
      <p className="text-ink">Records attendance by itself — nothing to press.</p>

      {/* Terminal first, deliberately: the app is signed but not notarised by Apple, so macOS
          blocks the .dmg on first open. The installer is the same agent with no Gatekeeper prompt. */}
      <CopyBox text={`curl -fsSL ${origin}/api/agent/download/mac | bash`} />
      <ol className="list-decimal space-y-1.5 ps-5">
        <li>Open <strong>Terminal</strong> (Command + Space, type “Terminal”).</li>
        <li>Paste the line above and press Return.</li>
        <li>Sign in with your own email and password when asked. That is the only time you type it.</li>
      </ol>

      <details className="rounded-xl border border-line p-3">
        <summary className="cursor-pointer text-xs font-medium text-ink">Prefer an app you can see in Applications?</summary>
        <div className="mt-3 space-y-3">
          <a href="/api/agent/download/mac-dmg" className="btn btn-ghost w-full" download>
            <Download className="size-4" /> Download PulseAgent.dmg
          </a>
          <p className="text-xs">
            macOS will say it <em>cannot verify this app is free of malware</em>. That warning appears for every app
            not signed with a paid Apple Developer ID — it is not a finding about this app. Two ways past it:
          </p>
          <ol className="list-decimal space-y-1.5 ps-5 text-xs">
            <li>Open the image and drag <strong>Pulse Attendance</strong> into <strong>Applications</strong>.</li>
            <li>
              Double-click it once and let the warning appear, then go to <strong>System Settings → Privacy &amp;
              Security</strong>, scroll down and press <strong>Open Anyway</strong>.
            </li>
            <li>
              Or clear the download flag in Terminal, and it opens normally afterwards:
              <div className="mt-2">
                <CopyBox text={'xattr -dr com.apple.quarantine "/Applications/Pulse Attendance.app"'} />
              </div>
            </li>
          </ol>
          <p className="text-xs text-muted">
            On macOS 15 and later, right-clicking and choosing <em>Open</em> no longer works for unsigned apps — use one
            of the two steps above.
          </p>
          <div className="rounded-xl border border-good/30 bg-good/5 p-3">
            <div className="text-xs font-semibold text-ink">No warning at all: bring it on a USB stick</div>
            <p className="mt-1 text-xs">
              The warning comes from the flag a browser attaches to anything it downloads, not from the app. Copy
              PulseAgent.dmg onto a USB stick from another computer, plug it into the Mac and open it from there: the
              flag was never set, so the app opens with a plain double-click. Copying it from a shared network folder
              works the same way. AirDrop and email do not — they set the flag too.
            </p>
          </div>
        </div>
      </details>

      <p className="text-xs text-muted">
        Either way it installs for your account only — no admin password needed. It starts at every login and keeps your
        device token in the Mac’s Keychain.
      </p>
    </div>
  );
}

function Phone({ host, secure }: { host: string; secure: boolean }) {
  return (
    <div className="space-y-4 p-5 text-sm text-ink-2">
      <p className="text-ink">Install this site as an app for check-in on the move.</p>
      <div className="rounded-xl border border-line p-3">
        <div className="font-semibold text-ink">iPhone / iPad</div>
        <ol className="mt-1 list-decimal space-y-1 ps-5 text-xs">
          <li>Open <code className="font-mono">{host}</code> in <strong>Safari</strong></li>
          <li>Tap <strong>Share</strong> (the square with the arrow)</li>
          <li>Tap <strong>Add to Home Screen</strong></li>
        </ol>
      </div>
      <div className="rounded-xl border border-line p-3">
        <div className="font-semibold text-ink">Android</div>
        <ol className="mt-1 list-decimal space-y-1 ps-5 text-xs">
          <li>Open <code className="font-mono">{host}</code> in <strong>Chrome</strong></li>
          <li>Menu (⋮) → <strong>Install app</strong></li>
        </ol>
      </div>
      <p className="text-xs text-muted">
        On a phone, attendance is <strong>not</strong> automatic: you press Check In. Phones stop apps in the
        background, so nothing can record attendance on its own there.
        {!secure && " Camera and GPS also need the site to be served over HTTPS."}
      </p>
    </div>
  );
}

/** The three ways to get the app, the visitor's own platform first. */
export function AppDownloads({ origin, host, secure, first }: { origin: string; host: string; secure: boolean; first: Os }) {
  const cards: Record<Os, { icon: React.ReactNode; title: string; body: React.ReactNode }> = {
    windows: { icon: <Laptop className="size-4 text-accent" />, title: "Windows PC", body: <Windows origin={origin} /> },
    mac: { icon: <Apple className="size-4 text-accent" />, title: "Mac", body: <Mac origin={origin} /> },
    phone: { icon: <Smartphone className="size-4 text-accent" />, title: "Phone", body: <Phone host={host} secure={secure} /> },
  };
  const order: Os[] = [first, ...(["windows", "mac", "phone"] as Os[]).filter((o) => o !== first)];

  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
      {order.map((os, i) => (
        <Card
          key={os}
          className={i === 0 ? "border-accent/40" : undefined}
          title={
            <span className="flex items-center gap-2">
              {cards[os].icon} {cards[os].title}
              {i === 0 && <span className="rounded-full bg-accent-soft px-2 py-0.5 text-[10px] font-medium text-accent">Your device</span>}
            </span>
          }
        >
          {cards[os].body}
        </Card>
      ))}
    </div>
  );
}

/** What the desktop agent records, in plain words. */
export function AgentBehaviour({ t, footer }: { t: T; footer?: React.ReactNode }) {
  return (
    <Card className="mt-4" title={t("What the desktop agent does")}>
      <div className="overflow-x-auto">
        <table className="data">
          <thead>
            <tr>
              <th>{t("On your computer")}</th>
              <th>{t("Recorded as")}</th>
            </tr>
          </thead>
          <tbody>
            {[
              ["Log in / unlock / wake up", "Check-in"],
              ["Lock the screen for longer than the away limit", "Checked out at the moment you locked it"],
              ["Sleep, log off or shut down", "Check-out"],
              ["Power cut or crash", "Checked out at the last signal the server received"],
              ["No internet", "Saved on the computer and sent later, with the original time"],
            ].map(([a, b]) => (
              <tr key={a}>
                <td className="text-ink">{a}</td>
                <td>{b}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {footer && <p className="px-5 py-3 text-xs text-muted">{footer}</p>}
    </Card>
  );
}
