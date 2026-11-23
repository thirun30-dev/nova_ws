"""nova_web_bridge — the robot-side backend for the NOVA web dashboard.

Everything the browser needs that plain Nav2/rosbridge topics don't give you:

Publishes (std_msgs/String = JSON unless noted)
  nova/system_state      {mode, managed, estop, nav_ready, map, uptime_s, use_sim_time}   2 Hz, latched
  nova/health            {topics:{..hz,ok}, nodes:{..bool}, system:{cpu_temp_c, load, mem_pct, disk_pct}}  1 Hz
  nova/robot_pose        geometry_msgs/PoseStamped (map->base_footprint, odom fallback)  20 Hz
  nova/nav_status        {state, distance_remaining, eta_s, recoveries, goal}            2 Hz + on change
  nova/locations         [{name, x, y, yaw, type}]                                        latched
  nova/maps              [{name, path, readonly, modified}]                               latched
  nova/operation_result  {operation, success, message, stamp}
  nova/estop             std_msgs/Bool                                                    latched
Subscribes
  nova/location_command  {action: save_location|delete_location|clear_all|navigate_to_location, ...}
  goal_pose              (only to remember the goal for nav_status)
Services
  nova/set_mode (nova_interfaces/SetMode)       IDLE | MAPPING | NAVIGATION (starts/stops the nav stack)
  nova/map_operation (nova_interfaces/MapOperation)  save_map | serialize_pose_graph | delete_map
  nova/emergency_stop, nova/reset_emergency_stop, nova/cancel_navigation (std_srvs/Trigger)
"""
import glob
import json
import math
import os
import shutil
import signal
import subprocess
import threading
import time

import rclpy
import yaml
from action_msgs.msg import GoalStatus, GoalStatusArray
from action_msgs.srv import CancelGoal
from ament_index_python.packages import get_package_share_directory
from geometry_msgs.msg import PoseStamped, Twist
from nav2_msgs.action import NavigateToPose
from nav_msgs.msg import OccupancyGrid, Odometry
from rclpy.node import Node
from rclpy.qos import DurabilityPolicy, QoSProfile, ReliabilityPolicy, qos_profile_sensor_data
from sensor_msgs.msg import BatteryState, LaserScan
from std_msgs.msg import Bool, String
from std_srvs.srv import Trigger
from tf2_ros import Buffer, TransformException, TransformListener

from nova_interfaces.srv import MapOperation, SetMode

LATCHED = QoSProfile(depth=1, durability=DurabilityPolicy.TRANSIENT_LOCAL,
                     reliability=ReliabilityPolicy.RELIABLE)

NAV_STATES = {
    GoalStatus.STATUS_ACCEPTED: 'NAVIGATING',
    GoalStatus.STATUS_EXECUTING: 'NAVIGATING',
    GoalStatus.STATUS_CANCELING: 'CANCELING',
    GoalStatus.STATUS_SUCCEEDED: 'SUCCEEDED',
    GoalStatus.STATUS_CANCELED: 'CANCELED',
    GoalStatus.STATUS_ABORTED: 'FAILED',
}

# topic -> (msg type, expected Hz, qos)
MONITORED = {
    'scan': (LaserScan, 5.0, qos_profile_sensor_data),
    'odom': (Odometry, 10.0, 10),
    'battery': (BatteryState, 1.0, 10),
}
WATCH_NODES = ['nova_base_driver', 'rplidar_node', 'ekf_filter_node', 'robot_state_publisher',
               'amcl', 'map_server', 'slam_toolbox', 'bt_navigator', 'controller_server',
               'planner_server', 'mission_manager', 'rosbridge_websocket']
LOCATION_TYPES = ('home', 'pickup', 'dropoff', 'charging', 'waypoint')


def yaw_of(q):
    return math.atan2(2.0 * (q.w * q.z + q.x * q.y), 1.0 - 2.0 * (q.y * q.y + q.z * q.z))


def read_first(path, default=None):
    try:
        with open(path) as f:
            return f.read().strip()
    except OSError:
        return default


