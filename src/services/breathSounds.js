// Breath sound generator for yoga breathing guidance
export class BreathSoundGenerator {
  constructor() {
    this.audioContext = null;
    this.masterGain = null;
    this.isPlaying = false;
    this.breathLoop = null;
    this.currentSources = []; // Track active sources
    this.settings = {
      inhaleTime: 4000, // ms
      holdTime: 2000,   // ms - now integrated into breath sounds
      exhaleTime: 6000, // ms
      volume: 0.2 // Lower volume for the noise-based breath sounds
    };
  }

  async init() {
    try {
      this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
      this.masterGain = this.audioContext.createGain();
      this.masterGain.connect(this.audioContext.destination);
      this.masterGain.gain.value = this.settings.volume;
      return true;
    } catch (error) {
      console.error('Failed to initialize breath sound generator:', error);
      return false;
    }
  }

  createBreathSound(_, duration, type = 'inhale') {
    console.log(`Creating ${type} sound for ${duration}s`);
    if (!this.audioContext) return null;

    // For hold phase, return early (silence) - this shouldn't be called anymore
    if (type === 'hold') {
      return null;
    }

    // Include hold time in the breath sound duration for natural flow
    const holdTimeSeconds = this.settings.holdTime / 1000;
    const totalDuration = duration + holdTimeSeconds;

    // Create noise buffer for inhale/exhale including hold period
    const bufferSize = this.audioContext.sampleRate * totalDuration;
    const buffer = this.audioContext.createBuffer(1, bufferSize, this.audioContext.sampleRate);
    const output = buffer.getChannelData(0);
    
    // Generate brown noise with movement for inhale/exhale
    let lastOut = 0.0;
    const isInhale = type === 'inhale';
    
    for (let i = 0; i < bufferSize; i++) {
      const progress = i / bufferSize;
      
      // Create movement in the noise characteristics
      let filterCoeff = isInhale 
        ? 0.02 + (progress * 0.015)  // Brown to reddish-brown for inhale
        : 0.035 - (progress * 0.015); // Reddish-brown to brown for exhale
      
      const white = Math.random() * 2 - 1;
      output[i] = (lastOut + (filterCoeff * white)) / (1 + filterCoeff);
      lastOut = output[i];
      output[i] *= 2.5; // Amplify
    }
    
    // Create buffer source
    const noiseSource = this.audioContext.createBufferSource();
    noiseSource.buffer = buffer;
    
    // Create filters and effects chain
    const highPassFilter = this.audioContext.createBiquadFilter();
    const lowPassFilter = this.audioContext.createBiquadFilter();
    const gainNode = this.audioContext.createGain();
    
    // Create simple reverb using convolution
    const reverbGain = this.audioContext.createGain();
    const dryGain = this.audioContext.createGain();
    const wetGain = this.audioContext.createGain();
    
    // Create impulse response for reverb
    const reverbBuffer = this.createReverbImpulse(0.8, 0.3); // 0.8s decay, 0.3 reverb
    const convolver = this.audioContext.createConvolver();
    convolver.buffer = reverbBuffer;
    
    // High pass filter with movement
    highPassFilter.type = 'highpass';
    const baseFreq = isInhale ? 80 : 60;
    highPassFilter.frequency.setValueAtTime(baseFreq, this.audioContext.currentTime);
    highPassFilter.frequency.linearRampToValueAtTime(
      baseFreq + (isInhale ? 40 : -20), 
      this.audioContext.currentTime + totalDuration
    );
    highPassFilter.Q.value = 0.7;
    
    // Low pass filter for warmth
    lowPassFilter.type = 'lowpass';
    lowPassFilter.frequency.value = isInhale ? 1200 : 800;
    lowPassFilter.Q.value = 1;

    // Natural envelope shaping that includes the hold period
    const now = this.audioContext.currentTime;
    const breathPhaseTime = duration; // Just the inhale or exhale time
    const holdPhaseTime = holdTimeSeconds;
    
    if (isInhale) {
      // Inhale: Quick natural attack like exhale, sustain, then fade out with silence gap
      const attackTime = breathPhaseTime * 0.2;  // Quick but smooth start (matching exhale)
      const sustainEnd = breathPhaseTime * 0.6;   // Sustain for 60% (matching exhale)
      const fadeOutStart = breathPhaseTime * 0.75; // Start fading at 75%
      const fadeOutEnd = breathPhaseTime * 0.95;  // Complete fade by 95%, leaving silence
      
      gainNode.gain.setValueAtTime(0, now);
      gainNode.gain.linearRampToValueAtTime(0.7, now + attackTime); // Quick smooth start
      gainNode.gain.setValueAtTime(0.7, now + sustainEnd);
      gainNode.gain.linearRampToValueAtTime(0.3, now + fadeOutStart);
      gainNode.gain.linearRampToValueAtTime(0, now + fadeOutEnd);
      // Silence for rest of inhale + hold period
      gainNode.gain.setValueAtTime(0, now + totalDuration);
    } else {
      // Exhale: Natural attack, sustain, then fade out with silence gap before next cycle
      const attackTime = breathPhaseTime * 0.15; // Quick but smooth start
      const sustainEnd = breathPhaseTime * 0.6;   // Sustain for 60% of exhale
      const fadeOutStart = breathPhaseTime * 0.7; // Start gentle fade
      const fadeOutEnd = breathPhaseTime * 0.9;   // Complete fade by 90%, leaving silence
      
      gainNode.gain.setValueAtTime(0, now);
      gainNode.gain.linearRampToValueAtTime(0.6, now + attackTime); // Smooth start
      gainNode.gain.setValueAtTime(0.6, now + sustainEnd);
      gainNode.gain.linearRampToValueAtTime(0.3, now + fadeOutStart);
      gainNode.gain.linearRampToValueAtTime(0, now + fadeOutEnd);
      // Silence for rest of exhale + hold period
      gainNode.gain.setValueAtTime(0, now + totalDuration);
    }
    
    // Reverb mix
    dryGain.gain.value = 0.7;
    wetGain.gain.value = 0.3;
    reverbGain.gain.value = 0.4;

    // Connect the audio graph
    noiseSource.connect(highPassFilter);
    highPassFilter.connect(lowPassFilter);
    lowPassFilter.connect(gainNode);
    
    // Dry path
    gainNode.connect(dryGain);
    dryGain.connect(this.masterGain);
    
    // Wet path (reverb)
    gainNode.connect(convolver);
    convolver.connect(wetGain);
    wetGain.connect(reverbGain);
    reverbGain.connect(this.masterGain);

    // Start the source
    noiseSource.start(now);
    noiseSource.stop(now + totalDuration);

    // Clean up when done
    noiseSource.onended = () => {
      const index = this.currentSources.indexOf(sourceInfo);
      if (index > -1) {
        this.currentSources.splice(index, 1);
      }
    };

    const sourceInfo = { noiseSource, gainNode, highPassFilter, lowPassFilter, convolver };
    this.currentSources.push(sourceInfo);

    return sourceInfo;
  }

