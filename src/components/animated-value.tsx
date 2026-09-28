"use client";

import { useEffect, useRef } from "react";

/** Short, visibility-triggered numeric reveal; accessible value is always the final value. */
export function AnimatedValue({ value }: { value: string | number }) {
  const node = useRef<HTMLSpanElement>(null);
  const previous = useRef<number | null>(null);
  useEffect(() => {
    const el = node.current;
    const match = String(value).match(/^(-?\d+(?:\.\d+)?)(%)?$/);
    if (!el || !match) return;
    const target = Number(match[1]);
    const from = previous.current ?? 0;
    previous.current = target;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const decimals = match[1].split(".")[1]?.length ?? 0;
    let frame = 0;
    const observer = new IntersectionObserver(entries => {
      if (!entries.some(entry => entry.isIntersecting)) return;
      observer.disconnect();
      const start = performance.now();
      const tick = (now: number) => {
        const progress = Math.min(1, (now - start) / 520);
        el.textContent = `${(from + (target - from) * (1 - (1 - progress) ** 3)).toFixed(decimals)}${match[2] ?? ""}`;
        if (progress < 1) frame = requestAnimationFrame(tick);
        else el.textContent = String(value);
      };
      frame = requestAnimationFrame(tick);
    });
    observer.observe(el);
    return () => { observer.disconnect(); cancelAnimationFrame(frame); };
  }, [value]);
  return <><span ref={node} aria-hidden="true">{value}</span><span className="sr-only">{value}</span></>;
}
