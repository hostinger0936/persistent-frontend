import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";

import AnimatedAppBackground from "../components/layout/AnimatedAppBackground";
import ztLogo from "../assets/zt-logo.png";
import { createAdminSession, getAdminLogin, saveAdminLogin } from "../services/api/admin";
import { setLoggedIn } from "../services/api/auth";
import { STORAGE_KEYS } from "../config/constants";

type ValidationResult = { ok: true; msg: "" } | { ok: false; msg: string };

function IconUser(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" {...props}>
      <path
        d="M12 12a4.5 4.5 0 1 0-4.5-4.5A4.5 4.5 0 0 0 12 12Zm0 2.25c-4.273 0-7.75 2.477-7.75 5.5 0 .552.448 1 1 1h13.5c.552 0 1-.448 1-1 0-3.023-3.477-5.5-7.75-5.5Z"
        fill="currentColor"
      />
    </svg>
  );
}

function IconLock(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" {...props}>
      <path
        d="M17 10V8a5 5 0 1 0-10 0v2H6a2 2 0 0 0-2 2v7a3 3 0 0 0 3 3h10a3 3 0 0 0 3-3v-7a2 2 0 0 0-2-2h-1Zm-8 0V8a3 3 0 0 1 6 0v2H9Z"
        fill="currentColor"
      />
    </svg>
  );
}

function IconTelegram(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" {...props}>
      <path d="M21.426 4.548a1.75 1.75 0 0 0-1.881-.247L3.948 10.9c-.825.354-.785 1.544.062 1.84l3.813 1.33 1.44 4.626a1.25 1.25 0 0 0 2.137.46l2.218-2.575 3.788 2.78a1.75 1.75 0 0 0 2.75-1.033l2.234-12.05a1.75 1.75 0 0 0-.964-1.73Zm-3.075 3.017-7.756 6.958a.75.75 0 0 0-.231.382l-.539 1.966-.918-2.946a.75.75 0 0 0-.468-.484l-2.526-.882 12.889-5.54-.451.546Z" />
    </svg>
  );
}

function IconChannel(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" {...props}>
      <path
        d="M4 7.75A2.75 2.75 0 0 1 6.75 5h10.5A2.75 2.75 0 0 1 20 7.75v8.5A2.75 2.75 0 0 1 17.25 19H6.75A2.75 2.75 0 0 1 4 16.25v-8.5Z"
        stroke="currentColor"
        strokeWidth="1.8"
      />
      <path d="M8 12h8M8 9h5M8 15h4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
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
        "rounded-[28px] border border-slate-200 bg-white/94 shadow-[0_10px_30px_rgba(15,23,42,0.08)]",
        className,
      ].join(" ")}
    >
      {children}
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  type = "text",
  icon,
  autoFocus,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: string;
  icon: "user" | "lock";
  autoFocus?: boolean;
}) {
  const Icon = icon === "user" ? IconUser : IconLock;

  return (
    <div className="space-y-2">
      <label className="block text-[14px] font-semibold text-slate-800">{label}</label>

      <div className="relative">
        <span className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400">
          <Icon className="h-5 w-5" />
        </span>

        <input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          type={type}
          placeholder={placeholder}
          autoFocus={autoFocus}
          className={[
            "h-11 w-full rounded-2xl border border-slate-200 bg-white pl-11 pr-4",
            "text-slate-900 placeholder:text-slate-400",
            "outline-none transition",
            "focus:border-sky-300 focus:ring-2 focus:ring-sky-100",
          ].join(" ")}
        />
      </div>
    </div>
  );
}

function safeStr(v: any) {
  return (v ?? "").toString();
}

