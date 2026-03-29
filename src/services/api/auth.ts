import { STORAGE_KEYS } from "../../config/constants";

/**
 * auth.ts — FULL & FINAL
 *
 * This project uses simple localStorage-based session.
 * Backend login endpoints exist but do NOT return tokens.
 *
 * Keys:
 * - zerotrace_admin_logged_in
 * - zerotrace_admin_username
 *
 * NOTE: Do NOT import from "./admin" here — causes circular dependency
 * (apiClient → auth → admin → apiClient). Clear sessionId directly.
 */

export function isLoggedIn(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEYS.LOGGED_IN) === "true";
  } catch {
    return false;
  }
}

export function getLoggedInUser(): string {
  try {
    return localStorage.getItem(STORAGE_KEYS.USERNAME) || "admin";
  } catch {
    return "admin";
  }
}

export function setLoggedIn(user: string) {
  try {
    localStorage.setItem(STORAGE_KEYS.LOGGED_IN, "true");
    localStorage.setItem(STORAGE_KEYS.USERNAME, (user || "admin").trim());
  } catch {
    // ignore
  }
}

export function logout() {
  try {
    localStorage.removeItem(STORAGE_KEYS.LOGGED_IN);
    localStorage.removeItem(STORAGE_KEYS.USERNAME);
  } catch {
    // ignore
  }
  // Clear session ID directly (no import from admin.ts to avoid circular dep)
  try {
    sessionStorage.removeItem("zerotrace_session_id");
  } catch {
    // ignore
  }
}
