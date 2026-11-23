# Live performance metrics (research KPIs: throughput, scheduling efficiency, reliability)
builtin_interfaces/Time stamp
string policy                  # fifo | priority | nearest
string robot_state             # IDLE, TO_PICKUP, LOADING, TO_DROPOFF, UNLOADING, HOMING, WAITING_FOR_NAV2
string active_mission_id

uint32 submitted
uint32 completed
uint32 failed
uint32 cancelled
uint32 queue_length

float32 throughput_per_hour    # completed missions per hour since first submission
float32 mean_wait_time_s       # created -> started
float32 mean_cycle_time_s      # started -> finished (completed missions)
float32 success_rate           # completed / (completed + failed)
float32 utilization            # fraction of time the robot was busy with a mission
float32 total_distance_m       # odometry-free estimate: sum of straight-line leg lengths
