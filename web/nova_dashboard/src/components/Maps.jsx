import React, { useState } from 'react';
import { LuSave, LuShare2, LuPlay, LuTrash2, LuLock, LuMap } from 'react-icons/lu';
import { Badge, Empty } from './ui.jsx';

export default function Maps({ nova }) {
  const { maps, state, api, connected } = nova;
  const mapping = (state?.nav_mode || state?.mode) === 'MAPPING';
  const [name, setName] = useState('');
  const stamp = () => new Date().toISOString().slice(0, 16).replace(/[-:]/g, '').replace('T', '_');

  return (
    <div className="col" style={{ gap: 12 }}>
      <div className="well" style={{ padding: 12 }}>
        <div className="row between">
          <span className="label">Save the map being built</span>
          {mapping ? <Badge tone="info" dot="ok">MAPPING</Badge> : <Badge>not mapping</Badge>}
        </div>
        <input className="input" style={{ marginTop: 8 }} placeholder={`map_${stamp()}`} value={name} onChange={(e) => setName(e.target.value.replace(/[^\w-]/g, ''))} />
        <div className="row" style={{ marginTop: 8 }}>
          <button className="btn primary sm grow" disabled={!connected || !mapping} onClick={() => { api.mapOperation('save_map', name || `map_${stamp()}`); setName(''); }}>
            <LuSave size={13} /> Save map (.pgm/.yaml)
          </button>
          <button className="btn sm grow" disabled={!connected || !mapping} onClick={() => api.mapOperation('serialize_pose_graph', name || `map_${stamp()}`)}>
            <LuShare2 size={13} /> Pose graph
          </button>
        </div>
        {!mapping && <p className="tiny muted" style={{ margin: '8px 0 0' }}>Switch to MAPPING, drive NOVA around slowly, then save.</p>}
      </div>

      <div className="list">
        {!maps.length && <Empty>No maps found in ~/nova_maps.</Empty>}
        {maps.map((m) => {
          const loaded = state?.map === m.name && (state?.nav_mode || state?.mode) === 'NAVIGATION';
          return (
            <div key={m.name} className="item" style={loaded ? { borderColor: 'var(--accent)', background: 'var(--accent-soft)' } : null}>
              <span className="wicon" style={{ width: 28, height: 28, borderRadius: 8, display: 'grid', placeItems: 'center', background: 'var(--accent-soft)', border: '1px solid var(--line-2)', color: 'var(--accent)' }}><LuMap size={14} /></span>
              <div className="grow">
                <div className="bold small row" style={{ gap: 6 }}>{m.name} {m.readonly && <LuLock size={11} color="var(--faint)" />}</div>
                <div className="tiny muted">{m.modified ? new Date(m.modified * 1000).toLocaleString() : ''}{loaded ? ' · loaded' : ''}</div>
              </div>
              <button className="btn primary xs" disabled={!connected || !state?.managed || state?.estop} onClick={() => api.setMode('NAVIGATION', m.name)}><LuPlay size={11} /> Load</button>
              {!m.readonly && (
                <button className="btn danger xs" disabled={!connected || loaded} onClick={() => api.mapOperation('delete_map', m.name)} title="Delete map"><LuTrash2 size={12} /></button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
