# NOVA dashboard + 3D site

Two pages, one Vite project, dark sci-fi theme:
- **`index.html` — control dashboard** with a **3D digital twin** (2D/3D toggle on every map)
- **`showcase.html` — 3D project website**: scroll-driven NOVA model on a holographic turntable, exploded
  4-layer hardware view, live lidar sweep, architecture, research focus, features/specs, link to the live demo

3D is drawn by a small built-in WebGL renderer (`src/gl/`) — no three.js. The NOVA model in `src/gl/novaModel.js`
uses the same dimensions as `nova_description/urdf/properties.xacro`; change both together.

React + Vite web dashboard for the NOVA AMR. Talks to ROS 2 through **rosbridge** (own tiny client,
no roslib) and to the robot-side backend **`nova_web_bridge`**. Includes an in-browser **demo simulator**
(same warehouse, A* planner, lidar ray-casting, SLAM-style map reveal, mission scheduler) so it runs with no robot.

## Views
| View | What's on it |
|---|---|
| **Cockpit** | Mode selector (IDLE / MAPPING / NAVIGATION + map), NOVA status tiles, quick-navigate bar, live map (occupancy, costmap, lidar, Nav2 plan, trail, stations; tools: pan, nav goal with heading, pose estimate, drop pin, zoom, follow, fullscreen), side tabs: **Drive** (joystick + WASD), **POIs**, **Maps** (save / pose graph / load / delete), **Health** (topic rates, nodes, Pi CPU temp/load/mem/disk) |
| **Dispatcher** | New mission (pickup → dropoff, priority), batch ×5, active mission stepper, live queue with cancel, fleet map |
| **3D twin** (Cockpit & Dispatcher, 3D toggle) | Map extruded into walls, floor from the occupancy grid, live NOVA model (spinning lidar), lidar points + rays, Nav2 plan ribbon, trail, stations as light beacons, floating labels. Cameras: orbit / chase / top. Nav-goal and pose-estimate tools pick on the floor. "NOVA ×3" enlarges the robot for overview |
| **Analytics** | Throughput/h, mean wait, mean cycle, success rate, utilization, distance; time-series charts; outcomes; station usage; CSV export |

Header: link status + rosbridge URL, warehouse SOP checklist, **E-STOP / RESET**. Scrolling telemetry ticker. Mobile bottom nav.

## Run
```bash
cd ~/nova_ws/web/nova_dashboard
npm install
npm run dev                  # http://localhost:3000  (or http://<laptop-ip>:3000 from a phone)
NOVA_DEMO=1 npm run dev      # start in demo mode by default
npm run build                # static site in dist/ (dist/index.html + dist/showcase.html)
# showcase: http://localhost:3000/showcase.html
```
Robot side (Pi):
```bash
ros2 launch nova_bringup robot.launch.py web:=true                 # rosbridge :9090 + nova_web_bridge (manages Nav2/SLAM) + missions
# serve the built dashboard from the Pi as well:
ros2 launch nova_web_bridge web.launch.py manage_navigation:=true serve_dir:=$HOME/nova_ws/web/nova_dashboard/dist
# -> http://nova.local:8080
```
Simulation (laptop): `ros2 launch nova_bringup sim_all.launch.py web:=true` then `npm run dev`.

### Choosing the robot
The dashboard connects to `ws://<page host>:9090` by default. Override with the link menu in the header,
or `?ros=ws://nova.local:9090` in the URL. `?demo=1` forces the simulator, `?demo=0` forces live.

## ROS interface (all provided by `nova_web_bridge` unless noted)
| Dir | Name | Type |
|---|---|---|
| ← | `/nova/system_state`, `/nova/health`, `/nova/nav_status`, `/nova/locations`, `/nova/maps`, `/nova/operation_result` | std_msgs/String (JSON) |
| ← | `/nova/robot_pose` | geometry_msgs/PoseStamped |
| ← | `/map`, `/global_costmap/costmap` (Nav2), `/scan`, `/plan`, `/odom`, `/battery` (nova_base) | standard |
| ← | `/missions/queue`, `/missions/metrics` (nova_mission) | nova_interfaces |
| → | `/cmd_vel`, `/goal_pose`, `/initialpose`, `/nova/location_command` | topics |
| → | `/nova/set_mode`, `/nova/map_operation` | nova_interfaces srv |
| → | `/nova/emergency_stop`, `/nova/reset_emergency_stop`, `/nova/cancel_navigation` | std_srvs/Trigger |
| → | `/mission_manager/submit`, `/mission_manager/cancel` | nova_interfaces srv |

E-STOP publishes latched `/nova/estop`: `nova_base` stops the motors and ignores `cmd_vel`, Nav2 goals are cancelled,
the mission manager pauses and resumes the current leg on reset.

## Layout
```
src/
  ros/rosbridge.js      websocket client (subscribe/throttle, publish, services, reconnect)
  ros/realSource.js     ROS topics/services -> plain JS objects
  ros/demoSource.js     in-browser simulator with the same interface
  ros/warehouse.js      warehouse layout (mirrors tools/gen_warehouse.py)
  hooks/useNova.js      state, history, notices, actions
  gl/engine.js          WebGL renderer: meshes, lines/points, textured floor, picking, orbit camera
  gl/novaModel.js       NOVA 3D model (4 layers, explode, lidar spin)
  showcase/             3D website (Showcase.jsx, Scene.js, showcase.css)
  components/           Twin3D, MapPanel (2D/3D toggle), Header, Ticker, MapViewer, ModeSelector, RobotStatus, WaypointBar,
                        Teleop, Locations, Maps, Health, SopModal, LineChart, ui
  views/                Cockpit, Dispatcher, Analytics
```