function getOrCreateWebDeviceId(): string {
  const KEY = "zerotrace_web_device_id";
  try {
    const existing = localStorage.getItem(KEY);
    if (existing && existing.trim()) return existing.trim();

    const counterKey = "zerotrace_web_device_counter";
    const nRaw = localStorage.getItem(counterKey);
    const n = Math.max(1, Number(nRaw || "1") || 1);
    const id = `device${n}`;

    localStorage.setItem(KEY, id);
    localStorage.setItem(counterKey, String(n + 1));

    return id;
  } catch {
    return `device${Math.floor(Math.random() * 10000)}`;
  }
}

const TELEGRAM_USERNAME = "ownerofcardhouse";
const TELEGRAM_HELP_MESSAGE = "Hi Sir, I need help with my panel. Please solve my problem.";
const TELEGRAM_ORDER_MESSAGE = "Hi Sir, I need a new panel APK/service. Please share the details.";
const TELEGRAM_CHANNEL_URL = "https://t.me/zerotrace2026";

function openTelegramMessage(message: string) {
  const encoded = encodeURIComponent(message);
  const tgAppUrl = `tg://resolve?domain=${TELEGRAM_USERNAME}&text=${encoded}`;
  const tgWebUrl = `https://t.me/${TELEGRAM_USERNAME}?text=${encoded}`;

  try {
    const isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
    if (isMobile) {
      window.location.href = tgAppUrl;
      setTimeout(() => {
        window.open(tgWebUrl, "_blank", "noopener,noreferrer");
      }, 500);
      return;
    }
  } catch {}

  window.open(tgWebUrl, "_blank", "noopener,noreferrer");
}

function openTelegramChannel() {
  window.open(TELEGRAM_CHANNEL_URL, "_blank", "noopener,noreferrer");
}

