#!/usr/bin/env bash
# Starts the whole robot: base + lidar + EKF + rosbridge (:9090) + web bridge + missions + website (:8080).
# Run by the nova.service systemd unit at boot (see setup_pi.sh); also fine to run by hand.
# Extra arguments are passed to the launch, e.g.  ./scripts/nova_start.sh startup_mode:=MAPPING
WS="$(cd "$(dirname "$0")/.." && pwd)"
source /opt/ros/jazzy/setup.bash
source "$WS/install/setup.bash"
export ROS_DOMAIN_ID="${ROS_DOMAIN_ID:-42}"
exec ros2 launch nova_bringup robot.launch.py web:=true "$@"
