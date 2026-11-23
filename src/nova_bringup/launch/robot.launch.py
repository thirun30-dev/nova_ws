"""Real NOVA robot bringup (run on the Raspberry Pi 5).

  ros2 launch nova_bringup robot.launch.py              # base + lidar + EKF
  ros2 launch nova_bringup robot.launch.py web:=true    # + dashboard backend; Nav2/SLAM switched from the dashboard
                                                        #   website: http://<robot-ip>:8080 (web/nova_dashboard/dist)
  ros2 launch nova_bringup robot.launch.py use_ekf:=false
"""
import os

from ament_index_python.packages import get_package_share_directory
from launch import LaunchDescription
from launch.actions import DeclareLaunchArgument, IncludeLaunchDescription
from launch.conditions import IfCondition, UnlessCondition
from launch.launch_description_sources import PythonLaunchDescriptionSource
from launch.substitutions import LaunchConfiguration, PathJoinSubstitution
from launch_ros.actions import Node
from launch_ros.substitutions import FindPackageShare


def default_dashboard_dir():
    """<ws>/web/nova_dashboard/dist, found from <ws>/install/nova_bringup/share/nova_bringup."""
    share = get_package_share_directory('nova_bringup')
    ws = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(share))))
    dist = os.path.join(ws, 'web', 'nova_dashboard', 'dist')
    return dist if os.path.isfile(os.path.join(dist, 'index.html')) else ''


def generate_launch_description():
    bringup = FindPackageShare('nova_bringup')
    base_cfg = PathJoinSubstitution([FindPackageShare('nova_base'), 'config', 'base.yaml'])
    lidar_cfg = PathJoinSubstitution([bringup, 'config', 'rplidar.yaml'])
    ekf_cfg = PathJoinSubstitution([bringup, 'config', 'ekf.yaml'])

    use_ekf = LaunchConfiguration('use_ekf')
    lidar = LaunchConfiguration('lidar')
    web = LaunchConfiguration('web')

    rsp = IncludeLaunchDescription(
        PythonLaunchDescriptionSource(PathJoinSubstitution(
            [FindPackageShare('nova_description'), 'launch', 'rsp.launch.py'])),
        launch_arguments={'use_sim_time': 'false', 'sim': 'false'}.items())

    # With EKF: driver publishes wheel/odom, EKF publishes odom + TF.
    base_with_ekf = Node(
        package='nova_base', executable='base_driver', name='nova_base_driver',
        output='screen', parameters=[base_cfg, {'publish_tf': False}],
        remappings=[('odom', 'wheel/odom')],
        condition=IfCondition(use_ekf))
    base_no_ekf = Node(
        package='nova_base', executable='base_driver', name='nova_base_driver',
        output='screen', parameters=[base_cfg, {'publish_tf': True}],
        condition=UnlessCondition(use_ekf))

    ekf = Node(
        package='robot_localization', executable='ekf_node', name='ekf_filter_node',
        output='screen', parameters=[ekf_cfg],
        remappings=[('odometry/filtered', 'odom')],
        condition=IfCondition(use_ekf))

    rplidar = Node(
        # Jazzy's rplidar_ros (2.1.x) ships only 'rplidar_composition'; name kept so rplidar.yaml applies
        package='rplidar_ros', executable='rplidar_composition', name='rplidar_node',
        output='screen', parameters=[lidar_cfg],
        respawn=True, respawn_delay=3.0,   # lidar can fail to spin up at boot ('80008000'); retry
        condition=IfCondition(lidar))

    # dashboard backend: rosbridge (:9090) + nova_web_bridge + website (:8080, if dist/ is built)
    rosbridge = IncludeLaunchDescription(
        PythonLaunchDescriptionSource(PathJoinSubstitution(
            [FindPackageShare('nova_web_bridge'), 'launch', 'web.launch.py'])),
        launch_arguments={'manage_navigation': 'true',
                          'startup_mode': LaunchConfiguration('startup_mode'),
                          'serve_dir': LaunchConfiguration('serve_dir')}.items(),
        condition=IfCondition(web))

    # mission scheduler (waits for Nav2; dispatch from the dashboard's Dispatcher view)
    missions = IncludeLaunchDescription(
        PythonLaunchDescriptionSource(PathJoinSubstitution(
            [FindPackageShare('nova_mission'), 'launch', 'mission.launch.py'])),
        condition=IfCondition(web))

    return LaunchDescription([
        DeclareLaunchArgument('use_ekf', default_value='true',
                              description='Smooth wheel odom with robot_localization (no IMU on this robot)'),
        DeclareLaunchArgument('lidar', default_value='true'),
        DeclareLaunchArgument('web', default_value='false',
                              description='Start the dashboard backend (rosbridge :9090 + nova_web_bridge)'),
        DeclareLaunchArgument('startup_mode', default_value='IDLE',
                              description='With web:=true: IDLE | MAPPING | NAVIGATION at boot'),
        DeclareLaunchArgument('serve_dir', default_value=default_dashboard_dir(),
                              description="With web:=true: built dashboard to serve on :8080 ('' = don't serve)"),
        rsp, base_with_ekf, base_no_ekf, ekf, rplidar, rosbridge, missions,
    ])
