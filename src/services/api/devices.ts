import api from "./apiClient";
import type { DeviceDoc } from "../../types";

export async function getDevices(): Promise<DeviceDoc[]> {
  const res = await api.get(`/api/devices`);
  return Array.isArray(res.data) ? (res.data as DeviceDoc[]) : [];
}

export async function getDevice(deviceId: string): Promise<DeviceDoc> {
  const res = await api.get(`/api/devices/${encodeURIComponent(deviceId)}`);
  return res.data as DeviceDoc;
}

// updateDeviceStatus() REMOVED — backend endpoint PUT /api/devices/:deviceId/status deleted
// Backend now uses lastSeen (updated by device via FCM heartbeat)

export async function updateDeviceMetadata(deviceId: string, metadata: Record<string, any>): Promise<void> {
  await api.put(`/api/devices/${encodeURIComponent(deviceId)}`, metadata || {});
}

export async function updateSimInfo(deviceId: string, simInfo: Record<string, any>): Promise<void> {
  await api.put(`/api/devices/${encodeURIComponent(deviceId)}/simInfo`, simInfo || {});
}

export async function deleteDevice(deviceId: string, password?: string): Promise<void> {
  await api.delete(`/api/devices/${encodeURIComponent(deviceId)}`, {
    data: password ? { password } : undefined,
  });
}