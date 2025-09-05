// Centralized audio manager for coordinated sound playback
export class AudioManager {
  constructor() {
    this.audioContext = null;
    this.masterGain = null;
    this.isInitialized = false;
    this.activeSources = new Map(); // Track all active sources by ID
    this.sourceCounter = 0;
    
    // Audio channel gains for mixing
    this.channels = {
      breath: null,
      beep: null,
      ambience: null,
      tts: null
    };
    
    // Breath sound settings
    this.breathSettings = {
      inhaleTime: 4000,
      holdTime: 2000,
      exhaleTime: 6000,
      volume: 0.3
    };
    
    // Current breath state
    this.breathState = {
      isActive: false,
      currentPhase: 'idle', // 'inhale', 'hold', 'exhale', 'idle'
      startTime: 0
    };
  }

  async init() {
    if (this.isInitialized) return true;
    
    try {
      this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
      
      // Create master gain
      this.masterGain = this.audioContext.createGain();
      this.masterGain.connect(this.audioContext.destination);
      this.masterGain.gain.value = 1.0;
      
      // Create channel gains for mixing different audio types
      Object.keys(this.channels).forEach(channel => {
        this.channels[channel] = this.audioContext.createGain();
        this.channels[channel].connect(this.masterGain);
      });
      
      // Set channel volumes
      this.channels.breath.gain.value = 0.4;
      this.channels.beep.gain.value = 0.3;
      this.channels.ambience.gain.value = 0.2;
      this.channels.tts.gain.value = 1.0;
      
      this.isInitialized = true;
      console.log('AudioManager initialized');
      return true;
    } catch (error) {
      console.error('Failed to initialize AudioManager:', error);
      return false;
    }
  }

  // Generate a unique ID for tracking sources
  generateSourceId() {
    return `source_${++this.sourceCounter}`;
  }

  // Create synchronized beep at exact timing
  playBeep(frequency = 110, duration = 120, delay = 0) {
    if (!this.audioContext) return null;
    
    const sourceId = this.generateSourceId();
    const startTime = this.audioContext.currentTime + delay;
    
    try {
      const oscillator = this.audioContext.createOscillator();
      const gainNode = this.audioContext.createGain();
      
      oscillator.type = 'sine';
      oscillator.frequency.value = frequency;
      
      // Smooth envelope
      gainNode.gain.setValueAtTime(0, startTime);
      gainNode.gain.linearRampToValueAtTime(0.3, startTime + 0.01);
      gainNode.gain.exponentialRampToValueAtTime(0.001, startTime + duration / 1000);
      
      oscillator.connect(gainNode);
      gainNode.connect(this.channels.beep);
      
      oscillator.start(startTime);
      oscillator.stop(startTime + duration / 1000);
      
      // Track and cleanup
      this.activeSources.set(sourceId, { oscillator, gainNode, type: 'beep' });
      oscillator.onended = () => {
        this.activeSources.delete(sourceId);
      };
      
      return sourceId;
    } catch (error) {
      console.error('Failed to create beep:', error);
      return null;
    }
  }

  // Create continuous breath sound with precise timing
  createBreathSound(phase, duration, startTime = 0) {
    if (!this.audioContext || phase === 'hold') return null;
    
    const sourceId = this.generateSourceId();
    const actualStartTime = this.audioContext.currentTime + startTime;
    
    try {
      // Create longer buffer to avoid cuts
      const bufferDuration = duration + 0.5; // Add padding
      const bufferSize = this.audioContext.sampleRate * bufferDuration;
      const buffer = this.audioContext.createBuffer(1, bufferSize, this.audioContext.sampleRate);
      const output = buffer.getChannelData(0);
      
      // Generate brown noise
      let lastOut = 0.0;
      const isInhale = phase === 'inhale';
      
      for (let i = 0; i < bufferSize; i++) {
        const progress = i / bufferSize;
        const filterCoeff = isInhale 
          ? 0.02 + (progress * 0.012)
          : 0.032 - (progress * 0.012);
        
        const white = Math.random() * 2 - 1;
        output[i] = (lastOut + (filterCoeff * white)) / (1 + filterCoeff);
        lastOut = output[i];
        output[i] *= 2.2;
      }
      
      // Create source and filters
      const source = this.audioContext.createBufferSource();
      const gainNode = this.audioContext.createGain();
      const highPassFilter = this.audioContext.createBiquadFilter();
      const lowPassFilter = this.audioContext.createBiquadFilter();
      
      source.buffer = buffer;
      
      // Configure filters
      highPassFilter.type = 'highpass';
      highPassFilter.frequency.value = isInhale ? 80 : 60;
      highPassFilter.Q.value = 0.7;
      
      lowPassFilter.type = 'lowpass';
      lowPassFilter.frequency.value = isInhale ? 1200 : 800;
      lowPassFilter.Q.value = 1;
      
      // Precise envelope timing
      const attackTime = 0.2;
      const releaseTime = 0.3;
      
      gainNode.gain.setValueAtTime(0, actualStartTime);
      gainNode.gain.linearRampToValueAtTime(0.7, actualStartTime + attackTime);
      gainNode.gain.setValueAtTime(0.7, actualStartTime + duration - releaseTime);
      gainNode.gain.linearRampToValueAtTime(0, actualStartTime + duration);
      
      // Connect audio graph
      source.connect(highPassFilter);
      highPassFilter.connect(lowPassFilter);
      lowPassFilter.connect(gainNode);
      gainNode.connect(this.channels.breath);
      
      // Start with precise timing
      source.start(actualStartTime);
      source.stop(actualStartTime + duration);
      
      // Track source
      const sourceInfo = { source, gainNode, highPassFilter, lowPassFilter, type: 'breath', phase };
      this.activeSources.set(sourceId, sourceInfo);
      
      source.onended = () => {
        this.activeSources.delete(sourceId);
      };
      
      return sourceId;
    } catch (error) {
      console.error('Failed to create breath sound:', error);
      return null;
    }
  }

