import { useCallback, useEffect, useMemo, useState } from "react";
import type { AdminSessionDoc } from "../types";
import { listSessions, logoutAll, logoutDevice } from "../services/api/admin";
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
  const [busyDevice, setBusyDevice] = useState<string | null>(null);
  const [busyAll, setBusyAll] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
          const deviceId = safeStr(data.deviceId || msg.deviceId);
          const admin = safeStr(data.admin || data.username || "admin");
          const lastSeen = Number(data.lastSeen || msg.timestamp || Date.now());

          if (!deviceId) return;

          setSessions((prev) => {
            const existingIndex = prev.findIndex(
              (s: any) =>
                safeStr(s?.deviceId) === deviceId &&
                safeStr((s as any)?.admin || (s as any)?.username || "admin") === admin,
            );

            if (existingIndex >= 0) {
              return prev.map((s, idx) =>
                idx === existingIndex
                  ? ({
                      ...(s as any),
                      deviceId,
                      admin,
                      lastSeen,
                    } as AdminSessionDoc)
                  : s,
              );
            }

            const next: AdminSessionDoc = {
              ...(data as any),
              deviceId,
              admin,
              lastSeen,
            } as AdminSessionDoc;

            return [next, ...prev];
          });

          return;
        }

        if (event === "admin_session:ping" || event === "session:ping" || event === "admin_session:updated") {
          const deviceId = safeStr(data.deviceId || msg.deviceId);
          const admin = safeStr(data.admin || data.username || "");
          const lastSeen = Number(data.lastSeen || msg.timestamp || Date.now());

          if (!deviceId) return;

          setSessions((prev) =>
            prev.map((s: any) => {
              const sameDevice = safeStr(s?.deviceId) === deviceId;
              const sameAdmin = admin ? safeStr(s?.admin || s?.username || "") === admin : true;

              if (!sameDevice || !sameAdmin) return s;

              return {
                ...(s as any),
                lastSeen,
              } as AdminSessionDoc;
            }),
          );

          return;
        }

        if (
          event === "admin_session:deleted" ||
          event === "session:deleted" ||
          event === "force_logout" ||
          event === "admin_session:logout"
        ) {
          const deviceId = safeStr(data.deviceId || msg.deviceId);
          if (!deviceId) return;

          setSessions((prev) => prev.filter((s: any) => safeStr(s?.deviceId) !== deviceId));
          return;
        }

        if (event === "admin_session:logout_all" || event === "session:logout_all") {
          setSessions([]);
        }
      } catch {
        // ignore
      }
    });

    return () => {
      off();
    };
  }, [load]);

  const deviceRows = useMemo(() => {
    const map = new Map<
      string,
      {
        deviceId: string;
        admins: string[];
        lastSeen: unknown;
        count: number;
        raw: AdminSessionDoc[];
      }
    >();

    for (const s of sessions || []) {
      const did = (s as any).deviceId || "unknown";
      const admin = (s as any).admin || (s as any).username || "admin";
      const lastSeen = (s as any).lastSeen;

      const prev = map.get(did);
      if (!prev) {
        map.set(did, {
          deviceId: did,
          admins: [admin],
          lastSeen,
          count: 1,
          raw: [s],
        });
      } else {
        prev.count += 1;
        prev.raw.push(s);
        if (!prev.admins.includes(admin)) prev.admins.push(admin);

        const a = toMs(prev.lastSeen as any);
        const b = toMs(lastSeen as any);

        if (b > a) prev.lastSeen = lastSeen;
      }
    }

    const arr = Array.from(map.values());
    arr.sort((x, y) => toMs(y.lastSeen as any) - toMs(x.lastSeen as any));
    return arr;
  }, [sessions]);

  async function handleLogoutDevice(deviceId: string) {
    if (!confirm(`Force logout admin session on device "${deviceId}"?`)) return;
    setBusyDevice(deviceId);
    setError(null);

    try {
      await logoutDevice(deviceId);
      setSessions((prev) => prev.filter((s: any) => s.deviceId !== deviceId));
    } catch (e) {
      console.error("logoutDevice failed", e);
      setError("Failed to logout device");
    } finally {
      setBusyDevice(null);
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
                Active admin sessions connected to devices
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

          <div className="mt-3 grid grid-cols-2 gap-2">
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3">
              <div className="text-[11px] text-slate-500">Active devices</div>
              <div className="mt-1 text-[18px] font-extrabold text-slate-900">
                {deviceRows.filter((d) => isActive(d.lastSeen as number | string | null)).length}
              </div>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3">
              <div className="text-[11px] text-slate-500">Total sessions</div>
              <div className="mt-1 text-[18px] font-extrabold text-slate-900">
                {sessions.length}
              </div>
            </div>
          </div>

          <div className="mt-4 space-y-3">
            {loading ? (
              <div className="rounded-2xl border border-slate-200 bg-white p-4 text-center text-slate-500">
                Loading…
              </div>
            ) : deviceRows.length === 0 ? (
              <div className="rounded-2xl border border-slate-200 bg-white p-6 text-center text-slate-500">
                No active sessions.
                <div className="mt-2 text-xs text-slate-400">
                  Login once from web to create <span className="font-mono">device1</span> session.
                </div>
              </div>
            ) : (
              deviceRows.map((d) => {
                const active = isActive(d.lastSeen as number | string | null);
                const adminsText = d.admins.filter(Boolean).join(", ");

                return (
                  <div
                    key={d.deviceId}
                    className="rounded-[22px] border border-slate-200 bg-white p-4 shadow-[0_6px_20px_rgba(15,23,42,0.05)]"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <div className="truncate text-[16px] font-extrabold text-slate-900">
                            {d.deviceId}
                          </div>
                          <span
                            className={[
                              "rounded-full border px-2.5 py-1 text-xs font-semibold",
                              active
                                ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                                : "border-rose-200 bg-rose-50 text-rose-700",
                            ].join(" ")}
                          >
                            {active ? "Active" : "Offline"}
                          </span>
                        </div>

                        <div className="mt-1 truncate text-xs text-slate-500">
                          Admin:{" "}
                          <span className="font-semibold text-slate-700">
                            {adminsText || "admin"}
                          </span>
                        </div>

                        <div className="mt-2 grid grid-cols-2 gap-2">
                          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3">
                            <div className="text-[11px] text-slate-500">Last seen</div>
                            <div className="mt-1 text-[12px] font-semibold text-slate-800">
                              {formatTs(d.lastSeen as number | string | null)}
                            </div>
                          </div>
                          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3">
                            <div className="text-[11px] text-slate-500">Admins</div>
                            <div className="mt-1 text-[12px] font-semibold text-slate-800">
                              {d.count}
                            </div>
                          </div>
                        </div>
                      </div>

                      <button
                        onClick={() => void handleLogoutDevice(d.deviceId)}
                        className="h-10 shrink-0 rounded-2xl border border-rose-200 bg-rose-50 px-4 text-sm font-semibold text-rose-700 hover:bg-rose-100 active:scale-[0.99] disabled:opacity-60"
                        disabled={busyDevice === d.deviceId}
                        type="button"
                      >
                        {busyDevice === d.deviceId ? "…" : "Logout"}
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
