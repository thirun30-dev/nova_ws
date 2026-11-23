import React, { useEffect, useMemo, useState } from 'react';
import { LuSend, LuShuffle, LuListOrdered, LuX, LuArrowRight, LuTruck, LuCheck, LuPackage, LuPackageOpen, LuClock } from 'react-icons/lu';
import MapPanel from '../components/MapPanel.jsx';
import { Card, StateBadge, Badge, Empty } from '../components/ui.jsx';
import { fmtDuration } from '../lib/geom.js';

const STEPS = [
  ['QUEUED', 'Queued', LuClock],
  ['TO_PICKUP', 'To pickup', LuTruck],
  ['LOADING', 'Loading', LuPackage],
  ['TO_DROPOFF', 'To dropoff', LuTruck],
  ['UNLOADING', 'Unloading', LuPackageOpen],
  ['COMPLETED', 'Done', LuCheck],
];
const PRIORITIES = [[0, 'Normal'], [2, 'High'], [5, 'Urgent']];
const TERMINAL = ['COMPLETED', 'FAILED', 'CANCELLED'];

function Stepper({ state }) {
  const idx = STEPS.findIndex(([s]) => s === state);
  return (
    <div className="steps">
      {STEPS.map(([s, label, Icon], i) => (
        <React.Fragment key={s}>
          {i > 0 && <div className={`step-line ${i <= idx ? 'done' : ''}`} />}
          <div className={`step ${i < idx || state === 'COMPLETED' ? 'done' : i === idx ? 'now' : ''}`}>
            <span className="pip"><Icon size={13} /></span>
            {label}
          </div>
        </React.Fragment>
      ))}
    </div>
  );
}

