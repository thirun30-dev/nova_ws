export const yawFromQuat = (q) =>
  Math.atan2(2 * (q.w * q.z + q.x * q.y), 1 - 2 * (q.y * q.y + q.z * q.z));

export const quatFromYaw = (yaw) => ({ x: 0, y: 0, z: Math.sin(yaw / 2), w: Math.cos(yaw / 2) });

export const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));

export const deg = (rad) => (rad * 180) / Math.PI;

export const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

export const fmt = (v, digits = 2, fallback = '—') =>
  v === null || v === undefined || Number.isNaN(v) ? fallback : Number(v).toFixed(digits);

export const fmtDuration = (s) => {
  if (s === null || s === undefined || Number.isNaN(s)) return '—';
  s = Math.max(0, Math.round(s));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h) return `${h}h ${String(m).padStart(2, '0')}m`;
  if (m) return `${m}m ${String(sec).padStart(2, '0')}s`;
  return `${sec}s`;
};

export const timeToSec = (t) => (t ? t.sec + t.nanosec * 1e-9 : 0);
