import React from 'react';
import { LuHouse, LuMapPin, LuPackage, LuPackageCheck, LuBatteryCharging } from 'react-icons/lu';

export function Card({ title, icon: Icon, right, children, className = '', bodyClass = 'card-body', style }) {
  return (
    <section className={`card ${className}`} style={style}>
      {title && (
        <header className="card-head">
          {Icon && <Icon size={16} color="var(--accent)" />}
          <span className="card-title">{title}</span>
          <div className="row" style={{ marginLeft: 'auto' }}>
            {right}
          </div>
        </header>
      )}
      <div className={bodyClass}>{children}</div>
    </section>
  );
}

export const Badge = ({ tone = 'neutral', children, dot }) => (
  <span className={`badge ${tone}`}>
    {dot && <span className={`dot ${dot}`} style={{ width: 6, height: 6 }} />}
    {children}
  </span>
);

const STATE_TONES = {
  QUEUED: 'neutral',
  TO_PICKUP: 'accent',
  LOADING: 'violet',
  TO_DROPOFF: 'accent',
  UNLOADING: 'violet',
  COMPLETED: 'ok',
  FAILED: 'bad',
  CANCELLED: 'warn',
  NAVIGATING: 'accent',
  SUCCEEDED: 'ok',
  CANCELED: 'warn',
  CANCELING: 'warn',
  IDLE: 'neutral',
  MAPPING: 'info',
  NAVIGATION: 'ok',
  SWITCHING: 'warn',
  ESTOP: 'bad',
  HOMING: 'info',
  WAITING_FOR_NAV2: 'warn',
};
export const stateTone = (s) => STATE_TONES[s] || 'neutral';
export const StateBadge = ({ state }) => <Badge tone={stateTone(state)}>{(state || '—').replaceAll('_', ' ')}</Badge>;

export const LOCATION_TYPES = {
  home: { label: 'Home', color: '#34d399', icon: LuHouse },
  pickup: { label: 'Pickup', color: '#fbbf24', icon: LuPackage },
  dropoff: { label: 'Dropoff', color: '#fb7185', icon: LuPackageCheck },
  charging: { label: 'Charging', color: '#a78bfa', icon: LuBatteryCharging },
  waypoint: { label: 'Waypoint', color: '#22d3ee', icon: LuMapPin },
};
export const locType = (t) => LOCATION_TYPES[t] || LOCATION_TYPES.waypoint;

export function LocIcon({ type, size = 30 }) {
  const t = locType(type);
  const Icon = t.icon;
  return (
    <span className="wicon" style={{ background: `${t.color}22`, border: `1px solid ${t.color}`, boxShadow: `0 0 12px -3px ${t.color}`, width: size, height: size, borderRadius: size / 3.3, display: 'grid', placeItems: 'center', color: t.color, flex: 'none' }}>
      <Icon size={size * 0.52} />
    </span>
  );
}

export function Empty({ children }) {
  return <div className="muted small" style={{ padding: '18px 4px', textAlign: 'center' }}>{children}</div>;
}
