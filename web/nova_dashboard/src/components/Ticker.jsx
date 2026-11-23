import React from 'react';
import { deg, fmt, fmtDuration } from '../lib/geom.js';

export default function Ticker({ nova, onJump }) {
  const { state, pose, odom, battery, nav, metrics, health, connected, demo } = nova;
  const items = [
    ['MODE', state?.mode || '—', 'DRIVE'],
    ['POSE', pose ? `${fmt(pose.x)}, ${fmt(pose.y)} · ${fmt(deg(pose.yaw), 0)}°` : '—', 'LOCATIONS'],
    ['VEL', `${fmt(odom?.vx)} m/s · ${fmt(odom?.wz)} rad/s`, 'DRIVE'],
    ['BATT', battery ? `${fmt(battery.voltage, 2)} V · ${fmt(battery.percentage * 100, 0)}%` : '—', 'HEALTH'],
    ['NAV', nav?.state === 'NAVIGATING' ? `${nav.state} · ${fmt(nav.distance_remaining, 1)} m left` : nav?.state || '—', 'LOCATIONS'],
    ['MISSIONS', metrics ? `${metrics.completed} done · ${metrics.queue_length} queued · ${fmt(metrics.throughput_per_hour, 1)}/h` : '—', null],
    ['CPU', health?.system?.cpu_temp_c != null ? `${health.system.cpu_temp_c} °C · load ${health.system.load}` : '—', 'HEALTH'],
    ['UPTIME', fmtDuration(state?.uptime_s), 'HEALTH'],
    ['LINK', demo ? 'DEMO' : connected ? 'ROSBRIDGE OK' : 'DISCONNECTED', 'HEALTH'],
  ];
  const row = items.map(([k, v, tab], i) => (
    <button key={`${k}${i}`} className="ticker-item" onClick={() => tab && onJump(tab)}>
      <b>{k}</b> {v}
    </button>
  ));
  return (
    <div className="ticker">
      <div className="ticker-track">
        {row}
        {row.map((el, i) => React.cloneElement(el, { key: `dup${i}` }))}
      </div>
    </div>
  );
}
