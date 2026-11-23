// Tiny responsive SVG line chart (no chart library).
import React, { useMemo } from 'react';

export default function LineChart({ data, series, height = 180, yMin = 0, yMax, unit = '' }) {
  const W = 600;
  const H = height;
  const pad = { l: 38, r: 10, t: 10, b: 22 };
  const { paths, ticks, xTicks } = useMemo(() => {
    if (!data.length) return { paths: [], ticks: [], xTicks: [] };
    const t0 = data[0].t;
    const t1 = Math.max(data[data.length - 1].t, t0 + 1);
    const vals = series.flatMap((s) => data.map((d) => d[s.key]).filter((v) => v != null));
    let hi = yMax ?? Math.max(1, ...vals);
    if (yMax == null) hi = niceCeil(hi * 1.1);
    const lo = yMin;
    const x = (t) => pad.l + ((t - t0) / (t1 - t0)) * (W - pad.l - pad.r);
    const y = (v) => H - pad.b - ((v - lo) / (hi - lo || 1)) * (H - pad.t - pad.b);
    const ps = series.map((s) => {
      let d = '';
      let started = false;
      data.forEach((row) => {
        const v = row[s.key];
        if (v == null) { started = false; return; }
        d += `${started ? 'L' : 'M'}${x(row.t).toFixed(1)},${y(v).toFixed(1)}`;
        started = true;
      });
      const area = s.fill && d ? `${d}L${x(data[data.length - 1].t).toFixed(1)},${y(lo)}L${x(data[0].t).toFixed(1)},${y(lo)}Z` : null;
      return { ...s, d, area };
    });
    const tk = [0, 0.25, 0.5, 0.75, 1].map((f) => ({ v: lo + f * (hi - lo), y: y(lo + f * (hi - lo)) }));
    const span = t1 - t0;
    const xt = [0, 0.5, 1].map((f) => ({ x: x(t0 + f * span), label: f === 1 ? 'now' : `-${Math.round((1 - f) * span / 60) || '<1'}m` }));
    return { paths: ps, ticks: tk, xTicks: xt };
  }, [data, series, H, yMin, yMax]);

  return (
    <svg className="chart" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={{ height }}>
      {ticks.map((t, i) => (
        <g key={i}>
          <line x1={pad.l} x2={W - pad.r} y1={t.y} y2={t.y} stroke="rgba(56,189,248,0.12)" strokeDasharray={i ? '3 4' : ''} />
          <text x={pad.l - 6} y={t.y + 3} textAnchor="end">{formatTick(t.v)}{i === ticks.length - 1 ? unit : ''}</text>
        </g>
      ))}
      {xTicks.map((t, i) => <text key={i} x={t.x} y={H - 6} textAnchor={i === 0 ? 'start' : i === 2 ? 'end' : 'middle'}>{t.label}</text>)}
      {paths.map((p) => (
        <g key={p.key}>
          {p.area && <path d={p.area} fill={p.color} opacity="0.12" />}
          <path d={p.d} fill="none" stroke={p.color} strokeWidth="2" vectorEffect="non-scaling-stroke" strokeLinejoin="round" style={{ filter: `drop-shadow(0 0 4px ${p.color})` }} />
        </g>
      ))}
      {!data.length && <text x={W / 2} y={H / 2} textAnchor="middle">collecting…</text>}
    </svg>
  );
}

function niceCeil(v) {
  const p = 10 ** Math.floor(Math.log10(v));
  return Math.ceil(v / p) * p;
}
const formatTick = (v) => (Math.abs(v) >= 100 ? v.toFixed(0) : Math.abs(v) >= 10 ? v.toFixed(0) : v.toFixed(1));
