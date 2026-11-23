import React, { useEffect, useRef, useState } from 'react';
import {
  LuArrowRight, LuChevronDown, LuCpu, LuRadar, LuRoute, LuListChecks, LuMonitorSmartphone, LuOctagonX, LuBox,
  LuGauge, LuTimer, LuShieldCheck, LuCircuitBoard, LuLayers, LuGithub, LuPlay, LuMousePointer2,
} from 'react-icons/lu';
import { createScene } from './Scene.js';
import { LAYERS } from '../gl/novaModel.js';

/* global __DASH_URL__ */
const DASH_URL = typeof __DASH_URL__ !== 'undefined' ? __DASH_URL__ : './index.html?demo=1';

const SPECS = [
  ['Compute', 'Raspberry Pi 5 · 4 GB · Ubuntu 24.04 · ROS 2 Jazzy'],
  ['Low-level controller', 'NOVA-LLC v1 carrier · Arduino Nano · TB6612FNG · 20 kHz PWM'],
  ['Drive', '2× N25 6 V 550 RPM encoder motors · differential drive · ball caster'],
  ['Perception', 'RPLidar A1M8 360° · MPU9250 IMU · wheel odometry fused with an EKF'],
  ['Power', '2S Li-ion · 5 A fuse · reverse-polarity FET · buck to 5 V · Pi on power bank'],
  ['Chassis', '3-layer hexagon · 23.5 × 21.5 cm · 5 cm + 6 cm standoffs'],
  ['Navigation', 'SLAM Toolbox · AMCL · Nav2 with Regulated Pure Pursuit'],
  ['Fleet layer', 'Mission manager · FIFO / priority / nearest scheduling · KPIs + CSV logs'],
];

const ARCH = [
  ['NOVA-LLC firmware', 'Arduino Nano', 'Wheel PID · encoders · IMU · battery · watchdog', LuCircuitBoard],
  ['nova_base', 'Pi 5 · serial', 'cmd_vel ↔ wheel speeds · odometry · IMU', LuCpu],
  ['Nav2 + SLAM', 'ROS 2 Jazzy', 'Mapping · localisation · planning · control', LuRoute],
  ['mission_manager', 'Fleet layer', 'Queue · scheduling policies · retries · KPIs', LuListChecks],
  ['nova_web_bridge', 'rosbridge :9090', 'State · health · maps · modes · E-STOP', LuRadar],
  ['Dashboard', 'React · WebGL', 'Cockpit · dispatcher · analytics · 3D twin', LuMonitorSmartphone],
];

const FEATURES = [
  [LuRoute, 'Autonomous navigation', 'Nav2 global planning with a Regulated Pure Pursuit controller tuned to stay light on the Pi 5.'],
  [LuRadar, 'Live SLAM mapping', 'Drive once with teleop; SLAM Toolbox builds the warehouse map and serialises the pose graph.'],
  [LuListChecks, 'Mission scheduling', 'Pickup → dropoff missions with FIFO, priority or nearest-pickup dispatch, retries and return-home.'],
  [LuBox, '3D digital twin', 'The map extruded into 3D with NOVA, lidar returns and planned paths streaming live in the browser.'],
  [LuOctagonX, 'Layered safety', 'A hardware E-STOP line, a firmware watchdog, and a software E-STOP that pauses every mission.'],
  [LuLayers, 'Sim-to-real', 'The same stack runs in a Gazebo Harmonic warehouse and on the robot, so you can test before you deploy.'],
];

const SECTIONS = ['hero', 'hardware', 'perception', 'architecture', 'research', 'features', 'demo'];

