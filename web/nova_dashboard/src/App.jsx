import React, { useState } from 'react';
import { LuGauge, LuSend, LuChartLine, LuOctagonX, LuRotateCcw, LuX, LuTriangleAlert } from 'react-icons/lu';
import { useNova } from './hooks/useNova.js';
import Header from './components/Header.jsx';
import Ticker from './components/Ticker.jsx';
import SopModal from './components/SopModal.jsx';
import Cockpit from './views/Cockpit.jsx';
import Dispatcher from './views/Dispatcher.jsx';
import Analytics from './views/Analytics.jsx';

export default function App() {
  const nova = useNova();
  const [view, setView] = useState('COCKPIT');
  const [tab, setTab] = useState('DRIVE');
  const [sop, setSop] = useState(false);
  const estop = !!nova.state?.estop;

  const jump = (t) => {
    setView('COCKPIT');
    setTab(t);
  };

  return (
    <div className="app">
      <Header nova={nova} view={view} setView={setView} onSop={() => setSop(true)} />
      <Ticker nova={nova} onJump={jump} />

      <main className="main">
        {!nova.connected && !nova.demo && (
          <div className="notice bad">
            <LuTriangleAlert size={16} />
            <span>Not connected to rosbridge at <span className="mono">{nova.url}</span> — retrying. Start the robot with <span className="mono">web:=true</span>, or open the link menu to run the demo.</span>
          </div>
        )}
        {estop && (
          <div className="banner-estop">
            <LuOctagonX size={20} /> E-STOP ENGAGED — motors stopped, missions paused
            <button className="btn sm" style={{ marginLeft: 'auto' }} onClick={nova.api.resetEstop}><LuRotateCcw size={13} /> Reset</button>
          </div>
        )}
        {nova.notice && (
          <div className={`notice ${nova.notice.ok === false ? 'bad' : ''}`}>
            <span className={`dot ${nova.notice.ok === false ? 'bad' : 'warn'}`} />
            {nova.notice.text}
            <button onClick={() => nova.setNotice(null)}><LuX size={14} /></button>
          </div>
        )}

        {view === 'COCKPIT' && <Cockpit nova={nova} tab={tab} setTab={setTab} />}
        {view === 'DISPATCH' && <Dispatcher nova={nova} />}
        {view === 'ANALYTICS' && <Analytics nova={nova} />}
      </main>

      <nav className="mobile-nav">
        <button className={view === 'COCKPIT' ? 'on' : ''} onClick={() => setView('COCKPIT')}><LuGauge size={18} />Cockpit</button>
        <button className={view === 'DISPATCH' ? 'on' : ''} onClick={() => setView('DISPATCH')}><LuSend size={18} />Dispatch</button>
        <button className={view === 'ANALYTICS' ? 'on' : ''} onClick={() => setView('ANALYTICS')}><LuChartLine size={18} />Analytics</button>
        <button className={`stop ${estop ? 'engaged' : ''}`} onClick={() => (estop ? nova.api.resetEstop() : nova.api.estop())} disabled={!nova.connected}>
          {estop ? <LuRotateCcw size={18} /> : <LuOctagonX size={18} />}{estop ? 'RESET' : 'E-STOP'}
        </button>
      </nav>

      {sop && <SopModal onClose={() => setSop(false)} />}
    </div>
  );
}
