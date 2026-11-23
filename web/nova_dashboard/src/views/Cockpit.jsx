import React, { useState } from 'react';
import { LuGamepad2, LuMapPin, LuMap, LuHeartPulse } from 'react-icons/lu';
import ModeSelector from '../components/ModeSelector.jsx';
import RobotStatus from '../components/RobotStatus.jsx';
import WaypointBar from '../components/WaypointBar.jsx';
import MapPanel from '../components/MapPanel.jsx';
import Teleop from '../components/Teleop.jsx';
import Locations from '../components/Locations.jsx';
import Maps from '../components/Maps.jsx';
import Health from '../components/Health.jsx';

export default function Cockpit({ nova, tab, setTab }) {
  const [pin, setPin] = useState(null);
  const tabs = [
    { id: 'DRIVE', label: 'Drive', icon: LuGamepad2 },
    { id: 'LOCATIONS', label: 'POIs', icon: LuMapPin, count: nova.locations.length },
    { id: 'MAPS', label: 'Maps', icon: LuMap },
    { id: 'HEALTH', label: 'Health', icon: LuHeartPulse },
  ];
  return (
    <>
      <div className="grid g-cockpit-top">
        <ModeSelector nova={nova} />
        <RobotStatus nova={nova} />
      </div>
      <WaypointBar nova={nova} />
      <div className="grid g-workspace">
        <section className="card" style={{ padding: 0, overflow: 'hidden' }}>
          <MapPanel
            id="cockpit"
            odom={nova.odom}
            map={nova.map}
            costmap={nova.costmap}
            scan={nova.scan}
            pose={nova.pose}
            plan={nova.plan}
            locations={nova.locations}
            goal={nova.nav?.goal}
            navState={nova.nav?.state}
            onGoal={nova.connected && !nova.state?.estop ? nova.api.sendGoal : undefined}
            onInitialPose={nova.connected ? nova.api.setInitialPose : undefined}
            onPin={nova.connected ? (x, y) => { setPin([x, y]); setTab('LOCATIONS'); } : undefined}
          />
        </section>
        <section className="card" style={{ display: 'flex', flexDirection: 'column', minHeight: 0 }}>
          <div className="tabs">
            {tabs.map((t) => (
              <button key={t.id} className={`tab ${tab === t.id ? 'active' : ''}`} onClick={() => setTab(t.id)}>
                <t.icon size={14} /> {t.label} {t.count ? <span className="count">{t.count}</span> : null}
              </button>
            ))}
          </div>
          <div className="card-body" style={{ overflow: 'auto', flex: 1 }}>
            {tab === 'DRIVE' && <Teleop nova={nova} />}
            {tab === 'LOCATIONS' && <Locations nova={nova} pendingPin={pin} clearPin={() => setPin(null)} />}
            {tab === 'MAPS' && <Maps nova={nova} />}
            {tab === 'HEALTH' && <Health nova={nova} />}
          </div>
        </section>
      </div>
    </>
  );
}
