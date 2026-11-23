import React, { useEffect, useState } from 'react';
import { LuNavigation, LuTrash2, LuLocate, LuSave } from 'react-icons/lu';
import { LocIcon, LOCATION_TYPES, locType, Empty } from './ui.jsx';
import { fmt, deg } from '../lib/geom.js';

export default function Locations({ nova, pendingPin, clearPin }) {
  const { locations, api, connected, state } = nova;
  const blocked = !connected || state?.estop;
  const [form, setForm] = useState({ name: '', type: 'pickup', x: '', y: '', yaw: '0' });

  useEffect(() => {
    if (pendingPin) setForm((f) => ({ ...f, x: pendingPin[0].toFixed(2), y: pendingPin[1].toFixed(2), name: f.name || `loc_${locations.length + 1}` }));
  }, [pendingPin, locations.length]);

  const save = (useCurrent) => {
    if (!form.name.trim()) return;
    api.locationCommand(
      useCurrent
        ? { action: 'save_location', name: form.name.trim(), type: form.type, use_current_pose: true }
        : { action: 'save_location', name: form.name.trim(), type: form.type, x: +form.x, y: +form.y, yaw: (+form.yaw * Math.PI) / 180 },
    );
    setForm({ name: '', type: form.type, x: '', y: '', yaw: '0' });
    clearPin?.();
  };
  const valid = form.name.trim() && form.x !== '' && form.y !== '' && !Number.isNaN(+form.x) && !Number.isNaN(+form.y);

  return (
    <div className="col" style={{ gap: 12 }}>
      <div className="well" style={{ padding: 12 }}>
        <div className="row">
          <input className="input" placeholder="name (e.g. pick_e)" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          <select className="select" style={{ width: 120 }} value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
            {Object.entries(LOCATION_TYPES).map(([k, t]) => <option key={k} value={k}>{t.label}</option>)}
          </select>
        </div>
        <div className="row" style={{ marginTop: 8 }}>
          <input className="input mono" placeholder="x" value={form.x} onChange={(e) => setForm({ ...form, x: e.target.value })} />
          <input className="input mono" placeholder="y" value={form.y} onChange={(e) => setForm({ ...form, y: e.target.value })} />
          <input className="input mono" placeholder="yaw°" value={form.yaw} onChange={(e) => setForm({ ...form, yaw: e.target.value })} />
        </div>
        <div className="row" style={{ marginTop: 8 }}>
          <button className="btn primary sm grow" disabled={!connected || !valid} onClick={() => save(false)}><LuSave size={13} /> Save at x, y</button>
          <button className="btn sm grow" disabled={!connected || !form.name.trim()} onClick={() => save(true)}><LuLocate size={13} /> Save robot pose</button>
        </div>
        <p className="tiny muted" style={{ margin: '8px 0 0' }}>Tip: use the pin tool on the map to fill x, y. Locations double as mission stations.</p>
      </div>

      <div className="list" style={{ maxHeight: 380, overflow: 'auto' }}>
        {!locations.length && <Empty>No locations saved.</Empty>}
        {locations.map((l) => (
          <div key={l.name} className="item">
            <LocIcon type={l.type} size={28} />
            <div className="grow">
              <div className="bold small">{l.name}</div>
              <div className="tiny muted mono">{locType(l.type).label} · ({fmt(l.x)}, {fmt(l.y)}) · {fmt(deg(l.yaw || 0), 0)}°</div>
            </div>
            <button className="btn primary xs" disabled={blocked} onClick={() => api.locationCommand({ action: 'navigate_to_location', name: l.name })}><LuNavigation size={12} /> Go</button>
            <button className="btn danger xs" disabled={!connected} onClick={() => api.locationCommand({ action: 'delete_location', name: l.name })} title="Delete"><LuTrash2 size={12} /></button>
          </div>
        ))}
      </div>
      {locations.length > 0 && (
        <ConfirmButton label="Clear all locations" onConfirm={() => api.locationCommand({ action: 'clear_all' })} disabled={!connected} />
      )}
    </div>
  );
}

export function ConfirmButton({ label, onConfirm, disabled }) {
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return undefined;
    const t = setTimeout(() => setArmed(false), 3000);
    return () => clearTimeout(t);
  }, [armed]);
  return (
    <button className="btn danger sm" disabled={disabled} onClick={() => (armed ? (setArmed(false), onConfirm()) : setArmed(true))}>
      <LuTrash2 size={13} /> {armed ? 'Click again to confirm' : label}
    </button>
  );
}
