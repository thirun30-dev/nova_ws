// Live data source: NOVA over rosbridge. Normalises ROS messages into plain objects
// so components never touch raw ROS types. Same interface as demoSource.js.
import { Rosbridge } from './rosbridge.js';
import { quatFromYaw, timeToSec, yawFromQuat } from '../lib/geom.js';

const T = {
  String: 'std_msgs/msg/String',
  Bool: 'std_msgs/msg/Bool',
  Pose: 'geometry_msgs/msg/PoseStamped',
  PoseCov: 'geometry_msgs/msg/PoseWithCovarianceStamped',
  Twist: 'geometry_msgs/msg/Twist',
  Odom: 'nav_msgs/msg/Odometry',
  Grid: 'nav_msgs/msg/OccupancyGrid',
  Path: 'nav_msgs/msg/Path',
  Scan: 'sensor_msgs/msg/LaserScan',
  Battery: 'sensor_msgs/msg/BatteryState',
  Trigger: 'std_srvs/srv/Trigger',
  SetMode: 'nova_interfaces/srv/SetMode',
  MapOp: 'nova_interfaces/srv/MapOperation',
  Submit: 'nova_interfaces/srv/SubmitMission',
  Cancel: 'nova_interfaces/srv/CancelMission',
  MissionArray: 'nova_interfaces/msg/MissionArray',
  Metrics: 'nova_interfaces/msg/SystemMetrics',
};

const parseJson = (cb) => (m) => {
  try {
    cb(JSON.parse(m.data));
  } catch {
    /* ignore malformed */
  }
};

const grid = (m) => ({
  width: m.info.width,
  height: m.info.height,
  resolution: m.info.resolution,
  ox: m.info.origin.position.x,
  oy: m.info.origin.position.y,
  data: m.data,
  stamp: timeToSec(m.header.stamp) || performance.now() / 1000,
  frame: m.header.frame_id,
});

const path = (m) =>
  m.header.frame_id && m.header.frame_id !== 'map' ? [] : m.poses.map((p) => [p.pose.position.x, p.pose.position.y]);

export function createRealSource(url) {
  const rb = new Rosbridge(url);
  const handlers = {};
  const emit = (ev, data) => (handlers[ev] || []).forEach((cb) => cb(data));
  const unsubs = [];
  const sub = (topic, type, cb, opts) => unsubs.push(rb.subscribe(topic, type, cb, opts));

  let lastBridgePose = 0;

  sub('/nova/system_state', T.String, parseJson((d) => emit('state', d)));
  sub('/nova/health', T.String, parseJson((d) => emit('health', d)));
  sub('/nova/nav_status', T.String, parseJson((d) => emit('nav', d)));
  sub('/nova/locations', T.String, parseJson((d) => emit('locations', d)));
  sub('/nova/maps', T.String, parseJson((d) => emit('maps', d)));
  sub('/nova/operation_result', T.String, parseJson((d) => emit('result', d)));
  sub(
    '/nova/robot_pose',
    T.Pose,
    (m) => {
      lastBridgePose = performance.now();
      emit('pose', {
        x: m.pose.position.x,
        y: m.pose.position.y,
        yaw: yawFromQuat(m.pose.orientation),
        frame: m.header.frame_id,
      });
    },
    { throttle: 50 },
  );
  sub(
    '/odom',
    T.Odom,
    (m) => {
      emit('odom', { vx: m.twist.twist.linear.x, wz: m.twist.twist.angular.z });
      if (performance.now() - lastBridgePose > 1000) {
        const p = m.pose.pose;
        emit('pose', { x: p.position.x, y: p.position.y, yaw: yawFromQuat(p.orientation), frame: 'odom' });
      }
    },
    { throttle: 100 },
  );
  sub(
    '/battery',
    T.Battery,
    (m) => emit('battery', { voltage: m.voltage, percentage: m.percentage, present: m.present }),
    { throttle: 1000 },
  );
  sub('/map', T.Grid, (m) => emit('map', grid(m)), { throttle: 3000 });
  sub('/global_costmap/costmap', T.Grid, (m) => emit('costmap', grid(m)), { throttle: 3000 });
  sub(
    '/scan',
    T.Scan,
    (m) =>
      emit('scan', {
        angle_min: m.angle_min,
        angle_increment: m.angle_increment,
        range_min: m.range_min,
        range_max: m.range_max,
        ranges: m.ranges,
      }),
    { throttle: 150 },
  );
  sub('/plan', T.Path, (m) => emit('plan', path(m)), { throttle: 1000 });
  sub(
    '/missions/queue',
    T.MissionArray,
    (m) =>
      emit(
        'missions',
        m.missions.map((j) => ({
          id: j.id,
          pickup: j.pickup,
          dropoff: j.dropoff,
          priority: j.priority,
          state: j.state,
          attempts: j.attempts,
          created: timeToSec(j.created),
          started: timeToSec(j.started),
          finished: timeToSec(j.finished),
        })),
      ),
    { throttle: 500 },
  );
  sub('/missions/metrics', T.Metrics, (m) => emit('metrics', { ...m, stamp: timeToSec(m.stamp) }), {
    throttle: 500,
  });

  rb.on('open', () => emit('connection', { connected: true, url, demo: false }));
  rb.on('close', () => emit('connection', { connected: false, url, demo: false }));
  rb.connect();

  const trigger = (srv) => rb.call(srv, T.Trigger, {});

  return {
    demo: false,
    url,
    on(ev, cb) {
      (handlers[ev] ||= []).push(cb);
      return () => (handlers[ev] = handlers[ev].filter((h) => h !== cb));
    },
    close() {
      unsubs.forEach((u) => u());
      rb.close();
    },
    sendVelocity(vx, wz) {
      rb.publish('/cmd_vel', T.Twist, {
        linear: { x: vx, y: 0, z: 0 },
        angular: { x: 0, y: 0, z: wz },
      });
    },
    sendGoal(x, y, yaw) {
      rb.publish('/goal_pose', T.Pose, {
        header: { frame_id: 'map', stamp: { sec: 0, nanosec: 0 } },
        pose: { position: { x, y, z: 0 }, orientation: quatFromYaw(yaw) },
      });
    },
    setInitialPose(x, y, yaw) {
      const cov = new Array(36).fill(0);
      cov[0] = 0.25;
      cov[7] = 0.25;
      cov[35] = 0.07;
      rb.publish('/initialpose', T.PoseCov, {
        header: { frame_id: 'map', stamp: { sec: 0, nanosec: 0 } },
        pose: { pose: { position: { x, y, z: 0 }, orientation: quatFromYaw(yaw) }, covariance: cov },
      });
    },
    setMode: (mode, mapName = '') => rb.call('/nova/set_mode', T.SetMode, { mode, map_name: mapName }),
    mapOperation: (operation, mapName = '') =>
      rb.call('/nova/map_operation', T.MapOp, { operation, map_name: mapName }, 15000),
    estop: () => trigger('/nova/emergency_stop'),
    resetEstop: () => trigger('/nova/reset_emergency_stop'),
    cancelNav: () => trigger('/nova/cancel_navigation'),
    locationCommand(cmd) {
      rb.publish('/nova/location_command', T.String, { data: JSON.stringify(cmd) });
    },
    submitMission: (pickup, dropoff, priority = 0) =>
      rb.call('/mission_manager/submit', T.Submit, { pickup, dropoff, priority }),
    cancelMission: (missionId) => rb.call('/mission_manager/cancel', T.Cancel, { mission_id: missionId }),
  };
}
