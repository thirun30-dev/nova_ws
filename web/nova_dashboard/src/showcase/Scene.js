// Showcase 3D scene: NOVA on a holographic turntable. Scroll-driven camera, explode and lidar demo.
import { Engine, Geo, OrbitCam, m4 } from '../gl/engine.js';
import { buildNova, drawNova, Z } from '../gl/novaModel.js';

// Per-section look: camera + model state the scene eases toward.
export const SHOTS = {
  hero: { dist: 0.78, pitch: 0.34, offset: 0.2, explode: 0, lidar: 0, spinSpeed: 0.0025, z: 0.11 },
  hardware: { dist: 0.95, pitch: 0.42, offset: -0.24, explode: 1, lidar: 0, spinSpeed: 0.0012, z: 0.19 },
  perception: { dist: 2.3, pitch: 0.72, offset: 0.0, forward: -0.32, explode: 0, lidar: 1, spinSpeed: 0.0008, z: 0.1 },
  architecture: { dist: 1.15, pitch: 0.3, offset: 0.32, explode: 0.35, lidar: 0, spinSpeed: 0.002, z: 0.12 },
  research: { dist: 1.5, pitch: 0.55, offset: -0.4, explode: 0, lidar: 0.4, spinSpeed: 0.002, z: 0.1 },
  features: { dist: 2.4, pitch: 0.6, offset: 0, forward: -0.25, explode: 0, lidar: 0, spinSpeed: 0.003, z: 0.1, dim: 0.45 },
  demo: { dist: 0.85, pitch: 0.28, offset: 0, explode: 0, lidar: 0.6, spinSpeed: 0.004, z: 0.11 },
};

function roomRange(a) {
  // a fake room around the robot for the lidar demo (metres)
  const walls = 0.95 + 0.12 * Math.sin(3 * a + 0.6) + 0.06 * Math.sin(7 * a);
  const box1 = Math.abs(Math.atan2(Math.sin(a - 0.7), Math.cos(a - 0.7))) < 0.28 ? 0.55 : 9;
  const box2 = Math.abs(Math.atan2(Math.sin(a + 2.2), Math.cos(a + 2.2))) < 0.2 ? 0.42 : 9;
  return Math.min(walls, box1, box2);
}

