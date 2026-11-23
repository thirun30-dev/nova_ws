import React from 'react';
import { LuRadio, LuCpu, LuNetwork } from 'react-icons/lu';
import { Empty } from './ui.jsx';

const TOPIC_LABELS = { scan: 'LiDAR /scan', odom: 'Odometry /odom', 'imu/data_raw': 'IMU /imu/data_raw', battery: 'Battery /battery', map: 'Map /map' };

function Gauge({ label, value, unit, max, warn, bad }) {
  const pct = value == null ? 0 : Math.min(100, (100 * value) / max);
  const tone = value == null ? '' : value >= bad ? 'bad' : value >= warn ? '' : 'ok';
  return (
    <div className="gauge">
      <div className="row between"><span className="label">{label}</span><span className="mono small">{value == null ? '—' : `${value}${unit}`}</span></div>
      <div className={`bar ${tone}`}><span style={{ width: `${pct}%` }} /></div>
    </div>
  );
}

export default function Health({ nova }) {
  const { health } = nova;
  if (!health) return <Empty>Waiting for /nova/health… (is nova_web_bridge running?)</Empty>;
  const sys = health.system || {};
  return (
    <div className="col" style={{ gap: 16 }}>
      <div>
        <div className="row" style={{ marginBottom: 4 }}><LuRadio size={14} color="var(--accent)" /><span className="label">Sensor streams</span></div>
        {Object.entries(health.topics || {}).map(([t, v]) => (
          <div key={t} className="hrow">
            <span className={`dot ${v.ok ? 'ok' : 'bad'}`} />
            <span className="grow small">{TOPIC_LABELS[t] || t}</span>
            <span className="mono small">{v.hz == null ? (v.ok ? 'latched' : 'missing') : `${v.hz} Hz`}</span>
            {v.expected && <span className="tiny faint mono">/ {v.expected}</span>}
          </div>
        ))}
      </div>
      <div>
        <div className="row" style={{ marginBottom: 8 }}><LuNetwork size={14} color="var(--accent)" /><span className="label">ROS nodes</span></div>
        <div className="nodes">
          {Object.entries(health.nodes || {}).map(([n, up]) => (
            <div key={n} className="node" title={n}><span className={`dot ${up ? 'ok' : ''}`} /><span>{n}</span></div>
          ))}
        </div>
      </div>
      <div className="col" style={{ gap: 10 }}>
        <div className="row"><LuCpu size={14} color="var(--accent)" /><span className="label">Raspberry Pi 5</span></div>
        <Gauge label="CPU temp" value={sys.cpu_temp_c} unit=" °C" max={90} warn={70} bad={80} />
        <Gauge label="CPU load" value={sys.load != null ? Math.round(sys.load * 100) : null} unit=" %" max={100} warn={70} bad={90} />
        <Gauge label="Memory" value={sys.mem_pct} unit=" %" max={100} warn={75} bad={90} />
        <Gauge label="Disk" value={sys.disk_pct} unit=" %" max={100} warn={80} bad={92} />
      </div>
    </div>
  );
}
