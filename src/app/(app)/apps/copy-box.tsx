"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";

/** A command line the user is meant to paste into Terminal. */
export function CopyBox({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  return (
    <div className="flex items-stretch gap-2">
      <code className="flex-1 overflow-x-auto whitespace-nowrap rounded-xl border border-line bg-surface-2 px-3 py-2.5 font-mono text-xs text-ink">{text}</code>
      <button
        type="button"
        className="btn btn-ghost btn-sm shrink-0"
        onClick={() => {
          navigator.clipboard?.writeText(text).then(() => {
            setDone(true);
            setTimeout(() => setDone(false), 2500);
          });
        }}
      >
        {done ? <Check className="size-4 text-good" /> : <Copy className="size-4" />}
        {done ? "Copied" : "Copy"}
      </button>
    </div>
  );
}
