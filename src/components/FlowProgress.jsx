import React from 'react';
import { FlowState } from '../hooks/useYogaFlow';

export function FlowProgress({ flow, currentIndex, remainingBreaths, flowState, waitingForTTS, timings }){
  return (
    <section>
      <h2>Flow Progress</h2>
      <p>Pose {flow.length ? currentIndex + 1 : 0}/{flow.length} {flow[currentIndex]?.name && '– ' + flow[currentIndex].name}</p>
      {flowState === FlowState.RUNNING && (
        <>
          <p>Remaining breaths this pose (before current cycle finishes): {remainingBreaths}</p>
          {waitingForTTS && <p style={{ fontSize: '.7rem', color: '#c66' }}>Waiting for TTS audio… (breaths will auto-start)</p>}
        </>
      )}
      <p style={{ fontSize: '.75rem', opacity: .6 }}>Demo timings: inhale {timings.in}ms, hold {timings.hold}ms, exhale {timings.out}ms. Pose advances right after final cycle completes.</p>
      <p style={{ fontSize: '.65rem', opacity: .5 }}>Debug: Console shows cycle start and final advancement logs.</p>
    </section>
  );
}
