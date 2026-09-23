"use client";

import { useState } from "react";
import { KeyRound, ShieldCheck } from "lucide-react";
import { requestPasswordReset, resetWithRecoveryCode } from "@/actions/recovery";
import { ActionForm, Field, SubmitButton } from "@/components/forms";
import { usePrefs } from "@/components/providers";

export function ForgotForms({ recoveryAvailable }: { recoveryAvailable: boolean }) {
  const { t } = usePrefs();
  const [tab, setTab] = useState<"ask" | "recover">("ask");

  return (
    <div className="card rise overflow-hidden">
      <div className="flex border-b border-line">
        {(["ask", "recover"] as const).map((id) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            className={`flex-1 px-4 py-3 text-sm font-medium transition ${tab === id ? "bg-accent-soft text-ink" : "text-muted hover:text-ink"}`}
          >
            {id === "ask" ? t("Ask my admin") : t("I am the admin")}
          </button>
        ))}
      </div>

      {tab === "ask" ? (
        <ActionForm action={requestPasswordReset} className="space-y-3 p-5">
          <p className="flex items-start gap-2 text-sm text-ink-2">
            <KeyRound className="mt-0.5 size-4 shrink-0 text-accent" />
            {t("Your admin will set a new password for you and pass it on.")}
          </p>
          <Field label="Email">
            <input name="email" type="email" required className="input" placeholder="you@company.com" autoComplete="username" />
          </Field>
          <Field label="Message for your admin (optional)">
            <input name="note" className="input" maxLength={200} placeholder="e.g. cannot sign in since this morning" />
          </Field>
          <SubmitButton className="w-full">{t("Send request")}</SubmitButton>
        </ActionForm>
      ) : recoveryAvailable ? (
        <ActionForm action={resetWithRecoveryCode} className="space-y-3 p-5">
          <p className="flex items-start gap-2 text-sm text-ink-2">
            <ShieldCheck className="mt-0.5 size-4 shrink-0 text-accent" />
            {t("Use the recovery code kept with the server settings to set a new admin password.")}
          </p>
          <Field label="Admin email">
            <input name="email" type="email" required className="input" autoComplete="username" />
          </Field>
          <Field label="Recovery code">
            <input name="code" required className="input font-mono" autoComplete="one-time-code" />
          </Field>
          <Field label="New password">
            <input name="password" type="password" required minLength={8} className="input" autoComplete="new-password" />
          </Field>
          <SubmitButton className="w-full">{t("Set new password")}</SubmitButton>
        </ActionForm>
      ) : (
        <div className="space-y-2 p-5 text-sm text-ink-2">
          <p className="text-ink">{t("Admin recovery is switched off on this server.")}</p>
          <p>
            {t("To switch it on, add an environment variable named")} <code className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-xs">ADMIN_RECOVERY_CODE</code>{" "}
            {t("with a long secret of your choosing, then restart the server. Another admin can also reset your password from the Employees page.")}
          </p>
        </div>
      )}
    </div>
  );
}
