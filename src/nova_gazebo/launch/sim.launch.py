"""NOVA in the Gazebo Harmonic warehouse.

  ros2 launch nova_gazebo sim.launch.py
  ros2 launch nova_gazebo sim.launch.py headless:=true rviz:=false
"""
import os

from ament_index_python.packages import get_package_share_directory
from launch import LaunchDescription
from launch.actions import (AppendEnvironmentVariable, DeclareLaunchArgument,
                            IncludeLaunchDescription)
from launch.conditions import IfCondition, UnlessCondition
from launch.launch_description_sources import PythonLaunchDescriptionSource
from launch.substitutions import LaunchConfiguration
from launch_ros.actions import Node


def generate_launch_description():
    gz_pkg = get_package_share_directory('nova_gazebo')
    desc_pkg = get_package_share_directory('nova_description')
    ros_gz_sim = get_package_share_directory('ros_gz_sim')

    world = LaunchConfiguration('world')
    x, y, yaw = LaunchConfiguration('x'), LaunchConfiguration('y'), LaunchConfiguration('yaw')

    gz_launch = os.path.join(ros_gz_sim, 'launch', 'gz_sim.launch.py')
    gz_gui = IncludeLaunchDescription(
        PythonLaunchDescriptionSource(gz_launch),
        launch_arguments={'gz_args': ['-r -v 2 ', world], 'on_exit_shutdown': 'true'}.items(),
        condition=UnlessCondition(LaunchConfiguration('headless')))
    gz_headless = IncludeLaunchDescription(
        PythonLaunchDescriptionSource(gz_launch),
        launch_arguments={'gz_args': ['-r -s -v 2 ', world], 'on_exit_shutdown': 'true'}.items(),
        condition=IfCondition(LaunchConfiguration('headless')))

    rsp = IncludeLaunchDescription(
        PythonLaunchDescriptionSource(os.path.join(desc_pkg, 'launch', 'rsp.launch.py')),
        launch_arguments={'use_sim_time': 'true', 'sim': 'true'}.items())

    spawn = Node(
        package='ros_gz_sim', executable='create', output='screen',
        arguments=['-name', 'nova', '-topic', 'robot_description',
                   '-x', x, '-y', y, '-z', '0.02', '-Y', yaw])

    bridge = Node(
        package='ros_gz_bridge', executable='parameter_bridge', output='screen',
        parameters=[{'config_file': os.path.join(gz_pkg, 'config', 'gz_bridge.yaml'),
                     'use_sim_time': True}])

    rviz = Node(
        package='rviz2', executable='rviz2', output='screen',
        arguments=['-d', os.path.join(desc_pkg, 'rviz', 'nova.rviz')],
        parameters=[{'use_sim_time': True}],
        condition=IfCondition(LaunchConfiguration('rviz')))

    return LaunchDescription([
        DeclareLaunchArgument('world', default_value=os.path.join(gz_pkg, 'worlds', 'warehouse.sdf')),
        DeclareLaunchArgument('headless', default_value='false'),
        DeclareLaunchArgument('rviz', default_value='true'),
        DeclareLaunchArgument('x', default_value='-5.0'),
        DeclareLaunchArgument('y', default_value='0.0'),
        DeclareLaunchArgument('yaw', default_value='0.0'),
        # lets Gazebo resolve package://nova_description/meshes/...
        AppendEnvironmentVariable('GZ_SIM_RESOURCE_PATH', os.path.dirname(desc_pkg)),
        gz_gui, gz_headless, rsp, spawn, bridge, rviz,
    ])
