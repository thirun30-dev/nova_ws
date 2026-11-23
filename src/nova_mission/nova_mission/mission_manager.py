"""NOVA mission manager — the warehouse task layer on top of Nav2.

Services
  ~/submit  (nova_interfaces/SubmitMission)   pickup, dropoff, priority -> mission_id
  ~/cancel  (nova_interfaces/CancelMission)
Topics
  missions/queue    (nova_interfaces/MissionArray)   active + queued + recent, 1 Hz
  missions/metrics  (nova_interfaces/SystemMetrics)  1 Hz
  missions/stations (visualization_msgs/MarkerArray) latched, for RViz / digital twin
Scheduling policies (param `policy`)
  fifo      first come first served
  priority  highest priority first, FIFO within a priority
  nearest   pickup closest to the robot's current pose (falls back to priority w/o TF)
Each finished mission is appended to a CSV in `log_dir` for offline analysis.
"""
import csv
import json
import math
import os
import time
from dataclasses import dataclass

import rclpy
import yaml
from action_msgs.msg import GoalStatus
from ament_index_python.packages import get_package_share_directory
from builtin_interfaces.msg import Time as TimeMsg
from nav2_msgs.action import NavigateToPose
from rclpy.action import ActionClient
from rclpy.node import Node
from rclpy.qos import DurabilityPolicy, QoSProfile, ReliabilityPolicy
from std_msgs.msg import Bool, String
from tf2_ros import Buffer, TransformException, TransformListener
from visualization_msgs.msg import Marker, MarkerArray

from nova_interfaces.msg import Mission, MissionArray, SystemMetrics
from nova_interfaces.srv import CancelMission, SubmitMission

TERMINAL = (Mission.STATE_COMPLETED, Mission.STATE_FAILED, Mission.STATE_CANCELLED)


@dataclass
class Job:
    id: str
    pickup: str
    dropoff: str
    priority: int
    seq: int
    created: float
    state: str = Mission.STATE_QUEUED
    attempts: int = 0
    started: float = 0.0
    finished: float = 0.0


def to_time_msg(t: float) -> TimeMsg:
    sec = int(t)
    return TimeMsg(sec=sec, nanosec=int((t - sec) * 1e9))


