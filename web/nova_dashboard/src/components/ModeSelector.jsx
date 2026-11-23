import React, { useEffect, useState } from 'react';
import { LuPower, LuScanLine, LuRoute, LuLoader } from 'react-icons/lu';
import { Card, Badge } from './ui.jsx';

const MODES = [
  { id: 'IDLE', icon: LuPower, name: 'IDLE', desc: 'Nav stack stopped. Teleop only.' },
  { id: 'MAPPING', icon: LuScanLine, name: 'MAPPING', desc: 'SLAM Toolbox builds a new map as you drive.' },
  { id: 'NAVIGATION', icon: LuRoute, name: 'NAVIGATION', desc: 'AMCL + Nav2 on a saved map. Missions run here.' },
];

export default function ModeSelector({ nova }) {
  const { state, maps, api, connected } = nova;
  const current = state?.nav_mode || state?.mode;
  const switching = current === 'SWITCHING';
  const [mapName, setMapName] = useState('');

  useEffect(() => {
    if (!mapName && maps.length) setMapName(state?.map || maps[0].name);
  }, [maps, mapName, state?.map]);

  const managed = state?.managed;

  return (
    <Card
      title="Operating mode"
      icon={LuRoute}
      right={
        switching ? (
          <Badge tone="warn"><LuLoader size={11} className="spin" /> SWITCHING</Badge>
        ) : (
          <Badge tone={current === 'NAVIGATION' ? 'ok' : current === 'MAPPING' ? 'info' : 'neutral'}>{current || '—'}</Badge>
        )
      }
    >
      <div className="modes">
        {MODES.map((m) => (
          <button
            key={m.id}
            className={`mode ${current === m.id ? 'active' : ''}`}
            disabled={!connected || !managed || switching || state?.estop}
            onClick={() => api.setMode(m.id, m.id === 'NAVIGATION' ? mapName : '')}
          >
            <span className="mode-icon"><m.icon size={17} /></span>
            <span className="mode-name">{m.name}</span>
            <span className="mode-desc">{m.desc}</span>
          </button>
        ))}
      </div>
      <div className="row" style={{ marginTop: 12 }}>
        <span className="label" style={{ flex: 'none' }}>Map</span>
        <select className="select" value={mapName} onChange={(e) => setMapName(e.target.value)} disabled={!maps.length}>
          {maps.map((m) => (
            <option key={m.name} value={m.name}>{m.name}{m.readonly ? ' (built-in)' : ''}</option>
          ))}
        </select>
        <button
          className="btn primary sm"
          disabled={!connected || !managed || switching || state?.estop || !mapName}
          onClick={() => api.setMode('NAVIGATION', mapName)}
        >
          Load
        </button>
      </div>
      {connected && managed === false && (
        <p className="tiny muted" style={{ margin: '10px 0 0' }}>
          Modes are fixed by the launch file here (sim). On the robot use <span className="mono">robot.launch.py web:=true</span> to switch from the dashboard.
        </p>
      )}
    </Card>
  );
}
