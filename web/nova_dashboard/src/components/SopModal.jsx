import React, { useState } from 'react';
import { LuBookOpenCheck, LuX } from 'react-icons/lu';

const SOP = [
  {
    title: '1 · Pre-operation checks',
    items: [
      'Aisles clear of people, loose pallets and cables along the planned routes',
      'Battery ≥ 7.2 V (2S) on the dashboard; 5 A fuse seated; power bank charged for the Pi 5',
      'RPLidar spinning freely, top deck secure, standoffs tight',
      'Physical E-STOP switch (J7) tested: motors cut when pressed',
      'Dashboard ONLINE; Health tab shows /scan, /odom, /imu green',
    ],
  },
  {
    title: '2 · Mapping a new area',
    items: [
      'Switch to MAPPING mode',
      'Drive slowly (≤ 0.2 m/s) with teleop; overlap loops so SLAM can close them',
      'Save the map and the pose graph with a descriptive name',
      'Load the new map in NAVIGATION mode and set the pose estimate',
    ],
  },
  {
    title: '3 · Autonomous missions',
    items: [
      'Pose estimate matches reality (LiDAR dots line up with the walls)',
      'Stations (pickup / dropoff / home) saved at reachable, open positions',
      'Submit missions from the Dispatcher; watch the first run end to end',
      'Keep a person within reach of the E-STOP during demos',
    ],
  },
  {
    title: '4 · E-STOP & recovery',
    items: [
      'Press E-STOP (dashboard or physical) — motors stop, Nav2 goals cancel, missions pause',
      'Clear the hazard, check the robot and surroundings',
      'Press RESET; missions resume their current leg automatically',
      'If localization is lost, set a new pose estimate before resuming',
    ],
  },
  {
    title: '5 · Shutdown',
    items: [
      'Let active missions finish or cancel them; send NOVA home',
      'Switch to IDLE, then shut down the Pi (sudo poweroff) before the main switch',
      'Charge the 2S pack with a balance charger; never leave it charging unattended',
    ],
  },
];

export default function SopModal({ onClose }) {
  const [done, setDone] = useState({});
  const total = SOP.reduce((n, s) => n + s.items.length, 0);
  const count = Object.values(done).filter(Boolean).length;
  return (
    <div className="modal-back" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <LuBookOpenCheck size={20} color="var(--accent)" />
          <div className="grow">
            <div className="bold">NOVA warehouse SOP</div>
            <div className="tiny" style={{ color: '#94a3b8' }}>Standard operating procedure · {count}/{total} checked</div>
          </div>
          <button className="icon-btn" onClick={onClose}><LuX size={16} /></button>
        </div>
        <div className="hazard" />
        {SOP.map((s, si) => (
          <div key={s.title} className="sop-section">
            <div className="bold" style={{ marginBottom: 6 }}>{s.title}</div>
            {s.items.map((it, ii) => {
              const k = `${si}.${ii}`;
              return (
                <label key={k} className={`check ${done[k] ? 'done' : ''}`}>
                  <input type="checkbox" checked={!!done[k]} onChange={(e) => setDone({ ...done, [k]: e.target.checked })} />
                  <span>{it}</span>
                </label>
              );
            })}
          </div>
        ))}
        <div className="row" style={{ padding: 16, justifyContent: 'flex-end' }}>
          <button className="btn" onClick={() => setDone({})}>Reset checklist</button>
          <button className="btn primary" onClick={onClose}>Done</button>
        </div>
      </div>
    </div>
  );
}
