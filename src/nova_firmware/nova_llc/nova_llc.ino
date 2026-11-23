/*
 * NOVA-LLC firmware  —  Arduino Nano (ATmega328P) on the NOVA-LLC v1 carrier board
 *
 * Wheel-velocity PID + quadrature encoders + MPU9250 + battery sense, over USB serial.
 * Pin map follows the NOVA-LLC v1 PCB:
 *   D2/D3  encoder A (motor A = LEFT)  channel A / B
 *   D4/D5  encoder B (motor B = RIGHT) channel A / B
 *   D6     TB6612 STBY (through E-STOP J7)
 *   D7/D8  AIN1/AIN2      D9  PWMA (Timer1 OC1A, 20 kHz)
 *   D11/D12 BIN1/BIN2     D10 PWMB (Timer1 OC1B, 20 kHz)
 *   A4/A5  I2C to MPU9250 (BSS138 level shift)   A6 VBAT sense (20k/10k divider)
 *
 * Serial protocol (115200 baud, ASCII, one command per line):
 *   host -> nano
 *     m <left_tps> <right_tps>          target wheel speed in encoder ticks/s (closed loop)
 *     o <left_duty> <right_duty>        open-loop duty -1..1 (wiring test; next 'm' or 's' ends it)
 *     s                                 stop (brake)
 *     c <max_tps> <kf> <kp> <ki> <kd>   configure; gains are normalised to max_tps
 *     r                                 reset encoder counts
 *   nano -> host (50 Hz)
 *     e <millis> <left_ticks> <right_ticks> <vbat_mV>
 *     i <ax> <ay> <az> <gx> <gy> <gz>   raw MPU9250 (+-2 g, +-250 dps)
 *     # <text>                          info / debug
 *
 * Safety: motors stop if no 'm'/'o' command arrives for CMD_TIMEOUT_MS.
 *         Duty is capped at MOTOR_VOLTS / VBAT (6 V motors on a 2S pack).
 */

#include <Arduino.h>
#include <Wire.h>
#include "wheel.h"

// ---------------- configuration ----------------
#define LEFT_ENC_INVERT   0     // flip if left ticks count DOWN when the robot drives forward
#define RIGHT_ENC_INVERT  1     // right motor is mirrored, so usually inverted
#define LEFT_MOTOR_INVERT  0    // flip if 'o 0.3 0' spins the left wheel backwards
#define RIGHT_MOTOR_INVERT 1

const float    MOTOR_VOLTS      = 6.0f;
const uint16_t CMD_TIMEOUT_MS   = 500;
const uint16_t LOOP_PERIOD_US   = 20000;   // 50 Hz control + telemetry
const uint16_t PWM_TOP          = 400;     // 16 MHz / (2 * 400) = 20 kHz phase-correct
const uint8_t  MPU_ADDR         = 0x68;

// ---------------- pins ----------------
const uint8_t PIN_STBY = 6;
const uint8_t PIN_AIN1 = 7, PIN_AIN2 = 8, PIN_PWMA = 9;
const uint8_t PIN_BIN1 = 11, PIN_BIN2 = 12, PIN_PWMB = 10;
const uint8_t PIN_VBAT = A6;

// ---------------- encoders (PCINT2 on D2..D5) ----------------
static const int8_t QDEC[16] = {0, -1, 1, 0, 1, 0, 0, -1, -1, 0, 0, 1, 0, 1, -1, 0};
volatile long encL = 0, encR = 0;
volatile uint8_t prevL = 0, prevR = 0;

ISR(PCINT2_vect) {
  uint8_t p = PIND;
  uint8_t sL = (((p >> 2) & 1) << 1) | ((p >> 3) & 1);   // D2=A, D3=B
  uint8_t sR = (((p >> 4) & 1) << 1) | ((p >> 5) & 1);   // D4=A, D5=B
  encL += QDEC[(prevL << 2) | sL];
  encR += QDEC[(prevR << 2) | sR];
  prevL = sL;
  prevR = sR;
}

// ---------------- control state ----------------
Wheel wl, wr;   // struct Wheel is defined in wheel.h

float max_tps = 4000.0f;                  // ticks/s at full speed; host overwrites via 'c'
float kf = 1.0f, kp = 0.8f, ki = 4.0f, kd = 0.0f;
bool  open_loop = false;
float ol_left = 0, ol_right = 0;
unsigned long last_cmd_ms = 0;
float vbat_v = 0;
bool  imu_ok = false;

char  rx_buf[64];
uint8_t rx_len = 0;

