import React, { useState, useRef, useEffect } from 'react';
import { breathSoundGenerator } from '../services/breathSounds';
import { ambienceGenerator } from '../services/ambienceGenerator';
import { createTTSClient, speakWith } from '../services/ttsWorkerClient';
import { VoiceCommandService } from '../services/VoiceCommandService';

export function BreathSoundTest() {
  const [isPlaying, setIsPlaying] = useState(false);
  const [isInitialized, setIsInitialized] = useState(false);
  
  // Checkboxes for different audio components
  const [enableBreath, setEnableBreath] = useState(true);
  const [enableBeep, setEnableBeep] = useState(true);
  const [enableInstruction, setEnableInstruction] = useState(false);
  const [enableAmbience, setEnableAmbience] = useState(false);
  const [enableCommandInput, setEnableCommandInput] = useState(false);

  // Service references
  const ttsWorkerRef = useRef(null);
  const voiceServiceRef = useRef(null);
  const [voiceStatus, setVoiceStatus] = useState('inactive');
  const [lastVoiceCommand, setLastVoiceCommand] = useState('');
  const [ttsStatus, setTtsStatus] = useState('inactive');

  // Initialize TTS worker
  useEffect(() => {
    if (enableInstruction && !ttsWorkerRef.current) {
      setTtsStatus('loading');
      ttsWorkerRef.current = createTTSClient((event) => {
        console.log('TTS Worker message:', event.data);
        const { status, audio, error } = event.data;
        
        if (status === 'ready') {
          setTtsStatus('ready');
        } else if (status === 'complete' && audio) {
          // Play the generated audio
          const audioElement = new Audio(audio);
          audioElement.play().catch(e => console.warn('Audio play failed:', e));
          setTtsStatus('ready');
        } else if (status === 'error') {
          console.error('TTS Error:', error);
          setTtsStatus('error');
        }
      });
    }
    return () => {
      if (ttsWorkerRef.current) {
        ttsWorkerRef.current.terminate();
        ttsWorkerRef.current = null;
        setTtsStatus('inactive');
      }
    };
  }, [enableInstruction]);

  // Initialize Voice Command Service
  useEffect(() => {
    if (enableCommandInput && !voiceServiceRef.current) {
      voiceServiceRef.current = new VoiceCommandService(
        (command) => {
          console.log('Voice command received:', command);
          setLastVoiceCommand(command.text || command);
        },
        (status) => {
          console.log('Voice status:', status);
          setVoiceStatus(status.status);
        }
      );
    }
    return () => {
      if (voiceServiceRef.current) {
        voiceServiceRef.current.stopListening();
        voiceServiceRef.current = null;
      }
    };
  }, [enableCommandInput]);

  const initializeAudio = async () => {
    if (!isInitialized) {
      const success = await breathSoundGenerator.init();
      if (success && enableAmbience) {
        ambienceGenerator.init();
      }
      setIsInitialized(success);
      return success;
    }
    return true;
  };

  // Simple beep function for testing
  const playBeep = (frequency = 110, duration = 120) => {
    if (!enableBeep || !breathSoundGenerator.audioContext) return;
    
    try {
      const ctx = breathSoundGenerator.audioContext;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      
      osc.type = 'sine';
      osc.frequency.value = frequency;
      
      gain.gain.setValueAtTime(0.001, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.3, ctx.currentTime + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + duration / 1000);
      
      osc.connect(gain).connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + duration / 1000);
    } catch (e) {
      console.warn('Beep failed', e);
    }
  };

  // Real TTS instruction function
  const playInstruction = () => {
    if (!enableInstruction || !ttsWorkerRef.current || ttsStatus !== 'ready') {
      console.log('TTS not ready:', { enableInstruction, hasWorker: !!ttsWorkerRef.current, ttsStatus });
      return;
    }
    const instructions = [
      "Take a deep breath in",
      "Now breathe out slowly", 
      "Feel your body relax",
      "Focus on your breathing"
    ];
    const randomInstruction = instructions[Math.floor(Math.random() * instructions.length)];
    console.log('Playing TTS instruction:', randomInstruction);
    setTtsStatus('generating');
    speakWith(ttsWorkerRef.current, randomInstruction);
  };

  // Test TTS immediately
  const testTTS = () => {
    if (!ttsWorkerRef.current || ttsStatus !== 'ready') {
      alert(`TTS not ready. Status: ${ttsStatus}`);
      return;
    }
    console.log('Testing TTS immediately');
    setTtsStatus('generating');
    speakWith(ttsWorkerRef.current, "This is a test of the text to speech system.");
  };

  // Real voice command activation
  const activateVoiceCommands = () => {
    if (!enableCommandInput || !voiceServiceRef.current) return;
    
    console.log('Activating voice command listening');
    voiceServiceRef.current.startListening();
  };

  const deactivateVoiceCommands = () => {
    if (voiceServiceRef.current) {
      console.log('Deactivating voice command listening');
      voiceServiceRef.current.stopListening();
    }
  };

  const startTest = async () => {
    const initialized = await initializeAudio();
    if (!initialized) {
      alert('Failed to initialize audio. Please check your browser permissions.');
      return;
    }

    setIsPlaying(true);
    console.log('Starting audio test with:', {
      breath: enableBreath,
      beep: enableBeep,
      instruction: enableInstruction,
      ambience: enableAmbience,
      commandInput: enableCommandInput
    });

    // Start ambience if enabled
    if (enableAmbience) {
      ambienceGenerator.startAmbience('nature');
    }

    // Start voice command listening if enabled
    if (enableCommandInput) {
      activateVoiceCommands();
    }

    // Start breathing cycle with conditional beeps
    const originalStartBreathingCycle = breathSoundGenerator.startBreathingCycle.bind(breathSoundGenerator);
    
    if (enableBreath) {
      // Override breath cycle to include conditional beeps
      breathSoundGenerator.startBreathingCycle = function() {
        if (this.isPlaying) return;
        
        this.isPlaying = true;
        this.currentSources = [];
        
        const breathCycle = () => {
          if (!this.isPlaying) return;

          // Play beep if enabled
          if (enableBeep) {
            playBeep(110, 120);
          }

          // Play instruction if enabled
          if (enableInstruction) {
            playInstruction();
          }

          // 1. Inhale phase (includes hold time in the sound envelope)
          if (enableBreath) {
            const inhaleSource = this.createBreathSound(
              null,
              this.settings.inhaleTime / 1000, 
              'inhale'
            );
          }

          // 2. Exhale phase starts after inhale+hold time
          const inhaleAndHoldTime = this.settings.inhaleTime + this.settings.holdTime;
          setTimeout(() => {
            if (this.isPlaying && enableBreath) {
              const exhaleSource = this.createBreathSound(
                null,
                this.settings.exhaleTime / 1000, 
                'exhale'
              );
            }
          }, inhaleAndHoldTime);

          // Schedule next complete breath cycle
          const totalCycleTime = this.settings.inhaleTime + this.settings.holdTime + this.settings.exhaleTime + this.settings.holdTime;
          this.breathLoop = setTimeout(() => {
            breathCycle();
          }, totalCycleTime);
        };

        console.log('Starting custom breath cycle with selective components');
        breathCycle();
      };

      breathSoundGenerator.startBreathingCycle();
    } else {
      // Just run the timing cycle without breath sounds
      const runTimingOnly = () => {
        if (!isPlaying) return;

        if (enableBeep) {
          playBeep(110, 120);
        }

        if (enableInstruction) {
          playInstruction();
        }

        const totalCycleTime = breathSoundGenerator.settings.inhaleTime + breathSoundGenerator.settings.holdTime + breathSoundGenerator.settings.exhaleTime + breathSoundGenerator.settings.holdTime;
        setTimeout(runTimingOnly, totalCycleTime);
      };
      runTimingOnly();
    }
  };

  const stopTest = () => {
    setIsPlaying(false);
    breathSoundGenerator.stopBreathingCycle();
    ambienceGenerator.stopAmbience();
    deactivateVoiceCommands();
    console.log('Stopped all audio test components');
  };

  return (
    <div style={{ 
      padding: '20px', 
      margin: '20px', 
      border: '2px solid #ccc', 
      borderRadius: '8px',
      backgroundColor: '#f9f9f9'
    }}>
      <h3>Audio Components Isolation Test</h3>
      <p style={{ fontSize: '14px', color: '#666', marginBottom: '20px' }}>
        Enable/disable different audio components to identify conflicts
      </p>
      
      {/* Component Checkboxes */}
      <div style={{ marginBottom: '20px' }}>
        <h4 style={{ marginBottom: '10px' }}>Audio Components:</h4>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '10px' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <input
              type="checkbox"
              checked={enableBreath}
              onChange={(e) => setEnableBreath(e.target.checked)}
              disabled={isPlaying}
            />
            <span>🫁 Breath Sounds</span>
          </label>
          
          <label style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <input
              type="checkbox"
              checked={enableBeep}
              onChange={(e) => setEnableBeep(e.target.checked)}
              disabled={isPlaying}
            />
            <span>🔔 Beeps</span>
          </label>
          
          <label style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <input
              type="checkbox"
              checked={enableInstruction}
              onChange={(e) => setEnableInstruction(e.target.checked)}
              disabled={isPlaying}
            />
            <span>🗣️ Instructions (TTS)</span>
          </label>
          
          <label style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <input
              type="checkbox"
              checked={enableAmbience}
              onChange={(e) => setEnableAmbience(e.target.checked)}
              disabled={isPlaying}
            />
            <span>🌿 Ambience</span>
          </label>
          
          <label style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <input
              type="checkbox"
              checked={enableCommandInput}
              onChange={(e) => setEnableCommandInput(e.target.checked)}
              disabled={isPlaying}
            />
            <span>🎤 Voice Commands</span>
          </label>
        </div>
      </div>

      {/* Control Buttons */}
      <div style={{ display: 'flex', gap: '15px', marginBottom: '20px', flexWrap: 'wrap' }}>
        <button 
          onClick={startTest}
          disabled={isPlaying}
          style={{
            padding: '12px 24px',
            backgroundColor: isPlaying ? '#ccc' : '#4CAF50',
            color: 'white',
            border: 'none',
            borderRadius: '5px',
            cursor: isPlaying ? 'not-allowed' : 'pointer',
            fontSize: '16px',
            fontWeight: 'bold'
          }}
        >
          ▶️ Start Test
        </button>
        
        <button 
          onClick={stopTest}
          disabled={!isPlaying}
          style={{
            padding: '12px 24px',
            backgroundColor: !isPlaying ? '#ccc' : '#f44336',
            color: 'white',
            border: 'none',
            borderRadius: '5px',
            cursor: !isPlaying ? 'not-allowed' : 'pointer',
            fontSize: '16px',
            fontWeight: 'bold'
          }}
        >
          ⏹️ Stop Test
        </button>

        {enableInstruction && (
          <button 
            onClick={testTTS}
            disabled={ttsStatus !== 'ready'}
            style={{
              padding: '12px 24px',
              backgroundColor: ttsStatus !== 'ready' ? '#ccc' : '#2196F3',
              color: 'white',
              border: 'none',
              borderRadius: '5px',
              cursor: ttsStatus !== 'ready' ? 'not-allowed' : 'pointer',
              fontSize: '14px'
            }}
          >
            🗣️ Test TTS
          </button>
        )}
      </div>
      
      {/* Status Display */}
      <div style={{ fontSize: '12px', color: '#888', backgroundColor: '#f0f0f0', padding: '10px', borderRadius: '5px' }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '5px' }}>
          <p><strong>Status:</strong> {isInitialized ? '✅ Audio initialized' : '❌ Audio not initialized'}</p>
          <p><strong>Test:</strong> {isPlaying ? '🔄 Running' : '⏹️ Stopped'}</p>
          <p><strong>Voice:</strong> {voiceStatus === 'listening' ? '🎤 Listening' : voiceStatus === 'error' ? '❌ Error' : '⏹️ Inactive'}</p>
          <p><strong>TTS:</strong> {
            ttsStatus === 'ready' ? '✅ Ready' : 
            ttsStatus === 'loading' ? '⏳ Loading' : 
            ttsStatus === 'generating' ? '🔄 Speaking' :
            ttsStatus === 'error' ? '❌ Error' : '⏹️ Inactive'
          }</p>
          <p><strong>Last Command:</strong> {lastVoiceCommand || 'None'}</p>
        </div>
        <p style={{ marginTop: '10px' }}><strong>Active Components:</strong> {
          [
            enableBreath && 'Breath',
            enableBeep && 'Beep', 
            enableInstruction && 'TTS',
            enableAmbience && 'Ambience',
            enableCommandInput && 'Voice'
          ].filter(Boolean).join(', ') || 'None'
        }</p>
      </div>
    </div>
  );
}
