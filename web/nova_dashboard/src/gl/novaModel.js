// NOVA 3D model, built from the same dimensions as nova_description/urdf/properties.xacro.
// Origin = base_footprint (floor, centre of the wheel axle), x forward, z up, metres.
// Parts are grouped in 4 layers so the showcase can "explode" the robot.
import { Geo, HEX, m4 } from './engine.js';

export const DIM = {
  hexL: 0.235, hexW: 0.215, wheelR: 0.0325, wheelW: 0.026, wheelSep: 0.245,
  clearance: 0.02, enclosureH: 0.06, plate: 0.003, standLow: 0.05, standHigh: 0.06, casterX: -0.085,
};
const D = DIM;
export const Z = {
  encBottom: D.clearance,
  encTop: D.clearance + D.enclosureH,
  mid: D.clearance + D.enclosureH + D.standLow,
  top: D.clearance + D.enclosureH + D.standLow + D.plate + D.standHigh,
};
Z.lidarBase = Z.top + D.plate;
Z.scan = Z.lidarBase + 0.03;

export const LAYERS = [
  { id: 0, name: 'Drive base', desc: 'Hexagon enclosure · 2× N25 6 V 550 RPM encoder motors · ball caster · 2S Li-ion pack + 5 A fuse · NOVA-LLC board (Arduino Nano + TB6612FNG + MPU9250)' },
  { id: 1, name: 'Compute deck', desc: 'Raspberry Pi 5 (4 GB) running ROS 2 Jazzy, Nav2, SLAM Toolbox and the mission manager · power bank' },
  { id: 2, name: 'Sensor deck', desc: 'Top plate on 6 cm standoffs — keeps the lidar plane clear of the robot body' },
  { id: 3, name: 'Perception', desc: 'RPLidar A1M8 · 360° · 0.15–12 m · drives SLAM, AMCL localisation and obstacle avoidance' },
];

const C = {
  shell: [0.09, 0.13, 0.2, 0.55],
  shellEdge: [0.13, 0.83, 0.93, 1],
  base: [0.08, 0.1, 0.14, 1],
  tyre: [0.05, 0.055, 0.065, 1],
  hub: [0.13, 0.83, 0.93, 1],
  motor: [0.82, 0.62, 0.28, 1],
  metal: [0.62, 0.66, 0.72, 1],
  pcb: [0.06, 0.42, 0.24, 1],
  nano: [0.1, 0.32, 0.72, 1],
  driver: [0.72, 0.12, 0.14, 1],
  battery: [0.15, 0.38, 0.85, 1],
  acrylic: [0.25, 0.75, 0.95, 0.28],
  pi: [0.1, 0.5, 0.25, 1],
  cooler: [0.2, 0.22, 0.26, 1],
  bank: [0.86, 0.88, 0.92, 1],
  lidar: [0.07, 0.08, 0.1, 1],
  ring: [0.98, 0.25, 0.35, 1],
};

function hexEdges(z0, z1) {
  const h = HEX(D.hexL, D.hexW);
  const out = [];
  for (let i = 0; i < 6; i++) {
    const a = h[i];
    const b = h[(i + 1) % 6];
    out.push([a[0], a[1], z0], [b[0], b[1], z0], [a[0], a[1], z1], [b[0], b[1], z1], [a[0], a[1], z0], [a[0], a[1], z1]);
  }
  return out;
}

