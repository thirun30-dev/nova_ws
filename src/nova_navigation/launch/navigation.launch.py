"""Nav2 for NOVA (localization + navigation), launched node-by-node so we control exactly
which servers run (no docking/collision-monitor surprises).

  ros2 launch nova_navigation navigation.launch.py use_sim_time:=true          # sim, warehouse map
  ros2 launch nova_navigation navigation.launch.py map:=/path/to/my_map.yaml   # real robot
  ros2 launch nova_navigation navigation.launch.py slam:=true                  # navigate while mapping
"""
from launch import LaunchDescription
from launch.actions import DeclareLaunchArgument, GroupAction, IncludeLaunchDescription
from launch.conditions import IfCondition, UnlessCondition
from launch.launch_description_sources import PythonLaunchDescriptionSource
from launch.substitutions import LaunchConfiguration, PathJoinSubstitution
from launch_ros.actions import Node
from launch_ros.substitutions import FindPackageShare


def generate_launch_description():
    pkg = FindPackageShare('nova_navigation')
    use_sim_time = LaunchConfiguration('use_sim_time')
    params = LaunchConfiguration('params_file')
    map_yaml = LaunchConfiguration('map')
    slam = LaunchConfiguration('slam')
    autostart = LaunchConfiguration('autostart')

    common = [params, {'use_sim_time': use_sim_time}]
    tf_remap = [('/tf', 'tf'), ('/tf_static', 'tf_static')]

    localization = GroupAction(
        condition=UnlessCondition(slam),
        actions=[
            Node(package='nav2_map_server', executable='map_server', name='map_server',
                 output='screen', parameters=common + [{'yaml_filename': map_yaml}],
                 remappings=tf_remap),
            Node(package='nav2_amcl', executable='amcl', name='amcl',
                 output='screen', parameters=common, remappings=tf_remap),
            Node(package='nav2_lifecycle_manager', executable='lifecycle_manager',
                 name='lifecycle_manager_localization', output='screen',
                 parameters=[{'use_sim_time': use_sim_time, 'autostart': autostart,
                              'node_names': ['map_server', 'amcl']}]),
        ])

    slam_launch = IncludeLaunchDescription(
        PythonLaunchDescriptionSource(PathJoinSubstitution([pkg, 'launch', 'slam.launch.py'])),
        launch_arguments={'use_sim_time': use_sim_time}.items(),
        condition=IfCondition(slam))

    nav_nodes = [
        'controller_server', 'smoother_server', 'planner_server', 'behavior_server',
        'bt_navigator', 'waypoint_follower', 'velocity_smoother',
    ]
    navigation = GroupAction(actions=[
        Node(package='nav2_controller', executable='controller_server', output='screen',
             parameters=common, remappings=tf_remap + [('cmd_vel', 'cmd_vel_nav')]),
        Node(package='nav2_smoother', executable='smoother_server', name='smoother_server',
             output='screen', parameters=common, remappings=tf_remap),
        Node(package='nav2_planner', executable='planner_server', name='planner_server',
             output='screen', parameters=common, remappings=tf_remap),
        Node(package='nav2_behaviors', executable='behavior_server', name='behavior_server',
             output='screen', parameters=common, remappings=tf_remap + [('cmd_vel', 'cmd_vel_nav')]),
        Node(package='nav2_bt_navigator', executable='bt_navigator', name='bt_navigator',
             output='screen', parameters=common, remappings=tf_remap),
        Node(package='nav2_waypoint_follower', executable='waypoint_follower',
             name='waypoint_follower', output='screen', parameters=common, remappings=tf_remap),
        Node(package='nav2_velocity_smoother', executable='velocity_smoother',
             name='velocity_smoother', output='screen', parameters=common,
             remappings=tf_remap + [('cmd_vel', 'cmd_vel_nav'), ('cmd_vel_smoothed', 'cmd_vel')]),
        Node(package='nav2_lifecycle_manager', executable='lifecycle_manager',
             name='lifecycle_manager_navigation', output='screen',
             parameters=[{'use_sim_time': use_sim_time, 'autostart': autostart,
                          'node_names': nav_nodes}]),
    ])

    return LaunchDescription([
        DeclareLaunchArgument('use_sim_time', default_value='false'),
        DeclareLaunchArgument('params_file',
                              default_value=PathJoinSubstitution([pkg, 'config', 'nav2_params.yaml'])),
        DeclareLaunchArgument('map',
                              default_value=PathJoinSubstitution([pkg, 'maps', 'warehouse.yaml'])),
        DeclareLaunchArgument('slam', default_value='false'),
        DeclareLaunchArgument('autostart', default_value='true'),
        localization, slam_launch, navigation,
    ])