export default function Showcase() {
  const canvasRef = useRef(null);
  const state = useRef({ section: 'hero', highlight: null, dragging: false, mobile: false });
  const [section, setSection] = useState('hero');
  const [hl, setHl] = useState(null);
  const [anchors, setAnchors] = useState([]);
  const [explode, setExplode] = useState(0);
  const [err, setErr] = useState(null);
  const autoHl = useRef(0);

  // scene
  useEffect(() => {
    const st = state.current;
    st.mobile = window.innerWidth < 860;
    let frameN = 0;
    st.onProject = (a, ex) => {
      if (++frameN % 2) return;
      setAnchors(a);
      setExplode(ex);
    };
    let stop;
    try {
      stop = createScene(canvasRef.current, st);
    } catch (e) {
      setErr(e.message);
    }
    const onResize = () => { st.mobile = window.innerWidth < 860; };
    window.addEventListener('resize', onResize);
    return () => {
      stop?.();
      window.removeEventListener('resize', onResize);
    };
  }, []);

  // which section is in view
  useEffect(() => {
    const onScroll = () => {
      const mid = window.innerHeight * 0.5;
      let best = 'hero';
      let bestD = Infinity;
      for (const id of SECTIONS) {
        const el = document.getElementById(id);
        if (!el) continue;
        const r = el.getBoundingClientRect();
        const d = r.top <= mid && r.bottom >= mid ? 0 : Math.min(Math.abs(r.top - mid), Math.abs(r.bottom - mid));
        if (d < bestD) { bestD = d; best = id; }
      }
      state.current.section = best;
      setSection(best);
    };
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  // auto-cycle the highlighted layer in the hardware section
  useEffect(() => {
    if (section !== 'hardware' || hl !== null) {
      state.current.highlight = section === 'hardware' ? hl : null;
      return undefined;
    }
    const id = setInterval(() => {
      autoHl.current = (autoHl.current + 1) % 4;
      state.current.highlight = autoHl.current;
    }, 2200);
    state.current.highlight = autoHl.current;
    return () => clearInterval(id);
  }, [section, hl]);

  // drag to rotate (on the backdrop, not on cards)
  const drag = useRef(null);
  const onDown = (e) => {
    drag.current = [e.clientX, e.clientY];
    state.current.dragging = true;
  };
  useEffect(() => {
    const move = (e) => {
      if (!drag.current) return;
      state.current.dragDelta = [e.clientX - drag.current[0], e.clientY - drag.current[1]];
      drag.current = [e.clientX, e.clientY];
    };
    const up = () => {
      drag.current = null;
      state.current.dragging = false;
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
  }, []);

  const go = (id) => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth' });
  const activeHl = section === 'hardware' ? state.current.highlight : null;

  return (
    <div className="sc">
      <canvas ref={canvasRef} className="sc-canvas" onPointerDown={onDown} />
      <div className="sc-vignette" />
      {err && <div className="sc-err">3D needs WebGL: {err}</div>}

      {section === 'hardware' && explode > 0.6 && anchors.map((a, i) => a && (
        <div key={i} className={`sc-pin ${activeHl === i ? 'on' : ''}`} style={{ transform: `translate(${a[0]}px, ${a[1]}px)` }}>
          <span>{i + 1}</span>
        </div>
      ))}

      <nav className="sc-nav">
        <a className="sc-logo" href="#hero" onClick={(e) => { e.preventDefault(); go('hero'); }}>
          <span className="sc-hex">N</span> NOVA
        </a>
        <div className="sc-links">
          {[['hardware', 'Robot'], ['perception', 'Perception'], ['architecture', 'Architecture'], ['research', 'Research'], ['features', 'Features']].map(([id, label]) => (
            <a key={id} href={`#${id}`} className={section === id ? 'on' : ''} onClick={(e) => { e.preventDefault(); go(id); }}>{label}</a>
          ))}
        </div>
        <a className="sc-btn primary sm" href={DASH_URL}><LuPlay size={14} /> Live demo</a>
      </nav>

      <main className="sc-content">
        <section id="hero" className="sc-section hero">
          <div className="sc-copy">
            <div className="sc-kicker"><span className="sc-dot" /> Final-year project · B.E. Robotics &amp; Automation</div>
            <h1 className="sc-title">NOVA</h1>
            <p className="sc-lead">
              A low-cost autonomous mobile robot for <b>intelligent warehouse transport</b>: it maps the floor, localises itself,
              schedules pickup-to-dropoff missions and streams a live <b>3D digital twin</b> to your browser.
            </p>
            <div className="sc-ctas">
              <a className="sc-btn primary" href={DASH_URL}><LuPlay size={16} /> Launch live demo</a>
              <button className="sc-btn" onClick={() => go('hardware')}>Explore the robot <LuChevronDown size={16} /></button>
            </div>
            <div className="sc-stats">
              {[['ROS 2', 'Jazzy · Nav2'], ['360°', 'LiDAR SLAM'], ['3', 'scheduling policies'], ['23.5 cm', 'hexagon footprint']].map(([v, l]) => (
                <div key={l} className="sc-stat"><b>{v}</b><span>{l}</span></div>
              ))}
            </div>
          </div>
          <div className="sc-hint"><LuMousePointer2 size={14} /> drag to rotate</div>
        </section>

        <section id="hardware" className="sc-section right">
          <div className="sc-panel">
            <div className="sc-eyebrow">01 · Hardware</div>
            <h2>Four layers. One hexagon.</h2>
            <p className="sc-muted">Built from the ground up: motors and power below, compute in the middle, perception on top. Hover a layer to light it up.</p>
            <div className="sc-layers">
              {LAYERS.map((l) => (
                <button
                  key={l.id}
                  className={`sc-layer ${activeHl === l.id ? 'on' : ''}`}
                  onMouseEnter={() => setHl(l.id)}
                  onMouseLeave={() => setHl(null)}
                  onFocus={() => setHl(l.id)}
                  onBlur={() => setHl(null)}
                >
                  <span className="sc-num">{l.id + 1}</span>
                  <span><b>{l.name}</b><small>{l.desc}</small></span>
                </button>
              ))}
            </div>
          </div>
        </section>

        <section id="perception" className="sc-section center bottom">
          <div className="sc-panel wide">
            <div className="sc-eyebrow">02 · Perception</div>
            <h2>Sees 360°. Maps as it moves.</h2>
            <div className="sc-grid3">
              <div className="sc-mini"><LuRadar size={18} /><b>SLAM Toolbox</b><span>Online async mapping at 5 cm resolution with loop closure.</span></div>
              <div className="sc-mini"><LuGauge size={18} /><b>EKF odometry</b><span>Wheel encoders fused with the MPU9250 gyro via robot_localization.</span></div>
              <div className="sc-mini"><LuRoute size={18} /><b>AMCL + Nav2</b><span>Particle-filter localisation, costmap inflation and pure-pursuit control.</span></div>
            </div>
          </div>
        </section>

        <section id="architecture" className="sc-section left">
          <div className="sc-panel">
            <div className="sc-eyebrow">03 · Architecture</div>
            <h2>From PWM to the browser.</h2>
            <div className="sc-arch">
              {ARCH.map(([name, where, what, Icon], i) => (
                <div key={name} className="sc-arch-row">
                  <span className="sc-arch-icon"><Icon size={16} /></span>
                  <div className="grow">
                    <div className="row"><b>{name}</b><span className="sc-tag">{where}</span></div>
                    <small>{what}</small>
                  </div>
                  {i < ARCH.length - 1 && <span className="sc-arch-link" />}
                </div>
              ))}
            </div>
          </div>
        </section>

        <section id="research" className="sc-section right">
          <div className="sc-panel">
            <div className="sc-eyebrow">04 · Research focus</div>
            <h2>Built to be measured.</h2>
            <p className="sc-muted">Every mission is logged. The same random workload can be replayed under each scheduling policy to compare:</p>
            <div className="sc-kpis">
              <div><LuGauge size={18} /><b>Throughput</b><span>missions / hour</span></div>
              <div><LuTimer size={18} /><b>Scheduling efficiency</b><span>wait + cycle time</span></div>
              <div><LuShieldCheck size={18} /><b>Reliability</b><span>success rate · recoveries</span></div>
            </div>
            <div className="sc-policies"><span>FIFO</span><span>Priority</span><span>Nearest pickup</span></div>
          </div>
        </section>

        <section id="features" className="sc-section center bottom">
          <div className="sc-panel wide">
            <div className="sc-eyebrow">05 · Capabilities</div>
            <h2>Everything a warehouse AMR needs.</h2>
            <div className="sc-features">
              {FEATURES.map(([Icon, t, d]) => (
                <div key={t} className="sc-feature"><span className="sc-ficon"><Icon size={18} /></span><b>{t}</b><span>{d}</span></div>
              ))}
            </div>
            <div className="sc-specs">
              {SPECS.map(([k, v]) => <div key={k} className="sc-spec"><span>{k}</span><b>{v}</b></div>)}
            </div>
          </div>
        </section>

        <section id="demo" className="sc-section center demo">
          <div className="sc-copy center">
            <div className="sc-eyebrow">06 · Try it</div>
            <h2 className="sc-big">See NOVA run.</h2>
            <p className="sc-lead">The control dashboard has a built-in simulator: dispatch missions, watch the 3D twin, hit the E-STOP. No robot needed.</p>
            <div className="sc-ctas center">
              <a className="sc-btn primary" href={DASH_URL}><LuPlay size={16} /> Open the dashboard <LuArrowRight size={16} /></a>
            </div>
          </div>
        </section>

        <footer className="sc-footer">
          <span className="sc-hex sm">N</span>
          <span>NOVA AMR · Thirunavukkarasu · Robotics &amp; Automation, Rajalakshmi Engineering College, Chennai</span>
          <span className="sc-muted"><LuGithub size={13} /> ROS 2 Jazzy · Nav2 · WebGL</span>
        </footer>
      </main>
    </div>
  );
}