/** Returns parts: { name, layer, mesh, color, emissive, spin?, edges? } */
export function buildNova(engine) {
  const parts = [];
  const add = (name, layer, geo, color, emissive = 0, extra = {}) =>
    parts.push({ name, layer, mesh: engine.createMesh(geo), color, emissive, ...extra });
  const hex = HEX(D.hexL, D.hexW);
  const ax = D.wheelR;

  // ---------------- layer 0: drive base
  add('Base plate', 0, new Geo().prism(hex, Z.encBottom, Z.encBottom + 0.003), C.base);
  add('Enclosure', 0, new Geo().prism(hex, Z.encBottom + 0.003, Z.encTop, (v) => v, false), C.shell, 0.05, { edges: hexEdges(Z.encBottom, Z.encTop) });
  for (const s of [1, -1]) {
    add('Wheel', 0, new Geo().cyl(0, s * D.wheelSep / 2, ax, D.wheelR, D.wheelW, 'y', 28), C.tyre);
    add('Hub', 0, new Geo().cyl(0, s * (D.wheelSep / 2 + 0.0135), ax, 0.016, 0.002, 'y', 20), C.hub, 0.9);
    add('N25 motor', 0, new Geo().cyl(0, s * 0.072, ax, 0.0125, 0.05, 'y').box(0, s * 0.102, ax, 0.024, 0.012, 0.022), C.motor, 0.05);
  }
  add('Ball caster', 0, new Geo().cyl(D.casterX, 0, 0.0125, 0.0125, 0.025, 'z', 16), C.metal);
  add('2S battery', 0, new Geo().cyl(-0.05, 0.011, 0.036, 0.009, 0.065, 'x', 16).cyl(-0.05, -0.011, 0.036, 0.009, 0.065, 'x', 16), C.battery, 0.08);
  add('NOVA-LLC board', 0, new Geo().box(0.04, 0, 0.03, 0.1, 0.08, 0.002), C.pcb, 0.05);
  add('Arduino Nano', 0, new Geo().box(0.03, 0.02, 0.036, 0.043, 0.018, 0.008), C.nano, 0.1);
  add('TB6612FNG', 0, new Geo().box(0.065, -0.02, 0.034, 0.02, 0.02, 0.005), C.driver, 0.1);

  // ---------------- layer 1: compute deck
  const standoffs = (z0, z1) => {
    const g = new Geo();
    for (const [x, y] of [[0.06, 0.075], [0.06, -0.075], [-0.06, 0.075], [-0.06, -0.075]]) g.cyl(x, y, (z0 + z1) / 2, 0.003, z1 - z0, 'z', 10);
    return g;
  };
  add('Standoffs 5 cm', 1, standoffs(Z.encTop, Z.mid), C.metal);
  add('Middle plate', 1, new Geo().prism(hex, Z.mid, Z.mid + D.plate), C.acrylic, 0.15, { edges: hexEdges(Z.mid, Z.mid + D.plate) });
  add('Raspberry Pi 5', 1, new Geo().box(0.035, 0, Z.mid + D.plate + 0.004, 0.085, 0.056, 0.002), C.pi, 0.08);
  add('Active cooler', 1, new Geo().box(0.03, 0, Z.mid + D.plate + 0.011, 0.045, 0.04, 0.01), C.cooler);
  add('Fan', 1, new Geo().ring(0.03, 0, Z.mid + D.plate + 0.0165, 0.004, 0.016, 24), C.hub, 0.6);
  add('Power bank', 1, new Geo().box(-0.055, 0, Z.mid + D.plate + 0.009, 0.068, 0.14, 0.016), C.bank);

  // ---------------- layer 2: sensor deck
  add('Standoffs 6 cm', 2, standoffs(Z.mid + D.plate, Z.top), C.metal);
  add('Top plate', 2, new Geo().prism(hex, Z.top, Z.top + D.plate), C.acrylic, 0.15, { edges: hexEdges(Z.top, Z.top + D.plate) });

  // ---------------- layer 3: lidar
  add('RPLidar base', 3, new Geo().box(0, 0, Z.lidarBase + 0.01, 0.097, 0.07, 0.02), C.lidar);
  add('RPLidar puck', 3, new Geo().cyl(0, 0, Z.lidarBase + 0.032, 0.035, 0.024, 'z', 32), C.lidar, 0, { spin: true });
  add('Lidar window', 3, new Geo().cyl(0, 0, Z.lidarBase + 0.031, 0.0355, 0.008, 'z', 32).box(0.03, 0, Z.lidarBase + 0.031, 0.012, 0.02, 0.006), C.ring, 0.9, { spin: true });

  return parts;
}

/**
 * Draw NOVA. base = world matrix of base_footprint. opts: explode (0..1), spin (rad),
 * highlight (layer id or null), glowEdges (bool).
 */
export function drawNova(engine, parts, base, { explode = 0, spin = 0, highlight = null, glow = 1 } = {}) {
  const edgePos = [];
  const edgeCol = [];
  const order = [...parts].sort((a, b) => (a.color[3] < 1) - (b.color[3] < 1)); // opaque first
  for (const p of order) {
    const lift = explode * p.layer * 0.075;
    let local = m4.trs(0, 0, lift);
    if (p.spin) local = m4.mul(local, m4.trs(0, 0, 0, spin));
    const model = m4.mul(base, local);
    const hl = highlight !== null && highlight === p.layer;
    const dim = highlight !== null && !hl;
    const color = dim ? [p.color[0] * 0.45, p.color[1] * 0.45, p.color[2] * 0.5, p.color[3]] : p.color;
    engine.drawMesh(p.mesh, model, color, p.emissive * glow + (hl ? 0.35 : 0));
    if (p.edges) {
      for (const v of p.edges) {
        const w = m4.apply(model, v);
        edgePos.push(w[0], w[1], w[2]);
        const a = hl ? 1 : dim ? 0.25 : 0.75;
        edgeCol.push(0.13, 0.83, 0.93, a * glow);
      }
    }
  }
  if (edgePos.length) engine.drawLines(edgePos, edgeCol, 'lines');
}