class WebBridge(Node):

    def __init__(self):
        super().__init__('nova_web_bridge')
        p = self.declare_parameter
        self.manage_nav = bool(p('manage_navigation', False).value)
        startup_mode = str(p('startup_mode', 'IDLE').value).upper()
        self.maps_dir = os.path.expanduser(p('maps_dir', '~/nova_maps').value)
        self.locations_file = os.path.expanduser(
            p('locations_file', '~/.ros/nova_locations.json').value)
        self.default_map = p('default_map', '').value or os.path.join(
            get_package_share_directory('nova_navigation'), 'maps', 'warehouse.yaml')
        self.global_frame = p('global_frame', 'map').value
        self.odom_frame = p('odom_frame', 'odom').value
        self.robot_frame = p('robot_frame', 'base_footprint').value
        self.use_sim_time = bool(self.get_parameter('use_sim_time').value)
        os.makedirs(self.maps_dir, exist_ok=True)

        self.start_wall = time.time()
        self.estop = False
        self.mode = 'IDLE'
        self.current_map = ''
        self.stack_proc = None
        self.stack_lock = threading.Lock()
        self.nav_goal = None
        self.nav = {'state': 'IDLE', 'distance_remaining': 0.0, 'eta_s': 0.0, 'recoveries': 0}

        # ---- publishers
        self.state_pub = self.create_publisher(String, 'nova/system_state', LATCHED)
        self.health_pub = self.create_publisher(String, 'nova/health', 10)
        self.pose_pub = self.create_publisher(PoseStamped, 'nova/robot_pose', 10)
        self.nav_pub = self.create_publisher(String, 'nova/nav_status', 10)
        self.loc_pub = self.create_publisher(String, 'nova/locations', LATCHED)
        self.maps_pub = self.create_publisher(String, 'nova/maps', LATCHED)
        self.result_pub = self.create_publisher(String, 'nova/operation_result', 10)
        self.estop_pub = self.create_publisher(Bool, 'nova/estop', LATCHED)
        self.cmd_pub = self.create_publisher(Twist, 'cmd_vel', 10)
        self.goal_pub = self.create_publisher(PoseStamped, 'goal_pose', 10)

        # ---- subscriptions
        self.create_subscription(String, 'nova/location_command', self.on_location_command, 10)
        self.create_subscription(PoseStamped, 'goal_pose', self.on_goal_pose, 10)
        self.create_subscription(GoalStatusArray, 'navigate_to_pose/_action/status',
                                 self.on_nav_status, LATCHED)
        self.create_subscription(NavigateToPose.Impl.FeedbackMessage,
                                 'navigate_to_pose/_action/feedback', self.on_nav_feedback, 10)
        self.map_seen = False
        self.create_subscription(OccupancyGrid, 'map', self.on_map, LATCHED)
        self.counts = {t: 0 for t in MONITORED}
        self.rates = {t: 0.0 for t in MONITORED}
        for topic, (mtype, _, qos) in MONITORED.items():
            self.create_subscription(mtype, topic, self.make_counter(topic), qos)
        self.last_rate_t = time.monotonic()

        # ---- services
        self.create_service(SetMode, 'nova/set_mode', self.srv_set_mode)
        self.create_service(MapOperation, 'nova/map_operation', self.srv_map_operation)
        self.create_service(Trigger, 'nova/emergency_stop', self.srv_estop)
        self.create_service(Trigger, 'nova/reset_emergency_stop', self.srv_reset_estop)
        self.create_service(Trigger, 'nova/cancel_navigation', self.srv_cancel_nav)
        self.cancel_client = self.create_client(CancelGoal, 'navigate_to_pose/_action/cancel_goal')

        self.tf_buffer = Buffer()
        self.tf_listener = TransformListener(self.tf_buffer, self)

        # ---- state
        self.locations = self.load_locations()
        self.publish_locations()
        self.publish_maps()
        self.estop_pub.publish(Bool(data=False))

        self.create_timer(0.05, self.publish_pose)
        self.create_timer(0.1, self.estop_hold)
        self.create_timer(0.5, self.publish_state)
        self.create_timer(0.5, self.publish_nav)
        self.create_timer(1.0, self.publish_health)

        if self.manage_nav and startup_mode in ('MAPPING', 'NAVIGATION'):
            self.switch_mode_async(startup_mode, '')
        self.get_logger().info(
            f'NOVA web bridge up (manage_navigation={self.manage_nav}, maps_dir={self.maps_dir})')

    # =============================================================== helpers
    def publish_json(self, pub, obj):
        pub.publish(String(data=json.dumps(obj)))

    def result(self, operation, success, message):
        self.get_logger().info(f'[{operation}] {"OK" if success else "FAIL"}: {message}')
        self.publish_json(self.result_pub, {'operation': operation, 'success': success,
                                            'message': message, 'stamp': time.time()})

    def robot_pose(self):
        for frame in (self.global_frame, self.odom_frame):
            try:
                t = self.tf_buffer.lookup_transform(frame, self.robot_frame, rclpy.time.Time())
                return frame, t
            except TransformException:
                continue
        return None, None

    def node_names(self):
        try:
            return set(self.get_node_names())
        except Exception:  # noqa: BLE001
            return set()

    def detected_mode(self, names):
        if 'slam_toolbox' in names:
            return 'MAPPING'
        if 'amcl' in names:
            return 'NAVIGATION'
        return 'IDLE'

    # =============================================================== pose / nav
    def publish_pose(self):
        frame, t = self.robot_pose()
        if t is None:
            return
        msg = PoseStamped()
        msg.header.stamp = t.header.stamp
        msg.header.frame_id = frame
        msg.pose.position.x = t.transform.translation.x
        msg.pose.position.y = t.transform.translation.y
        msg.pose.orientation = t.transform.rotation
        self.pose_pub.publish(msg)

    def on_goal_pose(self, msg: PoseStamped):
        self.nav_goal = {'x': msg.pose.position.x, 'y': msg.pose.position.y,
                         'yaw': yaw_of(msg.pose.orientation)}

    def on_nav_status(self, msg: GoalStatusArray):
        if not msg.status_list:
            return
        latest = max(msg.status_list,
                     key=lambda s: (s.goal_info.stamp.sec, s.goal_info.stamp.nanosec))
        state = NAV_STATES.get(latest.status, 'IDLE')
        if state != self.nav['state']:
            self.nav['state'] = state
            if state != 'NAVIGATING':
                self.nav['distance_remaining'] = 0.0
                self.nav['eta_s'] = 0.0
            self.publish_nav()

    def on_nav_feedback(self, msg):
        fb = msg.feedback
        self.nav['distance_remaining'] = float(fb.distance_remaining)
        eta = fb.estimated_time_remaining
        self.nav['eta_s'] = float(eta.sec + eta.nanosec * 1e-9)
        self.nav['recoveries'] = int(fb.number_of_recoveries)
        if self.nav['state'] not in ('NAVIGATING', 'CANCELING'):
            self.nav['state'] = 'NAVIGATING'

    def publish_nav(self):
        self.publish_json(self.nav_pub, dict(self.nav, goal=self.nav_goal))

    def cancel_all_goals(self):
        if self.cancel_client.service_is_ready():
            self.cancel_client.call_async(CancelGoal.Request())   # zero goal_info = cancel all
            return True
        return False

    # =============================================================== E-STOP
    def estop_hold(self):
        if self.estop:
            self.cmd_pub.publish(Twist())   # keeps a sim / un-gated base at zero

    def srv_estop(self, _req, res):
        self.estop = True
        self.estop_pub.publish(Bool(data=True))
        self.cancel_all_goals()
        for _ in range(3):
            self.cmd_pub.publish(Twist())
        self.publish_state()
        self.result('emergency_stop', True, 'E-STOP engaged: motors stopped, goals cancelled')
        res.success, res.message = True, 'E-STOP engaged'
        return res

    def srv_reset_estop(self, _req, res):
        self.estop = False
        self.estop_pub.publish(Bool(data=False))
        self.publish_state()
        self.result('reset_emergency_stop', True, 'E-STOP released')
        res.success, res.message = True, 'E-STOP released'
        return res

    def srv_cancel_nav(self, _req, res):
        ok = self.cancel_all_goals()
        res.success = ok
        res.message = 'navigation goals cancelled' if ok else 'Nav2 not running'
        return res

    # =============================================================== modes
    def srv_set_mode(self, req, res):
        mode = req.mode.upper().strip()
        if mode not in ('IDLE', 'MAPPING', 'NAVIGATION'):
            res.success, res.message = False, f'unknown mode {req.mode!r}'
            return res
        if not self.manage_nav:
            res.success = False
            res.message = ('navigation stack is launched externally '
                           '(start the bridge with manage_navigation:=true to switch modes)')
            return res
        map_path = ''
        if mode == 'NAVIGATION':
            map_path = self.resolve_map(req.map_name)
            if not map_path:
                res.success, res.message = False, f'map {req.map_name!r} not found'
                return res
        self.switch_mode_async(mode, map_path)
        res.success = True
        res.message = f'switching to {mode}' + (f' on {os.path.basename(map_path)}' if map_path else '')
        return res

    def resolve_map(self, name):
        if not name:
            return self.default_map if os.path.exists(self.default_map) else ''
        for m in self.list_maps():
            if m['name'] == name:
                return m['path']
        return ''

    def switch_mode_async(self, mode, map_path):
        threading.Thread(target=self.switch_mode, args=(mode, map_path), daemon=True).start()

    def switch_mode(self, mode, map_path):
        with self.stack_lock:
            self.mode = 'SWITCHING'
            self.publish_state()
            self.stop_stack()
            if mode == 'IDLE':
                self.mode, self.current_map = 'IDLE', ''
            else:
                if mode == 'NAVIGATION' and not map_path:
                    map_path = self.default_map
                cmd = ['ros2', 'launch', 'nova_navigation', 'navigation.launch.py',
                       f'use_sim_time:={str(self.use_sim_time).lower()}']
                cmd.append('slam:=true' if mode == 'MAPPING' else f'map:={map_path}')
                log_path = os.path.expanduser('~/.ros/nova_nav_stack.log')
                log = open(log_path, 'a')
                self.stack_proc = subprocess.Popen(cmd, stdout=log, stderr=subprocess.STDOUT,
                                                   start_new_session=True)
                self.mode = mode
                self.current_map = os.path.splitext(os.path.basename(map_path))[0] if map_path else ''
            self.publish_state()
            self.result('set_mode', True, f'mode is now {self.mode}')

    def stop_stack(self):
        proc, self.stack_proc = self.stack_proc, None
        if proc is None or proc.poll() is not None:
            return
        for sig, wait in ((signal.SIGINT, 15), (signal.SIGTERM, 5), (signal.SIGKILL, 2)):
            try:
                os.killpg(proc.pid, sig)
            except ProcessLookupError:
                return
            try:
                proc.wait(timeout=wait)
                return
            except subprocess.TimeoutExpired:
                continue

    # =============================================================== maps
    def list_maps(self):
        out = []
        pkg_maps = os.path.dirname(self.default_map)
        for d, readonly in ((self.maps_dir, False), (pkg_maps, True)):
            for y in sorted(glob.glob(os.path.join(d, '*.yaml'))):
                name = os.path.splitext(os.path.basename(y))[0]
                if any(m['name'] == name for m in out):
                    continue
                out.append({'name': name, 'path': y, 'readonly': readonly,
                            'modified': os.path.getmtime(y)})
        return out

    def publish_maps(self):
        self.publish_json(self.maps_pub, self.list_maps())

    def srv_map_operation(self, req, res):
        op = req.operation.strip()
        name = os.path.basename(req.map_name.strip()) or time.strftime('map_%Y%m%d_%H%M%S')
        name = ''.join(c for c in name if c.isalnum() or c in '-_')
        if op == 'save_map':
            target = os.path.join(self.maps_dir, name)
            cmd = ['ros2', 'run', 'nav2_map_server', 'map_saver_cli', '-f', target,
                   '--ros-args', '-p', f'use_sim_time:={str(self.use_sim_time).lower()}']
            self.run_async(op, cmd, f'map saved as {name}')
            res.success, res.message = True, f'saving map {name}...'
        elif op == 'serialize_pose_graph':
            target = os.path.join(self.maps_dir, name)
            cmd = ['ros2', 'service', 'call', '/slam_toolbox/serialize_map',
                   'slam_toolbox/srv/SerializePoseGraph', json.dumps({'filename': target})]
            self.run_async(op, cmd, f'pose graph saved as {name}')
            res.success, res.message = True, f'serializing pose graph {name}...'
        elif op == 'delete_map':
            m = next((m for m in self.list_maps() if m['name'] == name), None)
            if m is None or m['readonly']:
                res.success, res.message = False, 'map not found or read-only'
            else:
                with open(m['path']) as f:
                    image = (yaml.safe_load(f) or {}).get('image', name + '.pgm')
                for path in (m['path'], os.path.join(self.maps_dir, image)):
                    if os.path.exists(path):
                        os.remove(path)
                for ext in ('.posegraph', '.data'):
                    if os.path.exists(os.path.join(self.maps_dir, name + ext)):
                        os.remove(os.path.join(self.maps_dir, name + ext))
                self.publish_maps()
                res.success, res.message = True, f'deleted {name}'
                self.result(op, True, res.message)
        else:
            res.success, res.message = False, f'unknown operation {op!r}'
        return res

    def run_async(self, op, cmd, ok_message):
        def worker():
            try:
                out = subprocess.run(cmd, capture_output=True, text=True, timeout=60)
                ok = out.returncode == 0 and 'Failed' not in out.stdout + out.stderr
                tail = (out.stderr or out.stdout).strip().splitlines()[-1:] or ['']
                self.result(op, ok, ok_message if ok else f'failed: {tail[0]}')
            except (subprocess.TimeoutExpired, OSError) as exc:
                self.result(op, False, f'failed: {exc}')
            self.publish_maps()
        threading.Thread(target=worker, daemon=True).start()

    def on_map(self, _msg):
        self.map_seen = True

    # =============================================================== locations
    def load_locations(self):
        if os.path.exists(self.locations_file):
            try:
                with open(self.locations_file) as f:
                    return json.load(f)
            except (OSError, ValueError):
                self.get_logger().warn(f'could not read {self.locations_file}, starting empty')
        # first run: seed from the mission stations
        try:
            path = os.path.join(get_package_share_directory('nova_mission'), 'config', 'stations.yaml')
            with open(path) as f:
                stations = yaml.safe_load(f)['stations']
        except Exception:  # noqa: BLE001
            return []
        locs = []
        for name, s in stations.items():
            t = ('home' if name == 'home' else 'dropoff' if name.startswith('drop')
                 else 'pickup' if name.startswith('pick') else 'waypoint')
            locs.append({'name': name, 'x': s['x'], 'y': s['y'], 'yaw': s.get('yaw', 0.0), 'type': t})
        return locs

    def save_locations(self):
        try:
            os.makedirs(os.path.dirname(self.locations_file), exist_ok=True)
            with open(self.locations_file, 'w') as f:
                json.dump(self.locations, f, indent=2)
        except OSError as exc:
            self.get_logger().warn(f'could not save locations: {exc}')

    def publish_locations(self):
        self.publish_json(self.loc_pub, self.locations)

    def on_location_command(self, msg: String):
        try:
            cmd = json.loads(msg.data)
            action = cmd.get('action')
        except (ValueError, AttributeError):
            return
        if action == 'save_location':
            name = str(cmd.get('name', '')).strip()
            if not name:
                return self.result(action, False, 'location needs a name')
            if cmd.get('use_current_pose'):
                _, t = self.robot_pose()
                if t is None:
                    return self.result(action, False, 'robot pose unknown')
                x, y = t.transform.translation.x, t.transform.translation.y
                yaw = yaw_of(t.transform.rotation)
            else:
                x, y, yaw = float(cmd['x']), float(cmd['y']), float(cmd.get('yaw', 0.0))
            ltype = cmd.get('type', 'waypoint')
            if ltype not in LOCATION_TYPES:
                ltype = 'waypoint'
            self.locations = [loc for loc in self.locations if loc['name'] != name]
            self.locations.append({'name': name, 'x': round(x, 3), 'y': round(y, 3),
                                   'yaw': round(yaw, 3), 'type': ltype})
            self.result(action, True, f'saved {name}')
        elif action == 'delete_location':
            name = cmd.get('name')
            self.locations = [loc for loc in self.locations if loc['name'] != name]
            self.result(action, True, f'deleted {name}')
        elif action == 'clear_all':
            self.locations = []
            self.result(action, True, 'all locations cleared')
        elif action == 'navigate_to_location':
            loc = next((loc for loc in self.locations if loc['name'] == cmd.get('name')), None)
            if loc is None:
                return self.result(action, False, 'unknown location')
            if self.estop:
                return self.result(action, False, 'E-STOP is engaged')
            goal = PoseStamped()
            goal.header.frame_id = self.global_frame
            goal.header.stamp = self.get_clock().now().to_msg()
            goal.pose.position.x, goal.pose.position.y = float(loc['x']), float(loc['y'])
            goal.pose.orientation.z = math.sin(loc['yaw'] / 2.0)
            goal.pose.orientation.w = math.cos(loc['yaw'] / 2.0)
            self.goal_pub.publish(goal)
            self.result(action, True, f'navigating to {loc["name"]}')
            return
        else:
            return
        self.save_locations()
        self.publish_locations()

    # =============================================================== state / health
    def make_counter(self, topic):
        def cb(_msg):
            self.counts[topic] += 1
        return cb

    def publish_state(self):
        names = self.node_names()
        mode = self.mode if self.manage_nav else self.detected_mode(names)
        self.publish_json(self.state_pub, {
            'mode': 'ESTOP' if self.estop else mode,
            'nav_mode': mode,
            'managed': self.manage_nav,
            'estop': self.estop,
            'nav_ready': 'bt_navigator' in names,
            'map': self.current_map,
            'uptime_s': round(time.time() - self.start_wall, 1),
            'use_sim_time': self.use_sim_time,
        })

    def publish_health(self):
        now = time.monotonic()
        dt = max(1e-3, now - self.last_rate_t)
        self.last_rate_t = now
        topics = {}
        for topic, (_, expected, _) in MONITORED.items():
            hz = self.counts[topic] / dt
            self.counts[topic] = 0
            self.rates[topic] = 0.5 * self.rates[topic] + 0.5 * hz
            topics[topic] = {'hz': round(self.rates[topic], 1), 'expected': expected,
                             'ok': self.rates[topic] >= 0.5 * expected}
        topics['map'] = {'hz': None, 'expected': None, 'ok': self.map_seen}
        names = self.node_names()
        temp = read_first('/sys/class/thermal/thermal_zone0/temp')
        mem_total = mem_avail = None
        for line in (read_first('/proc/meminfo', '') or '').splitlines():
            if line.startswith('MemTotal:'):
                mem_total = float(line.split()[1])
            elif line.startswith('MemAvailable:'):
                mem_avail = float(line.split()[1])
        disk = shutil.disk_usage('/')
        self.publish_json(self.health_pub, {
            'topics': topics,
            'nodes': {n: (n in names) for n in WATCH_NODES},
            'system': {
                'cpu_temp_c': round(float(temp) / 1000.0, 1) if temp else None,
                'load': round(os.getloadavg()[0] / (os.cpu_count() or 1), 2),
                'mem_pct': round(100.0 * (1 - mem_avail / mem_total), 1) if mem_total else None,
                'disk_pct': round(100.0 * disk.used / disk.total, 1),
            },
        })

    def shutdown(self):
        if self.manage_nav:
            self.stop_stack()


def main(args=None):
    rclpy.init(args=args)
    node = WebBridge()
    try:
        rclpy.spin(node)
    except KeyboardInterrupt:
        pass
    finally:
        node.shutdown()
        node.destroy_node()
        rclpy.try_shutdown()


if __name__ == '__main__':
    main()
