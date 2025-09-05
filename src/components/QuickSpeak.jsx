import React from 'react';
export function QuickSpeak({ ready, currentText, onChange, onSpeak, onStartDemo, flowState }){
  return (
    <section>
      <h2>Quick Speak</h2>
      <textarea value={currentText} onChange={e=>onChange(e.target.value)} rows={4} style={{width:'100%',maxWidth:600}}/>
      <div style={{ marginTop:8, display:'flex', gap:8, flexWrap:'wrap'}}>
        <button disabled={!ready} onClick={onSpeak}>Speak</button>
        <button disabled={!ready || flowState==='RUNNING'} onClick={onStartDemo}>Start Demo Flow</button>
      </div>
    </section>
  );
}
