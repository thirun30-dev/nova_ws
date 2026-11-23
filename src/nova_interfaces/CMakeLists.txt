cmake_minimum_required(VERSION 3.8)
project(nova_interfaces)

find_package(ament_cmake REQUIRED)
find_package(rosidl_default_generators REQUIRED)
find_package(builtin_interfaces REQUIRED)

rosidl_generate_interfaces(${PROJECT_NAME}
  "msg/Mission.msg"
  "msg/MissionArray.msg"
  "msg/SystemMetrics.msg"
  "srv/SubmitMission.srv"
  "srv/CancelMission.srv"
  "srv/SetMode.srv"
  "srv/MapOperation.srv"
  DEPENDENCIES builtin_interfaces
)

ament_export_dependencies(rosidl_default_runtime)
ament_package()
