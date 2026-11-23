// Virtual joystick + WASD/arrow keys. Publishes cmd_vel at 10 Hz while active and a single
// zero on release (the Nano and base driver also stop on their own after 0.5 s of silence).
import React, { useEffect, useRef, useState } from 'react';
import { LuOctagonPause } from 'react-icons/lu';
import { fmt } from '../lib/geom.js';

export default function Teleop({ nova }) {
  const { api, connected, state } = nova;
  const disabled = !connected || state?.estop;
  const [maxV, setMaxV] = useState(0.25);
  const [maxW, setMaxW] = useState(0.5);   // slow turns keep lidar scans sharp for SLAM
  const [knob, setKnob] = useState([0, 0]); // -1..1
  const [keys, setKeys] = useState({});
  const cmd = useRef([0, 0]);
  const active = useRef(false);
  const padRef = useRef(null);
  const limits = useRef({ maxV, maxW });
  limits.current = { maxV, maxW };

  // command loop
  useEffect(() => {
    const id = setInterval(() => {
      const [v, w] = cmd.current;
      if (v || w) {
        api.sendVelocity(v, w);
        active.current = true;
      } else if (active.current) {
        api.sendVelocity(0, 0);
        active.current = false;
      }
    }, 100);
    return () => {
      clearInterval(id);
      if (active.current) api.sendVelocity(0, 0);
    };
  }, [api]);

  useEffect(() => {
    if (disabled) {
      cmd.current = [0, 0];
      setKnob([0, 0]);
    }
  }, [disabled]);

  // keyboard
  useEffect(() => {
    const map = { w: 'up', arrowup: 'up', s: 'down', arrowdown: 'down', a: 'left', arrowleft: 'left', d: 'right', arrowright: 'right', ' ': 'stop' };
    const apply = (k) => {
      const f = (k.up ? 1 : 0) - (k.down ? 1 : 0);
      const t = (k.left ? 1 : 0) - (k.right ? 1 : 0);
      cmd.current = disabled || k.stop ? [0, 0] : [f * limits.current.maxV, t * limits.current.maxW];
    };
    const down = (e) => {
      if (['INPUT', 'SELECT', 'TEXTAREA'].includes(e.target.tagName)) return;
      const k = map[e.key.toLowerCase()];
      if (!k) return;
      e.preventDefault();
      setKeys((prev) => {
        const next = { ...prev, [k]: true };
        apply(next);
        return next;
      });
    };
    const up = (e) => {
      const k = map[e.key.toLowerCase()];
      if (!k) return;
      setKeys((prev) => {
        const next = { ...prev, [k]: false };
        apply(next);
        return next;
      });
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      cmd.current = [0, 0];
    };
  }, [disabled]);

  const fromPointer = (e) => {
    const r = padRef.current.getBoundingClientRect();
    let dx = (e.clientX - (r.left + r.width / 2)) / (r.width / 2 - 32);
    let dy = (e.clientY - (r.top + r.height / 2)) / (r.height / 2 - 32);
    const m = Math.hypot(dx, dy);
    if (m > 1) { dx /= m; dy /= m; }
    setKnob([dx, dy]);
    const dz = (v) => (Math.abs(v) < 0.08 ? 0 : v);
    cmd.current = [-dz(dy) * limits.current.maxV, -dz(dx) * limits.current.maxW];
  };
  const release = () => {
    setKnob([0, 0]);
    cmd.current = [0, 0];
  };

  return (
    <div className="col" style={{ gap: 14 }}>
      <div
        ref={padRef}
        className={`joy ${disabled ? 'disabled' : ''}`}
        onPointerDown={(e) => { if (disabled) return; e.currentTarget.setPointerCapture(e.pointerId); fromPointer(e); }}
        onPointerMove={(e) => { if (e.buttons && !disabled) fromPointer(e); }}
        onPointerUp={release}
        onPointerCancel={release}
      >
        <div className="joy-knob" style={{ transform: `translate(${knob[0] * 68}px, ${knob[1] * 68}px)` }} />
      </div>
      <div className="row between">
        <div className="mono small">v <b>{fmt(cmd.current[0])}</b> m/s</div>
        <div className="mono small">ω <b>{fmt(cmd.current[1])}</b> rad/s</div>
      </div>
      <div className="keys">
        <span />
        <button className={`key ${keys.up ? 'on' : ''}`} tabIndex={-1}>W</button>
        <span />
        <button className={`key ${keys.left ? 'on' : ''}`} tabIndex={-1}>A</button>
        <button className={`key ${keys.down ? 'on' : ''}`} tabIndex={-1}>S</button>
        <button className={`key ${keys.right ? 'on' : ''}`} tabIndex={-1}>D</button>
      </div>
      <div className="col" style={{ gap: 4 }}>
        <div className="row between"><span className="label">Max linear</span><span className="mono small">{fmt(maxV)} m/s</span></div>
        <input className="slider" type="range" min="0.05" max="0.45" step="0.01" value={maxV} onChange={(e) => setMaxV(+e.target.value)} />
        <div className="row between"><span className="label">Max angular</span><span className="mono small">{fmt(maxW, 1)} rad/s</span></div>
        <input className="slider" type="range" min="0.3" max="2.5" step="0.1" value={maxW} onChange={(e) => setMaxW(+e.target.value)} />
      </div>
      <button className="btn dark block" onClick={() => { release(); api.sendVelocity(0, 0); api.cancelNav(); }} disabled={!connected}>
        <LuOctagonPause size={15} /> Stop &amp; cancel goal
      </button>
      <p className="tiny muted" style={{ margin: 0 }}>
        Keys: W/S forward–back, A/D turn, Space stop. Teleop overrides Nav2 while held.
        {state?.estop && <b style={{ color: 'var(--bad)' }}> E-STOP engaged — driving disabled.</b>}
      </p>
    </div>
  );
}
