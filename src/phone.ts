// Status of the phone companion link, published by the desktop receiver as `phone-status`.
export type PhoneStatus = {
  state: 'listening' | 'connected' | 'paused' | 'reconnecting';
  device: string;
  engine: string;
  name: string;
  addresses: string[];
  port: number;
  /** SVG of the pairing QR code; empty while a phone is connected. */
  qr: string;
  rttMs?: number;
};

const states = ['listening', 'connected', 'paused', 'reconnecting'];

export function isPhoneStatus(value: unknown): value is PhoneStatus {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.state === 'string' &&
    states.includes(v.state) &&
    typeof v.device === 'string' &&
    typeof v.engine === 'string' &&
    typeof v.name === 'string' &&
    Array.isArray(v.addresses) &&
    v.addresses.every((address) => typeof address === 'string') &&
    typeof v.port === 'number' &&
    typeof v.qr === 'string' &&
    (v.rttMs === undefined || typeof v.rttMs === 'number')
  );
}

/** Display names for the engines the companion apps report. */
export const phoneEngineName = (engine: string) =>
  ({ arkit: 'ARKit', mediapipe: 'MediaPipe' })[engine] ?? engine;

export const phoneQrUrl = (svg: string) => `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
