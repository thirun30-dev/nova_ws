"""Minimal RPLidar A1 driver (legacy SCAN mode) publishing sensor_msgs/LaserScan.

Replaces rplidar_ros on the robot: rplidar_ros 2.1 regularly failed to start scanning on the
Raspberry Pi ('80008000' / OPERATION_TIMEOUT) even when the lidar itself scanned fine with plain
commands. This node uses only those plain commands (STOP, RESET, motor on via DTR, SCAN) and
re-initialises the lidar by itself whenever data stops.

Output matches rplidar_ros with angle_compensate=true, inverted=false, so the URDF/TF, SLAM and
the dashboard need no changes: 360 one-degree bins, ROS angle = 180 deg - lidar angle,
angle_min = pi - 359 deg, angle_max = pi.
"""
import math
import threading
import time

import rclpy
from rclpy.node import Node
from sensor_msgs.msg import LaserScan

try:
    import serial
except ImportError:  # pragma: no cover
    serial = None

STOP = bytes([0xA5, 0x25])
RESET = bytes([0xA5, 0x40])
SCAN = bytes([0xA5, 0x20])
SCAN_DESCRIPTOR = bytes([0xA5, 0x5A, 0x05, 0x00, 0x00, 0x40, 0x81])
BINS = 360


class A1Lidar(Node):

    def __init__(self):
        # same name as rplidar_ros so rplidar.yaml and the dashboard's node health still apply
        super().__init__('rplidar_node')
        p = self.declare_parameter
        self.port = p('serial_port', '/dev/nova_lidar').value
        self.baud = int(p('serial_baudrate', 115200).value)
        self.frame_id = p('frame_id', 'laser_frame').value
        self.inverted = bool(p('inverted', False).value)
        self.range_min = float(p('range_min', 0.15).value)
        self.range_max = float(p('range_max', 12.0).value)
        self.data_timeout = float(p('data_timeout', 3.0).value)
        for name, default in (('channel_type', 'serial'), ('angle_compensate', True),
                              ('scan_mode', 'Standard')):
            p(name, default)                    # accepted for rplidar.yaml compatibility

        self.pub = self.create_publisher(LaserScan, 'scan', 10)
        self.running = True
        self.ser = None
        self.worker = threading.Thread(target=self.loop, daemon=True)
        self.worker.start()
        self.get_logger().info(f'A1 lidar driver on {self.port} @ {self.baud}, frame {self.frame_id}')

    # ------------------------------------------------------------------ serial
    def start_lidar(self):
        ser = serial.Serial(self.port, self.baud, timeout=0.2, write_timeout=1.0)
        ser.write(STOP)
        time.sleep(0.1)
        ser.reset_input_buffer()
        ser.write(RESET)                        # clears a lidar left streaming by a dead session
        banner = b''
        deadline = time.monotonic() + 2.5
        while time.monotonic() < deadline and b'Model' not in banner:
            banner += ser.read(256)
        time.sleep(1.0)
        ser.reset_input_buffer()
        ser.dtr = False                         # A1 adapter: DTR low = motor on
        time.sleep(2.0)                         # spin up
        ser.reset_input_buffer()
        ser.write(SCAN)
        head = ser.read(len(SCAN_DESCRIPTOR))
        if head != SCAN_DESCRIPTOR:
            ser.close()
            raise RuntimeError(f'no scan descriptor (got {head.hex() or "nothing"})')
        self.ser = ser
        self.get_logger().info('lidar scanning')

    def stop_lidar(self):
        ser, self.ser = self.ser, None
        if ser is None:
            return
        try:
            ser.write(STOP)
            time.sleep(0.05)
            ser.dtr = True                      # motor off
            ser.close()
        except Exception:  # noqa: BLE001
            pass

    def loop(self):
        if serial is None:
            self.get_logger().error('pyserial missing: sudo apt install python3-serial')
            return
        while self.running and rclpy.ok():
            try:
                self.start_lidar()
            except Exception as exc:  # noqa: BLE001
                self.get_logger().warn(f'lidar start failed: {exc} - retrying',
                                       throttle_duration_sec=10.0)
                self.stop_lidar()
                time.sleep(2.0)
                continue
            try:
                self.read_scans()
            except Exception as exc:  # noqa: BLE001
                if self.running:
                    self.get_logger().warn(f'lidar read error: {exc} - restarting lidar')
            self.stop_lidar()

    def read_scans(self):
        """Parse 5-byte measurement nodes; publish one LaserScan per revolution."""
        buf = bytearray()
        ranges = [0.0] * BINS
        quals = [0.0] * BINS
        rev_start = None
        last_data = time.monotonic()
        while self.running:
            chunk = self.ser.read(1024)
            now = time.monotonic()
            if chunk:
                buf += chunk
            elif now - last_data > self.data_timeout:
                raise RuntimeError(f'no data for {self.data_timeout:.0f} s')
            i = 0
            n = len(buf)
            while n - i >= 5:
                b0, b1 = buf[i], buf[i + 1]
                start = b0 & 1
                if start == ((b0 >> 1) & 1) or not (b1 & 1):   # bad check bits: resync by 1 byte
                    i += 1
                    continue
                last_data = now
                if start:
                    if rev_start is not None:
                        self.publish(ranges, quals, rev_start)
                    ranges = [0.0] * BINS
                    quals = [0.0] * BINS
                    rev_start = self.get_clock().now()
                angle = ((buf[i + 2] << 7) | (b1 >> 1)) / 64.0          # degrees, clockwise
                dist = ((buf[i + 4] << 8) | buf[i + 3]) / 4000.0        # metres
                if dist > 0.0:
                    k = min(int(angle), BINS - 1)
                    ranges[k] = dist
                    quals[k] = float(b0 >> 2)
                i += 5
            del buf[:i]

    def publish(self, ranges, quals, start_time):
        now = self.get_clock().now()
        scan_time = (now - start_time).nanoseconds * 1e-9
        msg = LaserScan()
        msg.header.stamp = start_time.to_msg()
        msg.header.frame_id = self.frame_id
        msg.angle_min = math.pi - math.radians(BINS - 1)
        msg.angle_max = math.pi
        msg.angle_increment = (msg.angle_max - msg.angle_min) / (BINS - 1)
        msg.scan_time = scan_time
        msg.time_increment = scan_time / (BINS - 1)
        msg.range_min = self.range_min
        msg.range_max = self.range_max
        # rplidar_ros (inverted=false) reverses the bins: index j holds lidar angle 359 - j
        order = range(BINS) if self.inverted else range(BINS - 1, -1, -1)
        msg.ranges = [ranges[k] if ranges[k] > 0.0 else math.inf for k in order]
        msg.intensities = [quals[k] for k in order]
        self.pub.publish(msg)

    def shutdown(self):
        self.running = False
        self.worker.join(timeout=1.0)
        self.stop_lidar()


def main(args=None):
    rclpy.init(args=args)
    node = A1Lidar()
    try:
        rclpy.spin(node)
    except KeyboardInterrupt:
        pass
    finally:
        try:
            node.shutdown()
            node.destroy_node()
        except KeyboardInterrupt:
            pass
        rclpy.try_shutdown()


if __name__ == '__main__':
    main()
