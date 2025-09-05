import React from 'react';
import { useYogaFlow, FlowState } from './hooks/useYogaFlow';
import { QuickSpeak } from './components/QuickSpeak.jsx';
import { FlowProgress } from './components/FlowProgress.jsx';
import { CommandsPanel } from './components/CommandsPanel.jsx';
import { VoiceCommands } from './components/VoiceCommands.jsx';
import { FlowSelection } from './components/FlowSelection.jsx';
import { BreathSoundTest } from './components/BreathSoundTest.jsx';
import flowsData from '../flows.json';

export default function App(){
  const { 
    flowState,status,device,ready,flow,currentIndex,remainingBreaths,currentText,poseDifficulty,describeMode,waitingForTTS,isSpeaking,
    speak,startFlow,commands,setCurrentText
  } = useYogaFlow();  const invoke = (key)=>{ if(commands[key]) commands[key](); };

  const timings = { in:1500, hold:300, out:1500 };

  const handleFlowSelect = (selectedFlow) => {
    startFlow(selectedFlow);
  };

  // Handle voice commands from the voice recognition system
  const handleVoiceCommand = (command) => {
    // Don't process commands if we're still setting up the flow
    if (flowState === FlowState.IDLE) return;
    
    // Allow critical commands even during TTS (like in BreathSoundTest)
    const criticalCommands = ['pause', 'stop', 'end', 'ready'];
    const isCritical = command.type === 'flow_control' && criticalCommands.includes(command.action);
    
    // Block non-critical commands during TTS to avoid interference
    if (isSpeaking && !isCritical) {
      console.log('Ignoring non-critical command during TTS:', command);
      return;
    }
    
    console.log('Received voice command:', command);
    
    // Map voice commands to existing yoga flow commands
    switch (command.type) {
      case 'flow_control':
        switch (command.action) {
          case 'pause':
            invoke('pause');
            break;
          case 'resume':
            invoke('continue');
            break;
          case 'skip':
            invoke('skip');
            break;
          case 'start':
            if (flowState === FlowState.IDLE) {
              // Could start a default flow or show flow selection
              console.log('Please select a flow first');
            } else if (flowState === FlowState.WAITING_FOR_READY) {
              invoke('ready');
            } else {
              invoke('continue');
            }
            break;
          case 'ready':
            if (flowState === FlowState.WAITING_FOR_READY) {
              invoke('ready');
            }
            break;
          case 'end':
            invoke('stop');
            break;
        }
        break;
      case 'difficulty':
        if (command.action === 'easier') {
          invoke('easier');
        } else if (command.action === 'harder') {
          invoke('harder');
        }
        break;
      case 'description':
        if (command.action === 'describe_pose') {
          invoke('describe');
        } else if (command.action === 'full_description_mode') {
          invoke('toggleDescribe');
        }
        break;
      // Add more command mappings as needed
    }
  };

  return (
    <div className="app">
      {flowState === FlowState.IDLE ? (
        <>
          <FlowSelection 
            flows={flowsData} 
            onFlowSelect={handleFlowSelect}
          />
          
          {/* Breath Sound Test Panel - only visible when idle */}
          <BreathSoundTest />
        </>
      ) : flowState === FlowState.WAITING_FOR_READY ? (
        <div className="flow-session">
          <div className="session-header">
            <h2>🧘‍♀️ Ready to Begin?</h2>
            <p className="ready-message">
              {status}
            </p>
            <p className="ready-instruction">
              Say <strong>"ready"</strong> when you're prepared to start your practice.
            </p>
            <button onClick={() => invoke('ready')} className="ready-btn">
              I'm Ready
            </button>
            <button onClick={() => invoke('stop')} className="end-session-btn">
              End Session
            </button>
          </div>
          
          {/* Voice commands are active during waiting */}
          <VoiceCommands 
            onCommand={handleVoiceCommand}
            enabled={true}
            hideUI={true}
          />
        </div>
      ) : (
        <div className="flow-session">
          <div className="session-header">
            <h2>{flow[currentIndex]?.name || 'Yoga Session'}</h2>
            <p>Breaths remaining: {remainingBreaths}</p>
            <button onClick={() => invoke('stop')} className="end-session-btn">
              End Session
            </button>
          </div>
          
          {/* Voice commands are automatically active during sessions */}
          <VoiceCommands 
            onCommand={handleVoiceCommand}
            enabled={true}
            hideUI={true}
          />
        </div>
      )}
    </div>
  );
}
