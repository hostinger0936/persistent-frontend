import api from "./apiClient";
import type { AdminSessionDoc } from "../../types";

export async function getAdminLogin(): Promise<{ username: string; password: string }> {
  const res = await api.get(`/api/admin/login`);
  return {
    username: res.data?.username || "",
    password: res.data?.password || "",
  };
}

export async function saveAdminLogin(username: string, password: string) {
  const res = await api.put(`/api/admin/login`, { username, password });
  return res.data;
}

export async function getGlobalPhone(): Promise<string> {
  const res = await api.get(`/api/admin/globalPhone`);
  const data = res.data;
  if (typeof data === "string") return data;
  if (data && typeof data === "object" && "phone" in data) return (data as any).phone || "";
  return "";
}

export async function setGlobalPhone(phone: string) {
  const res = await api.put(`/api/admin/globalPhone`, { phone });
  return res.data;
}

export async function getDeletePasswordStatus(): Promise<{ isSet: boolean }> {
  const res = await api.get(`/api/admin/deletePassword/status`);
  return {
    isSet: !!res.data?.isSet,
  };
}

export async function verifyDeletePassword(password: string): Promise<{
  success: boolean;
  verified: boolean;
  created: boolean;
  error?: string;
}> {
  const res = await api.post(`/api/admin/deletePassword/verify`, { password });
  return {
    success: !!res.data?.success,
    verified: !!res.data?.verified,
    created: !!res.data?.created,
    error: res.data?.error,
  };
}

export async function changeDeletePassword(currentPassword: string, newPassword: string): Promise<{
  success: boolean;
  message?: string;
  error?: string;
}> {
  const res = await api.post(`/api/admin/deletePassword/change`, {
    currentPassword,
    newPassword,
  });

  return {
    success: !!res.data?.success,
    message: res.data?.message,
    error: res.data?.error,
  };
}

export async function createAdminSession(admin: string, deviceId: string) {
  const res = await api.post(`/api/admin/session/create`, { admin, deviceId });
  return res.data;
}

export async function pingAdminSession(admin: string, deviceId: string) {
  const res = await api.post(`/api/admin/session/ping`, { admin, deviceId });
  return res.data;
}

export async function listSessions(): Promise<AdminSessionDoc[]> {
  const res = await api.get(`/api/admin/sessions`);
  return Array.isArray(res.data) ? res.data : [];
}

export async function logoutDevice(deviceId: string) {
  const res = await api.delete(`/api/admin/sessions/${encodeURIComponent(deviceId)}`);
  return res.data;
}

export async function logoutAll() {
  const res = await api.delete(`/api/admin/sessions`);
  return res.data;
}