export default function Dispatcher({ nova }) {
  const { locations, missions, metrics, api, connected } = nova;
  const pickups = locations.filter((l) => l.type !== 'dropoff' && l.type !== 'home');
  const dropoffs = locations.filter((l) => l.type !== 'pickup' && l.type !== 'home');
  const [pickup, setPickup] = useState('');
  const [dropoff, setDropoff] = useState('');
  const [priority, setPriority] = useState(0);
  const [filter, setFilter] = useState('LIVE');
  const [now, setNow] = useState(Date.now() / 1000);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now() / 1000), 1000);
    return () => clearInterval(id);
  }, []);
  useEffect(() => {
    if (!pickup && pickups.length) setPickup(pickups[0].name);
    if (!dropoff && dropoffs.length) setDropoff(dropoffs[0].name);
  }, [pickups, dropoffs, pickup, dropoff]);

  const active = missions.find((m) => m.id === metrics?.active_mission_id);
  const rows = useMemo(
    () => (filter === 'LIVE' ? missions.filter((m) => !TERMINAL.includes(m.state)) : [...missions].reverse()),
    [missions, filter],
  );
  const route = active ? [locations.find((l) => l.name === active.pickup), locations.find((l) => l.name === active.dropoff)].filter(Boolean) : [];

  const batch = () => {
    for (let i = 0; i < 5; i++) {
      const p = pickups[Math.floor(Math.random() * pickups.length)];
      const d = dropoffs[Math.floor(Math.random() * dropoffs.length)];
      if (p && d && p.name !== d.name) api.submitMission(p.name, d.name, Math.random() < 0.2 ? 2 : 0);
    }
  };

  // mission sim time vs wall time: show durations relative to the newest stamp we have
  const ref = metrics?.stamp || now;

  return (
    <div className="grid g-dispatch">
      <div className="col" style={{ gap: 16 }}>
        <Card title="New transport mission" icon={LuSend} right={metrics && <Badge tone="accent">policy: {metrics.policy}</Badge>}>
          <div className="row" style={{ alignItems: 'flex-end' }}>
            <div className="grow col" style={{ gap: 4 }}>
              <span className="label">Pickup</span>
              <select className="select" value={pickup} onChange={(e) => setPickup(e.target.value)}>
                {pickups.map((l) => <option key={l.name}>{l.name}</option>)}
              </select>
            </div>
            <LuArrowRight size={18} color="var(--faint)" style={{ marginBottom: 9 }} />
            <div className="grow col" style={{ gap: 4 }}>
              <span className="label">Dropoff</span>
              <select className="select" value={dropoff} onChange={(e) => setDropoff(e.target.value)}>
                {dropoffs.map((l) => <option key={l.name}>{l.name}</option>)}
              </select>
            </div>
          </div>
          <div className="col" style={{ gap: 4, marginTop: 12 }}>
            <span className="label">Priority</span>
            <div className="seg">
              {PRIORITIES.map(([v, label]) => <button key={v} className={priority === v ? 'on' : ''} onClick={() => setPriority(v)}>{label}</button>)}
            </div>
          </div>
          <div className="row" style={{ marginTop: 14 }}>
            <button className="btn primary grow" disabled={!connected || !pickup || !dropoff || pickup === dropoff} onClick={() => api.submitMission(pickup, dropoff, priority)}>
              <LuSend size={15} /> Dispatch
            </button>
            <button className="btn" disabled={!connected || !pickups.length || !dropoffs.length} onClick={batch} title="Queue 5 random missions">
              <LuShuffle size={15} /> Batch ×5
            </button>
          </div>
        </Card>

        <Card title="Active mission" icon={LuTruck} right={active && <StateBadge state={active.state} />}>
          {active ? (
            <>
              <div className="row between" style={{ marginBottom: 14 }}>
                <div>
                  <div className="mono bold" style={{ fontSize: 18 }}>{active.id}</div>
                  <div className="small muted">{active.pickup} → {active.dropoff} · attempt {active.attempts}</div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div className="mono bold">{fmtDuration(ref - active.started)}</div>
                  <div className="tiny muted">elapsed</div>
                </div>
              </div>
              <Stepper state={active.state} />
              <button className="btn danger sm" style={{ marginTop: 14 }} onClick={() => api.cancelMission(active.id)}><LuX size={13} /> Abort mission</button>
            </>
          ) : (
            <Empty>{metrics ? `NOVA is ${metrics.robot_state.replaceAll('_', ' ').toLowerCase()}.` : 'Mission manager not running.'}</Empty>
          )}
        </Card>

        <Card
          title="Mission queue"
          icon={LuListOrdered}
          bodyClass=""
          right={
            <div className="seg" style={{ width: 150 }}>
              <button className={filter === 'LIVE' ? 'on' : ''} onClick={() => setFilter('LIVE')}>Live</button>
              <button className={filter === 'ALL' ? 'on' : ''} onClick={() => setFilter('ALL')}>All</button>
            </div>
          }
        >
          <div style={{ maxHeight: 360, overflow: 'auto' }}>
            {rows.length === 0 ? (
              <Empty>{filter === 'LIVE' ? 'Queue is empty.' : 'No missions yet.'}</Empty>
            ) : (
              <table className="table">
                <thead><tr><th>ID</th><th>Route</th><th>Pri</th><th>State</th><th>Time</th><th /></tr></thead>
                <tbody>
                  {rows.map((m) => {
                    const t = m.finished ? m.finished - (m.started || m.created) : ref - (m.started || m.created);
                    return (
                      <tr key={m.id} className={m.id === active?.id ? 'active-row' : ''}>
                        <td className="mono bold">{m.id}</td>
                        <td className="small">{m.pickup} <span className="faint">→</span> {m.dropoff}</td>
                        <td>{m.priority > 0 ? <Badge tone={m.priority >= 5 ? 'bad' : 'accent'}>P{m.priority}</Badge> : <span className="faint small">—</span>}</td>
                        <td><StateBadge state={m.state} /></td>
                        <td className="mono small">{fmtDuration(t)}</td>
                        <td>{!TERMINAL.includes(m.state) && <button className="btn ghost xs" onClick={() => api.cancelMission(m.id)} title="Cancel"><LuX size={13} /></button>}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </Card>
      </div>

      <section className="card" style={{ padding: 0, overflow: 'hidden', minHeight: 560 }}>
        <MapPanel
          id="dispatch"
          compact
          odom={nova.odom}
          title={route.length === 2 ? `${route[0].name} → ${route[1].name}` : 'Fleet map'}
          map={nova.map}
          scan={nova.scan}
          pose={nova.pose}
          plan={nova.plan}
          locations={locations}
          goal={nova.nav?.goal}
          navState={nova.nav?.state}
        />
      </section>
    </div>
  );
}
