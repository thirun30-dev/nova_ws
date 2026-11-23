import React, { useState } from 'react';
import MapViewer from './MapViewer.jsx';
import Twin3D from './Twin3D.jsx';

const load = (k, d) => {
  try {
    return localStorage.getItem(k) || d;
  } catch {
    return d;
  }
};

/** 2D map or 3D digital twin with a toggle; remembers the choice per panel. */
export default function MapPanel({ id = 'cockpit', defaultView = '3D', ...props }) {
  const key = `nova_view_${id}`;
  const [view, setView] = useState(() => load(key, defaultView));
  const pick = (v) => {
    setView(v);
    try {
      localStorage.setItem(key, v);
    } catch {
      /* ignore */
    }
  };
  return (
    <div className="mappanel">
      <div className="view-toggle">
        <button className={view === '2D' ? 'on' : ''} onClick={() => pick('2D')}>2D</button>
        <button className={view === '3D' ? 'on' : ''} onClick={() => pick('3D')}>3D</button>
      </div>
      {view === '3D' ? <Twin3D {...props} /> : <MapViewer {...props} />}
    </div>
  );
}