export function createScene(canvas, state) {
  const E = new Engine(canvas, { clear: [0, 0, 0, 0], fog: [2.2, 7], fogColor: [0.016, 0.027, 0.055] });
  const nova = buildNova(E);
  const cam = new OrbitCam({ target: [0, 0, 0.11], dist: 0.8, yaw: -0.6, pitch: 0.34 });
  const platform = E.createMesh(new Geo().cyl(0, 0, -0.01, 0.3, 0.02, 'z', 64));
  const ring = E.createMesh(new Geo().ring(0, 0, 0.001, 0.97, 1.0, 96));
  const ringThick = E.createMesh(new Geo().ring(0, 0, 0.001, 0.9, 1.0, 96));
  const ticks = [];
  const tickCol = [];
  for (let i = 0; i < 72; i++) {
    const a = (i / 72) * Math.PI * 2;
    const r0 = i % 6 === 0 ? 0.33 : 0.345;
    ticks.push(Math.cos(a) * r0, Math.sin(a) * r0, 0.002, Math.cos(a) * 0.36, Math.sin(a) * 0.36, 0.002);
    tickCol.push(0.13, 0.83, 0.93, 0.7, 0.13, 0.83, 0.93, 0.7);
  }
  // dust particles
  const dust = [];
  const dustCol = [];
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 380; i++) {
    const r = 0.4 + rnd() * 2.6;
    const a = rnd() * Math.PI * 2;
    dust.push(Math.cos(a) * r, Math.sin(a) * r, rnd() * 1.4 - 0.1);
    const c = rnd() < 0.8 ? [0.13, 0.83, 0.93] : [0.65, 0.55, 0.98];
    dustCol.push(...c, 0.25 + rnd() * 0.5);
  }

  const cur = { ...SHOTS.hero, highlight: null };
  let spin = 0;
  let lidarSpin = 0;
  let raf;
  let last = performance.now();

  const frame = () => {
    raf = requestAnimationFrame(frame);
    const now = performance.now();
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    const shot = SHOTS[state.section] || SHOTS.hero;
    const k = 1 - Math.exp(-dt * 3.2);
    for (const key of ['dist', 'pitch', 'offset', 'explode', 'lidar', 'spinSpeed', 'z', 'forward']) cur[key] = (cur[key] ?? 0) + ((shot[key] ?? 0) - (cur[key] ?? 0)) * k;
    cur.dim = (cur.dim ?? 1) + ((shot.dim ?? 1) - (cur.dim ?? 1)) * k;

    if (!state.dragging) cam.yaw += cur.spinSpeed * 60 * dt;
    if (state.dragDelta) {
      cam.yaw -= state.dragDelta[0] * 0.008;
      cam.pitch = Math.max(0.05, Math.min(1.45, cam.pitch + state.dragDelta[1] * 0.005));
      state.dragDelta = null;
      state.userPitch = cam.pitch;
    }
    cam.dist = cur.dist * (state.mobile ? 1.35 : 1);
    if (!state.dragging) cam.pitch += (cur.pitch - cam.pitch) * k * 0.6;
    const right = [-Math.sin(cam.yaw), Math.cos(cam.yaw)];
    const off = state.mobile ? 0 : cur.offset * cur.dist;
    const fwd = [-Math.cos(cam.yaw), -Math.sin(cam.yaw)];
    const lift = cur.forward * cur.dist; // negative: pull target toward camera -> robot sits higher on screen
    cam.target = [-right[0] * off + fwd[0] * lift, -right[1] * off + fwd[1] * lift, cur.z];

    spin += dt * 9;
    lidarSpin += dt * 6.5;
    E.begin(cam.eye(), cam.target, 0.75);

    // dust
    const t = now / 1000;
    const dp = new Float32Array(dust.length);
    for (let i = 0; i < dust.length; i += 3) {
      dp[i] = dust[i];
      dp[i + 1] = dust[i + 1];
      dp[i + 2] = dust[i + 2] + Math.sin(t * 0.4 + i) * 0.03;
    }
    E.drawLines(dp, dustCol, 'points', { size: 2.2 });

    // platform
    const glow = 0.55 + 0.15 * Math.sin(t * 1.6);
    E.drawMesh(platform, m4.ident(), [0.03, 0.06, 0.11, 1], 0.1);
    E.drawMesh(ringThick, m4.trs(0, 0, 0.001, 0, 0.3), [0.13, 0.83, 0.93, 0.45 * glow], 1.0, { additive: true });
    E.drawMesh(ring, m4.trs(0, 0, 0.0005, t * 0.2, 0.52), [0.13, 0.83, 0.93, 0.35], 1, { additive: true });
    E.drawMesh(ring, m4.trs(0, 0, 0.0005, -t * 0.15, 0.85), [0.65, 0.55, 0.98, 0.22], 1, { additive: true });
    E.drawLines(ticks, tickCol, 'lines');
    // floor grid (radial fade)
    const gp = [];
    const gc = [];
    for (let i = -12; i <= 12; i++) {
      const v = i * 0.2;
      const a = 0.09 * (1 - Math.abs(i) / 13);
      gp.push(v, -2.4, -0.02, v, 2.4, -0.02, -2.4, v, -0.02, 2.4, v, -0.02);
      gc.push(0.13, 0.83, 0.93, 0, 0.13, 0.83, 0.93, a, 0.13, 0.83, 0.93, 0, 0.13, 0.83, 0.93, a);
    }
    E.drawLines(gp, gc, 'lines');

    // NOVA
    drawNova(E, nova, m4.ident(), { explode: cur.explode, spin, highlight: state.highlight, glow: cur.dim });

    // lidar demo
    if (cur.lidar > 0.02) {
      const n = 240;
      const pts = [];
      const pc = [];
      const rays = [];
      const rc = [];
      const z = Z.scan + cur.explode * 3 * 0.075;
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2;
        let age = (lidarSpin - a) % (Math.PI * 2);
        if (age < 0) age += Math.PI * 2;
        const fade = Math.max(0, 1 - age / (Math.PI * 1.7)) * cur.lidar;
        if (fade <= 0.01) continue;
        const r = roomRange(a);
        pts.push(r * Math.cos(a), r * Math.sin(a), z);
        pc.push(0.98, 0.35, 0.5, fade);
        if (age < 0.9) {
          rays.push(0, 0, z, r * Math.cos(a), r * Math.sin(a), z);
          rc.push(0.98, 0.35, 0.5, 0.15, 0.98, 0.35, 0.5, 0.8 * fade);
        }
      }
      E.drawLines(rays, rc, 'lines');
      E.drawLines(pts, pc, 'points', { size: 6.5 });
    }

    // callout anchors for HTML labels
    if (state.onProject) {
      const anchors = [0, 1, 2, 3].map((l) => {
        const zz = [0.06, 0.15, 0.2, 0.24][l] + cur.explode * l * 0.075;
        return E.project([0.12, 0.0, zz]);
      });
      state.onProject(anchors, cur.explode);
    }
  };
  frame();
  return () => cancelAnimationFrame(raf);
}
