import React from 'react';
export function CommandsPanel({ ready, invoke, describeMode, poseDifficulty }){
  return (
    <section>
      <h2>Commands</h2>
      <div style={{ display:'flex', flexWrap:'wrap', gap:8, maxWidth:680 }}>
        <button disabled={!ready} onClick={()=>invoke('skip')}>Skip</button>
        <button disabled={!ready} onClick={()=>invoke('pause')}>Pause</button>
        <button disabled={!ready} onClick={()=>invoke('resume')}>Resume</button>
        <button disabled={!ready} onClick={()=>invoke('easier')}>Easier</button>
        <button disabled={!ready} onClick={()=>invoke('harder')}>Harder</button>
        <button disabled={!ready} onClick={()=>invoke('neutral')}>Neutral</button>
        <button disabled={!ready} onClick={()=>invoke('describe')}>Describe</button>
        <button disabled={!ready} onClick={()=>invoke('nameOnly')}>Name Only</button>
      </div>
      <p style={{ fontSize: '.8rem', opacity: .7 }}>Mode: {describeMode ? 'Describe' : 'Name only'} | Difficulty offset: {poseDifficulty}</p>
    </section>
  );
}