// ---------------- motor output ----------------
void setupPwm() {
  pinMode(PIN_PWMA, OUTPUT);
  pinMode(PIN_PWMB, OUTPUT);
  TCCR1A = _BV(COM1A1) | _BV(COM1B1);   // non-inverting on OC1A (D9) / OC1B (D10)
  TCCR1B = _BV(WGM13) | _BV(CS10);      // mode 8: phase & freq correct, TOP = ICR1, no prescaler
  ICR1 = PWM_TOP;
  OCR1A = 0;
  OCR1B = 0;
}

float maxDuty() {
  if (vbat_v < 3.0f) return 0.7f;        // battery not present / USB only
  float d = MOTOR_VOLTS / vbat_v;
  return d > 1.0f ? 1.0f : d;
}

void driveMotor(uint8_t in1, uint8_t in2, volatile uint16_t &ocr, float duty, bool invert) {
  if (invert) duty = -duty;
  if (duty > 1.0f) duty = 1.0f;
  if (duty < -1.0f) duty = -1.0f;
  duty *= maxDuty();
  if (duty > 0.001f) {
    digitalWrite(in1, HIGH); digitalWrite(in2, LOW);
  } else if (duty < -0.001f) {
    digitalWrite(in1, LOW); digitalWrite(in2, HIGH);
    duty = -duty;
  } else {
    digitalWrite(in1, HIGH); digitalWrite(in2, HIGH);   // short brake
    duty = 0;
  }
  ocr = (uint16_t)(duty * PWM_TOP);
}

void setMotors(float left, float right) {
  driveMotor(PIN_AIN1, PIN_AIN2, OCR1A, left, LEFT_MOTOR_INVERT);
  driveMotor(PIN_BIN1, PIN_BIN2, OCR1B, right, RIGHT_MOTOR_INVERT);
}

void resetPid(Wheel &w) {
  w.integ = 0;
  w.prev_vel = w.vel_f;
}

void stopAll() {
  wl.target_tps = wr.target_tps = 0;
  open_loop = false;
  resetPid(wl);
  resetPid(wr);
  setMotors(0, 0);
}

// One PID step; returns normalised duty (-1..1)
float pidStep(Wheel &w, long ticks, float dt) {
  float measured = (ticks - w.last_ticks) / dt;
  w.last_ticks = ticks;
  w.vel_f = 0.6f * w.vel_f + 0.4f * measured;

  float tgt = w.target_tps / max_tps;
  float vel = w.vel_f / max_tps;

  if (w.target_tps == 0 && fabs(vel) < 0.02f) {
    w.integ = 0;
    w.prev_vel = vel;
    return 0;
  }
  float err = tgt - vel;
  w.integ += err * dt;
  float ilim = (ki > 0) ? 0.5f / ki : 0;
  if (w.integ > ilim) w.integ = ilim;
  if (w.integ < -ilim) w.integ = -ilim;
  float deriv = (vel - w.prev_vel) / dt;
  w.prev_vel = vel;
  float out = kf * tgt + kp * err + ki * w.integ - kd * deriv;
  if (out > 1) out = 1;
  if (out < -1) out = -1;
  return out;
}

// ---------------- IMU (MPU9250 accel/gyro, no library) ----------------
void imuWrite(uint8_t reg, uint8_t val) {
  Wire.beginTransmission(MPU_ADDR);
  Wire.write(reg);
  Wire.write(val);
  Wire.endTransmission();
}

bool imuInit() {
  Wire.beginTransmission(MPU_ADDR);
  Wire.write(0x75);                       // WHO_AM_I
  if (Wire.endTransmission(false) != 0) return false;
  if (Wire.requestFrom(MPU_ADDR, (uint8_t)1) != 1) return false;
  uint8_t who = Wire.read();
  if (who == 0x00 || who == 0xFF) return false;
  imuWrite(0x6B, 0x01);                   // wake, PLL clock
  delay(10);
  imuWrite(0x1A, 0x03);                   // DLPF 41 Hz
  imuWrite(0x1B, 0x00);                   // gyro +-250 dps
  imuWrite(0x1C, 0x00);                   // accel +-2 g
  imuWrite(0x1D, 0x03);                   // accel DLPF 41 Hz
  Serial.print(F("# imu who_am_i 0x"));
  Serial.println(who, HEX);
  return true;
}

void imuReadAndSend() {
  Wire.beginTransmission(MPU_ADDR);
  Wire.write(0x3B);
  if (Wire.endTransmission(false) != 0) return;
  if (Wire.requestFrom(MPU_ADDR, (uint8_t)14) != 14) return;
  int16_t v[7];
  for (uint8_t k = 0; k < 7; k++) v[k] = (Wire.read() << 8) | Wire.read();
  Serial.print('i');
  for (uint8_t k = 0; k < 7; k++) {
    if (k == 3) continue;                 // skip temperature
    Serial.print(' ');
    Serial.print(v[k]);
  }
  Serial.println();
}

