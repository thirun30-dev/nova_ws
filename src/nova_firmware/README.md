# nova_firmware — NOVA-LLC (Arduino Nano)

Not a ROS package (`COLCON_IGNORE` keeps colcon away). Flash `nova_llc/nova_llc.ino` to the Nano.

## Flash
Arduino IDE: Board **Arduino Nano**, Processor **ATmega328P (Old Bootloader)** for most clones → Upload.

arduino-cli:
```bash
arduino-cli core install arduino:avr
arduino-cli compile --fqbn arduino:avr:nano:cpu=atmega328old nova_llc
arduino-cli upload  --fqbn arduino:avr:nano:cpu=atmega328old -p /dev/ttyUSB0 nova_llc
```

## Bench test (wheels off the ground!)
Open a serial monitor at 115200, line ending "Newline":

| Send | Expect |
|---|---|
| (nothing) | `e ...` lines at 50 Hz, `i ...` lines if the IMU answered |
| `o 0.3 0` | left wheel spins **forward** — if backwards, flip `LEFT_MOTOR_INVERT` |
| `o 0 0.3` | right wheel spins forward — else flip `RIGHT_MOTOR_INVERT` |
| while spinning forward | that wheel's tick count in `e` **increases** — else flip `*_ENC_INVERT` |
| `s` | brake |
| `m 1000 1000` | closed-loop: both wheels at 1000 ticks/s (stops after 0.5 s without a new command) |

## Calibrate ticks per revolution
Send `r`, turn one wheel exactly 10 turns by hand, read its tick count from `e`, divide by 10.
Put that number in `nova_base/config/base.yaml → ticks_per_rev`. Decoding is 4x quadrature
(4 × encoder PPR × gear ratio).

## Things to double-check against NOVA-LLC v1
- Encoder A connector = left motor (motor A on the TB6612). If your wiring is the other way, swap the motor plugs or swap the invert flags/sides in the base driver.
- N25 encoder wire order (VCC/GND/A/B) before powering.
- The firmware caps duty at 6 V / VBAT, so a full 8.4 V pack drives the motors at ~71 % PWM max.
