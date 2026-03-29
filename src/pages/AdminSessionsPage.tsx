import { useCallback, useEffect, useMemo, useState } from "react";
import type { AdminSessionDoc } from "../types";
import { listSessions, logoutAll, logoutSession } from "../services/api/admin";
import { getOrCreateSessionId } from "../services/api/admin";
import AnimatedAppBackground from "../components/layout/AnimatedAppBackground";
import wsService from "../services/ws/wsService";

function formatTs(ts?: number | string | null) {
  if (!ts) return "-";
  try {
    const d = typeof ts === "number" ? new Date(ts) : new Date(String(ts));
    return d.toLocaleString();
  } catch {
    return String(ts);
  }
}

function toMs(value?: number | string | null) {
  if (!value) return 0;
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  const parsedDate = Date.parse(String(value));
  if (Number.isFinite(parsedDate)) return parsedDate;
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function isActive(lastSeen?: number | string | null) {
  const t = toMs(lastSeen);
  if (!t) return false;
  return Date.now() - t < 35_000;
}

function safeStr(v: unknown) {
  return String(v ?? "").trim();
}

function timeAgo(ts?: number | string | null): string {
  const t = toMs(ts);
  if (!t) return "-";
  const diff = Date.now() - t;
  if (diff < 60_000) return "just now";
  const min = Math.floor(diff / 60_000);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const d = Math.floor(hr / 24);
  return `${d}d ago`;
}

/** Browser icon based on name */
function browserIcon(browser?: string): string {
  const b = (browser || "").toLowerCase();
  if (b.includes("chrome")) return "🌐";
  if (b.includes("safari")) return "🧭";
  if (b.includes("firefox")) return "🦊";
  if (b.includes("edge")) return "🔷";
  if (b.includes("opera")) return "🔴";
  if (b.includes("samsung")) return "📱";
  return "🖥️";
}

/** OS icon */
function osIcon(os?: string): string {
  const o = (os || "").toLowerCase();
  if (o.includes("android")) return "🤖";
  if (o.includes("ios") || o.includes("ipad") || o.includes("iphone")) return "🍎";
  if (o.includes("windows")) return "🪟";
  if (o.includes("mac")) return "💻";
  if (o.includes("linux")) return "🐧";
  if (o.includes("chrome os")) return "📗";
  return "🖥️";
}

function SurfaceCard({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={[
        "rounded-[24px] border border-slate-200 bg-white/92 shadow-[0_8px_24px_rgba(15,23,42,0.06)]",
        className,
      ].join(" ")}
    >
      {children}
    </div>
  );
}

export default function AdminSessionsPage() {
  const [sessions, setSessions] = useState<AdminSessionDoc[]>([]);
  const [loading, setLoading] = useState(false);
  const [busySession, setBusySession] = useState<string | null>(null);
  const [busyAll, setBusyAll] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const mySessionId = useMemo(() => {
    try { return getOrCreateSessionId(); } catch { return ""; }
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const list = await listSessions();
      setSessions(Array.isArray(list) ? list : []);
    } catch (e) {
      console.error("load sessions failed", e);
      setError("Failed to load admin sessions");
      setSessions([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    wsService.connect();

    const off = wsService.onMessage((msg) => {
      try {
        if (!msg || msg.type !== "event") return;

        const event = safeStr(msg.event).toLowerCase();
        const data = msg.data || {};

        if (event === "admin_session:created" || event === "session:created") {
          const sessionId = safeStr(data.sessionId);
          const deviceId = safeStr(data.deviceId || msg.deviceId);
          const admin = safeStr(data.admin || data.username || "admin");
          const lastSeen = Number(data.lastSeen || msg.timestamp || Date.now());

          if (!sessionId && !deviceId) return;

          setSessions((prev) => {
            // Update existing session or add new
            const idx = sessionId
              ? prev.findIndex((s: any) => safeStr(s.sessionId) === sessionId)
              : -1;

            if (idx >= 0) {
              return prev.map((s, i) =>
                i === idx ? { ...s, ...data, lastSeen } as AdminSessionDoc : s,
              );
            }

            return [{ ...data, sessionId, deviceId, admin, lastSeen } as AdminSessionDoc, ...prev];
          });
          return;
        }

        if (event === "admin_session:ping" || event === "session:ping" || event === "admin_session:updated") {
          const sessionId = safeStr(data.sessionId);
          const lastSeen = Number(data.lastSeen || msg.timestamp || Date.now());

          if (!sessionId) return;

          setSessions((prev) =>
            prev.map((s: any) =>
              safeStr(s.sessionId) === sessionId ? { ...s, lastSeen } as AdminSessionDoc : s,
            ),
          );
          return;
        }

        if (
          event === "admin_session:deleted" ||
          event === "session:deleted" ||
          event === "admin_session:logout"
        ) {
          const sessionId = safeStr(data.sessionId);
          const deviceId = safeStr(data.deviceId || msg.deviceId);

          if (sessionId) {
            setSessions((prev) => prev.filter((s: any) => safeStr(s.sessionId) !== sessionId));
          } else if (deviceId) {
            setSessions((prev) => prev.filter((s: any) => safeStr(s.deviceId) !== deviceId));
          }
          return;
        }

        if (event === "admin_session:logout_all" || event === "session:logout_all") {
          setSessions([]);
        }
      } catch {
        // ignore
      }
    });

    return () => { off(); };
  }, [load]);

  const sortedSessions = useMemo(() => {
    return [...sessions].sort((a, b) => toMs(b.lastSeen) - toMs(a.lastSeen));
  }, [sessions]);

  const activeCount = useMemo(
    () => sessions.filter((s) => isActive(s.lastSeen)).length,
    [sessions],
  );

  async function handleLogoutSession(sid: string) {
    if (!confirm("Force logout this session?")) return;
    setBusySession(sid);
    setError(null);

    try {
      await logoutSession(sid);
      setSessions((prev) => prev.filter((s: any) => safeStr(s.sessionId) !== sid));
    } catch (e) {
      console.error("logoutSession failed", e);
      setError("Failed to logout session");
    } finally {
      setBusySession(null);
    }
  }

  async function handleLogoutAll() {
    if (!confirm("Force logout ALL admin sessions?")) return;
    setBusyAll(true);
    setError(null);

    try {
      await logoutAll();
      setSessions([]);
    } catch (e) {
      console.error("logoutAll failed", e);
      setError("Failed to logout all sessions");
    } finally {
      setBusyAll(false);
    }
  }

  return (
    <AnimatedAppBackground>
      <div className="mx-auto max-w-[420px] px-3 pb-24 pt-4">
        <SurfaceCard className="p-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-[22px] font-extrabold tracking-tight text-slate-900">
                Admin Sessions
              </div>
              <div className="text-[12px] text-slate-500">
                Each login creates a separate session
              </div>
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={() => void load()}
                className="h-10 rounded-2xl border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-700 hover:bg-slate-50 active:scale-[0.99]"
                type="button"
              >
                Refresh
              </button>
              <button
                onClick={handleLogoutAll}
                className="h-10 rounded-2xl border border-rose-200 bg-rose-50 px-4 text-sm font-semibold text-rose-700 hover:bg-rose-100 active:scale-[0.99] disabled:opacity-60"
                disabled={busyAll}
                type="button"
              >
                {busyAll ? "Logging out…" : "Logout All"}
              </button>
            </div>
          </div>

          {/* Stats */}
          <div className="mt-3 grid grid-cols-2 gap-2">
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3">
              <div className="text-[11px] text-slate-500">Active now</div>
              <div className="mt-1 text-[18px] font-extrabold text-emerald-700">
                {activeCount}
              </div>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3">
              <div className="text-[11px] text-slate-500">Total sessions</div>
              <div className="mt-1 text-[18px] font-extrabold text-slate-900">
                {sessions.length}
              </div>
            </div>
          </div>

          {/* Session list */}
          <div className="mt-4 space-y-3">
            {loading ? (
              <div className="rounded-2xl border border-slate-200 bg-white p-4 text-center text-slate-500">
                Loading…
              </div>
            ) : sortedSessions.length === 0 ? (
              <div className="rounded-2xl border border-slate-200 bg-white p-6 text-center text-slate-500">
                No active sessions.
                <div className="mt-2 text-xs text-slate-400">
                  Login from any browser to create a session.
                </div>
              </div>
            ) : (
              sortedSessions.map((s) => {
                const sid = safeStr((s as any).sessionId);
                const active = isActive(s.lastSeen);
                const isMe = sid === mySessionId;
                const admin = safeStr(s.admin) || "admin";
                const browser = safeStr((s as any).browser) || "Unknown";
                const os = safeStr((s as any).os) || "Unknown";
                const ip = safeStr((s as any).ip);
                const deviceId = safeStr(s.deviceId);

                return (
                  <div
                    key={sid || (s as any)._id || `${deviceId}_${admin}`}
                    className={[
                      "rounded-[22px] border p-4 shadow-[0_6px_20px_rgba(15,23,42,0.05)]",
                      isMe
                        ? "border-sky-300 bg-sky-50/50"
                        : "border-slate-200 bg-white",
                    ].join(" ")}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        {/* Browser + OS line */}
                        <div className="flex items-center gap-2">
                          <span className="text-lg">{browserIcon(browser)}</span>
                          <div className="truncate text-[15px] font-extrabold text-slate-900">
                            {browser}
                          </div>
                          <span
                            className={[
                              "shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-semibold",
                              active
                                ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                                : "border-rose-200 bg-rose-50 text-rose-700",
                            ].join(" ")}
                          >
                            {active ? "Active" : "Offline"}
                          </span>
                          {isMe && (
                            <span className="shrink-0 rounded-full border border-sky-200 bg-sky-100 px-2 py-0.5 text-[10px] font-semibold text-sky-700">
                              This device
                            </span>
                          )}
                        </div>

                        {/* OS + Admin */}
                        <div className="mt-1 flex items-center gap-2 text-xs text-slate-500">
                          <span>{osIcon(os)} {os}</span>
                          <span className="text-slate-300">•</span>
                          <span>Admin: <span className="font-semibold text-slate-700">{admin}</span></span>
                        </div>

                        {/* Details row */}
                        <div className="mt-2 grid grid-cols-2 gap-2">
                          <div className="rounded-xl border border-slate-200 bg-slate-50 px-2.5 py-2">
                            <div className="text-[10px] text-slate-400">Last seen</div>
                            <div className="text-[11px] font-semibold text-slate-800">
                              {timeAgo(s.lastSeen)}
                            </div>
                          </div>
                          <div className="rounded-xl border border-slate-200 bg-slate-50 px-2.5 py-2">
                            <div className="text-[10px] text-slate-400">IP</div>
                            <div className="truncate text-[11px] font-semibold text-slate-800">
                              {ip || "-"}
                            </div>
                          </div>
                        </div>

                        {/* Device ID + Session ID (small) */}
                        <div className="mt-2 text-[10px] text-slate-400">
                          Device: <span className="font-mono text-slate-500">{deviceId}</span>
                          {sid && (
                            <>
                              <span className="mx-1">•</span>
                              Session: <span className="font-mono text-slate-500">{sid.slice(0, 8)}…</span>
                            </>
                          )}
                        </div>
                      </div>

                      {/* Logout button */}
                      <button
                        onClick={() => sid ? handleLogoutSession(sid) : undefined}
                        className="h-9 shrink-0 rounded-xl border border-rose-200 bg-rose-50 px-3 text-xs font-semibold text-rose-700 hover:bg-rose-100 active:scale-[0.99] disabled:opacity-60"
                        disabled={!sid || busySession === sid}
                        type="button"
                      >
                        {busySession === sid ? "…" : "Logout"}
                      </button>
                    </div>
                  </div>
                );
              })
            )}
          </div>

          {error && (
            <div className="mt-4 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-2 text-sm text-rose-700">
              {error}
            </div>
          )}
        </SurfaceCard>
      </div>
    </AnimatedAppBackground>
  );
}
