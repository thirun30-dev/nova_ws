// Same layout as nova_ws/tools/gen_warehouse.py (Gazebo world + Nav2 map), used by the demo.
export const HALF_X = 6.0;
export const HALF_Y = 4.0;
export const WALL_T = 0.2;
export const RES = 0.05;
const MARGIN = 0.5;

export const BOXES = [
  // cx, cy, sx, sy
  [-2.0, 1.5, 3.0, 0.6],
  [-2.0, -1.5, 3.0, 0.6],
  [2.5, 1.5, 3.0, 0.6],
  [2.5, -1.5, 3.0, 0.6],
  [-4.5, 3.0, 0.8, 0.8],
  [-4.5, -3.0, 0.8, 0.8],
];
export const PILLARS = [
  [0.25, 2.8, 0.15],
  [0.25, -2.8, 0.15],
];

export const STATIONS = [
  { name: 'home', x: -5.0, y: 0.0, yaw: 0, type: 'home' },
  { name: 'pick_a', x: -2.0, y: 0.6, yaw: 0, type: 'pickup' },
  { name: 'pick_b', x: -2.0, y: -0.6, yaw: 0, type: 'pickup' },
  { name: 'pick_c', x: 2.5, y: 2.6, yaw: 0, type: 'pickup' },
  { name: 'pick_d', x: 2.5, y: -2.6, yaw: 0, type: 'pickup' },
  { name: 'drop_1', x: 5.0, y: 2.0, yaw: 0, type: 'dropoff' },
  { name: 'drop_2', x: 5.0, y: -2.0, yaw: 0, type: 'dropoff' },
];

function walls() {
  const lx = 2 * HALF_X + 2 * WALL_T;
  const ly = 2 * HALF_Y + 2 * WALL_T;
  return [
    [0, HALF_Y + WALL_T / 2, lx, WALL_T],
    [0, -HALF_Y - WALL_T / 2, lx, WALL_T],
    [HALF_X + WALL_T / 2, 0, WALL_T, ly],
    [-HALF_X - WALL_T / 2, 0, WALL_T, ly],
  ];
}

/** OccupancyGrid-style truth map: -1 unknown, 0 free, 100 occupied. Row 0 = bottom. */
export function buildGrid() {
  const ox = -HALF_X - MARGIN;
  const oy = -HALF_Y - MARGIN;
  const width = Math.round((2 * HALF_X + 2 * MARGIN) / RES);
  const height = Math.round((2 * HALF_Y + 2 * MARGIN) / RES);
  const data = new Int8Array(width * height);
  const rects = [...walls(), ...BOXES];
  for (let j = 0; j < height; j++) {
    for (let i = 0; i < width; i++) {
      const x = ox + (i + 0.5) * RES;
      const y = oy + (j + 0.5) * RES;
      let v = Math.abs(x) <= HALF_X && Math.abs(y) <= HALF_Y ? 0 : -1;
      for (const [cx, cy, sx, sy] of rects) {
        if (Math.abs(x - cx) <= sx / 2 && Math.abs(y - cy) <= sy / 2) {
          v = 100;
          break;
        }
      }
      if (v !== 100) {
        for (const [px, py, r] of PILLARS) {
          if (Math.hypot(x - px, y - py) <= r) {
            v = 100;
            break;
          }
        }
      }
      data[j * width + i] = v;
    }
  }
  return { width, height, resolution: RES, ox, oy, data };
}

/** Distance (m) from each cell to the nearest occupied cell, via multi-source BFS (8-neighbour). */
export function distanceField(g) {
  const { width: w, height: h, data } = g;
  const dist = new Float32Array(w * h).fill(Infinity);
  const queue = []; // SPFA-style relaxation; cells can be re-queued when improved
  let head = 0;
  for (let k = 0; k < w * h; k++) {
    if (data[k] === 100) {
      dist[k] = 0;
      queue.push(k);
    }
  }
  const nb = [
    [1, 0, 1],
    [-1, 0, 1],
    [0, 1, 1],
    [0, -1, 1],
    [1, 1, Math.SQRT2],
    [1, -1, Math.SQRT2],
    [-1, 1, Math.SQRT2],
    [-1, -1, Math.SQRT2],
  ];
  while (head < queue.length) {
    const k = queue[head++];
    const i = k % w;
    const j = (k / w) | 0;
    for (const [di, dj, c] of nb) {
      const ni = i + di;
      const nj = j + dj;
      if (ni < 0 || nj < 0 || ni >= w || nj >= h) continue;
      const nk = nj * w + ni;
      const nd = dist[k] + c * g.resolution;
      if (nd < dist[nk] - 1e-6) {
        dist[nk] = nd;
        queue.push(nk);
      }
    }
  }
  return dist;
}

/** Nav2-like costmap from the distance field (lethal inside robot radius, decaying inflation). */
export function costmapFrom(g, dist, robotRadius = 0.16, inflation = 0.45) {
  const data = new Int8Array(g.width * g.height);
  for (let k = 0; k < data.length; k++) {
    if (g.data[k] === -1) data[k] = -1;
    else if (dist[k] <= robotRadius) data[k] = 100;
    else if (dist[k] <= inflation) data[k] = Math.round(98 * Math.exp(-3.0 * (dist[k] - robotRadius)));
    else data[k] = 0;
  }
  return { ...g, data };
}
