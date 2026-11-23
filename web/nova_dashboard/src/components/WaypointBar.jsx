import React, { useEffect, useState } from 'react';
import { LuMapPinned, LuPlus, LuNavigation, LuSquare, LuTrash2 } from 'react-icons/lu';
import { LocIcon, locType } from './ui.jsx';
import { fmt } from '../lib/geom.js';

export default function WaypointBar({ nova }) {
  const { locations, api, connected, state, nav } = nova;
  const blocked = !connected || state?.estop;
  const [naming, setNaming] = useState(null); // null | string
  const [confirmDel, setConfirmDel] = useState(null); // name awaiting a second tap
  useEffect(() => {
    if (!confirmDel) return undefined;
    const t = setTimeout(() => setConfirmDel(null), 3000);
    return () => clearTimeout(t);
  }, [confirmDel]);
  const remove = (name) => {
    if (confirmDel !== name) { setConfirmDel(name); return; }
    api.locationCommand({ action: 'delete_location', name });
    setConfirmDel(null);
  };
  const save = (e) => {
    e.preventDefault();
    if (naming?.trim()) api.locationCommand({ action: 'save_location', name: naming.trim(), type: 'waypoint', use_current_pose: true });
    setNaming(null);
  };
  return (
    <section className="card">
      <div className="row" style={{ padding: '10px 14px 0' }}>
        <LuMapPinned size={16} color="var(--accent)" />
        <span className="card-title">Quick navigate</span>
        <span className="tiny muted">{locations.length} locations</span>
        <div className="row" style={{ marginLeft: 'auto' }}>
          {nav?.state === 'NAVIGATING' && (
            <button className="btn danger sm" onClick={api.cancelNav}><LuSquare size={12} /> Cancel goal</button>
          )}
          {naming === null ? (
            <button className="btn sm" onClick={() => setNaming(`wp_${locations.length + 1}`)} disabled={blocked}><LuPlus size={14} /> Save current pose</button>
          ) : (
            <form className="row" onSubmit={save}>
              <input className="input" style={{ width: 150, padding: '5px 8px' }} autoFocus value={naming} onChange={(e) => setNaming(e.target.value)} />
              <button className="btn primary sm" type="submit">Save</button>
              <button className="btn ghost sm" type="button" onClick={() => setNaming(null)}>Cancel</button>
            </form>
          )}
        </div>
      </div>
      <div className="waybar no-scrollbar">
        {locations.length === 0 && <span className="muted small">No locations yet — drop pins on the map or save the current pose.</span>}
        {locations.map((l) => (
          <div key={l.name} className="waychip">
            <LocIcon type={l.type} />
            <div className="grow">
              <div className="bold small">{l.name}</div>
              <div className="tiny muted mono">{locType(l.type).label} · {fmt(l.x, 1)}, {fmt(l.y, 1)}</div>
            </div>
            <button
              className="btn primary xs"
              disabled={blocked}
              onClick={() => api.locationCommand({ action: 'navigate_to_location', name: l.name })}
              title={`Navigate to ${l.name}`}
            >
              <LuNavigation size={12} /> Go
            </button>
            <button
              className={`btn ${confirmDel === l.name ? 'danger' : 'ghost'} xs`}
              disabled={!connected}
              onClick={() => remove(l.name)}
              title={confirmDel === l.name ? `Tap again to delete ${l.name}` : `Remove ${l.name}`}
            >
              <LuTrash2 size={12} />{confirmDel === l.name && ' Delete?'}
            </button>
          </div>
        ))}
      </div>
    </section>
  );
}