  // Create a simple reverb impulse response
  createReverbImpulse(decayTime, reverbAmount) {
    const length = this.audioContext.sampleRate * decayTime;
    const impulse = this.audioContext.createBuffer(2, length, this.audioContext.sampleRate);
    
    for (let channel = 0; channel < 2; channel++) {
      const channelData = impulse.getChannelData(channel);
      for (let i = 0; i < length; i++) {
        const decay = Math.pow(1 - (i / length), 2);
        channelData[i] = (Math.random() * 2 - 1) * decay * reverbAmount;
      }
    }
    
    return impulse;
  }

  startBreathingCycle() {
    if (this.isPlaying) return;
    
    this.isPlaying = true;
    this.currentSources = []; // Reset sources
    
    const breathCycle = () => {
      if (!this.isPlaying) return;

      // Simplified breath cycle: just inhale and exhale (holds are integrated)
      
      // 1. Inhale phase (includes hold time in the sound envelope)
      const inhaleSource = this.createBreathSound(
        null,
        this.settings.inhaleTime / 1000, 
        'inhale'
      );

      // 2. Exhale phase starts after inhale+hold time (includes its own hold fade)
      const inhaleAndHoldTime = this.settings.inhaleTime + this.settings.holdTime;
      setTimeout(() => {
        if (this.isPlaying) {
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

    console.log('Starting continuous breath cycle with integrated holds');
    breathCycle();
  }

  // Get the total time for one complete breath cycle (includes both holds)
  getBreathCycleTime() {
    return this.settings.inhaleTime + this.settings.holdTime + this.settings.exhaleTime + this.settings.holdTime;
  }

  stopBreathingCycle() {
    this.isPlaying = false;
    if (this.breathLoop) {
      clearTimeout(this.breathLoop);
      this.breathLoop = null;
    }
    
    // Stop all current audio sources gracefully
    this.currentSources.forEach(source => {
      if (source.noiseSource) {
        try {
          // Fade out current sources instead of abrupt stop
          const now = this.audioContext.currentTime;
          source.gainNode.gain.cancelScheduledValues(now);
          source.gainNode.gain.setValueAtTime(source.gainNode.gain.value, now);
          source.gainNode.gain.linearRampToValueAtTime(0, now + 0.1);
          
          setTimeout(() => {
            try {
              source.noiseSource.stop();
            } catch (e) {
              // Source may already be stopped
            }
          }, 150);
        } catch (e) {
          console.warn('Error stopping breath source:', e);
        }
      }
    });
    
    this.currentSources = [];
    console.log('Breath cycle stopped');
  }

  updateSettings(newSettings) {
    this.settings = { ...this.settings, ...newSettings };
    if (this.masterGain) {
      this.masterGain.gain.value = this.settings.volume;
    }
  }

  setVolume(volume) {
    this.settings.volume = Math.max(0, Math.min(1, volume));
    if (this.masterGain) {
      this.masterGain.gain.value = this.settings.volume;
    }
  }
}

// Create a singleton instance
export const breathSoundGenerator = new BreathSoundGenerator();
