"""NOVA base driver: bridges ROS 2 and the Arduino Nano running hiro_base1.ino over USB serial.

The Nano speaks the ROSArduinoBridge protocol (57600 baud, commands end with '\\r'):
    e          -> "<left_ticks> <right_ticks>"
    r          -> reset encoders, "OK"
    m <l> <r>  -> closed-loop target in encoder ticks per PID frame (1 / pid_rate s), "OK"
    b          -> baud rate (used as a liveness check)
It only answers when asked, so this node polls it at poll_rate.

Subscribes:  cmd_vel (geometry_msgs/Twist), nova/estop (std_msgs/Bool)
Publishes:   odom (nav_msgs/Odometry), joint_states, wheel_ticks (std_msgs/Int64MultiArray)
TF:          odom -> base_footprint (only if publish_tf is true)
No IMU and no battery sensing on this hardware.
"""
import math
import threading
import time

import rclpy
from geometry_msgs.msg import TransformStamped, Twist
from nav_msgs.msg import Odometry
from rcl_interfaces.msg import SetParametersResult
from rclpy.node import Node
from rclpy.qos import DurabilityPolicy, QoSProfile, ReliabilityPolicy
from sensor_msgs.msg import JointState
from std_msgs.msg import Bool, Int64MultiArray
from tf2_ros import TransformBroadcaster

try:
    import serial
except ImportError:  # pragma: no cover
    serial = None

TWO_PI = 2.0 * math.pi


