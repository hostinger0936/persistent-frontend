// src/components/layout/Topbar.tsx
import { useEffect, useState } from "react";
import { logout, getLoggedInUser } from "../../services/api/auth";
import { getOrCreateSessionId } from "../../services/api/admin";
import wsService from "../../services/ws/wsService";
import WsIndicator from "../misc/WsIndicator";

function BrandLogo({ size = 40 }: { size?: number }) {
  return (
    <img
      src="/zt-logo.png"
      alt="ZeroTrace"
      width={size}
      height={size}
      className="shrink-0 rounded-xl border border-slate-200 bg-white object-cover"
      draggable={false}
    />
  );
}

function ActionPill({
  children,
  className = "",
  as = "div",
  href,
  onClick,
  title,
}: {
  children: React.ReactNode;
  className?: string;
  as?: "div" | "a" | "button";
  href?: string;
  onClick?: () => void;
  title?: string;
}) {
  const Comp: any = as;
  return (
    <Comp
      href={href}
      onClick={onClick}
      title={title}
      type={as === "button" ? "button" : undefined}
      className={[
        "inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2",
        "text-slate-700 shadow-[0_4px_14px_rgba(15,23,42,0.05)] transition",
        as !== "div" ? "hover:bg-slate-50 active:scale-[0.99]" : "",
        className,
      ].join(" ")}
    >
      {children}
    </Comp>
  );
}

export default function Topbar() {
  const [username, setUsername] = useState<string>(getLoggedInUser());

  useEffect(() => {
    const onStorage = () => setUsername(getLoggedInUser());
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  /* ═══════════════════════════════════════════
     GLOBAL FORCE_LOGOUT HANDLER
     ═══════════════════════════════════════════
     When backend sends force_logout for this session:
     - If sessionId matches this browser → actually logout
     - If no sessionId (logout all / logout by device) → logout everyone
  */
  useEffect(() => {
    wsService.connect();

    const off = wsService.onMessage((msg) => {
      try {
        if (!msg) return;

        // Handle force_logout
        if (msg.type === "force_logout") {
          const msgSessionId = String(msg.sessionId || msg?.data?.sessionId || "").trim();
          const mySessionId = getOrCreateSessionId();

          // If no sessionId in message → logout ALL (logout-all was triggered)
          // If sessionId matches this browser → logout this browser
          if (!msgSessionId || msgSessionId === mySessionId) {
            console.log("[Topbar] force_logout received — logging out", {
              msgSessionId: msgSessionId || "(all)",
              mySessionId,
            });
            logout();
            window.location.href = "/login";
            return;
          }

          // Different sessionId — not for this browser, ignore
          return;
        }
      } catch {
        // ignore
      }
    });

    return () => { off(); };
  }, []);

  return (
    <header className="sticky top-0 z-[40] w-full border-b border-slate-200 bg-white/90 backdrop-blur-md">
      <div className="mx-auto max-w-[420px] px-3 py-3 md:max-w-none md:px-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <BrandLogo size={40} />

            <div className="min-w-0 leading-tight">
              <div className="truncate text-[12px] font-semibold text-slate-500">ZeroTrace</div>
              <div className="truncate text-[16px] font-extrabold text-slate-900">Admin Panel</div>
              <div className="truncate text-[11px] text-slate-400">Realtime dashboard</div>
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-2">
            <ActionPill className="px-3">
              <WsIndicator />
            </ActionPill>

            <ActionPill
              as="a"
              href="/settings"
              className="text-[12px] font-bold text-slate-700"
              title="Settings"
            >
              Settings
            </ActionPill>

            <div className="hidden sm:block">
              <ActionPill className="flex-col items-start gap-0 px-3 py-2">
                <div className="text-[10px] leading-none text-slate-400">Logged in</div>
                <div className="text-[12px] font-extrabold leading-tight text-slate-800">
                  {username}
                </div>
              </ActionPill>
            </div>

            <ActionPill
              as="button"
              title="Logout"
              className="text-[12px] font-bold text-slate-700"
              onClick={() => {
                if (!confirm("Logout?")) return;
                logout();
                window.location.href = "/login";
              }}
            >
              <span aria-hidden>⎋</span>
              <span className="hidden sm:inline">Logout</span>
            </ActionPill>
          </div>
        </div>
      </div>
    </header>
  );
}
