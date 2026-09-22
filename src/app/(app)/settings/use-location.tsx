"use client";

import { Crosshair } from "lucide-react";
import { usePrefs } from "@/components/providers";

/** Fills the lat/lng inputs of the surrounding form with this device's GPS position. */
export function UseMyLocation() {
  const { toast } = usePrefs();
  return (
    <button
      type="button"
      className="btn btn-ghost btn-sm"
      onClick={(e) => {
        const form = e.currentTarget.closest("form");
        if (!form || !navigator.geolocation) return;
        navigator.geolocation.getCurrentPosition(
          (pos) => {
            (form.elements.namedItem("lat") as HTMLInputElement).value = pos.coords.latitude.toFixed(6);
            (form.elements.namedItem("lng") as HTMLInputElement).value = pos.coords.longitude.toFixed(6);
            toast(`Location set (±${Math.round(pos.coords.accuracy)} m)`);
          },
          () => toast("Could not get location", "error"),
          { enableHighAccuracy: true, timeout: 10000 },
        );
      }}
    >
      <Crosshair className="size-3.5" /> Use my current location
    </button>
  );
}
