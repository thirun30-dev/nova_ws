import React from 'react';
import { LuBatteryMedium, LuGauge, LuCompass, LuNavigation2, LuPackage, LuClock } from 'react-icons/lu';
import { Card, StateBadge } from './ui.jsx';
import { deg, fmt, fmtDuration } from '../lib/geom.js';

export default function RobotStatus({ nova }) {
  const { battery, odom, pose, nav, metrics, state } = nova;
  const pct = battery ? Math.round(battery.percentage * 100) : null;
  const battTone = pct === null ? '' : pct < 20 ? 'bad' : pct < 45 ? '' : 'ok';

  return (
    <Card title="NOVA status" icon={LuGauge} right={<StateBadge state={state?.mode} />}>
      <div className="tiles">
        <div className="tile">
          <div className="tile-label"><LuBatteryMedium size={13} /> Battery · 2S</div>
          <div className="tile-value">{pct === null ? '—' : pct}<small>%</small></div>
          <div className={`bar ${battTone}`}><span style={{ width: `${pct ?? 0}%` }} /></div>
          <div className="tile-sub mono">{battery ? `${fmt(battery.voltage, 2)} V` : 'no data'}</div>
        </div>
        <div className="tile">
          <div className="tile-label"><LuGauge size={13} /> Velocity</div>
          <div className="tile-value">{fmt(odom?.vx)}<small>m/s</small></div>
          <div className="tile-sub mono">ω {fmt(odom?.wz)} rad/s</div>
        </div>
        <div className="tile">
          <div className="tile-label"><LuCompass size={13} /> Pose · {pose?.frame || 'map'}</div>
          <div className="tile-value">{pose ? `${fmt(pose.x)}, ${fmt(pose.y)}` : '—'}</div>
          <div className="tile-sub mono">θ {pose ? `${fmt(deg(pose.yaw), 1)}°` : '—'}</div>
        </div>
        <div className="tile">
          <div className="tile-label"><LuNavigation2 size={13} /> Navigation</div>
          <div style={{ marginTop: 8 }}><StateBadge state={nav?.state} /></div>
          <div className="tile-sub mono">
            {nav?.state === 'NAVIGATING'
              ? `${fmt(nav.distance_remaining, 1)} m · ETA ${fmtDuration(nav.eta_s)}`
              : nav?.recoveries ? `${nav.recoveries} recoveries` : 'no active goal'}
          </div>
        </div>
        <div className="tile">
          <div className="tile-label"><LuPackage size={13} /> Mission</div>
          <div className="tile-value">{metrics?.active_mission_id || '—'}</div>
          <div className="tile-sub">{metrics ? `${metrics.robot_state.replaceAll('_', ' ')} · ${metrics.queue_length} queued` : 'mission manager offline'}</div>
        </div>
        <div className="tile">
          <div className="tile-label"><LuClock size={13} /> Uptime</div>
          <div className="tile-value">{fmtDuration(state?.uptime_s)}</div>
          <div className="tile-sub">{state?.map ? `map: ${state.map}` : state?.use_sim_time ? 'sim time' : 'wall time'}</div>
        </div>
      </div>
    </Card>
  );
}
