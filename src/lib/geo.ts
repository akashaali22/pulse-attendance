export function haversineMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

export interface Fence {
  id: number;
  name: string;
  lat: number;
  lng: number;
  radius_m: number;
}

/** Nearest fence the point falls inside. GPS accuracy (capped at 100 m) is given as benefit of the doubt. */
export function matchFence(lat: number, lng: number, accuracy: number, fences: Fence[]) {
  let best: { fence: Fence; distance: number } | null = null;
  for (const f of fences) {
    const d = haversineMeters(lat, lng, f.lat, f.lng);
    if (!best || d < best.distance) best = { fence: f, distance: d };
  }
  const inside = !!best && best.distance - Math.min(Math.max(accuracy, 0), 100) <= best.fence.radius_m;
  return { inside, nearest: best };
}

/** Allowed-IP list entries: exact IPs or prefixes ending in "." or "*" (e.g. "192.168.1." or "10.0.*"). */
export function ipAllowed(ip: string, list: string): boolean {
  const rules = list.split(/[,\s]+/).map((s) => s.trim()).filter(Boolean);
  if (rules.length === 0) return true;
  return rules.some((r) => {
    const rule = r.replace(/\*$/, "");
    return rule.endsWith(".") ? ip.startsWith(rule) : ip === rule;
  });
}