// ---------------- serial commands ----------------
void handleLine(char *line) {
  char *cmd = strtok(line, " ");
  if (!cmd) return;
  switch (cmd[0]) {
    case 'm': {
      char *a = strtok(NULL, " "), *b = strtok(NULL, " ");
      if (!a || !b) return;
      if (open_loop) { open_loop = false; resetPid(wl); resetPid(wr); }
      wl.target_tps = atof(a);
      wr.target_tps = atof(b);
      last_cmd_ms = millis();
      break;
    }
    case 'o': {
      char *a = strtok(NULL, " "), *b = strtok(NULL, " ");
      if (!a || !b) return;
      open_loop = true;
      ol_left = atof(a);
      ol_right = atof(b);
      last_cmd_ms = millis();
      break;
    }
    case 's':
      stopAll();
      break;
    case 'r':
      noInterrupts(); encL = encR = 0; interrupts();
      wl.last_ticks = wr.last_ticks = 0;
      break;
    case 'c': {
      char *t[5];
      for (uint8_t k = 0; k < 5; k++) { t[k] = strtok(NULL, " "); if (!t[k]) return; }
      float m = atof(t[0]);
      if (m > 10) max_tps = m;
      kf = atof(t[1]); kp = atof(t[2]); ki = atof(t[3]); kd = atof(t[4]);
      resetPid(wl); resetPid(wr);
      Serial.println(F("# config ok"));
      break;
    }
    default:
      break;
  }
}

void pollSerial() {
  while (Serial.available()) {
    char ch = Serial.read();
    if (ch == '\n' || ch == '\r') {
      if (rx_len) {
        rx_buf[rx_len] = 0;
        handleLine(rx_buf);
        rx_len = 0;
      }
    } else if (rx_len < sizeof(rx_buf) - 1) {
      rx_buf[rx_len++] = ch;
    } else {
      rx_len = 0;                         // overflow: drop line
    }
  }
}

// ---------------- setup / loop ----------------
void setup() {
  Serial.begin(115200);

  pinMode(PIN_STBY, OUTPUT);
  pinMode(PIN_AIN1, OUTPUT); pinMode(PIN_AIN2, OUTPUT);
  pinMode(PIN_BIN1, OUTPUT); pinMode(PIN_BIN2, OUTPUT);
  setupPwm();
  setMotors(0, 0);
  digitalWrite(PIN_STBY, HIGH);           // E-STOP J7 can still pull STBY low in hardware

  for (uint8_t p = 2; p <= 5; p++) pinMode(p, INPUT_PULLUP);
  prevL = (((PIND >> 2) & 1) << 1) | ((PIND >> 3) & 1);
  prevR = (((PIND >> 4) & 1) << 1) | ((PIND >> 5) & 1);
  PCMSK2 |= _BV(PCINT18) | _BV(PCINT19) | _BV(PCINT20) | _BV(PCINT21);
  PCICR  |= _BV(PCIE2);

  Wire.begin();
  Wire.setClock(400000);
#if defined(WIRE_HAS_TIMEOUT)
  Wire.setWireTimeout(3000, true);
#endif
  imu_ok = imuInit();
  if (!imu_ok) Serial.println(F("# imu not found"));

  vbat_v = analogRead(PIN_VBAT) * (15.0f / 1023.0f);
  Serial.println(F("# nova_llc ready"));
}

void loop() {
  static unsigned long last_us = micros();
  pollSerial();

  unsigned long now_us = micros();
  if ((unsigned long)(now_us - last_us) < LOOP_PERIOD_US) return;
  float dt = (now_us - last_us) * 1e-6f;
  last_us = now_us;

  long tL, tR;
  noInterrupts(); tL = encL; tR = encR; interrupts();
  if (LEFT_ENC_INVERT)  tL = -tL;
  if (RIGHT_ENC_INVERT) tR = -tR;

  // battery: A6 * 5 V / 1023 * 3 (20k/10k divider), low-pass filtered
  float v = analogRead(PIN_VBAT) * (15.0f / 1023.0f);
  vbat_v = 0.9f * vbat_v + 0.1f * v;

  if (millis() - last_cmd_ms > CMD_TIMEOUT_MS && (wl.target_tps != 0 || wr.target_tps != 0 || open_loop)) {
    stopAll();
    Serial.println(F("# watchdog stop"));
  }

  float dL = pidStep(wl, tL, dt);
  float dR = pidStep(wr, tR, dt);
  if (open_loop) { dL = ol_left; dR = ol_right; }
  setMotors(dL, dR);

  Serial.print('e'); Serial.print(' ');
  Serial.print(millis()); Serial.print(' ');
  Serial.print(tL); Serial.print(' ');
  Serial.print(tR); Serial.print(' ');
  Serial.println((long)(vbat_v * 1000));

  if (imu_ok) imuReadAndSend();
}
