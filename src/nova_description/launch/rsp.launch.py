"""robot_state_publisher for NOVA. Included by the sim and real-robot launch files."""
from launch import LaunchDescription
from launch.actions import DeclareLaunchArgument
from launch.substitutions import Command, LaunchConfiguration, PathJoinSubstitution
from launch_ros.actions import Node
from launch_ros.parameter_descriptions import ParameterValue
from launch_ros.substitutions import FindPackageShare


def generate_launch_description():
    use_sim_time = LaunchConfiguration('use_sim_time')
    sim = LaunchConfiguration('sim')

    xacro_file = PathJoinSubstitution(
        [FindPackageShare('nova_description'), 'urdf', 'nova.urdf.xacro'])
    robot_description = ParameterValue(
        Command(['xacro ', xacro_file, ' sim:=', sim]), value_type=str)

    return LaunchDescription([
        DeclareLaunchArgument('use_sim_time', default_value='false'),
        DeclareLaunchArgument('sim', default_value='false',
                              description='Include Gazebo plugins/sensors in the URDF'),
        Node(
            package='robot_state_publisher',
            executable='robot_state_publisher',
            output='screen',
            parameters=[{
                'robot_description': robot_description,
                'use_sim_time': use_sim_time,
                'publish_frequency': 30.0,
            }],
        ),
    ])
