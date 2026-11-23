#!/usr/bin/env bash
# One-time setup on the Ubuntu 24.04 laptop (simulation, RViz, mission dashboard).
# Usage: cd ~/nova_ws && ./scripts/setup_laptop.sh
set -euo pipefail
WS="$(cd "$(dirname "$0")/.." && pwd)"

sudo apt update
sudo apt install -y \
  python3-colcon-common-extensions python3-rosdep python3-serial python3-yaml \
  ros-jazzy-xacro ros-jazzy-robot-state-publisher ros-jazzy-joint-state-publisher \
  ros-jazzy-joint-state-publisher-gui ros-jazzy-rviz2 \
  ros-jazzy-ros-gz \
  ros-jazzy-navigation2 ros-jazzy-nav2-bringup ros-jazzy-slam-toolbox \
  ros-jazzy-robot-localization ros-jazzy-rplidar-ros \
  ros-jazzy-rosbridge-suite ros-jazzy-teleop-twist-keyboard

set +u; source /opt/ros/jazzy/setup.bash; set -u   # ROS setup files use unset variables
cd "$WS"
colcon build --symlink-install

grep -q "nova_ws/install/setup.bash" ~/.bashrc || cat >> ~/.bashrc <<'EOF'
source /opt/ros/jazzy/setup.bash
source ~/nova_ws/install/setup.bash
export ROS_DOMAIN_ID=42
EOF

echo "Done. Open a new terminal and run:"
echo "  ros2 launch nova_bringup sim_all.launch.py"
