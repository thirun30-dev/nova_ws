"""Restart a hung lidar driver.

rplidar_ros 2.1 sometimes hangs after "RESULT_OPERATION_TIMEOUT" at startup instead of exiting,
so the launch file's respawn never fires. If no scan arrives for `timeout` seconds, this node
interrupts the driver process and resets the lidar; robot.launch.py (respawn=True) then starts
a fresh driver.
"""
import os
import signal
import time

import rclpy
from rclpy.node import Node
from rclpy.qos import qos_profile_sensor_data
from sensor_msgs.msg import LaserScan

from nova_base.lidar_reset import reset_lidar


def find_pids(exe_suffix):
    """PIDs whose executable path (argv[0]) ends with exe_suffix."""
    pids = []
    for entry in os.listdir('/proc'):
        if not entry.isdigit():
            continue
        try:
            with open(f'/proc/{entry}/cmdline', 'rb') as f:
                argv0 = f.read().split(b'\0', 1)[0].decode(errors='ignore')
        except OSError:
            continue
        if argv0.endswith(exe_suffix):
            pids.append(int(entry))
    return pids


def alive(pid):
    try:
        os.kill(pid, 0)
        return True
    except OSError:
        return False


class ScanWatchdog(Node):

    def __init__(self):
        super().__init__('scan_watchdog')
        self.timeout = float(self.declare_parameter('timeout', 10.0).value)
        self.grace = float(self.declare_parameter('grace', 25.0).value)    # driver start-up time
        self.exe = self.declare_parameter('driver_executable',
                                          '/rplidar_ros/rplidar_composition').value
        self.port = self.declare_parameter('port', '/dev/nova_lidar').value
        now = time.monotonic()
        self.last_scan = now
        self.last_restart = now                    # first action only after `grace` (driver retries first)
        self.ok_logged = False
        self.create_subscription(LaserScan, 'scan', self.on_scan, qos_profile_sensor_data)
        self.create_timer(1.0, self.check)

    def on_scan(self, _msg):
        self.last_scan = time.monotonic()
        if not self.ok_logged:
            self.get_logger().info('lidar scans arriving')
            self.ok_logged = True

    def check(self):
        now = time.monotonic()
        if now - self.last_scan < self.timeout or now - self.last_restart < self.grace:
            return
        pids = find_pids(self.exe)
        self.last_restart = now
        self.ok_logged = False
        if not pids:
            self.get_logger().warn('no lidar scans and no driver process (waiting for respawn)')
            return
        self.get_logger().warn(f'no lidar scans for {now - self.last_scan:.0f} s - '
                               f'restarting lidar driver (pid {pids})')
        for pid in pids:
            try:
                os.kill(pid, signal.SIGINT)
            except OSError:
                pass
        deadline = time.monotonic() + 5.0
        while any(alive(p) for p in pids) and time.monotonic() < deadline:
            time.sleep(0.2)
        for pid in pids:
            if alive(pid):
                try:
                    os.kill(pid, signal.SIGKILL)
                except OSError:
                    pass
        # clear a lidar left streaming; the launch respawns the driver 5 s after it died
        reset_lidar(self.port, log=self.get_logger().info)


def main(args=None):
    rclpy.init(args=args)
    node = ScanWatchdog()
    try:
        rclpy.spin(node)
    except KeyboardInterrupt:
        pass
    finally:
        node.destroy_node()
        rclpy.try_shutdown()


if __name__ == '__main__':
    main()
