"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Pencil, X } from "lucide-react";
import { adminCorrectDay } from "@/actions/requests";
import { usePrefs } from "@/components/providers";
import { Dialog } from "@/components/dialog";

export function EditDay({ userId, name, date, inT, outT, label }: { userId: number; name: string; date: string; inT: string; outT: string; label?: string }) {
  const { t, toast } = usePrefs();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  return (
    <>
      <button type="button" className="btn btn-ghost btn-sm" onClick={() => setOpen(true)} title={t(label ?? "Edit")} aria-label={t(label ?? "Edit")}>
        <Pencil className="size-3.5" />
        {label && t(label)}
      </button>
      {open && (
        <Dialog label={`${t("Edit")} · ${name}`} onClose={() => setOpen(false)} className="max-w-sm">
          <form
            className="space-y-3 p-5 text-start"
            onClick={(e) => e.stopPropagation()}
            onSubmit={(e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              start(async () => {
                const newOut = String(f.get("out") ?? "");
                const r = await adminCorrectDay(userId, date, String(f.get("in") ?? ""), newOut, String(f.get("reason") ?? ""), !!outT && !newOut);
                if (r.ok) {
                  toast(t(r.message ?? "Saved successfully"));
                  setOpen(false);
                  router.refresh();
                } else toast(t(r.error), "error");
              });
            }}
          >
            <div className="flex items-center justify-between">
              <div>
                <h3 className="font-semibold text-ink">{name}</h3>
                <p className="text-xs text-muted">{date}</p>
              </div>
              <button type="button" onClick={() => setOpen(false)} aria-label={t("Close")}>
                <X className="size-4 text-muted" />
              </button>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <label>
                <span className="label">{t("Check-in time")}</span>
                <input type="time" name="in" defaultValue={inT} className="input" />
              </label>
              <label>
                <span className="label">{t("Check-out time")}</span>
                <input type="time" name="out" defaultValue={outT} className="input" />
              </label>
            </div>
            <label className="block">
              <span className="label">{t("Reason")}</span>
              <input name="reason" required minLength={3} className="input" />
            </label>
            <p className="text-[11px] text-muted">Original punches are kept (voided) and this change is written to the audit log.</p>
            <button className="btn btn-primary w-full" disabled={pending}>
              {pending ? <Loader2 className="size-4 animate-spin" /> : t("Save")}
            </button>
          </form>
        </Dialog>
      )}
    </>
  );
}
