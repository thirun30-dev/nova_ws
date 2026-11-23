// Demo data source: a small in-browser NOVA simulator (warehouse map, A* planner,
// pure-pursuit follower, ray-cast lidar, SLAM-style map reveal, mission scheduler).
// Lets the dashboard run with no robot — same interface as realSource.js.
import { buildGrid, costmapFrom, distanceField, STATIONS } from './warehouse.js';
import { clamp, wrap } from '../lib/geom.js';

const DT = 0.05;
const ROBOT_RADIUS = 0.14;

class MinHeap {
  constructor() {
    this.a = [];
  }
  push(item, pri) {
    const a = this.a;
    a.push([pri, item]);
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (a[p][0] <= a[i][0]) break;
      [a[p], a[i]] = [a[i], a[p]];
      i = p;
    }
  }
  pop() {
    const a = this.a;
    const top = a[0];
    const last = a.pop();
    if (a.length) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < a.length && a[l][0] < a[m][0]) m = l;
        if (r < a.length && a[r][0] < a[m][0]) m = r;
        if (m === i) break;
        [a[m], a[i]] = [a[i], a[m]];
        i = m;
      }
    }
    return top[1];
  }
  get size() {
    return this.a.length;
  }
}

export function createDemoSource() {
  const truth = buildGrid();
  const dist = distanceField(truth);
  const cost = costmapFrom(truth, dist);
  const W = truth.width;
  const H = truth.height;
  const R = truth.resolution;
  const known = { ...truth, data: Int8Array.from(truth.data) };

  const handlers = {};
  const emit = (ev, data) => (handlers[ev] || []).forEach((cb) => cb(data));
  const now = () => Date.now() / 1000;
  const t0 = now();

  const robot = { x: -5, y: 0, yaw: 0, v: 0, w: 0 };
  const teleop = { vx: 0, wz: 0, t: 0 };
  let mode = 'NAVIGATION';
  let switching = false;
  let estop = false;
  let currentMap = 'warehouse';
  let goal = null;
  let plan = [];
  let navState = 'IDLE';
  let recoveries = 0;
  let battery = 8.3;
  let mapDirty = true;
  let locations = STATIONS.map((s) => ({ ...s }));
  let maps = [
    { name: 'warehouse', readonly: true, modified: t0 - 86400 },
    { name: 'lab_floor2', readonly: false, modified: t0 - 7200 },
  ];

  // ---------------------------------------------------------------- grid helpers
  const cellOf = (x, y) => [Math.floor((x - truth.ox) / R), Math.floor((y - truth.oy) / R)];
  const inside = (i, j) => i >= 0 && j >= 0 && i < W && j < H;
  const distAt = (x, y) => {
    const [i, j] = cellOf(x, y);
    return inside(i, j) ? dist[j * W + i] : 0;
  };

  function astar(sx, sy, gx, gy) {
    const [si, sj] = cellOf(sx, sy);
    const [gi, gj] = cellOf(gx, gy);
    if (!inside(gi, gj) || cost.data[gj * W + gi] >= 99 || cost.data[gj * W + gi] < 0) return null;
    const start = sj * W + si;
    const target = gj * W + gi;
    const g = new Float32Array(W * H).fill(Infinity);
    const came = new Int32Array(W * H).fill(-1);
    const heap = new MinHeap();
    g[start] = 0;
    heap.push(start, 0);
    const nb = [
      [1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1],
      [1, 1, Math.SQRT2], [1, -1, Math.SQRT2], [-1, 1, Math.SQRT2], [-1, -1, Math.SQRT2],
    ];
    let iter = 0;
    while (heap.size && iter++ < 200000) {
      const k = heap.pop();
      if (k === target) break;
      const i = k % W;
      const j = (k / W) | 0;
      for (const [di, dj, c] of nb) {
        const ni = i + di;
        const nj = j + dj;
        if (!inside(ni, nj)) continue;
        const nk = nj * W + ni;
        const cv = cost.data[nk];
        if ((cv >= 99 || cv < 0) && nk !== target) continue;
        const ng = g[k] + c * (1 + Math.max(0, cv) / 25);
        if (ng < g[nk]) {
          g[nk] = ng;
          came[nk] = k;
          heap.push(nk, ng + Math.hypot(ni - gi, nj - gj));
        }
      }
    }
    if (came[target] === -1 && target !== start) return null;
    const cells = [];
    for (let k = target; k !== -1; k = came[k]) cells.push(k);
    cells.reverse();
    const pts = cells
      .filter((_, idx) => idx % 3 === 0 || idx === cells.length - 1)
      .map((k) => [truth.ox + ((k % W) + 0.5) * R, truth.oy + (((k / W) | 0) + 0.5) * R]);
    pts[pts.length - 1] = [gx, gy];
    return pts;
  }

  const pathLength = (pts) => {
    let L = Math.hypot(pts[0][0] - robot.x, pts[0][1] - robot.y);
    for (let i = 1; i < pts.length; i++) L += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
    return L;
  };

  function navigate(x, y, yaw) {
    if (estop) return false;
    const p = astar(robot.x, robot.y, x, y);
    if (!p) {
      navState = 'FAILED';
      goal = { x, y, yaw };
      plan = [];
      emit('plan', plan);
      emitNav();
      result('navigate', false, 'no path to goal (blocked or unknown)');
      return false;
    }
    goal = { x, y, yaw };
    plan = p;
    navState = 'NAVIGATING';
    emit('plan', plan);
    emitNav();
    return true;
  }

  function stopNav(state) {
    if (navState === 'NAVIGATING') navState = state;
    plan = [];
    emit('plan', plan);
    emitNav();
  }

  // ---------------------------------------------------------------- control loop
  function controller() {
    if (!goal || navState !== 'NAVIGATING' || !plan.length) return [0, 0];
    while (plan.length > 1 && Math.hypot(plan[0][0] - robot.x, plan[0][1] - robot.y) < 0.2) plan.shift();
    const dGoal = Math.hypot(goal.x - robot.x, goal.y - robot.y);
    if (dGoal < 0.12) {
      const e = wrap(goal.yaw - robot.yaw);
      if (Math.abs(e) < 0.08) {
        navState = 'SUCCEEDED';
        plan = [];
        emit('plan', plan);
        emitNav();
        return [0, 0];
      }
      return [0, clamp(2 * e, -1.2, 1.2)];
    }
    let target = plan[plan.length - 1];
    for (const p of plan) {
      if (Math.hypot(p[0] - robot.x, p[1] - robot.y) >= 0.45) {
        target = p;
        break;
      }
    }
    const e = wrap(Math.atan2(target[1] - robot.y, target[0] - robot.x) - robot.yaw);
    if (Math.abs(e) > 0.9) return [0, Math.sign(e) * 1.2];
    const v = 0.32 * (1 - Math.min(Math.abs(e) / 1.2, 0.7)) * Math.min(1, dGoal / 0.5 + 0.2);
    return [v, clamp(2.4 * e, -1.5, 1.5)];
  }

  function physics() {
    let tv = 0;
    let tw = 0;
    const teleopActive = performance.now() - teleop.t < 400 && (teleop.vx || teleop.wz);
    if (!estop) {
      if (teleopActive) {
        if (navState === 'NAVIGATING') stopNav('CANCELED');
        tv = teleop.vx;
        tw = teleop.wz;
      } else {
        [tv, tw] = controller();
      }
    }
    robot.v += clamp(tv - robot.v, -1.0 * DT, 1.0 * DT);
    robot.w += clamp(tw - robot.w, -3.0 * DT, 3.0 * DT);
    if (estop) {
      robot.v = 0;
      robot.w = 0;
    }
    const nyaw = wrap(robot.yaw + robot.w * DT);
    const nx = robot.x + robot.v * Math.cos(nyaw) * DT;
    const ny = robot.y + robot.v * Math.sin(nyaw) * DT;
    if (distAt(nx, ny) > ROBOT_RADIUS || distAt(nx, ny) > distAt(robot.x, robot.y)) {
      robot.x = nx;
      robot.y = ny;
    } else {
      robot.v = 0;
      if (navState === 'NAVIGATING') {
        recoveries += 1;
        navigate(goal.x, goal.y, goal.yaw);
      }
    }
    robot.yaw = nyaw;
    battery = Math.max(6.6, battery - (Math.abs(robot.v) * 0.0006 + 0.00002));
    emit('pose', { x: robot.x, y: robot.y, yaw: robot.yaw, frame: 'map' });
    emit('odom', { vx: robot.v, wz: robot.w });
    if (navState === 'NAVIGATING' && plan.length && Math.random() < 0.1) emitNav();
  }

  // ---------------------------------------------------------------- lidar + mapping
  function scan() {
    const n = 360;
    const inc = (2 * Math.PI) / n;
    const ranges = new Array(n);
    const reveal = mode === 'MAPPING';
    for (let b = 0; b < n; b++) {
      const a = robot.yaw - Math.PI + b * inc;
      const ca = Math.cos(a);
      const sa = Math.sin(a);
      let r = 0.15;
      let hit = false;
      for (; r < 8; r += R * 0.6) {
        const [i, j] = cellOf(robot.x + r * ca, robot.y + r * sa);
        if (!inside(i, j)) break;
        const k = j * W + i;
        if (truth.data[k] === 100) {
          hit = true;
          if (reveal && known.data[k] !== 100) {
            known.data[k] = 100;
            mapDirty = true;
          }
          break;
        }
        if (reveal && b % 2 === 0 && known.data[k] !== 0) {
          known.data[k] = 0;
          mapDirty = true;
        }
      }
      ranges[b] = hit ? r + (Math.random() - 0.5) * 0.02 : Infinity;
    }
    emit('scan', { angle_min: -Math.PI, angle_increment: inc, range_min: 0.15, range_max: 12, ranges });
  }

  function emitMap() {
    if (!mapDirty) return;
    mapDirty = false;
    emit('map', { ...known, data: Int8Array.from(known.data), stamp: now(), frame: 'map' });
  }

  // ---------------------------------------------------------------- missions
  const jobs = [];
  let jobSeq = 0;
  let active = null;
  let phase = null;
  let dwellUntil = 0;
  let firstSubmit = null;
  let busy = 0;
  let distanceSum = 0;
  let missionGoal = null;
  const policy = 'priority';
  const station = (name) => locations.find((l) => l.name === name);

  function submit(pickup, dropoff, priority) {
    if (!station(pickup) || !station(dropoff)) return { accepted: false, mission_id: '', message: 'unknown station' };
    if (pickup === dropoff) return { accepted: false, mission_id: '', message: 'pickup and dropoff must differ' };
    const t = now();
    const j = { id: `M${String(++jobSeq).padStart(4, '0')}`, pickup, dropoff, priority, state: 'QUEUED', attempts: 0, created: t, started: 0, finished: 0 };
    jobs.push(j);
    firstSubmit ??= t;
    return { accepted: true, mission_id: j.id, message: `queued (${jobs.filter((x) => x.state === 'QUEUED').length} waiting)` };
  }

  function goTo(name) {
    const s = station(name);
    missionGoal = name;
    if (s) navigate(s.x, s.y, s.yaw || 0);
  }

  function missionTick() {
    const t = now();
    if (active) busy += 0.25;
    if (estop || mode === 'IDLE') return;
    if (!active) {
      const queued = jobs.filter((j) => j.state === 'QUEUED');
      if (queued.length) {
        queued.sort((a, b) => b.priority - a.priority || a.created - b.created);
        active = queued[0];
        active.started = t;
        active.attempts = 1;
        active.state = phase = 'TO_PICKUP';
        const s = station(active.pickup);
        distanceSum += Math.hypot(s.x - robot.x, s.y - robot.y);
        goTo(active.pickup);
      } else if (phase !== 'HOMING') {
        const h = station('home');
        if (h && Math.hypot(h.x - robot.x, h.y - robot.y) > 0.3 && navState !== 'NAVIGATING') {
          phase = 'HOMING';
          goTo('home');
        }
      } else if (navState !== 'NAVIGATING') {
        phase = null;
      }
      return;
    }
    if (active.state === 'LOADING' || active.state === 'UNLOADING') {
      if (t < dwellUntil) return;
      if (active.state === 'LOADING') {
        active.state = phase = 'TO_DROPOFF';
        const a = station(active.pickup);
        const b = station(active.dropoff);
        distanceSum += Math.hypot(a.x - b.x, a.y - b.y);
        goTo(active.dropoff);
      } else {
        active.state = 'COMPLETED';
        active.finished = t;
        result('mission', true, `${active.id} completed`);
        active = null;
        phase = null;
      }
      return;
    }
    if (navState === 'SUCCEEDED' && missionGoal) {
      missionGoal = null;
      active.state = phase = active.state === 'TO_PICKUP' ? 'LOADING' : 'UNLOADING';
      dwellUntil = t + 2.5;
    } else if (navState === 'FAILED' || navState === 'CANCELED') {
      if (active.attempts < 2) {
        active.attempts += 1;
        goTo(active.state === 'TO_PICKUP' ? active.pickup : active.dropoff);
      } else {
        active.state = 'FAILED';
        active.finished = t;
        result('mission', false, `${active.id} failed`);
        active = null;
        phase = null;
      }
    } else if (navState !== 'NAVIGATING') {
      goTo(active.state === 'TO_PICKUP' ? active.pickup : active.dropoff);
    }
  }

  function emitMissions() {
    const live = jobs.filter((j) => !['COMPLETED', 'FAILED', 'CANCELLED'].includes(j.state));
    const done = jobs.filter((j) => ['COMPLETED', 'FAILED', 'CANCELLED'].includes(j.state)).slice(-20);
    emit('missions', [...live, ...done].map((j) => ({ ...j })));
    const t = now();
    const completed = jobs.filter((j) => j.state === 'COMPLETED');
    const failed = jobs.filter((j) => j.state === 'FAILED').length;
    const started = jobs.filter((j) => j.started);
    const elapsed = firstSubmit ? t - firstSubmit : 0;
    emit('metrics', {
      stamp: t,
      policy,
      robot_state: estop ? 'ESTOP' : phase || 'IDLE',
      active_mission_id: active ? active.id : '',
      submitted: jobs.length,
      completed: completed.length,
      failed,
      cancelled: jobs.filter((j) => j.state === 'CANCELLED').length,
      queue_length: jobs.filter((j) => j.state === 'QUEUED').length,
      throughput_per_hour: elapsed > 1 ? completed.length / (elapsed / 3600) : 0,
      mean_wait_time_s: started.length ? started.reduce((s, j) => s + j.started - j.created, 0) / started.length : 0,
      mean_cycle_time_s: completed.length ? completed.reduce((s, j) => s + j.finished - j.started, 0) / completed.length : 0,
      success_rate: completed.length + failed ? completed.length / (completed.length + failed) : 0,
      utilization: elapsed > 1 ? Math.min(1, busy / elapsed) : 0,
      total_distance_m: distanceSum,
    });
  }

  // ---------------------------------------------------------------- state / health
  function emitNav() {
    emit('nav', {
      state: navState,
      distance_remaining: navState === 'NAVIGATING' && plan.length ? pathLength(plan) : 0,
      eta_s: navState === 'NAVIGATING' && plan.length ? pathLength(plan) / 0.28 : 0,
      recoveries,
      goal,
    });
  }

  function emitState() {
    emit('state', {
      mode: estop ? 'ESTOP' : switching ? 'SWITCHING' : mode,
      nav_mode: switching ? 'SWITCHING' : mode,
      managed: true,
      estop,
      nav_ready: mode !== 'IDLE' && !switching,
      map: mode === 'NAVIGATION' ? currentMap : '',
      uptime_s: now() - t0,
      use_sim_time: false,
    });
  }

  const jitter = (v, f = 0.06) => +(v * (1 + (Math.random() - 0.5) * f)).toFixed(1);
  function emitHealth() {
    const navUp = mode !== 'IDLE' && !switching;
    emit('health', {
      topics: {
        scan: { hz: jitter(8), expected: 5, ok: true },
        odom: { hz: jitter(20), expected: 10, ok: true },
        'imu/data_raw': { hz: jitter(50), expected: 20, ok: true },
        battery: { hz: jitter(2), expected: 1, ok: true },
        map: { hz: null, expected: null, ok: navUp },
      },
      nodes: {
        nova_base_driver: true,
        rplidar_node: true,
        ekf_filter_node: true,
        robot_state_publisher: true,
        amcl: mode === 'NAVIGATION' && !switching,
        map_server: mode === 'NAVIGATION' && !switching,
        slam_toolbox: mode === 'MAPPING' && !switching,
        bt_navigator: navUp,
        controller_server: navUp,
        planner_server: navUp,
        mission_manager: true,
        rosbridge_websocket: true,
      },
      system: {
        cpu_temp_c: +(47 + Math.abs(robot.v) * 12 + Math.random() * 2).toFixed(1),
        load: +(0.22 + Math.random() * 0.08 + (navUp ? 0.15 : 0)).toFixed(2),
        mem_pct: +(38 + Math.random() * 3).toFixed(1),
        disk_pct: 41.2,
      },
    });
    emit('battery', { voltage: battery, percentage: clamp((battery - 6.4) / 2.0, 0, 1), present: true });
  }

  function result(operation, success, message) {
    emit('result', { operation, success, message, stamp: now() });
  }

  // ---------------------------------------------------------------- timers
  const timers = [
    setInterval(physics, DT * 1000),
    setInterval(scan, 125),
    setInterval(emitMap, 1000),
    setInterval(missionTick, 250),
    setInterval(emitMissions, 1000),
    setInterval(emitState, 500),
    setInterval(emitHealth, 1000),
  ];
  setTimeout(() => {
    emit('connection', { connected: true, url: 'demo', demo: true });
    emit('costmap', { ...cost, stamp: now(), frame: 'map' });
    emit('locations', locations);
    emit('maps', maps);
    emitMap();
    emitState();
    emitHealth();
    emitNav();
    emitMissions();
    // a few missions so the dispatcher isn't empty
    submit('pick_a', 'drop_1', 0);
    submit('pick_c', 'drop_2', 2);
    submit('pick_d', 'drop_1', 0);
  }, 50);

  const ok = (message) => Promise.resolve({ success: true, message });
  const fail = (message) => Promise.resolve({ success: false, message });

  return {
    demo: true,
    url: 'demo',
    on(ev, cb) {
      (handlers[ev] ||= []).push(cb);
      return () => (handlers[ev] = handlers[ev].filter((h) => h !== cb));
    },
    close() {
      timers.forEach(clearInterval);
    },
    sendVelocity(vx, wz) {
      if (estop) return;
      teleop.vx = vx;
      teleop.wz = wz;
      teleop.t = performance.now();
    },
    sendGoal(x, y, yaw) {
      missionGoal = null;
      navigate(x, y, yaw);
    },
    setInitialPose(x, y, yaw) {
      Object.assign(robot, { x, y, yaw, v: 0, w: 0 });
      stopNav('CANCELED');
      result('initial_pose', true, `pose set to (${x.toFixed(2)}, ${y.toFixed(2)})`);
    },
    setMode(m, mapName) {
      if (!['IDLE', 'MAPPING', 'NAVIGATION'].includes(m)) return fail('unknown mode');
      switching = true;
      stopNav('CANCELED');
      emitState();
      setTimeout(() => {
        switching = false;
        mode = m;
        if (m === 'MAPPING') {
          known.data.fill(-1);
          mapDirty = true;
        } else if (m === 'NAVIGATION') {
          currentMap = mapName || 'warehouse';
          known.data.set(truth.data);
          mapDirty = true;
        }
        emitState();
        result('set_mode', true, `mode is now ${m}`);
      }, 1200);
      return ok(`switching to ${m}`);
    },
    mapOperation(op, name) {
      name = (name || `map_${new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '')}`).replace(/[^\w-]/g, '');
      if (op === 'save_map') {
        if (mode !== 'MAPPING') return fail('start MAPPING first');
        maps = [...maps.filter((m) => m.name !== name), { name, readonly: false, modified: now() }];
        setTimeout(() => {
          emit('maps', maps);
          result(op, true, `map saved as ${name}`);
        }, 900);
        return ok(`saving map ${name}...`);
      }
      if (op === 'serialize_pose_graph') {
        setTimeout(() => result(op, true, `pose graph saved as ${name}`), 900);
        return ok(`serializing ${name}...`);
      }
      if (op === 'delete_map') {
        const m = maps.find((x) => x.name === name);
        if (!m || m.readonly) return fail('map not found or read-only');
        maps = maps.filter((x) => x.name !== name);
        emit('maps', maps);
        result(op, true, `deleted ${name}`);
        return ok(`deleted ${name}`);
      }
      return fail('unknown operation');
    },
    estop() {
      estop = true;
      stopNav('CANCELED');
      emitState();
      result('emergency_stop', true, 'E-STOP engaged: motors stopped, goals cancelled');
      return ok('E-STOP engaged');
    },
    resetEstop() {
      estop = false;
      if (navState === 'CANCELED') navState = 'IDLE'; // an E-STOP cancel is not a mission failure
      emitState();
      result('reset_emergency_stop', true, 'E-STOP released');
      return ok('E-STOP released');
    },
    cancelNav() {
      stopNav('CANCELED');
      return ok('navigation goals cancelled');
    },
    locationCommand(cmd) {
      const a = cmd.action;
      if (a === 'save_location') {
        const name = String(cmd.name || '').trim();
        if (!name) return result(a, false, 'location needs a name');
        const p = cmd.use_current_pose ? { x: robot.x, y: robot.y, yaw: robot.yaw } : cmd;
        locations = [
          ...locations.filter((l) => l.name !== name),
          { name, x: +p.x.toFixed(3), y: +p.y.toFixed(3), yaw: +(p.yaw || 0).toFixed(3), type: cmd.type || 'waypoint' },
        ];
        result(a, true, `saved ${name}`);
      } else if (a === 'delete_location') {
        locations = locations.filter((l) => l.name !== cmd.name);
        result(a, true, `deleted ${cmd.name}`);
      } else if (a === 'clear_all') {
        locations = [];
        result(a, true, 'all locations cleared');
      } else if (a === 'navigate_to_location') {
        const l = station(cmd.name);
        if (!l) return result(a, false, 'unknown location');
        missionGoal = null;
        if (navigate(l.x, l.y, l.yaw || 0)) result(a, true, `navigating to ${l.name}`);
        return;
      }
      emit('locations', locations);
    },
    submitMission: (p, d, pr) => Promise.resolve(submit(p, d, pr)),
    cancelMission(id) {
      const j = jobs.find((x) => x.id === id);
      if (!j || ['COMPLETED', 'FAILED', 'CANCELLED'].includes(j.state)) {
        return Promise.resolve({ success: false, message: 'no such active/queued mission' });
      }
      if (j === active) {
        stopNav('CANCELED');
        missionGoal = null;
        active = null;
        phase = null;
      }
      j.state = 'CANCELLED';
      j.finished = now();
      return Promise.resolve({ success: true, message: 'cancelled' });
    },
  };
}
