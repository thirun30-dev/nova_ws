import React, { useMemo } from 'react';
import {
  LuTrendingUp, LuTimer, LuHourglass, LuShieldCheck, LuActivity, LuRuler, LuDownload, LuBatteryMedium, LuChartBar,
} from 'react-icons/lu';
import { Card, Empty, StateBadge } from '../components/ui.jsx';
import LineChart from '../components/LineChart.jsx';
import { fmt, fmtDuration } from '../lib/geom.js';

function Kpi({ icon: Icon, label, value, unit, sub }) {
  return (
    <div className="card" style={{ padding: 14 }}>
      <div className="tile-label"><Icon size={13} /> {label}</div>
      <div className="tile-value" style={{ fontSize: 24 }}>{value}<small>{unit}</small></div>
      <div className="tile-sub">{sub}</div>
    </div>
  );
}

function Legend({ items }) {
  return (
    <div className="row" style={{ gap: 12 }}>
      {items.map(([c, l]) => <span key={l} className="row tiny muted" style={{ gap: 5 }}><span className="legend-dot" style={{ background: c }} />{l}</span>)}
    </div>
  );
}

export default function Analytics({ nova }) {
  const { metrics: m, history, missions } = nova;

  const outcome = useMemo(() => {
    const c = { COMPLETED: 0, FAILED: 0, CANCELLED: 0 };
    missions.forEach((j) => { if (c[j.state] !== undefined) c[j.state] += 1; });
    return c;
  }, [missions]);

  const stations = useMemo(() => {
    const counts = {};
    missions.forEach((j) => {
      counts[j.pickup] = (counts[j.pickup] || 0) + 1;
      counts[j.dropoff] = (counts[j.dropoff] || 0) + 1;
    });
    return Object.entries(counts).sort((a, b) => b[1] - a[1]);
  }, [missions]);

  const exportCsv = () => {
    const head = 'id,pickup,dropoff,priority,state,attempts,created,started,finished,wait_s,cycle_s\n';
    const body = missions
      .map((j) => [j.id, j.pickup, j.dropoff, j.priority, j.state, j.attempts, j.created, j.started, j.finished,
        j.started ? (j.started - j.created).toFixed(2) : '', j.finished && j.started ? (j.finished - j.started).toFixed(2) : ''].join(','))
      .join('\n');
    const blob = new Blob([head + body], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `nova_missions_${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const done = outcome.COMPLETED + outcome.FAILED + outcome.CANCELLED;
  const maxStation = stations.length ? stations[0][1] : 1;

  return (
    <div className="col" style={{ gap: 16 }}>
      <div className="grid g-kpi">
        <Kpi icon={LuTrendingUp} label="Throughput" value={fmt(m?.throughput_per_hour, 1)} unit="/h" sub={`${m?.completed ?? 0} completed`} />
        <Kpi icon={LuHourglass} label="Mean wait" value={fmtDuration(m?.mean_wait_time_s)} sub="queued → dispatched" />
        <Kpi icon={LuTimer} label="Mean cycle" value={fmtDuration(m?.mean_cycle_time_s)} sub="dispatch → delivered" />
        <Kpi icon={LuShieldCheck} label="Success rate" value={m ? fmt(m.success_rate * 100, 0) : '—'} unit="%" sub={`${m?.failed ?? 0} failed`} />
        <Kpi icon={LuActivity} label="Utilization" value={m ? fmt(m.utilization * 100, 0) : '—'} unit="%" sub={m ? `robot: ${m.robot_state.replaceAll('_', ' ').toLowerCase()}` : ''} />
        <Kpi icon={LuRuler} label="Distance" value={fmt(m?.total_distance_m, 1)} unit="m" sub="planned leg length" />
      </div>

      <div className="grid g-2">
        <Card title="Throughput & utilization" icon={LuTrendingUp} right={<Legend items={[['#22d3ee', 'missions/h'], ['#a78bfa', 'utilization %']]} />}>
          <LineChart data={history} series={[{ key: 'throughput', color: '#22d3ee', fill: true }, { key: 'utilization', color: '#a78bfa' }]} />
        </Card>
        <Card title="Queue length" icon={LuChartBar} right={<Legend items={[['#a78bfa', 'queued'], ['#34d399', 'completed']]} />}>
          <LineChart data={history} series={[{ key: 'queue', color: '#a78bfa', fill: true }, { key: 'completed', color: '#34d399' }]} />
        </Card>
        <Card title="Battery" icon={LuBatteryMedium} right={<Legend items={[['#34d399', 'voltage V']]} />}>
          <LineChart data={history} series={[{ key: 'battery_v', color: '#34d399', fill: true }]} yMin={6} yMax={8.5} />
        </Card>
        <Card title="Speed" icon={LuActivity} right={<Legend items={[['#22d3ee', '|v| m/s']]} />}>
          <LineChart data={history} series={[{ key: 'speed', color: '#22d3ee', fill: true }]} yMax={0.5} />
        </Card>
      </div>

      <div className="grid g-3">
        <Card title="Outcomes" icon={LuShieldCheck}>
          {done === 0 ? <Empty>No finished missions yet.</Empty> : (
            <>
              <div style={{ display: 'flex', height: 14, borderRadius: 8, overflow: 'hidden', background: 'rgba(148,163,184,0.12)' }}>
                <span style={{ width: `${(100 * outcome.COMPLETED) / done}%`, background: 'var(--ok)' }} />
                <span style={{ width: `${(100 * outcome.FAILED) / done}%`, background: 'var(--bad)' }} />
                <span style={{ width: `${(100 * outcome.CANCELLED) / done}%`, background: 'var(--warn)' }} />
              </div>
              <div className="col" style={{ marginTop: 12, gap: 6 }}>
                {Object.entries(outcome).map(([k, v]) => (
                  <div key={k} className="row between small"><StateBadge state={k} /><span className="mono">{v}</span></div>
                ))}
              </div>
            </>
          )}
        </Card>
        <Card title="Station usage" icon={LuChartBar}>
          {!stations.length ? <Empty>No missions yet.</Empty> : (
            <div className="col" style={{ gap: 8 }}>
              {stations.slice(0, 8).map(([name, n]) => (
                <div key={name}>
                  <div className="row between small"><span>{name}</span><span className="mono">{n}</span></div>
                  <div className="bar"><span style={{ width: `${(100 * n) / maxStation}%` }} /></div>
                </div>
              ))}
            </div>
          )}
        </Card>
        <Card title="Research export" icon={LuDownload}>
          <p className="small muted" style={{ marginTop: 0 }}>
            Download this session's missions as CSV (same columns as the mission manager's log in
            <span className="mono"> ~/.ros/nova_missions/</span>). Compare <b>fifo</b>, <b>priority</b> and <b>nearest</b> runs with the same generator seed.
          </p>
          <button className="btn primary" onClick={exportCsv} disabled={!missions.length}><LuDownload size={15} /> Export missions CSV</button>
          <div className="tiny muted" style={{ marginTop: 10 }}>Policy: <b>{m?.policy || '—'}</b> · {m?.submitted ?? 0} submitted · {m?.cancelled ?? 0} cancelled</div>
        </Card>
      </div>
    </div>
  );
}
