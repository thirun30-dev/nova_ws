"""Mission manager (+ optional random generator).

  ros2 launch nova_mission mission.launch.py
  ros2 launch nova_mission mission.launch.py use_sim_time:=true policy:=nearest generator:=true
"""
from launch import LaunchDescription
from launch.actions import DeclareLaunchArgument
from launch.conditions import IfCondition
from launch.substitutions import LaunchConfiguration, PathJoinSubstitution
from launch_ros.actions import Node
from launch_ros.substitutions import FindPackageShare


def generate_launch_description():
    cfg = PathJoinSubstitution([FindPackageShare('nova_mission'), 'config', 'mission.yaml'])
    use_sim_time = LaunchConfiguration('use_sim_time')

    return LaunchDescription([
        DeclareLaunchArgument('use_sim_time', default_value='false'),
        DeclareLaunchArgument('policy', default_value='priority',
                              description='fifo | priority | nearest'),
        DeclareLaunchArgument('generator', default_value='false'),
        DeclareLaunchArgument('stations_file', default_value='',
                              description='Station YAML (empty = package default)'),
        Node(package='nova_mission', executable='mission_manager', name='mission_manager',
             output='screen',
             parameters=[cfg, {'use_sim_time': use_sim_time,
                               'policy': LaunchConfiguration('policy'),
                               'stations_file': LaunchConfiguration('stations_file')}]),
        Node(package='nova_mission', executable='mission_generator', name='mission_generator',
             output='screen', parameters=[cfg, {'use_sim_time': use_sim_time}],
             condition=IfCondition(LaunchConfiguration('generator'))),
    ])
