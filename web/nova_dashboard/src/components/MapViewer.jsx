// Canvas map: occupancy grid, costmap, lidar, plan, trail, stations, goal and the NOVA footprint.
// Tools: pan, nav goal (drag for heading), pose estimate, drop pin. Wheel/pinch zoom.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  LuHand, LuNavigation, LuCrosshair, LuMapPinPlus, LuZoomIn, LuZoomOut, LuMaximize, LuMinimize,
  LuFocus, LuScan, LuLocateFixed,
} from 'react-icons/lu';
import { locType } from './ui.jsx';

// NOVA footprint (metres) — matches nova_description/urdf/properties.xacro
const HEX_L = 0.235;
const HEX_W = 0.215;
const WHEEL_SEP = 0.245;
const WHEEL_R = 0.0325;
const WHEEL_W = 0.026;
const MIN_SCALE = 8;
const MAX_SCALE = 320;

function gridToCanvas(g, kind) {
  const c = document.createElement('canvas');
  c.width = g.width;
  c.height = g.height;
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(g.width, g.height);
  const px = img.data;
  for (let j = 0; j < g.height; j++) {
    const row = g.height - 1 - j; // flip: OccupancyGrid row 0 is the bottom
    for (let i = 0; i < g.width; i++) {
      const v = g.data[j * g.width + i];
      const o = (row * g.width + i) * 4;
      if (kind === 'map') {
        if (v < 0) { px[o] = 6; px[o + 1] = 11; px[o + 2] = 22; px[o + 3] = 255; }
        else if (v >= 65) { px[o] = 28; px[o + 1] = 96; px[o + 2] = 132; px[o + 3] = 255; }
        else { px[o] = 14 + v * 0.4; px[o + 1] = 24 + v * 0.4; px[o + 2] = 44 + v * 0.5; px[o + 3] = 255; }
      } else {
        if (v <= 0) { px[o + 3] = 0; continue; }
        if (v >= 99) { px[o] = 167; px[o + 1] = 139; px[o + 2] = 250; px[o + 3] = 70; }
        else { px[o] = 34; px[o + 1] = 211; px[o + 2] = 238; px[o + 3] = Math.round(6 + v * 0.5); }
      }
    }
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

export default function MapViewer({
  map, costmap, scan, pose, plan, locations = [], goal, navState,
  onGoal, onInitialPose, onPin, compact = false, title = 'Live map',
}) {
  const wrapRef = useRef(null);
  const canvasRef = useRef(null);
  const cam = useRef({ x: 0, y: 0, scale: 45 });
  const fitted = useRef(false);
  const mapCache = useRef({ src: null, canvas: null });
  const costCache = useRef({ src: null, canvas: null });
  const trail = useRef([]);
  const drag = useRef(null);
  const pointers = useRef(new Map());
  const props = useRef({});
  const [tool, setTool] = useState('PAN');
  const [layers, setLayers] = useState({ lidar: true, costmap: !compact, trail: true, grid: false, labels: true });
  const [follow, setFollow] = useState(false);
  const [full, setFull] = useState(false);
  const [cursor, setCursor] = useState(null);
  const [zoom, setZoom] = useState(45);

  props.current = { map, costmap, scan, pose, plan, locations, goal, navState, tool, layers, follow };

  // trail of robot positions
  useEffect(() => {
    if (!pose) return;
    const t = trail.current;
    const last = t[t.length - 1];
    if (!last || Math.hypot(last[0] - pose.x, last[1] - pose.y) > 0.08) {
      t.push([pose.x, pose.y]);
      if (t.length > 220) t.shift();
    }
  }, [pose]);

  const fit = useCallback(() => {
    const m = props.current.map;
    const el = wrapRef.current;
    if (!m || !el) return;
    const wM = m.width * m.resolution;
    const hM = m.height * m.resolution;
    cam.current.x = m.ox + wM / 2;
    cam.current.y = m.oy + hM / 2;
    cam.current.scale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, 0.92 * Math.min(el.clientWidth / wM, el.clientHeight / hM)));
    setZoom(cam.current.scale);
  }, []);

  useEffect(() => {
    if (map && !fitted.current) {
      fitted.current = true;
      fit();
    }
  }, [map, fit]);

  const toWorld = (px, py) => {
    const el = canvasRef.current;
    const c = cam.current;
    return [c.x + (px - el.clientWidth / 2) / c.scale, c.y - (py - el.clientHeight / 2) / c.scale];
  };

  // ---------------------------------------------------------------- render loop
  useEffect(() => {
    let raf;
    const draw = () => {
      raf = requestAnimationFrame(draw);
      const canvas = canvasRef.current;
      if (!canvas) return;
      const dpr = window.devicePixelRatio || 1;
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
        canvas.width = Math.round(w * dpr);
        canvas.height = Math.round(h * dpr);
      }
      const P = props.current;
      const c = cam.current;
      if (P.follow && P.pose) {
        c.x += (P.pose.x - c.x) * 0.15;
        c.y += (P.pose.y - c.y) * 0.15;
      }
      const ctx = canvas.getContext('2d');
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = '#03060d';
      ctx.fillRect(0, 0, w, h);
      const X = (mx) => w / 2 + (mx - c.x) * c.scale;
      const Y = (my) => h / 2 - (my - c.y) * c.scale;

      // grid
      if (P.layers.grid) {
        const step = c.scale > 60 ? 0.5 : c.scale > 20 ? 1 : 5;
        const [x0, y1] = [c.x - w / 2 / c.scale, c.y + h / 2 / c.scale];
        const [x1, y0] = [c.x + w / 2 / c.scale, c.y - h / 2 / c.scale];
        ctx.strokeStyle = 'rgba(34,211,238,0.08)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        for (let gx = Math.floor(x0 / step) * step; gx <= x1; gx += step) { ctx.moveTo(X(gx), 0); ctx.lineTo(X(gx), h); }
        for (let gy = Math.floor(y0 / step) * step; gy <= y1; gy += step) { ctx.moveTo(0, Y(gy)); ctx.lineTo(w, Y(gy)); }
        ctx.stroke();
      }

      // occupancy map
      if (P.map) {
        if (mapCache.current.src !== P.map) mapCache.current = { src: P.map, canvas: gridToCanvas(P.map, 'map') };
        const m = P.map;
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(mapCache.current.canvas, X(m.ox), Y(m.oy + m.height * m.resolution), m.width * m.resolution * c.scale, m.height * m.resolution * c.scale);
        ctx.strokeStyle = 'rgba(34,211,238,0.35)';
        ctx.strokeRect(X(m.ox), Y(m.oy + m.height * m.resolution), m.width * m.resolution * c.scale, m.height * m.resolution * c.scale);
      }
      if (P.layers.costmap && P.costmap) {
        if (costCache.current.src !== P.costmap) costCache.current = { src: P.costmap, canvas: gridToCanvas(P.costmap, 'cost') };
        const m = P.costmap;
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(costCache.current.canvas, X(m.ox), Y(m.oy + m.height * m.resolution), m.width * m.resolution * c.scale, m.height * m.resolution * c.scale);
      }
      if (P.layers.grid) {
        ctx.strokeStyle = 'rgba(34,211,238,0.9)';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(X(0) - 8, Y(0)); ctx.lineTo(X(0) + 8, Y(0));
        ctx.moveTo(X(0), Y(0) - 8); ctx.lineTo(X(0), Y(0) + 8);
        ctx.stroke();
      }

      // trail
      if (P.layers.trail && trail.current.length > 1) {
        ctx.strokeStyle = 'rgba(167,139,250,0.8)';
        ctx.lineWidth = 2;
        ctx.setLineDash([5, 5]);
        ctx.beginPath();
        trail.current.forEach(([tx, ty], i) => (i ? ctx.lineTo(X(tx), Y(ty)) : ctx.moveTo(X(tx), Y(ty))));
        ctx.stroke();
        ctx.setLineDash([]);
      }

      // lidar
      if (P.layers.lidar && P.scan && P.pose && (!P.pose.frame || P.pose.frame === 'map' || !P.map)) {
        const s = P.scan;
        ctx.fillStyle = 'rgba(251,113,133,0.95)';
        const size = Math.max(2, Math.min(4, c.scale / 25));
        for (let i = 0; i < s.ranges.length; i += 1) {
          const r = s.ranges[i];
          if (r === null || !Number.isFinite(r) || r < s.range_min || r > s.range_max) continue;
          const a = P.pose.yaw + s.angle_min + i * s.angle_increment;
          ctx.fillRect(X(P.pose.x + r * Math.cos(a)) - size / 2, Y(P.pose.y + r * Math.sin(a)) - size / 2, size, size);
        }
      }

      // global plan
      if (P.plan && P.plan.length > 1) {
        ctx.save();
        ctx.shadowColor = 'rgba(52,211,153,0.9)';
        ctx.shadowBlur = 8;
        ctx.strokeStyle = '#34d399';
        ctx.lineWidth = 3;
        ctx.lineJoin = 'round';
        ctx.beginPath();
        P.plan.forEach(([px, py], i) => (i ? ctx.lineTo(X(px), Y(py)) : ctx.moveTo(X(px), Y(py))));
        ctx.stroke();
        ctx.restore();
      }

      // stations
      for (const l of P.locations) {
        const t = locType(l.type);
        const lx = X(l.x);
        const ly = Y(l.y);
        ctx.fillStyle = t.color + '33';
        ctx.strokeStyle = t.color;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(lx, ly, 11, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(lx, ly);
        ctx.lineTo(lx + 15 * Math.cos(l.yaw || 0), ly - 15 * Math.sin(l.yaw || 0));
        ctx.stroke();
        ctx.fillStyle = t.color;
        ctx.beginPath();
        ctx.arc(lx, ly, 4, 0, Math.PI * 2);
        ctx.fill();
        if (P.layers.labels) {
          ctx.font = '600 11px "JetBrains Mono", ui-monospace, monospace';
          const tw = ctx.measureText(l.name).width;
          ctx.fillStyle = 'rgba(3,7,15,0.85)';
          roundRect(ctx, lx - tw / 2 - 6, ly + 14, tw + 12, 18, 6);
          ctx.fill();
          ctx.fillStyle = '#fff';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(l.name, lx, ly + 23);
        }
      }

      // active goal
      const g = drag.current?.preview || (P.navState === 'NAVIGATING' ? P.goal : null);
      if (g) {
        const gx = X(g.x);
        const gy = Y(g.y);
        const color = drag.current?.kind === 'POSE' ? '#34d399' : '#22d3ee';
        ctx.strokeStyle = color;
        ctx.fillStyle = color;
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.arc(gx, gy, 13, 0, Math.PI * 2);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(gx - 19, gy); ctx.lineTo(gx - 7, gy);
        ctx.moveTo(gx + 7, gy); ctx.lineTo(gx + 19, gy);
        ctx.moveTo(gx, gy - 19); ctx.lineTo(gx, gy - 7);
        ctx.moveTo(gx, gy + 7); ctx.lineTo(gx, gy + 19);
        ctx.stroke();
        const ax = gx + 30 * Math.cos(g.yaw);
        const ay = gy - 30 * Math.sin(g.yaw);
        ctx.beginPath();
        ctx.moveTo(gx, gy);
        ctx.lineTo(ax, ay);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(ax, ay);
        ctx.lineTo(ax - 9 * Math.cos(g.yaw - 0.5), ay + 9 * Math.sin(g.yaw - 0.5));
        ctx.lineTo(ax - 9 * Math.cos(g.yaw + 0.5), ay + 9 * Math.sin(g.yaw + 0.5));
        ctx.closePath();
        ctx.fill();
      }

      // NOVA robot (hexagon, drawn last). Enlarged when zoomed out so it stays visible.
      if (P.pose) {
        const k = Math.max(1, 30 / (HEX_L * c.scale));
        const s = c.scale * k;
        ctx.save();
        ctx.translate(X(P.pose.x), Y(P.pose.y));
        ctx.rotate(-P.pose.yaw);
        // headlight cone
        const cone = ctx.createRadialGradient(0, 0, 0, 0, 0, 0.9 * s);
        cone.addColorStop(0, 'rgba(34,211,238,0.35)');
        cone.addColorStop(1, 'rgba(34,211,238,0)');
        ctx.fillStyle = cone;
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.arc(0, 0, 0.9 * s, -0.45, 0.45);
        ctx.closePath();
        ctx.fill();
        // wheels
        ctx.fillStyle = '#000';
        for (const sy of [-1, 1]) {
          roundRect(ctx, -WHEEL_R * s, sy * (WHEEL_SEP / 2) * s - (WHEEL_W / 2) * s, 2 * WHEEL_R * s, WHEEL_W * s, 2);
          ctx.fill();
        }
        // hexagon body
        const a = (HEX_L / 2) * s;
        const b = (HEX_L / 4) * s;
        const hw = (HEX_W / 2) * s;
        const body = ctx.createLinearGradient(-a, -hw, a, hw);
        body.addColorStop(0, '#1e3a5f');
        body.addColorStop(1, '#0b1730');
        ctx.fillStyle = body;
        ctx.strokeStyle = '#22d3ee';
        ctx.shadowColor = '#22d3ee';
        ctx.shadowBlur = 10;
        ctx.lineWidth = 1.8;
        ctx.beginPath();
        ctx.moveTo(a, 0); ctx.lineTo(b, -hw); ctx.lineTo(-b, -hw); ctx.lineTo(-a, 0); ctx.lineTo(-b, hw); ctx.lineTo(b, hw);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        // top deck ring + lidar puck
        ctx.shadowBlur = 0;
        ctx.fillStyle = '#05080f';
        ctx.beginPath();
        ctx.arc(0, 0, 0.036 * s, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#fb7185';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(0, 0, 0.036 * s, 0, Math.PI * 2);
        ctx.stroke();
        // heading chevron
        ctx.fillStyle = '#22d3ee';
        ctx.beginPath();
        ctx.moveTo(a - 0.012 * s, 0);
        ctx.lineTo(a - 0.05 * s, -0.03 * s);
        ctx.lineTo(a - 0.04 * s, 0);
        ctx.lineTo(a - 0.05 * s, 0.03 * s);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
      }
    };
    draw();
    return () => cancelAnimationFrame(raf);
  }, []);

  // ---------------------------------------------------------------- interaction
  const zoomAt = (factor, px, py) => {
    const c = cam.current;
    const el = canvasRef.current;
    if (px === undefined) { px = el.clientWidth / 2; py = el.clientHeight / 2; }
    const [wx, wy] = toWorld(px, py);
    c.scale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, c.scale * factor));
    c.x = wx - (px - el.clientWidth / 2) / c.scale;
    c.y = wy + (py - el.clientHeight / 2) / c.scale;
    setZoom(c.scale);
  };

  const local = (e) => {
    const r = canvasRef.current.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  };

  const onPointerDown = (e) => {
    canvasRef.current.setPointerCapture(e.pointerId);
    const [px, py] = local(e);
    pointers.current.set(e.pointerId, [px, py]);
    if (pointers.current.size === 2) {
      const [p1, p2] = [...pointers.current.values()];
      drag.current = { kind: 'PINCH', d0: Math.hypot(p1[0] - p2[0], p1[1] - p2[1]), s0: cam.current.scale };
      return;
    }
    const [wx, wy] = toWorld(px, py);
    if (tool === 'PAN') {
      drag.current = { kind: 'PAN', px, py, cx: cam.current.x, cy: cam.current.y };
      setFollow(false);
    } else if (tool === 'GOAL' || tool === 'POSE') {
      drag.current = { kind: tool, sx: wx, sy: wy, preview: { x: wx, y: wy, yaw: 0 } };
    } else if (tool === 'PIN') {
      onPin?.(wx, wy);
      setTool('PAN');
    }
  };

  const onPointerMove = (e) => {
    const [px, py] = local(e);
    setCursor(toWorld(px, py));
    if (!pointers.current.has(e.pointerId)) return;
    pointers.current.set(e.pointerId, [px, py]);
    const d = drag.current;
    if (!d) return;
    if (d.kind === 'PINCH' && pointers.current.size === 2) {
      const [p1, p2] = [...pointers.current.values()];
      const dist = Math.hypot(p1[0] - p2[0], p1[1] - p2[1]);
      cam.current.scale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, (d.s0 * dist) / d.d0));
      setZoom(cam.current.scale);
    } else if (d.kind === 'PAN') {
      cam.current.x = d.cx - (px - d.px) / cam.current.scale;
      cam.current.y = d.cy + (py - d.py) / cam.current.scale;
    } else if (d.kind === 'GOAL' || d.kind === 'POSE') {
      const [wx, wy] = toWorld(px, py);
      const far = Math.hypot(wx - d.sx, wy - d.sy) > 0.15;
      d.preview = { x: d.sx, y: d.sy, yaw: far ? Math.atan2(wy - d.sy, wx - d.sx) : 0 };
    }
  };

  const onPointerUp = (e) => {
    pointers.current.delete(e.pointerId);
    const d = drag.current;
    if (d && (d.kind === 'GOAL' || d.kind === 'POSE')) {
      const { x, y, yaw } = d.preview;
      (d.kind === 'GOAL' ? onGoal : onInitialPose)?.(x, y, yaw);
      setTool('PAN');
    }
    drag.current = pointers.current.size ? drag.current : null;
  };

  useEffect(() => {
    const el = canvasRef.current;
    const onWheel = (e) => {
      e.preventDefault();
      const [px, py] = local(e);
      zoomAt(e.deltaY < 0 ? 1.15 : 0.87, px, py);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  useEffect(() => {
    const esc = (e) => e.key === 'Escape' && (setFull(false), setTool('PAN'));
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, []);

  const tools = [
    { id: 'PAN', icon: LuHand, tip: 'Pan', cls: '' },
    onGoal && { id: 'GOAL', icon: LuNavigation, tip: 'Nav goal (drag for heading)', cls: 'goal' },
    onInitialPose && { id: 'POSE', icon: LuCrosshair, tip: 'Pose estimate', cls: 'pose' },
    onPin && { id: 'PIN', icon: LuMapPinPlus, tip: 'Drop a location pin', cls: 'pin' },
  ].filter(Boolean);

  const hint = { GOAL: 'Click & drag to set the goal and heading', POSE: 'Click & drag where NOVA really is', PIN: 'Click to drop a location pin' }[tool];

  return (
    <div ref={wrapRef} className={`mapwrap ${full ? 'fullscreen' : ''}`} style={{ cursor: tool === 'PAN' ? 'grab' : 'crosshair' }}>
      <canvas
        ref={canvasRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onPointerLeave={() => setCursor(null)}
      />
      {!map && <div className="map-empty"><div><LuScan size={28} /><br />Waiting for /map…<br /><span className="tiny">Start MAPPING or NAVIGATION mode</span></div></div>}
      {hint && <div className="map-hint">{hint}</div>}

      <div className="map-toolbar">
        <div className="map-toolgroup">
          {tools.map((t) => (
            <button key={t.id} className={`map-tool ${t.cls} ${tool === t.id ? 'active' : ''}`} title={t.tip} onClick={() => setTool(t.id)}>
              <t.icon size={17} />
            </button>
          ))}
        </div>
        <div className="map-toolgroup">
          <button className="map-tool" title="Zoom in" onClick={() => zoomAt(1.25)}><LuZoomIn size={17} /></button>
          <button className="map-tool" title="Zoom out" onClick={() => zoomAt(0.8)}><LuZoomOut size={17} /></button>
          <button className="map-tool" title="Fit map" onClick={() => { setFollow(false); fit(); }}><LuFocus size={17} /></button>
          <button className={`map-tool ${follow ? 'active' : ''}`} title="Follow robot" onClick={() => setFollow((f) => !f)}><LuLocateFixed size={17} /></button>
          <button className="map-tool" title="Fullscreen" onClick={() => setFull((f) => !f)}>{full ? <LuMinimize size={17} /> : <LuMaximize size={17} />}</button>
        </div>
      </div>

      <div className="map-layers">
        {[['lidar', 'LiDAR'], ['costmap', 'Costmap'], ['trail', 'Trail'], ['labels', 'Labels'], ['grid', 'Grid']].map(([k, label]) => (
          <button key={k} className={`layer ${layers[k] ? 'on' : ''}`} onClick={() => setLayers((l) => ({ ...l, [k]: !l[k] }))}>{label}</button>
        ))}
      </div>

      <div className="map-foot">
        <div className="map-chip">
          <span>{title.toUpperCase()}</span>
          <span>{cursor ? `x ${cursor[0].toFixed(2)}  y ${cursor[1].toFixed(2)}` : 'x —  y —'}</span>
          <span>{zoom.toFixed(0)} px/m</span>
        </div>
        {!compact && (
          <div className="map-legend hide-sm">
            <span><i style={{ background: '#22d3ee', color: '#22d3ee' }} />NOVA</span>
            <span><i style={{ background: '#fb7185', color: '#fb7185' }} />LiDAR</span>
            <span><i style={{ background: '#34d399', color: '#34d399' }} />Nav2 plan</span>
            <span><i style={{ background: '#a78bfa', color: '#a78bfa' }} />Trail</span>
          </div>
        )}
      </div>
    </div>
  );
}
