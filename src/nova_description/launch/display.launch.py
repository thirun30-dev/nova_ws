"""View the NOVA model in RViz with joint sliders:  ros2 launch nova_description display.launch.py"""
from launch import LaunchDescription
from launch.actions import DeclareLaunchArgument, IncludeLaunchDescription
from launch.conditions import IfCondition, UnlessCondition
from launch.launch_description_sources import PythonLaunchDescriptionSource
from launch.substitutions import LaunchConfiguration, PathJoinSubstitution
from launch_ros.actions import Node
from launch_ros.substitutions import FindPackageShare


def generate_launch_description():
    pkg = FindPackageShare('nova_description')
    gui = LaunchConfiguration('gui')

    return LaunchDescription([
        DeclareLaunchArgument('gui', default_value='true',
                              description='Use joint_state_publisher_gui sliders'),
        IncludeLaunchDescription(
            PythonLaunchDescriptionSource(PathJoinSubstitution([pkg, 'launch', 'rsp.launch.py']))),
        Node(package='joint_state_publisher_gui', executable='joint_state_publisher_gui',
             condition=IfCondition(gui)),
        Node(package='joint_state_publisher', executable='joint_state_publisher',
             condition=UnlessCondition(gui)),
        Node(package='rviz2', executable='rviz2', output='screen',
             arguments=['-d', PathJoinSubstitution([pkg, 'rviz', 'nova.rviz']),
                        '-f', 'base_footprint']),
    ])
