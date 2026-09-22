"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

/**
 * Renders children into document.body. Needed for full-screen overlays: an ancestor with a CSS
 * transform (e.g. the `.rise` animation) turns `position: fixed` into "fixed to that ancestor".
 */
export function Portal({ children }: { children: React.ReactNode }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  return mounted ? createPortal(children, document.body) : null;
}
