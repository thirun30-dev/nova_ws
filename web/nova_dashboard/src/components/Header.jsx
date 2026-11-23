import React, { useState } from 'react';
import {
  LuGauge, LuSend, LuChartLine, LuBookOpenCheck, LuOctagonX, LuRotateCcw, LuPlugZap, LuFlaskConical,
} from 'react-icons/lu';

export const VIEWS = [
  { id: 'COCKPIT', label: 'Cockpit', icon: LuGauge },
  { id: 'DISPATCH', label: 'Dispatcher', icon: LuSend },
  { id: 'ANALYTICS', label: 'Analytics', icon: LuChartLine },
];

export default function Header({ nova, view, setView, onSop }) {
  const { connected, demo, url, state, api, connect, startDemo } = nova;
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(url);
  const estop = !!state?.estop;

  const link = demo
    ? { dot: 'demo', text: 'DEMO MODE' }
    : connected
      ? { dot: 'ok', text: 'ONLINE' }
      : { dot: 'bad', text: 'OFFLINE' };

  return (
    <header className="header">
      <div className="header-inner">
        <div className="brand">
          <div className="brand-mark">N</div>
          <div className="hide-sm">
            <div className="brand-name">NOVA</div>
            <div className="brand-sub">AMR CONTROL · WAREHOUSE TRANSPORT</div>
          </div>
        </div>

        <nav className="views">
          {VIEWS.map((v) => (
            <button key={v.id} className={`view-btn ${view === v.id ? 'active' : ''}`} onClick={() => setView(v.id)}>
              <v.icon size={15} /> {v.label}
            </button>
          ))}
        </nav>

        <div className="header-right">
          <div style={{ position: 'relative' }}>
            <button className="link-pill" onClick={() => { setDraft(url); setOpen((o) => !o); }} title={demo ? 'Simulated robot' : url}>
              <span className={`dot ${link.dot}`} />
              <span className="mono">{link.text}</span>
              <span className="hide-sm faint mono" style={{ maxWidth: 170, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {demo ? 'in-browser sim' : url.replace(/^wss?:\/\//, '')}
              </span>
            </button>
            {open && (
              <div className="popover">
                <div className="label">rosbridge URL</div>
                <form
                  className="row"
                  style={{ marginTop: 6 }}
                  onSubmit={(e) => {
                    e.preventDefault();
                    connect(draft.trim());
                    setOpen(false);
                  }}
                >
                  <input className="input mono" value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="ws://nova.local:9090" />
                  <button className="btn primary sm" type="submit"><LuPlugZap size={14} /> Connect</button>
                </form>
                <p className="small muted" style={{ margin: '10px 0' }}>
                  On the robot: <span className="mono">ros2 launch nova_bringup robot.launch.py web:=true</span>
                </p>
                <button className="btn block sm" onClick={() => { startDemo(); setOpen(false); }}>
                  <LuFlaskConical size={14} /> Run in-browser demo (no robot)
                </button>
              </div>
            )}
          </div>

          <button className="icon-btn hide-sm" onClick={onSop} title="Warehouse SOP">
            <LuBookOpenCheck size={17} />
          </button>

          <button
            className={`estop hide-sm ${estop ? 'engaged' : ''}`}
            onClick={() => (estop ? api.resetEstop() : api.estop())}
            disabled={!connected}
            title={estop ? 'Release E-STOP' : 'Emergency stop'}
          >
            {estop ? <LuRotateCcw size={17} /> : <LuOctagonX size={17} />}
            {estop ? 'RESET' : 'E-STOP'}
          </button>
        </div>
      </div>
    </header>
  );
}
