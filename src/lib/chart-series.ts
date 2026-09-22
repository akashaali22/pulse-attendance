// Shared by server and client components. Status is a "state" encoding → reserved status colors,
// always paired with a legend and labelled tooltips.
export const SERIES = [
  { key: "present", label: "On time", color: "var(--good)" },
  { key: "late", label: "Late", color: "var(--warn)" },
  { key: "halfDay", label: "HALF_DAY", color: "var(--serious)" },
  { key: "absent", label: "ABSENT", color: "var(--bad)" },
  { key: "leave", label: "ON_LEAVE", color: "var(--info)" },
] as const;

export type TrendPoint = { date: string; present: number; late: number; halfDay: number; absent: number; leave: number };
