/**
 * src/utils/reachability.ts
 *
 * Shared utility for lastSeen-based device status.
 *
 * Panel computes reachability from lastSeen.at:
 *   0–15 min   → "responsive" (green)
 *   15 min–2hr → "idle" (amber)
 *   2hr–3days  → "unreachable" (red)
 *   3days+     → "uninstalled" (purple)
 */

export type ReachabilityStatus = "responsive" | "idle" | "unreachable" | "uninstalled";

const RESPONSIVE_MS = 15 * 60 * 1000;            // 15 minutes
const IDLE_MS = 2 * 60 * 60 * 1000;              // 2 hours
const UNINSTALLED_MS = 3 * 24 * 60 * 60 * 1000;  // 3 days

/** Extract lastSeen.at timestamp from device document (handles legacy fallbacks) */
export function pickLastSeenAt(d: any): number {
  const lsAt = d?.lastSeen?.at;
  if (typeof lsAt === "number" && lsAt > 0) return lsAt;

  const st = d?.status?.timestamp;
  if (typeof st === "number" && st > 0) return st;

  const ua = d?.updatedAt;
  if (typeof ua === "string") { const p = Date.parse(ua); if (Number.isFinite(p) && p > 0) return p; }
  if (typeof ua === "number" && ua > 0) return ua;

  return 0;
}

/** Extract lastSeen action string */
export function pickLastSeenAction(d: any): string {
  return String(d?.lastSeen?.action || "").trim();
}

/** Extract lastSeen battery */
export function pickLastSeenBattery(d: any): number {
  const b = d?.lastSeen?.battery;
  return typeof b === "number" && b >= 0 ? b : -1;
}

/** Compute reachability from lastSeen.at timestamp */
export function computeReachability(lastSeenAt: number): ReachabilityStatus {
  if (lastSeenAt <= 0) return "uninstalled";
  const agoMs = Date.now() - lastSeenAt;
  if (agoMs <= RESPONSIVE_MS) return "responsive";
  if (agoMs <= IDLE_MS) return "idle";
  if (agoMs <= UNINSTALLED_MS) return "unreachable";
  return "uninstalled";
}

/** Check if device is "responsive" (equivalent to old "online") */
export function isDeviceResponsive(d: any): boolean {
  return computeReachability(pickLastSeenAt(d)) === "responsive";
}

/** Get reachability label for display */
export function getReachabilityLabel(status: ReachabilityStatus): string {
  if (status === "responsive") return "Responsive";
  if (status === "idle") return "Idle";
  if (status === "uninstalled") return "Uninstalled";
  return "Unreachable";
}

/** Get reachability pill CSS classes */
export function getReachabilityPillClasses(status: ReachabilityStatus): string {
  if (status === "responsive") return "border-emerald-200 bg-emerald-50 text-emerald-700";
  if (status === "idle") return "border-amber-200 bg-amber-50 text-amber-700";
  if (status === "uninstalled") return "border-purple-200 bg-purple-50 text-purple-700";
  return "border-rose-200 bg-rose-50 text-rose-700";
}

/** Get reachability dot color class */
export function getReachabilityDotClass(status: ReachabilityStatus): string {
  if (status === "responsive") return "bg-emerald-500";
  if (status === "idle") return "bg-amber-500";
  if (status === "uninstalled") return "bg-purple-500";
  return "bg-rose-500";
}

/** Format lastSeen timestamp as locale string */
export function formatLastSeen(lastSeenAt: number): string {
  if (!lastSeenAt || lastSeenAt <= 0) return "-";
  try { return new Date(lastSeenAt).toLocaleString(); } catch { return "-"; }
}

/** Format lastSeen as relative time string */
export function formatLastSeenAgo(lastSeenAt: number): string {
  if (!lastSeenAt || lastSeenAt <= 0) return "-";
  const diffMs = Date.now() - lastSeenAt;
  if (diffMs < 0) return "now";
  const sec = Math.floor(diffMs / 1000);
  if (sec < 60) return "now";
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min} min ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} hr ago`;
  const days = Math.floor(hr / 24);
  return `${days}d ago`;
}
