"""One command for the full digital twin on the laptop:
Gazebo warehouse + NOVA + Nav2 (on the pre-built warehouse map) + mission manager + RViz.

  ros2 launch nova_bringup sim_all.launch.py
  ros2 launch nova_bringup sim_all.launch.py generator:=true      # auto-generate missions
  ros2 launch nova_bringup sim_all.launch.py policy:=nearest web:=true
"""
from launch import LaunchDescription
from launch.actions import DeclareLaunchArgument, IncludeLaunchDescription, TimerAction
from launch.conditions import IfCondition
from launch.launch_description_sources import PythonLaunchDescriptionSource
from launch.substitutions import LaunchConfiguration, PathJoinSubstitution
from launch_ros.substitutions import FindPackageShare


def generate_launch_description():
    def launch_file(pkg, name):
        return PythonLaunchDescriptionSource(
            PathJoinSubstitution([FindPackageShare(pkg), 'launch', name]))

    sim = IncludeLaunchDescription(
        launch_file('nova_gazebo', 'sim.launch.py'),
        launch_arguments={'rviz': LaunchConfiguration('rviz')}.items())

    nav = IncludeLaunchDescription(
        launch_file('nova_navigation', 'navigation.launch.py'),
        launch_arguments={'use_sim_time': 'true'}.items())

    mission = IncludeLaunchDescription(
        launch_file('nova_mission', 'mission.launch.py'),
        launch_arguments={
            'use_sim_time': 'true',
            'policy': LaunchConfiguration('policy'),
            'generator': LaunchConfiguration('generator'),
        }.items())

    # dashboard backend: rosbridge (:9090) + nova_web_bridge
    rosbridge = IncludeLaunchDescription(
        PythonLaunchDescriptionSource(PathJoinSubstitution(
            [FindPackageShare('nova_web_bridge'), 'launch', 'web.launch.py'])),
        launch_arguments={'use_sim_time': 'true', 'manage_navigation': 'false'}.items(),
        condition=IfCondition(LaunchConfiguration('web')))

    return LaunchDescription([
        DeclareLaunchArgument('rviz', default_value='true'),
        DeclareLaunchArgument('policy', default_value='priority',
                              description='fifo | priority | nearest'),
        DeclareLaunchArgument('generator', default_value='false',
                              description='Auto-generate random missions'),
        DeclareLaunchArgument('web', default_value='false'),
        sim,
        TimerAction(period=6.0, actions=[nav]),        # let Gazebo + clock come up first
        TimerAction(period=12.0, actions=[mission]),
        rosbridge,
    ])