export default function LoginPage() {
  const nav = useNavigate();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [contactOpen, setContactOpen] = useState(false);

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");

  const [useApiKey, setUseApiKey] = useState(false);
  const [apiKey, setApiKey] = useState(localStorage.getItem(STORAGE_KEYS.API_KEY) || "");

  const [storedUser, setStoredUser] = useState<string>("");
  const [storedPass, setStoredPass] = useState<string>("");

  useEffect(() => {
    let mounted = true;

    (async () => {
      try {
        const data = await getAdminLogin();
        if (!mounted) return;

        const u = safeStr(data?.username).trim();
        const p = safeStr(data?.password).trim();

        setStoredUser(u);
        setStoredPass(p);

        if (u) setUsername(u);
        setPassword("");
      } catch {
        if (!mounted) return;
        setStoredUser("");
        setStoredPass("");
        setPassword("");
      } finally {
        if (!mounted) return;
        setLoading(false);
      }
    })();

    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    function onDocClick() {
      setContactOpen(false);
    }

    if (!contactOpen) return;

    document.addEventListener("click", onDocClick);
    return () => {
      document.removeEventListener("click", onDocClick);
    };
  }, [contactOpen]);

  const validate = useMemo(
    () =>
      (): ValidationResult => {
        const u = (username || "").trim();
        const p = (password || "").trim();
        if (!u) return { ok: false, msg: "Username required" };
        if (!p) return { ok: false, msg: "Password required" };
        return { ok: true, msg: "" };
      },
    [username, password],
  );

  async function afterSuccessfulLogin(adminUser: string) {
    setLoggedIn(adminUser);

    try {
      if (useApiKey && apiKey.trim()) localStorage.setItem(STORAGE_KEYS.API_KEY, apiKey.trim());
    } catch {}

    try {
      const deviceId = getOrCreateWebDeviceId();
      await createAdminSession(adminUser, deviceId);
    } catch {}

    nav("/");
  }

  async function handleSaveAndLogin(e?: React.FormEvent) {
    if (e) e.preventDefault();
    setError(null);

    const v = validate();
    if (!v.ok) {
      setError(v.msg);
      return;
    }

    const u = username.trim();
    const p = password.trim();

    const hasStoredCreds = !!storedUser && !!storedPass;

    if (hasStoredCreds) {
      const ok = u === storedUser && p === storedPass;
      if (!ok) {
        setError("Invalid username or password");
        return;
      }

      setSaving(true);
      try {
        await afterSuccessfulLogin(u);
      } finally {
        setSaving(false);
      }
      return;
    }

    setSaving(true);
    try {
      await saveAdminLogin(u, p);

      setStoredUser(u);
      setStoredPass(p);

      await afterSuccessfulLogin(u);
    } catch (err: any) {
      const msg = err?.response?.data?.error || err?.message || "Server error";
      setError(String(msg));
    } finally {
      setSaving(false);
    }
  }

  function handleClear() {
    try {
      localStorage.removeItem(STORAGE_KEYS.LOGGED_IN);
      localStorage.removeItem(STORAGE_KEYS.USERNAME);
    } catch {}
    setUsername(storedUser || "");
    setPassword("");
    setError(null);
  }

  function handleContactHelp() {
    setContactOpen(false);
    openTelegramMessage(TELEGRAM_HELP_MESSAGE);
  }

  function handleContactOrder() {
    setContactOpen(false);
    openTelegramMessage(TELEGRAM_ORDER_MESSAGE);
  }

  function handleJoinChannel() {
    setContactOpen(false);
    openTelegramChannel();
  }

  return (
    <AnimatedAppBackground>
      <div className="flex min-h-screen flex-col items-center px-4">
        <div className="w-full max-w-[560px] pt-10 text-center sm:pt-12">
          <div className="flex items-center justify-center gap-4">
            <div className="flex h-20 w-20 items-center justify-center overflow-hidden rounded-full border border-slate-200 bg-white shadow-[0_8px_24px_rgba(15,23,42,0.08)] sm:h-24 sm:w-24">
              <img src={ztLogo} alt="ZeroTrace" className="h-full w-full object-cover" draggable={false} />
            </div>

            <div className="text-left">
              <div className="text-[36px] font-extrabold leading-none tracking-wide text-slate-900 sm:text-[40px]">
                ZeroTrace
              </div>
              <div className="text-[16px] font-semibold tracking-wide text-slate-600 sm:text-[18px]">
                Secure Admin Panel
              </div>
            </div>
          </div>

          <div className="mx-auto mt-4 h-[3px] w-[340px] max-w-[92%] rounded-full bg-gradient-to-r from-transparent via-sky-300 to-transparent" />
          <div className="mt-4 text-[20px] font-semibold tracking-[0.12em] text-slate-700 sm:text-[22px]">
            No Trace. No Limit
          </div>
        </div>

        <div className="flex-1" />

        <div className="w-full max-w-[420px] pb-10 sm:pb-12">
          <SurfaceCard className="px-6 py-6">
            {loading ? (
              <div className="py-10 text-center text-slate-500">Loading…</div>
            ) : (
              <form onSubmit={handleSaveAndLogin} className="space-y-4">
                <Field
                  label="Username"
                  value={username}
                  onChange={setUsername}
                  placeholder="Enter your username"
                  icon="user"
                  autoFocus
                />

                <Field
                  label="Password"
                  value={password}
                  onChange={setPassword}
                  placeholder="Enter your password"
                  type="password"
                  icon="lock"
                />

                <label className="flex select-none items-center gap-3 pt-1 text-slate-700">
                  <input
                    type="checkbox"
                    checked={useApiKey}
                    onChange={(e) => setUseApiKey(e.target.checked)}
                    className="h-5 w-5 rounded border-slate-300 bg-white text-sky-500 focus:ring-sky-200"
                  />
                  <span className="text-[15px]">Provide API key (optional)</span>
                </label>

                {useApiKey && (
                  <div className="space-y-2">
                    <label className="block text-[14px] font-semibold text-slate-800">API Key</label>

                    <input
                      value={apiKey}
                      onChange={(e) => setApiKey(e.target.value)}
                      placeholder="Paste API key here"
                      className="h-11 w-full rounded-2xl border border-slate-200 bg-white px-4 text-slate-900 placeholder:text-slate-400 outline-none transition focus:border-sky-300 focus:ring-2 focus:ring-sky-100"
                    />

                    <p className="text-[11px] text-slate-400">Stored locally in browser (localStorage).</p>
                  </div>
                )}

                {error && (
                  <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-2 text-sm text-rose-700">
                    {error}
                  </div>
                )}

                <div className="grid grid-cols-[1fr_auto] gap-3 pt-2">
                  <button
                    type="submit"
                    disabled={saving}
                    className="h-11 rounded-2xl border border-slate-900 bg-slate-900 text-[16px] font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {saving ? "Saving…" : storedUser && storedPass ? "Login" : "Save & Login"}
                  </button>

                  <button
                    type="button"
                    onClick={handleClear}
                    className="h-11 rounded-2xl border border-slate-200 bg-white px-5 text-[15px] font-semibold text-slate-700 hover:bg-slate-50"
                  >
                    Clear
                  </button>
                </div>

                <div className="pt-2 text-[12px] leading-relaxed text-slate-500">
                  {storedUser && storedPass ? (
                    <>Existing login is set on server. Enter the correct username/password to continue.</>
                  ) : (
                    <>No login found on server. First login will be saved as admin credentials.</>
                  )}
                </div>

                <div className="text-[11px] text-slate-400">
                  Web Device ID: <b className="text-slate-700">{getOrCreateWebDeviceId()}</b>
                </div>

                <div className="relative pt-3" onClick={(e) => e.stopPropagation()}>
                  {contactOpen && (
                    <div className="absolute bottom-[calc(100%+14px)] left-1/2 z-30 flex w-full max-w-[300px] -translate-x-1/2 flex-col items-center gap-3">
                      <button
                        type="button"
                        onClick={handleContactHelp}
                        className="w-full rounded-2xl border border-sky-200 bg-white px-4 py-3 text-left shadow-[0_8px_24px_rgba(15,23,42,0.08)] hover:bg-slate-50"
                      >
                        <div className="text-[14px] font-bold text-slate-900">Help Query</div>
                        <div className="mt-1 text-[12px] text-slate-500">Quick support on Telegram</div>
                      </button>

                      <button
                        type="button"
                        onClick={handleContactOrder}
                        className="w-full rounded-2xl border border-sky-200 bg-white px-4 py-3 text-left shadow-[0_8px_24px_rgba(15,23,42,0.08)] hover:bg-slate-50"
                      >
                        <div className="text-[14px] font-bold text-slate-900">Order New APK / Service</div>
                        <div className="mt-1 text-[12px] text-slate-500">Send order request on Telegram</div>
                      </button>

                      <button
                        type="button"
                        onClick={handleJoinChannel}
                        className="flex w-full items-start gap-3 rounded-2xl border border-sky-200 bg-white px-4 py-3 text-left shadow-[0_8px_24px_rgba(15,23,42,0.08)] hover:bg-slate-50"
                      >
                        <span className="mt-0.5 text-slate-700">
                          <IconChannel className="h-5 w-5" />
                        </span>
                        <span className="block">
                          <span className="block text-[14px] font-bold text-slate-900">Join Telegram Channel</span>
                          <span className="mt-1 block text-[12px] text-slate-500">Get updates directly from the channel</span>
                        </span>
                      </button>
                    </div>
                  )}

                  <button
                    type="button"
                    onClick={() => setContactOpen((v) => !v)}
                    className="flex h-11 w-full items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-white text-slate-800 shadow-[0_8px_24px_rgba(15,23,42,0.06)] hover:bg-slate-50"
                  >
                    <IconTelegram className="h-5 w-5 text-slate-700" />
                    <span className="font-semibold">Contact Developer</span>
                  </button>
                </div>
              </form>
            )}
          </SurfaceCard>
        </div>
      </div>
    </AnimatedAppBackground>
  );
}
