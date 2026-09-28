"use client";

import { AlertCircle, RotateCcw } from "lucide-react";
import { usePrefs } from "@/components/providers";

export default function ErrorPage({ reset }: { reset: () => void }) {
  const { t } = usePrefs();
  return <section className="card mx-auto mt-10 max-w-lg p-8 text-center" role="alert">
    <AlertCircle className="mx-auto mb-4 size-7 text-warn" />
    <h1 className="text-lg font-semibold">{t("Unable to load this page")}</h1>
    <p className="mt-2 text-sm text-muted">{t("Please try again. Your saved data is unchanged.")}</p>
    <button className="btn btn-primary mt-6" onClick={reset}><RotateCcw className="size-4" />{t("Try again")}</button>
  </section>;
}