class BaseDriver(Node):

    def __init__(self):
        super().__init__('nova_base_driver')

        p = self.declare_parameter
        self.port = p('port', '/dev/nova_llc').value
        self.baud = int(p('baud', 57600).value)
        self.r = float(p('wheel_radius', 0.0415).value)
        self.sep = float(p('wheel_separation', 0.200).value)
        self.tpr = float(p('ticks_per_rev', 610.0).value)
        self.max_rpm = float(p('max_motor_rpm', 550.0).value)
        self.pid_rate = float(p('pid_rate', 30.0).value)      # must match PID_RATE in the sketch
        self.cmd_timeout = float(p('cmd_timeout', 0.5).value)
        self.poll_rate = float(p('poll_rate', 30.0).value)
        self.publish_tf = bool(p('publish_tf', False).value)
        self.odom_frame = p('odom_frame', 'odom').value
        self.base_frame = p('base_frame', 'base_footprint').value
        self.left_joint = p('left_wheel_joint', 'left_wheel_joint').value
        self.right_joint = p('right_wheel_joint', 'right_wheel_joint').value

        self.max_wheel_w = self.max_rpm / 60.0 * TWO_PI * 0.9   # leave 10 % headroom for PID

        self.odom_pub = self.create_publisher(Odometry, 'odom', 20)
        self.js_pub = self.create_publisher(JointState, 'joint_states', 20)
        self.ticks_pub = self.create_publisher(Int64MultiArray, 'wheel_ticks', 10)
        self.tf_bc = TransformBroadcaster(self) if self.publish_tf else None
        self.create_subscription(Twist, 'cmd_vel', self.on_cmd_vel, 10)
        latched = QoSProfile(depth=1, durability=DurabilityPolicy.TRANSIENT_LOCAL,
                             reliability=ReliabilityPolicy.RELIABLE)
        self.estop = False
        self.create_subscription(Bool, 'nova/estop', self.on_estop, latched)

        # odometry state
        self.x = self.y = self.th = 0.0
        self.last_ticks = None
        self.last_t = None

        # command state (written by ROS callbacks, read by the serial thread)
        self.target_w = (0.0, 0.0)
        self.last_cmd = 0.0

        self.ser = None
        self.running = True
        self.worker = threading.Thread(target=self.serial_loop, daemon=True)
        self.worker.start()

        self.get_logger().info(
            f'NOVA base driver (hiro_base1): port={self.port} baud={self.baud} r={self.r} '
            f'sep={self.sep} tpr={self.tpr} tf={self.publish_tf}')
        self.add_on_set_parameters_callback(self.on_set_params)

    # calibration can be tuned live: ros2 param set /nova_base_driver wheel_separation 0.15
    LIVE = {'wheel_radius': 'r', 'wheel_separation': 'sep', 'ticks_per_rev': 'tpr'}

    def on_set_params(self, params):
        updates = {}
        for prm in params:
            if prm.name in self.LIVE:
                try:
                    val = float(prm.value)
                except (TypeError, ValueError):
                    return SetParametersResult(successful=False, reason=f'{prm.name} must be a number')
                if val <= 0.0:
                    return SetParametersResult(successful=False, reason=f'{prm.name} must be > 0')
                updates[self.LIVE[prm.name]] = val
        for attr, val in updates.items():
            setattr(self, attr, val)
        if updates:
            self.get_logger().info(f'calibration now r={self.r} sep={self.sep} tpr={self.tpr}')
        return SetParametersResult(successful=True)

    # ------------------------------------------------------------------ ROS callbacks
    def on_estop(self, msg: Bool):
        if msg.data != self.estop:
            self.get_logger().warn('E-STOP ENGAGED' if msg.data else 'E-STOP released')
        self.estop = msg.data
        if self.estop:
            self.target_w = (0.0, 0.0)

    def on_cmd_vel(self, msg: Twist):
        if self.estop:
            return
        v, w = msg.linear.x, msg.angular.z
        wl = (v - w * self.sep / 2.0) / self.r
        wr = (v + w * self.sep / 2.0) / self.r
        peak = max(abs(wl), abs(wr))
        if peak > self.max_wheel_w:            # scale both, keep the curvature
            k = self.max_wheel_w / peak
            wl, wr = wl * k, wr * k
        self.target_w = (wl, wr)
        self.last_cmd = time.monotonic()

    def target_ticks_per_frame(self):
        wl, wr = self.target_w
        if self.estop or time.monotonic() - self.last_cmd > self.cmd_timeout:
            return 0, 0
        k = self.tpr / TWO_PI / self.pid_rate   # rad/s -> ticks per PID frame
        return round(wl * k), round(wr * k)    # firmware parses integers (atol)

    # ------------------------------------------------------------------ serial
    def transact(self, cmd: str) -> str:
        """Send one command, return its one-line reply ('' on timeout)."""
        self.ser.write((cmd + '\r').encode('ascii'))
        return self.ser.readline().decode('ascii', errors='ignore').strip()

    def open_serial(self):
        ser = serial.Serial(self.port, self.baud, timeout=0.1)
        time.sleep(2.5)                        # opening the port resets the Nano (bootloader)
        ser.reset_input_buffer()
        self.ser = ser
        reply = self.transact('b')
        if reply != str(self.baud):
            self.close_serial()
            raise RuntimeError(f"no reply from the Nano (sent 'b', got {reply!r}) - "
                               'is hiro_base1 flashed and the board powered?')
        self.transact('r')                     # start odometry from zero
        self.last_ticks = None
        self.get_logger().info(f'connected to hiro_base1 on {self.port}')

    def close_serial(self):
        ser, self.ser = self.ser, None
        if ser is not None:
            try:
                ser.close()
            except Exception:  # noqa: BLE001
                pass

    def serial_loop(self):
        if serial is None:
            self.get_logger().error('pyserial missing: sudo apt install python3-serial')
            return
        period = 1.0 / self.poll_rate
        next_t = time.monotonic()
        while self.running and rclpy.ok():
            if self.ser is None:
                try:
                    self.open_serial()
                except Exception as exc:  # noqa: BLE001
                    self.get_logger().warn(f'cannot use {self.port}: {exc}',
                                           throttle_duration_sec=5.0)
                    time.sleep(2.0)
                    continue
                next_t = time.monotonic()
            try:
                tl, tr = self.target_ticks_per_frame()
                self.transact(f'm {tl} {tr}')  # also feeds the firmware's 2 s auto-stop
                reply = self.transact('e')
            except Exception as exc:  # noqa: BLE001
                if not self.running:          # port closed by stop() during shutdown
                    break
                self.get_logger().warn(f'serial error: {exc}')
                self.close_serial()
                continue
            try:
                left, right = (int(v) for v in reply.split())
                self.on_encoders(left, right, time.monotonic())
            except ValueError:
                self.get_logger().debug(f'bad encoder reply: {reply!r}')

            next_t += period
            delay = next_t - time.monotonic()
            if delay > 0:
                time.sleep(delay)
            else:
                next_t = time.monotonic()      # fell behind; don't try to catch up

    # ------------------------------------------------------------------ telemetry
    def on_encoders(self, tl, tr, t):
        stamp = self.get_clock().now().to_msg()
        ticks_msg = Int64MultiArray()
        ticks_msg.data = [tl, tr]
        self.ticks_pub.publish(ticks_msg)

        if self.last_ticks is None:
            self.last_ticks, self.last_t = (tl, tr), t
            return
        dtl, dtr = tl - self.last_ticks[0], tr - self.last_ticks[1]
        dt = t - self.last_t
        self.last_ticks, self.last_t = (tl, tr), t
        if dt <= 0.0 or dt > 0.5:
            return

        k = TWO_PI * self.r / self.tpr
        dl, dr = dtl * k, dtr * k
        dc = 0.5 * (dl + dr)
        dth = (dr - dl) / self.sep
        self.x += dc * math.cos(self.th + 0.5 * dth)
        self.y += dc * math.sin(self.th + 0.5 * dth)
        self.th = math.atan2(math.sin(self.th + dth), math.cos(self.th + dth))

        qz, qw = math.sin(self.th / 2.0), math.cos(self.th / 2.0)

        odom = Odometry()
        odom.header.stamp = stamp
        odom.header.frame_id = self.odom_frame
        odom.child_frame_id = self.base_frame
        odom.pose.pose.position.x = self.x
        odom.pose.pose.position.y = self.y
        odom.pose.pose.orientation.z = qz
        odom.pose.pose.orientation.w = qw
        odom.twist.twist.linear.x = dc / dt
        odom.twist.twist.angular.z = dth / dt
        pc = [0.0] * 36
        pc[0] = pc[7] = 0.01
        pc[14] = pc[21] = pc[28] = 1e6
        pc[35] = 0.05
        tc = [0.0] * 36
        tc[0] = 0.002
        tc[7] = 0.001
        tc[14] = tc[21] = tc[28] = 1e6
        tc[35] = 0.02
        odom.pose.covariance = pc
        odom.twist.covariance = tc
        self.odom_pub.publish(odom)

        if self.tf_bc is not None:
            tf = TransformStamped()
            tf.header.stamp = stamp
            tf.header.frame_id = self.odom_frame
            tf.child_frame_id = self.base_frame
            tf.transform.translation.x = self.x
            tf.transform.translation.y = self.y
            tf.transform.rotation.z = qz
            tf.transform.rotation.w = qw
            self.tf_bc.sendTransform(tf)

        self.js_count = getattr(self, 'js_count', 0) + 1
        if self.js_count % 3:                  # wheel joint states at 10 Hz: they only animate
            return                             # the wheels, and every update costs /tf traffic
        js = JointState()
        js.header.stamp = stamp
        js.name = [self.left_joint, self.right_joint]
        js.position = [tl / self.tpr * TWO_PI, tr / self.tpr * TWO_PI]
        js.velocity = [dtl / self.tpr * TWO_PI / dt, dtr / self.tpr * TWO_PI / dt]
        self.js_pub.publish(js)

    # ------------------------------------------------------------------ shutdown
    def stop(self):
        self.running = False
        self.worker.join(timeout=1.0)          # let the serial thread finish its exchange
        if self.ser is not None:
            try:
                self.transact('m 0 0')         # brake
            except Exception:  # noqa: BLE001
                pass
        self.close_serial()


def main(args=None):
    rclpy.init(args=args)
    node = BaseDriver()
    try:
        rclpy.spin(node)
    except KeyboardInterrupt:
        pass
    finally:
        try:
            node.stop()
            node.destroy_node()
        except KeyboardInterrupt:     # second SIGINT from ros2 launch during cleanup
            pass
        rclpy.try_shutdown()


if __name__ == '__main__':
    main()
