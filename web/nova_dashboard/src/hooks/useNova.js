// Central state hook: owns the data source (live rosbridge or demo), keeps the latest
// value of every stream, a 1 Hz history for analytics, notices, and the action API.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createRealSource } from '../ros/realSource.js';
import { createDemoSource } from '../ros/demoSource.js';

const HISTORY_MAX = 900; // 15 min @ 1 Hz

/* global __NOVA_DEMO__ */
const DEMO_BUILD = typeof __NOVA_DEMO__ !== 'undefined' && __NOVA_DEMO__;

function storage(key, value) {
  try {
    if (value === undefined) return localStorage.getItem(key);
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    /* storage unavailable (sandboxed preview) */
  }
  return null;
}

export function defaultRosUrl() {
  try {
    const q = new URLSearchParams(window.location.search);
    if (q.get('ros')) return q.get('ros');
  } catch {
    /* ignore */
  }
  const saved = storage('nova_ros_url');
  if (saved) return saved;
  const host = (typeof window !== 'undefined' && window.location.hostname) || 'localhost';
  return `ws://${host}:9090`;
}

function initialDemo() {
  try {
    const q = new URLSearchParams(window.location.search);
    if (q.has('demo')) return q.get('demo') !== '0';
  } catch {
    /* ignore */
  }
  const saved = storage('nova_demo');
  if (saved !== null) return saved === '1';
  return DEMO_BUILD;
}

export function useNova() {
  const [url, setUrl] = useState(defaultRosUrl);
  const [demo, setDemo] = useState(initialDemo);
  const [connected, setConnected] = useState(false);
  const [state, setState] = useState({ mode: 'IDLE', managed: false, estop: false });
  const [health, setHealth] = useState(null);
  const [pose, setPose] = useState(null);
  const [odom, setOdom] = useState({ vx: 0, wz: 0 });
  const [nav, setNav] = useState({ state: 'IDLE' });
  const [locations, setLocations] = useState([]);
  const [maps, setMaps] = useState([]);
  const [battery, setBattery] = useState(null);
  const [map, setMap] = useState(null);
  const [costmap, setCostmap] = useState(null);
  const [scan, setScan] = useState(null);
  const [plan, setPlan] = useState([]);
  const [missions, setMissions] = useState([]);
  const [metrics, setMetrics] = useState(null);
  const [notice, setNotice] = useState(null); // {text, ok}
  const [history, setHistory] = useState([]);

  const src = useRef(null);
  const latest = useRef({});
  latest.current = { battery, odom, metrics, nav, state };

  // (re)create the source when url/demo changes
  useEffect(() => {
    setConnected(false);
    const s = demo ? createDemoSource() : createRealSource(url);
    src.current = s;
    const offs = [
      s.on('connection', (c) => setConnected(c.connected)),
      s.on('state', setState),
      s.on('health', setHealth),
      s.on('pose', setPose),
      s.on('odom', setOdom),
      s.on('nav', setNav),
      s.on('locations', setLocations),
      s.on('maps', setMaps),
      s.on('battery', setBattery),
      s.on('map', setMap),
      s.on('costmap', setCostmap),
      s.on('scan', setScan),
      s.on('plan', setPlan),
      s.on('missions', setMissions),
      s.on('metrics', setMetrics),
      s.on('result', (r) => setNotice({ text: r.message, ok: r.success, t: Date.now() })),
    ];
    return () => {
      offs.forEach((off) => off());
      s.close();
      if (src.current === s) src.current = null;
    };
  }, [url, demo]);

  // analytics history @ 1 Hz
  useEffect(() => {
    const id = setInterval(() => {
      const { battery: b, odom: o, metrics: m, nav: n, state: st } = latest.current;
      setHistory((h) => {
        const row = {
          t: Date.now() / 1000,
          battery_v: b?.voltage ?? null,
          battery_pct: b ? b.percentage * 100 : null,
          speed: Math.abs(o?.vx ?? 0),
          queue: m?.queue_length ?? 0,
          throughput: m?.throughput_per_hour ?? 0,
          completed: m?.completed ?? 0,
          failed: m?.failed ?? 0,
          utilization: m ? m.utilization * 100 : 0,
          nav: n?.state,
          mode: st?.mode,
        };
        const next = h.length >= HISTORY_MAX ? h.slice(h.length - HISTORY_MAX + 1) : h.slice();
        next.push(row);
        return next;
      });
    }, 1000);
    return () => clearInterval(id);
  }, []);

  // auto-dismiss notices
  useEffect(() => {
    if (!notice) return undefined;
    const id = setTimeout(() => setNotice(null), notice.ok === false ? 9000 : 5000);
    return () => clearTimeout(id);
  }, [notice]);

  const report = useCallback((p, label) => {
    p.then((r) => {
      const ok = r.success ?? r.accepted ?? true;
      setNotice({ text: r.message || `${label}: ${ok ? 'ok' : 'failed'}`, ok, t: Date.now() });
      return r;
    }).catch((e) => setNotice({ text: `${label}: ${e.message}`, ok: false, t: Date.now() }));
    return p;
  }, []);

  const api = useMemo(
    () => ({
      sendVelocity: (vx, wz) => src.current?.sendVelocity(vx, wz),
      sendGoal: (x, y, yaw) => {
        src.current?.sendGoal(x, y, yaw);
        setNotice({ text: `Goal sent → (${x.toFixed(2)}, ${y.toFixed(2)})`, ok: true, t: Date.now() });
      },
      setInitialPose: (x, y, yaw) => {
        src.current?.setInitialPose(x, y, yaw);
        setNotice({ text: `Initial pose → (${x.toFixed(2)}, ${y.toFixed(2)})`, ok: true, t: Date.now() });
      },
      setMode: (mode, mapName) => report(src.current.setMode(mode, mapName), 'Mode'),
      mapOperation: (op, name) => report(src.current.mapOperation(op, name), 'Map'),
      estop: () => report(src.current.estop(), 'E-STOP'),
      resetEstop: () => report(src.current.resetEstop(), 'E-STOP reset'),
      cancelNav: () => report(src.current.cancelNav(), 'Cancel'),
      locationCommand: (cmd) => src.current?.locationCommand(cmd),
      submitMission: (p, d, pr) => report(src.current.submitMission(p, d, pr), 'Mission'),
      cancelMission: (id) => report(src.current.cancelMission(id), 'Cancel mission'),
    }),
    [report],
  );

  const connect = useCallback((newUrl) => {
    storage('nova_ros_url', newUrl);
    storage('nova_demo', '0');
    setDemo(false);
    setUrl(newUrl);
  }, []);

  const startDemo = useCallback(() => {
    storage('nova_demo', '1');
    setDemo(true);
  }, []);

  return {
    url, demo, connected, connect, startDemo,
    state, health, pose, odom, nav, locations, maps, battery,
    map, costmap, scan, plan, missions, metrics, history,
    notice, setNotice, api,
  };
}
