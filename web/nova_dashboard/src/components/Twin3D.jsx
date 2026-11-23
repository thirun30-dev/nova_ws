// 3D digital twin: map extruded into walls, floor from the occupancy grid, live NOVA model,
// lidar returns, Nav2 plan, trail, stations as light beams. Orbit / follow / top cameras,
// nav-goal and pose-estimate tools picked on the floor.
import React, { useEffect, useRef, useState } from 'react';
import {
  LuRotate3D, LuCar, LuSquareDashed, LuNavigation, LuCrosshair, LuZoomIn, LuZoomOut, LuMaximize, LuMinimize, LuScan,
} from 'react-icons/lu';
import { Engine, Geo, OrbitCam, m4 } from '../gl/engine.js';
import { buildNova, drawNova, Z } from '../gl/novaModel.js';
import { locType } from './ui.jsx';

const WALL_H = 0.45;
const hexToRgb = (h) => [parseInt(h.slice(1, 3), 16) / 255, parseInt(h.slice(3, 5), 16) / 255, parseInt(h.slice(5, 7), 16) / 255];

function wallsFromGrid(g) {
  const geo = new Geo();
  const R = g.resolution;
  for (let j = 0; j < g.height; j++) {
    let i = 0;
    while (i < g.width) {
      if (g.data[j * g.width + i] >= 65) {
        let k = i;
        while (k + 1 < g.width && g.data[j * g.width + k + 1] >= 65) k++;
        const x0 = g.ox + i * R;
        const x1 = g.ox + (k + 1) * R;
        geo.box((x0 + x1) / 2, g.oy + (j + 0.5) * R, WALL_H / 2, x1 - x0, R, WALL_H);
        i = k + 1;
      } else i++;
    }
  }
  return geo;
}

function floorRgba(g) {
  const px = new Uint8Array(g.width * g.height * 4);
  for (let k = 0; k < g.width * g.height; k++) {
    const v = g.data[k];
    const o = k * 4;
    if (v < 0) { px[o] = 8; px[o + 1] = 14; px[o + 2] = 26; px[o + 3] = 90; }
    else if (v >= 65) { px[o] = 34; px[o + 1] = 90; px[o + 2] = 130; px[o + 3] = 255; }
    else { px[o] = 15; px[o + 1] = 26; px[o + 2] = 46; px[o + 3] = 255; }
  }
  return px;
}

function ribbon(points, width, z) {
  const geo = new Geo();
  for (let i = 0; i + 1 < points.length; i++) {
    const [x0, y0] = points[i];
    const [x1, y1] = points[i + 1];
    const L = Math.hypot(x1 - x0, y1 - y0) || 1;
    const nx = (-(y1 - y0) / L) * width / 2;
    const ny = ((x1 - x0) / L) * width / 2;
    geo.quad([x0 + nx, y0 + ny, z], [x0 - nx, y0 - ny, z], [x1 - nx, y1 - ny, z], [x1 + nx, y1 + ny, z]);
  }
  return geo;
}

