# One warehouse transport mission: go to pickup, load, go to dropoff, unload.

string STATE_QUEUED=QUEUED
string STATE_TO_PICKUP=TO_PICKUP
string STATE_LOADING=LOADING
string STATE_TO_DROPOFF=TO_DROPOFF
string STATE_UNLOADING=UNLOADING
string STATE_COMPLETED=COMPLETED
string STATE_FAILED=FAILED
string STATE_CANCELLED=CANCELLED

string id
string pickup                      # station name (nova_mission/config/stations.yaml)
string dropoff
uint8 priority                     # 0 = normal, higher = more urgent
string state
uint8 attempts                     # navigation attempts used on the current leg
builtin_interfaces/Time created
builtin_interfaces/Time started    # zero until dispatched
builtin_interfaces/Time finished   # zero until terminal
