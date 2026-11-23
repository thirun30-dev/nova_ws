#pragma once

// Kept in a header so Arduino's auto-generated function prototypes
// (inserted after the #includes in nova_llc.ino) can see this type.
struct Wheel {
  float target_tps = 0, vel_f = 0, integ = 0, prev_vel = 0;
  long last_ticks = 0;
};
