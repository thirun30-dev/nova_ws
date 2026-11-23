"""Build a map with SLAM Toolbox.

  ros2 launch nova_navigation slam.launch.py                      # real robot
  ros2 launch nova_navigation slam.launch.py use_sim_time:=true   # Gazebo
Save:  ros2 run nav2_map_server map_saver_cli -f ~/nova_ws/src/nova_navigation/maps/my_map
"""
from launch import LaunchDescription
from launch.actions import DeclareLaunchArgument, IncludeLaunchDescription
from launch.launch_description_sources import PythonLaunchDescriptionSource
from launch.substitutions import LaunchConfiguration, PathJoinSubstitution
from launch_ros.substitutions import FindPackageShare


def generate_launch_description():
    params = PathJoinSubstitution(
        [FindPackageShare('nova_navigation'), 'config', 'slam_toolbox.yaml'])
    slam = IncludeLaunchDescription(
        PythonLaunchDescriptionSource(PathJoinSubstitution(
            [FindPackageShare('slam_toolbox'), 'launch', 'online_async_launch.py'])),
        launch_arguments={
            'use_sim_time': LaunchConfiguration('use_sim_time'),
            'slam_params_file': LaunchConfiguration('slam_params_file'),
        }.items())

    return LaunchDescription([
        DeclareLaunchArgument('use_sim_time', default_value='false'),
        DeclareLaunchArgument('slam_params_file', default_value=params),
        slam,
    ])
