# nova_ws — NOVA AMR (ROS 2 Jazzy)

Workspace for **NOVA**, a low-cost differential-drive AMR for intelligent warehouse transport:
AMR navigation + mission scheduling + real-time monitoring + digital twin.

**Hardware:** Raspberry Pi 5 (4 GB) · RPLidar A1M8 · Arduino Nano on the NOVA-LLC v1 board ·
TB6612FNG · 2× N25 6 V 550 RPM encoder motors + ball caster · MPU9250 · 2S pack, 5 A fuse ·
3-layer hexagon chassis (23.5 × 21.5 cm, standoffs 5 cm / 6 cm).

**Software:** Ubuntu 24.04 · ROS 2 Jazzy · Gazebo Harmonic · Nav2 · SLAM Toolbox · robot_localization.

```
nova_ws/
├── src/
│   ├── nova_description/   URDF/xacro (all dimensions in urdf/properties.xacro), hex mesh, RViz config
│   ├── nova_firmware/      Arduino Nano sketch: 20 kHz PWM, 4x quadrature, wheel PID, IMU, VBAT (COLCON_IGNORE)
│   ├── nova_base/          Pi-side serial driver: cmd_vel -> wheels, odom, joint_states, imu, battery
│   ├── nova_bringup/       robot.launch.py (real robot), sim_all.launch.py (full digital twin), EKF, lidar
│   ├── nova_gazebo/        warehouse world, ros_gz bridge, sim.launch.py
│   ├── nova_navigation/    Nav2 params (RPP controller), SLAM Toolbox params, warehouse map
│   ├── nova_interfaces/    Mission, MissionArray, SystemMetrics msgs; SubmitMission, CancelMission srvs
│   ├── nova_mission/       mission_manager (queue + fifo/priority/nearest scheduling + KPIs + CSV), mission_generator
│   └── nova_web_bridge/    dashboard backend: state/health/pose/nav status, locations, maps, mode switching, E-STOP
├── web/nova_dashboard/     React + Vite web dashboard (Cockpit / Dispatcher / Analytics) + in-browser demo sim
├── scripts/                setup_pi.sh, setup_laptop.sh, 99-nova.rules (udev: /dev/nova_llc, /dev/nova_lidar)
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
./scripts/setup_pi.sh            # Pi: no Gazebo, installs udev rules
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
1. **Firmware** — flash `src/nova_firmware/nova_llc/nova_llc.ino`, do the bench test and tick calibration in `src/nova_firmware/README.md`.
2. **Measure** wheel radius, wheel separation, caster position → `nova_description/urdf/properties.xacro` and `nova_base/config/base.yaml`.
3. **Bring up** — `./scripts/setup_pi.sh` installs the `nova` systemd service, so after a reboot the Pi starts
   everything by itself (base, lidar, EKF, rosbridge :9090, web bridge, missions, website :8080).
   Open `http://<pi-hostname>.local:8080` and do mapping/navigation from the dashboard (Cockpit → mode
   selector, Drive tab, Maps tab). By hand instead: `sudo systemctl stop nova`, then
   ```bash
   ./scripts/nova_start.sh          # = ros2 launch nova_bringup robot.launch.py web:=true
   ```
4. **Map** (Pi, or laptop on the same network):
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
| `/scan` | sensor_msgs/LaserScan | rplidar_ros / gz |
| `/imu/data_raw` | sensor_msgs/Imu | nova_base / gz |
| `/battery` | sensor_msgs/BatteryState | nova_base |
| `/wheel_ticks` | std_msgs/Int64MultiArray | nova_base |
| `/missions/queue`, `/missions/metrics`, `/missions/stations` | nova_interfaces / MarkerArray | mission_manager |

## Tuning checklist
- [ ] `ticks_per_rev` calibrated (10-turn test)
- [ ] Motor + encoder invert flags set in firmware (forward = positive ticks on both)
- [ ] `wheel_radius`, `wheel_separation` measured — drive 1 m with teleop, compare `/odom`
- [ ] Rotate 360° in place — if `/odom` yaw is off, adjust `wheel_separation`
- [ ] Lidar orientation — if the scan is rotated 180° in RViz, set `lidar_yaw` to `${pi}` in properties.xacro
- [ ] IMU axes — `imu_rpy` in properties.xacro matches how the MPU9250 sits on the LLC board
- [ ] Nav2 footprint in `nav2_params.yaml` matches the real outline incl. wheels

## Changing the warehouse
Edit the layout in `tools/gen_warehouse.py`, run `python3 tools/gen_warehouse.py`, rebuild.
World and map are regenerated together so they always match.
