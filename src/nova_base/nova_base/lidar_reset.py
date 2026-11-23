"""Put an RPLidar A1 back into a clean idle state before its ROS driver connects.

If a previous session ended abruptly (driver killed, power blip), the lidar can be left
streaming scan data. rplidar_ros 2.1 then hangs or fails with '80008000' / OPERATION_TIMEOUT
on connect. STOP + RESET clears that; the lidar reboots and prints its banner.

    ros2 run nova_base lidar_reset [port]      # default /dev/nova_lidar
"""
import sys
import time

STOP = bytes([0xA5, 0x25])
RESET = bytes([0xA5, 0x40])
SCAN = bytes([0xA5, 0x20])


def reset_lidar(port='/dev/nova_lidar', baud=115200, log=print):
    """Returns True if the lidar answered the reset with its banner."""
    try:
        import serial
    except ImportError:
        log('lidar_reset: pyserial missing')
        return False
    try:
        with serial.Serial(port, baud, timeout=0.2, write_timeout=1.0) as s:
            s.write(STOP)
            time.sleep(0.1)
            s.reset_input_buffer()
            s.write(RESET)
            banner = b''
            deadline = time.monotonic() + 2.5
            while time.monotonic() < deadline and b'Model' not in banner:
                banner += s.read(256)
            time.sleep(1.0)                      # let it finish booting
            s.reset_input_buffer()
            # Warm-up scan: on the Pi the driver's first scan after a bare reset times out,
            # but succeeds once the lidar has spun up and scanned once.
            warm = 0
            for _ in range(2):
                s.dtr = False                    # A1 adapter: DTR low = motor on
                time.sleep(2.0)
                s.reset_input_buffer()
                s.write(SCAN)
                t_end = time.monotonic() + 3.0
                while time.monotonic() < t_end:
                    warm += len(s.read(4096))
                s.write(STOP)
                time.sleep(0.2)
                s.reset_input_buffer()
                if warm > 1000:
                    break
            s.dtr = True                         # motor off; the driver restarts it
    except Exception as exc:  # noqa: BLE001
        log(f'lidar_reset: cannot reset {port}: {exc}')
        return False
    ok = b'RP LIDAR' in banner
    log(f'lidar_reset: {port} reset {"OK" if ok else "sent (no banner)"}, warm-up scan {warm} bytes')
    return ok


def main():
    port = sys.argv[1] if len(sys.argv) > 1 and not sys.argv[1].startswith('--') else '/dev/nova_lidar'
    reset_lidar(port)
    return 0      # never block the launch on this


if __name__ == '__main__':
    sys.exit(main())
