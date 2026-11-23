# nova_ws — NOVA AMR (ROS 2 Jazzy)

Workspace for **NOVA**, a low-cost differential-drive AMR for intelligent warehouse transport:
AMR navigation + mission scheduling + real-time monitoring + digital twin.

**Hardware:** Raspberry Pi 5 (4 GB, official 5 A PSU) · RPLidar A1M8 (own 5 V feed on the adapter's 2nd micro-USB) ·
Arduino Nano · TB6612FNG · 2× N25 6 V 550 RPM encoder motors + ball caster · 2S pack, 5 A fuse ·
3-layer hexagon chassis (23.5 × 21.5 cm, standoffs 5 cm / 6 cm). **No IMU and no battery sensing** on the built robot.

> **Firmware note:** the Nano runs `hiro_base1.ino` (ROSArduinoBridge protocol, 57600 baud, polled
> `e` / `m` commands — sketch kept outside this repo), **not** `src/nova_firmware/nova_llc`. That sketch
> and `src/nova_firmware/README.md` describe the original NOVA-LLC design (IMU, VBAT, streaming) and are
> kept for reference only. `nova_base/base_driver.py` speaks the hiro_base1 protocol.

**Software:** Ubuntu 24.04 · ROS 2 Jazzy · Gazebo Harmonic · Nav2 · SLAM Toolbox · robot_localization.

```
nova_ws/
├── src/
│   ├── nova_description/   URDF/xacro (all dimensions in urdf/properties.xacro), hex mesh, RViz config
│   ├── nova_firmware/      original NOVA-LLC Nano sketch (reference only, not flashed; COLCON_IGNORE)
│   ├── nova_base/          base_driver (hiro_base1 serial: cmd_vel -> wheels, odom, joint_states, wheel_ticks),
│   │                       a1_lidar (own RPLidar A1 driver, default), lidar_reset + scan_watchdog (for rplidar_ros)
│   ├── nova_bringup/       robot.launch.py (real robot), sim_all.launch.py (full digital twin), EKF, lidar
│   ├── nova_gazebo/        warehouse world, ros_gz bridge, sim.launch.py
│   ├── nova_navigation/    Nav2 params (RPP controller), SLAM Toolbox params, warehouse map
│   ├── nova_interfaces/    Mission, MissionArray, SystemMetrics msgs; SubmitMission, CancelMission srvs
│   ├── nova_mission/       mission_manager (queue + fifo/priority/nearest scheduling + KPIs + CSV, return-home), mission_generator
│   └── nova_web_bridge/    dashboard backend: state/health/pose/nav status, locations, maps (~/nova_maps), mode switching, E-STOP
├── web/nova_dashboard/     React + Vite web dashboard (Cockpit / Dispatcher / Analytics) + in-browser demo sim
├── scripts/                setup_pi.sh, setup_laptop.sh, nova_start.sh, nova.service (boot), nova-sudoers,
│                           99-nova.rules (udev: /dev/nova_llc = Nano FTDI, /dev/nova_lidar = CP2102)
└── tools/                  gen_hex_mesh.py, gen_warehouse.py (world + matching map from one layout)
```

## TF tree
```
map ─(AMCL / SLAM)─ odom ─(EKF real | gz DiffDrive sim)─ base_footprint ─ base_link
                                                           ├─ left/right_wheel_link (joint_states)
                                                           ├─ caster_link, imu_link
                                                           ├─ mid_deck_link (Pi 5, power bank)
                                                           └─ top_deck_link ─ lidar_link ─ laser_frame
```

## 1. Build
```bash
cd ~/nova_ws
./scripts/setup_laptop.sh        # laptop: everything incl. Gazebo
./scripts/setup_pi.sh            # Pi: udev rules, dialout group, nova.service, sudoers rule (no Gazebo install;
                                 #     nova_gazebo is still built because nova_bringup depends on it)
# later rebuilds
colcon build --symlink-install && source install/setup.bash
```

## 2. Simulation / digital twin (laptop)
```bash
ros2 launch nova_bringup sim_all.launch.py                    # Gazebo + Nav2 + missions + RViz
ros2 launch nova_bringup sim_all.launch.py generator:=true policy:=nearest
```
Pieces individually: `nova_gazebo sim.launch.py`, `nova_navigation navigation.launch.py use_sim_time:=true`,
`nova_mission mission.launch.py use_sim_time:=true`. Model only: `ros2 launch nova_description display.launch.py`.

Drive by hand: `ros2 run teleop_twist_keyboard teleop_twist_keyboard`

## 3. Missions
```bash
ros2 service call /mission_manager/submit nova_interfaces/srv/SubmitMission "{pickup: pick_a, dropoff: drop_1, priority: 0}"
ros2 service call /mission_manager/submit nova_interfaces/srv/SubmitMission "{pickup: pick_c, dropoff: drop_2, priority: 2}"
ros2 service call /mission_manager/cancel nova_interfaces/srv/CancelMission "{mission_id: M0001}"
ros2 topic echo /missions/metrics          # throughput/h, wait, cycle time, success rate, utilization
ros2 topic echo /missions/queue
```
Stations: `nova_mission/config/stations.yaml`. Every run logs a CSV to `~/.ros/nova_missions/` —
run the generator with the same `seed` under `fifo`, `priority` and `nearest` to compare scheduling policies for the paper.

## 4. Real robot (Pi 5)
1. **Firmware** — the Nano runs `hiro_base1.ino` (see the firmware note above); flash it with the Arduino IDE.
2. **Calibrate** → `nova_base/config/base.yaml` (and keep `nova_description/urdf/properties.xacro` in sync).
   Current values: `wheel_radius: 0.0415` (83 mm tyre), `ticks_per_rev: 779` (1 m tape drive, rescaled to the
   measured radius), `wheel_separation: 0.152` (effective, from a lidar scan-matched 360° turn — the
   tape-measured 0.20 m gives wrong yaw). If you change `wheel_radius`, scale `ticks_per_rev` by the same
   factor, or odometry distance changes.
   `wheel_separation` can be changed live: `ros2 param set /nova_base_driver wheel_separation <m>`.
3. **Bring up** — `./scripts/setup_pi.sh` installs the `nova` systemd service, so after a reboot the Pi starts
   everything by itself (base, lidar, EKF, rosbridge :9090, web bridge, missions, website :8080).
   Open `http://<pi-hostname>.local:8080` and do mapping/navigation from the dashboard (Cockpit → mode
   selector, Drive tab, Maps tab). Wait until Health shows `/scan` (~15 s after start) before switching to
   MAPPING/NAVIGATION — the web bridge refuses the switch while the lidar isn't scanning.
   ```bash
   sudo systemctl status nova | restart nova | stop nova    # restart/stop/start need no password (nova-sudoers)
   journalctl -u nova -f                                    # live log
   ./scripts/nova_start.sh          # by hand (after stopping the service) = robot.launch.py web:=true
   ./scripts/nova_start.sh lidar_driver:=rplidar_ros        # vendor lidar driver instead of nova_base a1_lidar
   ```
4. **Map** — easiest from the dashboard (MAPPING mode, drive **slowly**: fast turns with the ~7.6 Hz lidar
   smear the map; the joystick defaults to 0.5 rad/s). Maps saved from the dashboard go to `~/nova_maps/`.
   From a terminal instead (Pi, or laptop on the same network):
   ```bash
   ros2 launch nova_navigation slam.launch.py
   ros2 run teleop_twist_keyboard teleop_twist_keyboard   # drive slowly around the space
   ros2 run nav2_map_server map_saver_cli -f ~/nova_ws/src/nova_navigation/maps/lab
   ```
5. **Navigate + missions:**
   ```bash
   ros2 launch nova_navigation navigation.launch.py map:=$HOME/nova_ws/src/nova_navigation/maps/lab.yaml
   ros2 launch nova_mission mission.launch.py stations_file:=...   # after recording real station poses
   ```
   Set the start pose with **2D Pose Estimate** in RViz (the AMCL initial pose in `nav2_params.yaml` is the sim's).

RViz on the laptop while the Pi runs the robot: same Wi-Fi, same `ROS_DOMAIN_ID=42` on both, then
`rviz2 -d ~/nova_ws/src/nova_description/rviz/nova.rviz`.

## Web dashboard
Served by the robot itself on `:8080` from `web/nova_dashboard/dist` (rebuild with `npm run build` after
changing the dashboard source). Saved waypoints can be driven to (**Go**) or removed (trash icon, tap twice).
For development:
```bash
ros2 launch nova_bringup robot.launch.py web:=true          # robot: rosbridge :9090 + nova_web_bridge + missions
ros2 launch nova_bringup sim_all.launch.py web:=true        # or the simulation
cd web/nova_dashboard && npm install && npm run dev         # http://localhost:3000
```
See `web/nova_dashboard/README.md` for the full ROS interface. `?demo=1` runs it with no robot.

## Topics
| Topic | Type | From |
|---|---|---|
| `/cmd_vel` | geometry_msgs/Twist | Nav2 velocity_smoother / teleop |
| `/odom` | nav_msgs/Odometry | EKF (real) / gz DiffDrive (sim) |
| `/wheel/odom` | nav_msgs/Odometry | nova_base (raw, when EKF runs) |
| `/scan` | sensor_msgs/LaserScan | nova_base a1_lidar (node `rplidar_node`) or rplidar_ros / gz |
| `/joint_states` | sensor_msgs/JointState | nova_base (10 Hz) |
| `/wheel_ticks` | std_msgs/Int64MultiArray | nova_base |
| `/nova/estop` | std_msgs/Bool | nova_web_bridge → nova_base |
| `/imu/data_raw` | sensor_msgs/Imu | gz only (no IMU on the real robot) |
| `/missions/queue`, `/missions/metrics`, `/missions/stations` | nova_interfaces / MarkerArray | mission_manager |

## Tuning checklist
- [x] `ticks_per_rev` calibrated (779 at r = 41.5 mm, 1 m tape drive)
- [x] Forward = positive ticks on both wheels
- [x] `wheel_separation` — rotate 360° in place, compare `/odom` yaw with the scan (0.152 effective)
- [x] `wheel_radius` measured (83 mm tyre → 0.0415 m)
- [ ] Re-measure tyre centre-to-centre spacing and sync `wheel_separation` in `properties.xacro` (still 0.200)
- [x] Lidar orientation checked — full 360° scan lines up with the robot, `lidar_yaw: 0`
- [x] Nav2 footprint in `nav2_params.yaml` matches the hex chassis (+1 cm margin)
- [ ] Record real station poses for `stations.yaml`; set AMCL initial pose for the lab map

### Nav2 notes (Pi 5)
`nav2_params.yaml` is tuned for the Pi and a small room: controller at 10 Hz, `PoseProgressChecker`
(turning in place counts as progress), RPP `min_approach_linear_velocity: 0.10` (the base stalls below
~0.05 m/s), inflation radius 0.30 m. The mission manager only returns home after it has run a mission,
not after manual goals.

## Troubleshooting
- **Lidar not scanning / `80008000` / `OPERATION_TIMEOUT`** — a known rplidar_ros 2.1 problem on the Pi,
  not hardware. The default `lidar_driver:=nova` (`nova_base a1_lidar`) resets and restarts the lidar
  itself; give it ~15 s after a restart. `ros2 run nova_base lidar_reset` puts the lidar back to idle by hand.
- **Nano "silent"** — usually an orphaned `base_driver` still holding `/dev/nova_llc`:
  `pgrep -af base_driver`, kill it, then restart the service.

## Changing the warehouse
Edit the layout in `tools/gen_warehouse.py`, run `python3 tools/gen_warehouse.py`, rebuild.
World and map are regenerated together so they always match.
