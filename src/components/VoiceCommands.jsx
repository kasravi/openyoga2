import React, { useState, useEffect, useRef } from 'react';
import { VoiceCommandService } from '../services/VoiceCommandService.js';

export function VoiceCommands({ onCommand, enabled = true, hideUI = false }) {
  const [status, setStatus] = useState({ status: 'idle', message: 'Ready' });
  const [isListening, setIsListening] = useState(false);
  const [lastCommand, setLastCommand] = useState(null);
  const [commandHistory, setCommandHistory] = useState([]);
  const [voiceStatus, setVoiceStatus] = useState('inactive');
  const [lastVoiceCommand, setLastVoiceCommand] = useState('');
  const voiceServiceRef = useRef(null);

  useEffect(() => {
    // Initialize voice command service once when enabled (based on working BreathSoundTest logic)
    if (enabled && !voiceServiceRef.current) {
      console.log('🎤 Initializing voice command service');
      voiceServiceRef.current = new VoiceCommandService(
        (command) => {
          console.log('Voice command received:', command);
          const commandText = command.text || command;
          setLastVoiceCommand(commandText);
          setLastCommand(command);
          setCommandHistory(prev => [command, ...prev.slice(0, 9)]); // Keep last 10 commands
          
          // Use ref to avoid stale closure
          if (onCommandRef.current) {
            onCommandRef.current(command);
          }
        },
        (statusUpdate) => {
          console.log('Voice status:', statusUpdate);
          setVoiceStatus(statusUpdate.status);
          setStatus(statusUpdate);
          setIsListening(statusUpdate.status === 'listening');
        }
      );
      
      // Start listening immediately and let it run continuously
      console.log('🎤 Starting voice recognition - will run continuously');
      voiceServiceRef.current.startListening();
    }

    return () => {
      // Only cleanup when component unmounts (session ends)
      if (voiceServiceRef.current) {
        console.log('🛑 Cleaning up voice service (session ended)');
        voiceServiceRef.current.stopListening();
        voiceServiceRef.current = null;
      }
    };
  }, [enabled]); // Removed onCommand dependency to prevent re-creation

  // Update onCommand ref to avoid stale closures
  const onCommandRef = useRef(onCommand);
  useEffect(() => {
    onCommandRef.current = onCommand;
  }, [onCommand]);

  const toggleListening = () => {
    if (!voiceServiceRef.current) return;

    if (isListening) {
      console.log('🔇 Temporarily pausing voice recognition');
      voiceServiceRef.current.stopListening();
    } else {
      console.log('🎤 Resuming voice recognition');
      voiceServiceRef.current.startListening();
    }
  };

  const getStatusColor = () => {
    // Enhanced status colors from BreathSoundTest
    switch (voiceStatus) {
      case 'listening': return '#4CAF50';
      case 'error': return '#f44336';
      case 'warning': return '#ff9800';
      case 'inactive': return '#666';
      default: return '#666';
    }
  };

  if (!enabled) {
    return null;
  }

  // If hideUI is true, return a minimal invisible component that just handles voice commands
  if (hideUI) {
    return (
      <div style={{ display: 'none' }}>
        {/* Voice commands are active but invisible */}
      </div>
    );
  }

  return (
    <div className="voice-commands">
      <h3>Voice Commands</h3>
      
      <div className="voice-status">
        <div className="status-indicator" style={{ 
          display: 'flex', 
          alignItems: 'center', 
          gap: '10px',
          padding: '10px',
          backgroundColor: '#f5f5f5',
          borderRadius: '8px',
          marginBottom: '15px'
        }}>
          <div style={{
            width: '12px',
            height: '12px',
            borderRadius: '50%',
            backgroundColor: getStatusColor(),
            animation: isListening ? 'pulse 1.5s infinite' : 'none'
          }}></div>
          <span>{status.message}</span>
        </div>

        {/* Enhanced status from BreathSoundTest */}
        <div style={{ fontSize: '12px', color: '#666', backgroundColor: '#f0f0f0', padding: '10px', borderRadius: '5px', marginBottom: '15px' }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '5px' }}>
            <p><strong>Voice Status:</strong> {voiceStatus === 'listening' ? '🎤 Listening' : voiceStatus === 'error' ? '❌ Error' : '⏹️ Inactive'}</p>
            <p><strong>Last Command:</strong> {lastVoiceCommand || 'None'}</p>
          </div>
        </div>

        <button 
          onClick={toggleListening}
          style={{
            padding: '12px 24px',
            backgroundColor: isListening ? '#f44336' : '#4CAF50',
            color: 'white',
            border: 'none',
            borderRadius: '8px',
            cursor: 'pointer',
            marginBottom: '20px',
            fontSize: '16px'
          }}
        >
          {isListening ? '🛑 Stop Listening' : '🎤 Start Listening'}
        </button>
      </div>

      {lastCommand && (
        <div className="last-command" style={{
          padding: '15px',
          backgroundColor: '#e8f5e8',
          borderRadius: '8px',
          marginBottom: '15px'
        }}>
          <h4>Last Command:</h4>
          <pre style={{ 
            backgroundColor: 'white', 
            padding: '10px', 
            borderRadius: '4px',
            overflow: 'auto',
            fontSize: '14px'
          }}>
            {JSON.stringify(lastCommand, null, 2)}
          </pre>
        </div>
      )}

      <details>
        <summary style={{ cursor: 'pointer', fontWeight: 'bold' }}>
          Command History ({commandHistory.length})
        </summary>
        <div style={{ maxHeight: '200px', overflow: 'auto', marginTop: '10px' }}>
          {commandHistory.map((cmd, index) => (
            <div key={index} style={{
              padding: '8px',
              backgroundColor: index === 0 ? '#f0f8ff' : '#f9f9f9',
              borderRadius: '4px',
              marginBottom: '5px',
              fontSize: '12px'
            }}>
              <strong>{cmd.type}/{cmd.action}</strong> - "{cmd.originalText}"
              <br />
              <small>Confidence: {(cmd.confidence * 100).toFixed(0)}% | {new Date(cmd.timestamp).toLocaleTimeString()}</small>
            </div>
          ))}
        </div>
      </details>

      <style>
        {`
        @keyframes pulse {
          0% { opacity: 1; }
          50% { opacity: 0.5; }
          100% { opacity: 1; }
        }
        `}
      </style>
    </div>
  );
}