class MissionManager(Node):

    def __init__(self):
        super().__init__('mission_manager')
        p = self.declare_parameter
        stations_file = p('stations_file', '').value
        self.policy = p('policy', 'priority').value
        self.load_time = float(p('load_time', 3.0).value)
        self.unload_time = float(p('unload_time', 3.0).value)
        self.max_retries = int(p('max_retries', 1).value)
        self.return_home = bool(p('return_home', True).value)
        self.home = p('home_station', 'home').value
        self.worked = False          # return home only after mission work, not after manual goals
        self.global_frame = p('global_frame', 'map').value
        self.robot_frame = p('robot_frame', 'base_footprint').value
        nav_action = p('nav_action', 'navigate_to_pose').value
        log_dir = os.path.expanduser(p('log_dir', '~/.ros/nova_missions').value)

        if not stations_file:
            stations_file = os.path.join(
                get_package_share_directory('nova_mission'), 'config', 'stations.yaml')
        with open(stations_file) as f:
            self.stations = yaml.safe_load(f)['stations']
        self.get_logger().info(
            f'{len(self.stations)} stations from {stations_file}; policy={self.policy}')

        # mission bookkeeping
        self.jobs: dict[str, Job] = {}
        self.seq = 0
        self.active: Job | None = None
        self.phase = None                 # TO_PICKUP / LOADING / TO_DROPOFF / UNLOADING / HOMING
        self.dwell_until = 0.0
        self.first_submit = None
        self.busy_time = 0.0
        self.last_tick = None
        self.total_distance = 0.0
        self.home_retry_after = 0.0

        # nav goal bookkeeping
        self.nav = ActionClient(self, NavigateToPose, nav_action)
        self.goal_seq = 0
        self.goal_handle = None
        self.nav_state = None             # None | 'running' | 'succeeded' | 'failed'

        self.tf_buffer = Buffer()
        self.tf_listener = TransformListener(self.tf_buffer, self)

        self.create_service(SubmitMission, '~/submit', self.on_submit)
        self.create_service(CancelMission, '~/cancel', self.on_cancel)
        self.queue_pub = self.create_publisher(MissionArray, 'missions/queue', 10)
        self.metrics_pub = self.create_publisher(SystemMetrics, 'missions/metrics', 10)
        latched = QoSProfile(depth=1, durability=DurabilityPolicy.TRANSIENT_LOCAL,
                             reliability=ReliabilityPolicy.RELIABLE)
        self.marker_pub = self.create_publisher(MarkerArray, 'missions/stations', latched)
        self.publish_station_markers()

        # live station edits + E-STOP from nova_web_bridge
        self.paused = False
        self.create_subscription(String, 'nova/locations', self.on_locations, latched)
        self.create_subscription(Bool, 'nova/estop', self.on_estop, latched)

        self.csv_path = None
        try:
            os.makedirs(log_dir, exist_ok=True)
            self.csv_path = os.path.join(log_dir, time.strftime('missions_%Y%m%d_%H%M%S.csv'))
            with open(self.csv_path, 'w', newline='') as f:
                csv.writer(f).writerow(['id', 'pickup', 'dropoff', 'priority', 'state', 'policy',
                                        'created', 'started', 'finished', 'wait_s', 'cycle_s',
                                        'attempts'])
        except OSError as exc:
            self.get_logger().warn(f'mission CSV logging disabled: {exc}')
            self.csv_path = None

        self.create_timer(0.2, self.tick)
        self.create_timer(1.0, self.publish_status)

    # ------------------------------------------------------------------ helpers
    def now(self) -> float:
        return self.get_clock().now().nanoseconds * 1e-9

    def robot_xy(self):
        try:
            t = self.tf_buffer.lookup_transform(self.global_frame, self.robot_frame,
                                                rclpy.time.Time())
            return t.transform.translation.x, t.transform.translation.y
        except TransformException:
            return None

    def dist(self, a: str, b: str) -> float:
        sa, sb = self.stations[a], self.stations[b]
        return math.hypot(sa['x'] - sb['x'], sa['y'] - sb['y'])

    def robot_state(self) -> str:
        if self.paused:
            return 'ESTOP'
        if not self.nav.server_is_ready():
            return 'WAITING_FOR_NAV2'
        return self.phase or 'IDLE'

    # ------------------------------------------------------------------ web bridge inputs
    def on_locations(self, msg: String):
        try:
            locs = json.loads(msg.data)
        except ValueError:
            return
        stations = {}
        for loc in locs:
            try:
                stations[str(loc['name'])] = {'x': float(loc['x']), 'y': float(loc['y']),
                                              'yaw': float(loc.get('yaw', 0.0)),
                                              'type': loc.get('type', 'waypoint')}
            except (KeyError, TypeError, ValueError):
                continue
        if not stations:
            return
        # never drop a station that a live mission still needs
        for j in self.jobs.values():
            if j.state not in TERMINAL:
                for name in (j.pickup, j.dropoff):
                    if name not in stations and name in self.stations:
                        stations[name] = self.stations[name]
        self.stations = stations
        self.publish_station_markers()

    def on_estop(self, msg: Bool):
        if msg.data and not self.paused:
            self.get_logger().warn('E-STOP: missions paused')
            self.cancel_nav()
            if self.phase == 'HOMING':
                self.phase = None
        elif not msg.data and self.paused:
            self.get_logger().info('E-STOP released: missions resume')
        self.paused = msg.data

    # ------------------------------------------------------------------ services
    def on_submit(self, req, res):
        if req.pickup not in self.stations or req.dropoff not in self.stations:
            res.accepted = False
            res.message = f'unknown station; known: {sorted(self.stations)}'
            return res
        if req.pickup == req.dropoff:
            res.accepted = False
            res.message = 'pickup and dropoff must differ'
            return res
        self.seq += 1
        now = self.now()
        job = Job(id=f'M{self.seq:04d}', pickup=req.pickup, dropoff=req.dropoff,
                  priority=int(req.priority), seq=self.seq, created=now)
        self.jobs[job.id] = job
        if self.first_submit is None:
            self.first_submit = now
        res.accepted = True
        res.mission_id = job.id
        res.message = f'queued ({self.queue_length()} waiting)'
        self.get_logger().info(f'{job.id}: {job.pickup} -> {job.dropoff} (p{job.priority}) queued')
        return res

    def on_cancel(self, req, res):
        job = self.jobs.get(req.mission_id)
        if job is None or job.state in TERMINAL:
            res.success = False
            res.message = 'no such active/queued mission'
            return res
        if job is self.active:
            self.cancel_nav()
            self.active = None
            self.phase = None
        self.finish(job, Mission.STATE_CANCELLED)
        res.success = True
        res.message = 'cancelled'
        return res

    # ------------------------------------------------------------------ navigation
    def send_nav(self, station: str):
        st = self.stations[station]
        goal = NavigateToPose.Goal()
        goal.pose.header.frame_id = self.global_frame
        goal.pose.header.stamp = self.get_clock().now().to_msg()
        goal.pose.pose.position.x = float(st['x'])
        goal.pose.pose.position.y = float(st['y'])
        yaw = float(st.get('yaw', 0.0))
        goal.pose.pose.orientation.z = math.sin(yaw / 2.0)
        goal.pose.pose.orientation.w = math.cos(yaw / 2.0)

        self.goal_seq += 1
        seq = self.goal_seq
        self.goal_handle = None
        self.nav_state = 'running'
        fut = self.nav.send_goal_async(goal)
        fut.add_done_callback(lambda f, s=seq: self.on_goal_response(f, s))

    def on_goal_response(self, fut, seq):
        try:
            handle = fut.result()
        except Exception as exc:  # noqa: BLE001
            self.get_logger().error(f'goal send failed: {exc}')
            if seq == self.goal_seq:
                self.nav_state = 'failed'
            return
        if seq != self.goal_seq:                      # superseded while in flight
            if handle.accepted:
                handle.cancel_goal_async()
            return
        if not handle.accepted:
            self.nav_state = 'failed'
            return
        self.goal_handle = handle
        handle.get_result_async().add_done_callback(lambda f, s=seq: self.on_result(f, s))

    def on_result(self, fut, seq):
        if seq != self.goal_seq:
            return
        status = fut.result().status
        self.nav_state = 'succeeded' if status == GoalStatus.STATUS_SUCCEEDED else 'failed'

    def cancel_nav(self):
        self.goal_seq += 1                            # invalidate pending callbacks
        if self.goal_handle is not None:
            self.goal_handle.cancel_goal_async()
        self.goal_handle = None
        self.nav_state = None

    # ------------------------------------------------------------------ scheduling
    def queue_length(self) -> int:
        return sum(1 for j in self.jobs.values() if j.state == Mission.STATE_QUEUED)

    def select_next(self):
        queued = [j for j in self.jobs.values() if j.state == Mission.STATE_QUEUED]
        if not queued:
            return None
        if self.policy == 'fifo':
            return min(queued, key=lambda j: j.seq)
        if self.policy == 'nearest':
            xy = self.robot_xy()
            if xy is not None:
                def d(j):
                    s = self.stations[j.pickup]
                    return math.hypot(s['x'] - xy[0], s['y'] - xy[1])
                return min(queued, key=lambda j: (d(j), j.seq))
        return min(queued, key=lambda j: (-j.priority, j.seq))   # 'priority' (default)

    def home_key(self):
        """Station to return to: exact name, then case-insensitive name, then any type 'home'."""
        if self.home in self.stations:
            return self.home
        for name in self.stations:
            if name.lower() == self.home.lower():
                return name
        for name, st in self.stations.items():
            if st.get('type') == 'home':
                return name
        return None

    def start(self, job: Job):
        self.worked = True
        if self.phase == 'HOMING':
            self.cancel_nav()
        self.active = job
        job.started = self.now()
        job.attempts = 1
        self.set_phase(job, Mission.STATE_TO_PICKUP)
        self.send_nav(job.pickup)
        xy = self.robot_xy()
        if xy is not None:
            s = self.stations[job.pickup]
            self.total_distance += math.hypot(s['x'] - xy[0], s['y'] - xy[1])
        self.get_logger().info(f'{job.id}: dispatched -> {job.pickup}')

    def set_phase(self, job: Job, state: str):
        job.state = state
        self.phase = state

    def finish(self, job: Job, state: str):
        job.state = state
        job.finished = self.now()
        self.get_logger().info(f'{job.id}: {state}')
        if self.csv_path:
            wait = (job.started - job.created) if job.started else ''
            cycle = (job.finished - job.started) if job.started else ''
            try:
                with open(self.csv_path, 'a', newline='') as f:
                    csv.writer(f).writerow([job.id, job.pickup, job.dropoff, job.priority, state,
                                            self.policy, f'{job.created:.3f}', f'{job.started:.3f}',
                                            f'{job.finished:.3f}', wait, cycle, job.attempts])
            except OSError:
                pass

    # ------------------------------------------------------------------ state machine
    def tick(self):
        now = self.now()
        if self.last_tick is not None and self.active is not None:
            self.busy_time += max(0.0, now - self.last_tick)
        self.last_tick = now

        if self.paused or not self.nav.server_is_ready():
            return

        job = self.active
        if job is None:
            nxt = self.select_next()
            if nxt is not None:
                self.start(nxt)
            elif (self.return_home and self.worked and self.phase is None
                  and self.home_key() is not None and now >= self.home_retry_after):
                home = self.home_key()
                xy = self.robot_xy()
                h = self.stations[home]
                if xy is not None and math.hypot(xy[0] - h['x'], xy[1] - h['y']) > 0.3:
                    self.phase = 'HOMING'
                    self.send_nav(home)
                elif xy is not None:
                    self.worked = False      # already home
            elif self.phase == 'HOMING' and self.nav_state in ('succeeded', 'failed'):
                if self.nav_state == 'failed':
                    self.home_retry_after = now + 10.0
                else:
                    self.worked = False      # home again: wait for the next mission
                self.phase = None
                self.nav_state = None
            return

        if job.state in (Mission.STATE_LOADING, Mission.STATE_UNLOADING):
            if now < self.dwell_until:
                return
            if job.state == Mission.STATE_LOADING:
                job.attempts = 1
                self.set_phase(job, Mission.STATE_TO_DROPOFF)
                self.total_distance += self.dist(job.pickup, job.dropoff)
                self.send_nav(job.dropoff)
            else:
                self.finish(job, Mission.STATE_COMPLETED)
                self.active = None
                self.phase = None
            return

        if self.nav_state == 'running':
            return

        target = job.pickup if job.state == Mission.STATE_TO_PICKUP else job.dropoff
        if self.nav_state is None:                    # e.g. resumed after E-STOP
            self.send_nav(target)
        elif self.nav_state == 'succeeded':
            self.nav_state = None
            if job.state == Mission.STATE_TO_PICKUP:
                self.set_phase(job, Mission.STATE_LOADING)
                self.dwell_until = now + self.load_time
            else:
                self.set_phase(job, Mission.STATE_UNLOADING)
                self.dwell_until = now + self.unload_time
        elif self.nav_state == 'failed':
            if job.attempts <= self.max_retries:
                job.attempts += 1
                self.get_logger().warn(f'{job.id}: nav to {target} failed, retry {job.attempts}')
                self.send_nav(target)
            else:
                self.nav_state = None
                self.finish(job, Mission.STATE_FAILED)
                self.active = None
                self.phase = None

    # ------------------------------------------------------------------ publishing
    def job_msg(self, j: Job) -> Mission:
        m = Mission()
        m.id, m.pickup, m.dropoff = j.id, j.pickup, j.dropoff
        m.priority = max(0, min(255, j.priority))
        m.state = j.state
        m.attempts = max(0, min(255, j.attempts))
        m.created = to_time_msg(j.created)
        m.started = to_time_msg(j.started)
        m.finished = to_time_msg(j.finished)
        return m

    def publish_status(self):
        now = self.now()
        jobs = sorted(self.jobs.values(), key=lambda j: j.seq)
        live = [j for j in jobs if j.state not in TERMINAL]
        recent = [j for j in jobs if j.state in TERMINAL][-20:]
        arr = MissionArray()
        arr.stamp = to_time_msg(now)
        arr.missions = [self.job_msg(j) for j in live + recent]
        self.queue_pub.publish(arr)

        done = [j for j in jobs if j.state == Mission.STATE_COMPLETED]
        failed = sum(1 for j in jobs if j.state == Mission.STATE_FAILED)
        started = [j for j in jobs if j.started > 0]
        m = SystemMetrics()
        m.stamp = to_time_msg(now)
        m.policy = self.policy
        m.robot_state = self.robot_state()
        m.active_mission_id = self.active.id if self.active else ''
        m.submitted = len(jobs)
        m.completed = len(done)
        m.failed = failed
        m.cancelled = sum(1 for j in jobs if j.state == Mission.STATE_CANCELLED)
        m.queue_length = self.queue_length()
        elapsed = (now - self.first_submit) if self.first_submit is not None else 0.0
        m.throughput_per_hour = float(len(done) / (elapsed / 3600.0)) if elapsed > 1.0 else 0.0
        m.mean_wait_time_s = float(sum(j.started - j.created for j in started) / len(started)) \
            if started else 0.0
        m.mean_cycle_time_s = float(sum(j.finished - j.started for j in done) / len(done)) \
            if done else 0.0
        m.success_rate = float(len(done) / (len(done) + failed)) if (done or failed) else 0.0
        m.utilization = float(min(1.0, self.busy_time / elapsed)) if elapsed > 1.0 else 0.0
        m.total_distance_m = float(self.total_distance)
        self.metrics_pub.publish(m)

    def publish_station_markers(self):
        arr = MarkerArray()
        clear = Marker()
        clear.action = Marker.DELETEALL
        arr.markers.append(clear)
        for i, (name, s) in enumerate(sorted(self.stations.items())):
            t = s.get('type', '')
            if name == self.home_key() or t == 'home':
                kind = 'home'
            elif t == 'dropoff' or name.startswith('drop'):
                kind = 'drop'
            else:
                kind = 'pick'
            color = {'home': (0.2, 0.8, 0.2), 'drop': (0.9, 0.2, 0.2), 'pick': (0.95, 0.8, 0.1)}[kind]
            pad = Marker()
            pad.header.frame_id = self.global_frame
            pad.ns, pad.id, pad.type = 'stations', i, Marker.CYLINDER
            pad.pose.position.x, pad.pose.position.y = float(s['x']), float(s['y'])
            pad.pose.orientation.w = 1.0
            pad.scale.x = pad.scale.y = 0.4
            pad.scale.z = 0.02
            pad.color.r, pad.color.g, pad.color.b = color
            pad.color.a = 0.8
            label = Marker()
            label.header.frame_id = self.global_frame
            label.ns, label.id, label.type = 'labels', i, Marker.TEXT_VIEW_FACING
            label.pose.position.x, label.pose.position.y = float(s['x']), float(s['y'])
            label.pose.position.z = 0.4
            label.pose.orientation.w = 1.0
            label.scale.z = 0.25
            label.color.r = label.color.g = label.color.b = label.color.a = 1.0
            label.text = name
            arr.markers += [pad, label]
        self.marker_pub.publish(arr)


def main(args=None):
    rclpy.init(args=args)
    node = MissionManager()
    try:
        rclpy.spin(node)
    except KeyboardInterrupt:
        pass
    finally:
        node.destroy_node()
        rclpy.try_shutdown()


if __name__ == '__main__':
    main()