export default function Twin3D({ map, scan, pose, plan, locations = [], goal, navState, onGoal, onInitialPose, compact = false, title = '3D twin', odom }) {
  const wrapRef = useRef(null);
  const canvasRef = useRef(null);
  const labelsRef = useRef(null);
  const props = useRef({});
  const eng = useRef(null);
  const [mode, setMode] = useState('ORBIT');
  const [tool, setTool] = useState('ORBIT');
  const [big, setBig] = useState(true);
  const [layers, setLayers] = useState({ lidar: true, rays: !compact, trail: true, beams: true });
  const [full, setFull] = useState(false);
  const [err, setErr] = useState(null);
  const [cursor, setCursor] = useState(null);

  props.current = { map, scan, pose, plan, locations, goal, navState, mode, tool, big, layers, odom };

  useEffect(() => {
    let raf;
    let E;
    try {
      E = new Engine(canvasRef.current, { clear: [0, 0, 0, 0] });
    } catch (e) {
      setErr(e.message);
      return undefined;
    }
    const S = {
      E,
      cam: new OrbitCam({ target: [0, 0, 0], dist: 14, yaw: -2.1, pitch: 0.95 }),
      nova: buildNova(E),
      unitRing: E.createMesh(new Geo().ring(0, 0, 0.004, 0.78, 1.0, 48)),
      unitDisc: E.createMesh(new Geo().ring(0, 0, 0.002, 0.0, 1.0, 40)),
      unitBeam: E.createMesh(new Geo().cyl(0, 0, 0.5, 1, 1, 'z', 28)),
      arrow: E.createMesh(new Geo().box(0.25, 0, 0.012, 0.5, 0.05, 0.006).prism([[0.62, 0], [0.48, 0.07], [0.48, -0.07]], 0.009, 0.015)),
      walls: null, wallsSrc: null, planMesh: null, planSrc: null,
      trail: [], fitted: false, spin: 0, t0: performance.now(), drag: null, pointers: new Map(),
    };
    eng.current = S;

    const frame = () => {
      raf = requestAnimationFrame(frame);
      const P = props.current;
      const t = (performance.now() - S.t0) / 1000;
      S.spin += 0.18;

      // rebuild map-dependent geometry
      if (P.map && S.wallsSrc !== P.map) {
        S.wallsSrc = P.map;
        E.deleteMesh(S.walls);
        S.walls = E.createMesh(wallsFromGrid(P.map));
        const m = P.map;
        E.setFloor(floorRgba(m), m.width, m.height, m.ox, m.oy, m.ox + m.width * m.resolution, m.oy + m.height * m.resolution);
        S.bounds = [m.ox, m.oy, m.ox + m.width * m.resolution, m.oy + m.height * m.resolution];
        if (!S.fitted) {
          S.fitted = true;
          S.cam.target = [(S.bounds[0] + S.bounds[2]) / 2, (S.bounds[1] + S.bounds[3]) / 2, 0];
          S.cam.dist = Math.max(S.bounds[2] - S.bounds[0], S.bounds[3] - S.bounds[1]) * 0.95;
        }
      }
      if (P.plan !== S.planSrc) {
        S.planSrc = P.plan;
        E.deleteMesh(S.planMesh);
        S.planMesh = P.plan && P.plan.length > 1 ? E.createMesh(ribbon(P.plan, 0.07, 0.012)) : null;
      }
      if (P.pose) {
        const last = S.trail[S.trail.length - 1];
        if (!last || Math.hypot(last[0] - P.pose.x, last[1] - P.pose.y) > 0.06) {
          S.trail.push([P.pose.x, P.pose.y]);
          if (S.trail.length > 300) S.trail.shift();
        }
      }

      // camera
      const cam = S.cam;
      if (P.pose && P.mode === 'FOLLOW') {
        cam.goal = { target: [P.pose.x, P.pose.y, 0.1], dist: 2.6, pitch: 0.42, yaw: P.pose.yaw + Math.PI };
        cam.update(0.07);
      } else if (P.mode === 'TOP' && S.bounds) {
        cam.goal = { pitch: 1.5, yaw: -Math.PI / 2 };
        cam.update(0.1);
      } else cam.goal = null;
      E.begin(cam.eye(), cam.target, 0.85);

      // floor + grid
      E.drawFloor(1);
      if (S.bounds) {
        const [x0, y0, x1, y1] = S.bounds;
        const gp = [];
        const gc = [];
        for (let x = Math.ceil(x0); x <= x1; x++) { gp.push(x, y0, 0.003, x, y1, 0.003); gc.push(0.13, 0.83, 0.93, 0.07, 0.13, 0.83, 0.93, 0.07); }
        for (let y = Math.ceil(y0); y <= y1; y++) { gp.push(x0, y, 0.003, x1, y, 0.003); gc.push(0.13, 0.83, 0.93, 0.07, 0.13, 0.83, 0.93, 0.07); }
        E.drawLines(gp, gc, 'lines');
      }
      // walls
      if (S.walls) E.drawMesh(S.walls, m4.ident(), [0.1, 0.2, 0.32, 1], 0.12);

      // stations
      for (const l of P.locations) {
        const c = hexToRgb(locType(l.type).color);
        E.drawMesh(S.unitRing, m4.trs(l.x, l.y, 0, 0, 0.24), [...c, 0.9], 1.2, { additive: true });
        if (P.layers.beams) E.drawMesh(S.unitBeam, m4.trs(l.x, l.y, 0, 0, 0.18, 0.18, 1.1), [...c, 0.09], 0.8, { additive: true });
      }

      // trail
      if (P.layers.trail && S.trail.length > 1) {
        const tp = [];
        const tc = [];
        S.trail.forEach(([x, y], i) => { tp.push(x, y, 0.006); tc.push(0.65, 0.55, 0.98, (i / S.trail.length) * 0.8); });
        E.drawLines(tp, tc, 'strip');
      }
      // plan
      if (S.planMesh) E.drawMesh(S.planMesh, m4.ident(), [0.2, 0.83, 0.6, 0.85], 1.0, { additive: true });

      // goal
      const g = S.drag?.preview || (P.navState === 'NAVIGATING' ? P.goal : null);
      if (g) {
        const pulse = 0.22 + 0.05 * Math.sin(t * 5);
        const col = S.drag?.kind === 'POSE' ? [0.2, 0.83, 0.6, 1] : [0.13, 0.83, 0.93, 1];
        E.drawMesh(S.unitRing, m4.trs(g.x, g.y, 0, 0, pulse), col, 1.3, { additive: true });
        E.drawMesh(S.arrow, m4.trs(g.x, g.y, 0, g.yaw), col, 1.0, { additive: true });
      }

      // robot
      const scale = P.big ? 3 : 1;
      if (P.pose) {
        const base = m4.trs(P.pose.x, P.pose.y, 0, P.pose.yaw, scale);
        E.drawMesh(S.unitDisc, m4.trs(P.pose.x, P.pose.y, 0.001, 0, 0.16 * scale), [0, 0, 0, 0.45], 0);
        drawNova(E, S.nova, base, { spin: S.spin });

        // lidar
        if (P.layers.lidar && P.scan && (!P.pose.frame || P.pose.frame === 'map' || !P.map)) {
          const s = P.scan;
          const pts = [];
          const pc = [];
          const rays = [];
          const rc = [];
          const zh = Z.scan * Math.min(scale, 1.6);
          for (let i = 0; i < s.ranges.length; i++) {
            const r = s.ranges[i];
            if (r === null || !Number.isFinite(r) || r < s.range_min || r > s.range_max) continue;
            const a = P.pose.yaw + s.angle_min + i * s.angle_increment;
            const x = P.pose.x + r * Math.cos(a);
            const y = P.pose.y + r * Math.sin(a);
            pts.push(x, y, zh);
            pc.push(0.98, 0.35, 0.5, 0.95);
            if (P.layers.rays && i % 5 === 0) {
              rays.push(P.pose.x, P.pose.y, zh, x, y, zh);
              rc.push(0.98, 0.35, 0.5, 0.0, 0.98, 0.35, 0.5, 0.22);
            }
          }
          if (rays.length) E.drawLines(rays, rc, 'lines');
          E.drawLines(pts, pc, 'points', { size: 4.5 });
        }
      }

      // HTML labels
      const box = labelsRef.current;
      if (box) {
        const items = [...P.locations.map((l) => ({ key: `s:${l.name}`, x: l.x, y: l.y, z: 1.25, text: l.name, color: locType(l.type).color }))];
        if (P.pose) {
          const v = P.odom ? Math.abs(P.odom.vx).toFixed(2) : '0.00';
          items.push({ key: 'robot', x: P.pose.x, y: P.pose.y, z: 0.3 * scale + 0.25, text: `NOVA · ${v} m/s`, color: '#22d3ee', robot: true });
        }
        const seen = new Set();
        for (const it of items) {
          seen.add(it.key);
          let el = box.querySelector(`[data-k="${CSS.escape(it.key)}"]`);
          if (!el) {
            el = document.createElement('div');
            el.className = `twin-label ${it.robot ? 'robot' : ''}`;
            el.dataset.k = it.key;
            box.appendChild(el);
          }
          if (el.textContent !== it.text) el.textContent = it.text;
          el.style.setProperty('--c', it.color);
          const p = E.project([it.x, it.y, it.z]);
          if (!p) { el.style.display = 'none'; continue; }
          el.style.display = '';
          el.style.transform = `translate(${p[0]}px, ${p[1]}px) translate(-50%, -100%)`;
        }
        [...box.children].forEach((el) => { if (!seen.has(el.dataset.k)) el.remove(); });
      }
    };
    frame();
    return () => cancelAnimationFrame(raf);
  }, []);

  // ------------------------------------------------------------------ input
  const local = (e) => {
    const r = canvasRef.current.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  };
  const onDown = (e) => {
    const S = eng.current;
    if (!S) return;
    canvasRef.current.setPointerCapture(e.pointerId);
    const [px, py] = local(e);
    S.pointers.set(e.pointerId, [px, py]);
    if (S.pointers.size === 2) {
      const [a, b] = [...S.pointers.values()];
      S.drag = { kind: 'PINCH', d0: Math.hypot(a[0] - b[0], a[1] - b[1]), dist0: S.cam.dist, mid: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2] };
      return;
    }
    if ((tool === 'GOAL' || tool === 'POSE') && e.button === 0) {
      const w = S.E.pickGround(px, py);
      if (w) S.drag = { kind: tool, sx: w[0], sy: w[1], preview: { x: w[0], y: w[1], yaw: 0 } };
      return;
    }
    if (mode !== 'ORBIT') setMode('ORBIT');
    S.drag = { kind: e.button === 2 || e.shiftKey ? 'PAN' : 'ROT', px, py };
  };
  const onMove = (e) => {
    const S = eng.current;
    if (!S) return;
    const [px, py] = local(e);
    const w = S.E.pickGround(px, py);
    setCursor(w);
    if (!S.pointers.has(e.pointerId)) return;
    const prev = S.pointers.get(e.pointerId);
    S.pointers.set(e.pointerId, [px, py]);
    const d = S.drag;
    if (!d) return;
    if (d.kind === 'PINCH' && S.pointers.size === 2) {
      const [a, b] = [...S.pointers.values()];
      S.cam.dist = Math.max(0.3, Math.min(60, (d.dist0 * d.d0) / Math.hypot(a[0] - b[0], a[1] - b[1])));
      const mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
      S.cam.pan(mid[0] - d.mid[0], mid[1] - d.mid[1]);
      d.mid = mid;
    } else if (d.kind === 'ROT') S.cam.rotate(px - prev[0], py - prev[1]);
    else if (d.kind === 'PAN') S.cam.pan(px - prev[0], py - prev[1]);
    else if ((d.kind === 'GOAL' || d.kind === 'POSE') && w) {
      const far = Math.hypot(w[0] - d.sx, w[1] - d.sy) > 0.15;
      d.preview = { x: d.sx, y: d.sy, yaw: far ? Math.atan2(w[1] - d.sy, w[0] - d.sx) : 0 };
    }
  };
  const onUp = (e) => {
    const S = eng.current;
    if (!S) return;
    S.pointers.delete(e.pointerId);
    const d = S.drag;
    if (d && (d.kind === 'GOAL' || d.kind === 'POSE')) {
      const { x, y, yaw } = d.preview;
      (d.kind === 'GOAL' ? onGoal : onInitialPose)?.(x, y, yaw);
      setTool('ORBIT');
    }
    if (!S.pointers.size) S.drag = null;
  };
  useEffect(() => {
    const el = canvasRef.current;
    const wheel = (e) => {
      e.preventDefault();
      eng.current?.cam.zoom(e.deltaY < 0 ? 0.88 : 1.14);
      if (props.current.mode === 'FOLLOW') setMode('ORBIT');
    };
    el.addEventListener('wheel', wheel, { passive: false });
    const ctx = (e) => e.preventDefault();
    el.addEventListener('contextmenu', ctx);
    return () => {
      el.removeEventListener('wheel', wheel);
      el.removeEventListener('contextmenu', ctx);
    };
  }, []);

  const cams = [
    { id: 'ORBIT', icon: LuRotate3D, tip: 'Free orbit (drag rotate · right-drag pan · wheel zoom)' },
    { id: 'FOLLOW', icon: LuCar, tip: 'Chase camera' },
    { id: 'TOP', icon: LuSquareDashed, tip: 'Top view' },
  ];
  const hint = { GOAL: 'Click & drag on the floor: goal + heading', POSE: 'Click & drag where NOVA really is' }[tool];

  return (
    <div ref={wrapRef} className={`mapwrap twin ${full ? 'fullscreen' : ''}`}>
      <canvas
        ref={canvasRef}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
        onPointerLeave={() => setCursor(null)}
        style={{ cursor: tool === 'ORBIT' ? 'grab' : 'crosshair' }}
      />
      <div ref={labelsRef} className="twin-labels" />
      {err && <div className="map-empty">3D view unavailable: {err}</div>}
      {!map && !err && <div className="map-empty"><div><LuScan size={28} /><br />Waiting for /map…</div></div>}
      {hint && <div className="map-hint">{hint}</div>}

      <div className="map-toolbar">
        <div className="map-toolgroup">
          {cams.map((c) => (
            <button key={c.id} className={`map-tool ${mode === c.id && tool === 'ORBIT' ? 'active' : ''}`} title={c.tip} onClick={() => { setTool('ORBIT'); setMode(c.id); }}>
              <c.icon size={17} />
            </button>
          ))}
        </div>
        {(onGoal || onInitialPose) && (
          <div className="map-toolgroup">
            {onGoal && <button className={`map-tool goal ${tool === 'GOAL' ? 'active' : ''}`} title="Nav goal" onClick={() => setTool(tool === 'GOAL' ? 'ORBIT' : 'GOAL')}><LuNavigation size={17} /></button>}
            {onInitialPose && <button className={`map-tool pose ${tool === 'POSE' ? 'active' : ''}`} title="Pose estimate" onClick={() => setTool(tool === 'POSE' ? 'ORBIT' : 'POSE')}><LuCrosshair size={17} /></button>}
          </div>
        )}
        <div className="map-toolgroup">
          <button className="map-tool" title="Zoom in" onClick={() => eng.current?.cam.zoom(0.8)}><LuZoomIn size={17} /></button>
          <button className="map-tool" title="Zoom out" onClick={() => eng.current?.cam.zoom(1.25)}><LuZoomOut size={17} /></button>
          <button className="map-tool" title="Fullscreen" onClick={() => setFull((f) => !f)}>{full ? <LuMinimize size={17} /> : <LuMaximize size={17} />}</button>
        </div>
      </div>

      <div className="map-layers">
        {[['lidar', 'LiDAR'], ['rays', 'Rays'], ['trail', 'Trail'], ['beams', 'Beacons']].map(([k, l]) => (
          <button key={k} className={`layer ${layers[k] ? 'on' : ''}`} onClick={() => setLayers((s) => ({ ...s, [k]: !s[k] }))}>{l}</button>
        ))}
        <button className={`layer ${big ? 'on' : ''}`} onClick={() => setBig((b) => !b)} title="Draw NOVA 3× larger so it's visible from far away">NOVA ×3</button>
      </div>

      <div className="map-foot">
        <div className="map-chip">
          <span>{title.toUpperCase()}</span>
          <span>{cursor ? `x ${cursor[0].toFixed(2)}  y ${cursor[1].toFixed(2)}` : 'x —  y —'}</span>
          <span>{mode}</span>
        </div>
      </div>
    </div>
  );
}
