#!/usr/bin/env bash
# One-time setup on the Raspberry Pi 5 (Ubuntu 24.04 + ROS 2 Jazzy already installed).
# Usage: cd ~/nova_ws && ./scripts/setup_pi.sh
set -euo pipefail
WS="$(cd "$(dirname "$0")/.." && pwd)"

sudo apt update
sudo apt install -y \
  python3-colcon-common-extensions python3-rosdep python3-serial python3-yaml \
  ros-jazzy-xacro ros-jazzy-robot-state-publisher ros-jazzy-joint-state-publisher \
  ros-jazzy-rplidar-ros ros-jazzy-robot-localization \
  ros-jazzy-navigation2 ros-jazzy-slam-toolbox \
  ros-jazzy-rosbridge-suite ros-jazzy-teleop-twist-keyboard

sudo usermod -aG dialout "$USER"
sudo cp "$WS/scripts/99-nova.rules" /etc/udev/rules.d/
sudo udevadm control --reload-rules && sudo udevadm trigger

source /opt/ros/jazzy/setup.bash
cd "$WS"
# Gazebo is not needed on the robot
colcon build --symlink-install --packages-skip nova_gazebo

grep -q "nova_ws/install/setup.bash" ~/.bashrc || cat >> ~/.bashrc <<'EOF'
source /opt/ros/jazzy/setup.bash
source ~/nova_ws/install/setup.bash
export ROS_DOMAIN_ID=42
EOF

# Web dashboard: served from web/nova_dashboard/dist on :8080.
# Build it here if Node.js is installed; otherwise copy dist/ over from the laptop.
DASH="$WS/web/nova_dashboard"
if command -v npm >/dev/null; then
  (cd "$DASH" && npm ci && npm run build)
elif [ ! -f "$DASH/dist/index.html" ]; then
  echo "WARNING: no Node.js and no $DASH/dist - the website won't be served."
  echo "         On the laptop: cd web/nova_dashboard && npm run build, then copy dist/ to the Pi."
fi

# Start everything at boot
chmod +x "$WS/scripts/nova_start.sh"
sed -e "s|@USER@|$USER|g" -e "s|@WS@|$WS|g" "$WS/scripts/nova.service" \
  | sudo tee /etc/systemd/system/nova.service >/dev/null
sudo systemctl daemon-reload
sudo systemctl enable nova.service

echo "Done. Plug in the Nano + lidar and reboot:  sudo reboot"
echo "After boot, open  http://$(hostname).local:8080  (or http://<pi-ip>:8080) on a phone/laptop on the same Wi-Fi."
echo "  status: sudo systemctl status nova     log: journalctl -u nova -f"