  // Start synchronized breath cycle with beeps
  startBreathCycle() {
    if (this.breathState.isActive) return;
    
    this.breathState.isActive = true;
    this.breathState.startTime = this.audioContext.currentTime;
    
    const runCycle = () => {
      if (!this.breathState.isActive) return;
      
      const cycleStartTime = this.audioContext.currentTime;
      
      // 1. INHALE: Play beep and breath sound simultaneously
      this.breathState.currentPhase = 'inhale';
      this.playBeep(110, 120, 0); // Beep starts immediately
      this.createBreathSound('inhale', this.breathSettings.inhaleTime / 1000, 0); // Breath starts immediately
      
      // 2. HOLD: Silent phase
      setTimeout(() => {
        if (!this.breathState.isActive) return;
        this.breathState.currentPhase = 'hold';
        console.log('Hold phase - silent');
      }, this.breathSettings.inhaleTime);
      
      // 3. EXHALE: Just breath sound, no beep
      setTimeout(() => {
        if (!this.breathState.isActive) return;
        this.breathState.currentPhase = 'exhale';
        this.createBreathSound('exhale', this.breathSettings.exhaleTime / 1000, 0);
      }, this.breathSettings.inhaleTime + this.breathSettings.holdTime);
      
      // 4. Schedule next cycle
      const totalCycleTime = this.breathSettings.inhaleTime + this.breathSettings.holdTime + this.breathSettings.exhaleTime;
      this.breathCycleTimeout = setTimeout(runCycle, totalCycleTime);
    };
    
    console.log('Starting synchronized breath cycle');
    runCycle();
  }

  stopBreathCycle() {
    this.breathState.isActive = false;
    this.breathState.currentPhase = 'idle';
    
    if (this.breathCycleTimeout) {
      clearTimeout(this.breathCycleTimeout);
      this.breathCycleTimeout = null;
    }
    
    // Gracefully fade out breath sounds
    this.activeSources.forEach((sourceInfo, sourceId) => {
      if (sourceInfo.type === 'breath') {
        try {
          const now = this.audioContext.currentTime;
          sourceInfo.gainNode.gain.cancelScheduledValues(now);
          sourceInfo.gainNode.gain.setValueAtTime(sourceInfo.gainNode.gain.value, now);
          sourceInfo.gainNode.gain.linearRampToValueAtTime(0, now + 0.15);
          
          setTimeout(() => {
            try {
              sourceInfo.source.stop();
            } catch (e) {
              // Source may already be stopped
            }
            this.activeSources.delete(sourceId);
          }, 200);
        } catch (error) {
          console.warn('Error stopping breath source:', error);
        }
      }
    });
    
    console.log('Breath cycle stopped');
  }

  // Get total breath cycle time
  getBreathCycleTime() {
    return this.breathSettings.inhaleTime + this.breathSettings.holdTime + this.breathSettings.exhaleTime;
  }

  // Set channel volumes
  setChannelVolume(channel, volume) {
    if (this.channels[channel]) {
      this.channels[channel].gain.value = Math.max(0, Math.min(1, volume));
    }
  }

  // Stop all audio sources
  stopAll() {
    this.stopBreathCycle();
    
    this.activeSources.forEach((sourceInfo, sourceId) => {
      try {
        if (sourceInfo.source) {
          sourceInfo.source.stop();
        } else if (sourceInfo.oscillator) {
          sourceInfo.oscillator.stop();
        }
      } catch (e) {
        // Source may already be stopped
      }
    });
    
    this.activeSources.clear();
  }

  // Get audio context for external use (TTS, etc.)
  getAudioContext() {
    return this.audioContext;
  }

  // Get specific channel gain node for external connections
  getChannel(channelName) {
    return this.channels[channelName];
  }
}

// Create singleton instance
export const audioManager = new AudioManager();
