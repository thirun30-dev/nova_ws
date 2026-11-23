"""Dashboard backend: rosbridge websocket (:9090) + nova_web_bridge (+ optional static file server).

  ros2 launch nova_web_bridge web.launch.py                              # sim / nav launched elsewhere
  ros2 launch nova_web_bridge web.launch.py manage_navigation:=true      # robot: dashboard switches modes
  ros2 launch nova_web_bridge web.launch.py serve_dir:=$HOME/nova_ws/web/nova_dashboard/dist
      -> open http://<robot-ip>:8080
"""
from launch import LaunchDescription
from launch.actions import DeclareLaunchArgument, ExecuteProcess, IncludeLaunchDescription
from launch.conditions import IfCondition
from launch.launch_description_sources import AnyLaunchDescriptionSource
from launch.substitutions import LaunchConfiguration, PathJoinSubstitution, PythonExpression
from launch_ros.actions import Node
from launch_ros.substitutions import FindPackageShare


def generate_launch_description():
    cfg = PathJoinSubstitution([FindPackageShare('nova_web_bridge'), 'config', 'web_bridge.yaml'])
    serve_dir = LaunchConfiguration('serve_dir')

    rosbridge = IncludeLaunchDescription(
        AnyLaunchDescriptionSource(PathJoinSubstitution(
            [FindPackageShare('rosbridge_server'), 'launch', 'rosbridge_websocket_launch.xml'])),
        launch_arguments={'port': LaunchConfiguration('port')}.items())

    bridge = Node(
        package='nova_web_bridge', executable='web_bridge', name='nova_web_bridge', output='screen',
        parameters=[cfg, {
            'use_sim_time': LaunchConfiguration('use_sim_time'),
            'manage_navigation': LaunchConfiguration('manage_navigation'),
            'startup_mode': LaunchConfiguration('startup_mode'),
        }])

    static = ExecuteProcess(
        cmd=['python3', '-m', 'http.server', LaunchConfiguration('http_port'), '-d', serve_dir],
        output='screen',
        condition=IfCondition(PythonExpression(["'", serve_dir, "' != ''"])))

    return LaunchDescription([
        DeclareLaunchArgument('use_sim_time', default_value='false'),
        DeclareLaunchArgument('manage_navigation', default_value='false'),
        DeclareLaunchArgument('startup_mode', default_value='IDLE'),
        DeclareLaunchArgument('port', default_value='9090'),
        DeclareLaunchArgument('serve_dir', default_value='',
                              description='Built dashboard (dist/) to serve over HTTP'),
        DeclareLaunchArgument('http_port', default_value='8080'),
        rosbridge, bridge, static,
    ])
