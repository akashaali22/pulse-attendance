"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Pencil, X } from "lucide-react";
import { adminCorrectDay } from "@/actions/requests";
import { usePrefs } from "@/components/providers";
import { Portal } from "@/components/portal";

export function EditDay({ userId, name, date, inT, outT }: { userId: number; name: string; date: string; inT: string; outT: string }) {
  const { t, toast } = usePrefs();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  return (
    <>
      <button className="btn btn-ghost btn-sm" onClick={() => setOpen(true)} title={t("Edit")} aria-label={t("Edit")}>
        <Pencil className="size-3.5" />
      </button>
      {open && (
        <Portal>
        <div className="fixed inset-0 z-[80] grid place-items-center bg-black/60 p-4 backdrop-blur-sm" onClick={() => setOpen(false)}>
          <form
            className="card rise w-full max-w-sm space-y-3 p-5 text-start shadow-2xl"
            onClick={(e) => e.stopPropagation()}
            onSubmit={(e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              start(async () => {
                const r = await adminCorrectDay(userId, date, String(f.get("in") ?? ""), String(f.get("out") ?? ""), String(f.get("reason") ?? ""));
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
        </div>
        </Portal>
      )}
    </>
  );
}
