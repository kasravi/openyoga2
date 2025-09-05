// Background ambience generator for yoga practice
export class AmbienceGenerator {
  constructor() {
    this.audioContext = null;
    this.masterGain = null;
    this.sources = [];
    this.isPlaying = false;
    this.currentAmbience = 'nature';
  }

  async init() {
    try {
      this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
      this.masterGain = this.audioContext.createGain();
      this.masterGain.connect(this.audioContext.destination);
      this.masterGain.gain.value = 0.2; // Low volume for background
      return true;
    } catch (error) {
      console.error('Failed to initialize ambience generator:', error);
      return false;
    }
  }

  // Generate procedural nature sounds
  createNatureAmbience() {
    const sources = [];

    // Wind sound (brown noise filtered)
    const windNoise = this.createBrownNoise();
    const windFilter = this.audioContext.createBiquadFilter();
    windFilter.type = 'bandpass';
    windFilter.frequency.value = 200;
    windFilter.Q.value = 0.5;
    
    const windGain = this.audioContext.createGain();
    windGain.gain.value = 0.3;
    
    windNoise.connect(windFilter);
    windFilter.connect(windGain);
    windGain.connect(this.masterGain);
    
    sources.push({ type: 'wind', nodes: [windNoise, windFilter, windGain] });

    // Gentle water trickle (filtered white noise)
    const waterNoise = this.createWhiteNoise();
    const waterFilter = this.audioContext.createBiquadFilter();
    waterFilter.type = 'lowpass';
    waterFilter.frequency.value = 1200;
    waterFilter.Q.value = 2;
    
    const waterGain = this.audioContext.createGain();
    waterGain.gain.value = 0.2;
    
    waterNoise.connect(waterFilter);
    waterFilter.connect(waterGain);
    waterGain.connect(this.masterGain);
    
    sources.push({ type: 'water', nodes: [waterNoise, waterFilter, waterGain] });

    // Distant bird chirps (occasional synthesis)
    this.scheduleBirdChirps();

    return sources;
  }

  createBrownNoise() {
    const bufferSize = this.audioContext.sampleRate * 2; // 2 seconds
    const buffer = this.audioContext.createBuffer(1, bufferSize, this.audioContext.sampleRate);
    const output = buffer.getChannelData(0);
    
    let lastOut = 0.0;
    for (let i = 0; i < bufferSize; i++) {
      const white = Math.random() * 2 - 1;
      output[i] = (lastOut + (0.02 * white)) / 1.02;
      lastOut = output[i];
      output[i] *= 3.5; // Compensation for volume reduction
    }
    
    const noise = this.audioContext.createBufferSource();
    noise.buffer = buffer;
    noise.loop = true;
    noise.start();
    
    return noise;
  }

  createWhiteNoise() {
    const bufferSize = this.audioContext.sampleRate * 2;
    const buffer = this.audioContext.createBuffer(1, bufferSize, this.audioContext.sampleRate);
    const output = buffer.getChannelData(0);
    
    for (let i = 0; i < bufferSize; i++) {
      output[i] = Math.random() * 2 - 1;
    }
    
    const noise = this.audioContext.createBufferSource();
    noise.buffer = buffer;
    noise.loop = true;
    noise.start();
    
    return noise;
  }

  scheduleBirdChirps() {
    if (!this.isPlaying) return;

    const createChirp = () => {
      const osc = this.audioContext.createOscillator();
      const gain = this.audioContext.createGain();
      
      osc.type = 'sine';
      osc.frequency.setValueAtTime(1200 + Math.random() * 800, this.audioContext.currentTime);
      
      const now = this.audioContext.currentTime;
      gain.gain.setValueAtTime(0, now);
      gain.gain.linearRampToValueAtTime(0.1, now + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.3);
      
      osc.connect(gain);
      gain.connect(this.masterGain);
      
      osc.start(now);
      osc.stop(now + 0.3);
    };

    // Create a chirp with some randomness
    if (Math.random() < 0.3) {
      createChirp();
      // Sometimes create a second chirp shortly after
      if (Math.random() < 0.4) {
        setTimeout(createChirp, 200 + Math.random() * 400);
      }
    }

    // Schedule next potential chirp
    setTimeout(() => this.scheduleBirdChirps(), 8000 + Math.random() * 12000);
  }

  createCalmAmbience() {
    const sources = [];

    // Subtle pad sound
    const osc1 = this.audioContext.createOscillator();
    const osc2 = this.audioContext.createOscillator();
    const gain1 = this.audioContext.createGain();
    const gain2 = this.audioContext.createGain();
    const filter = this.audioContext.createBiquadFilter();
    
    osc1.type = 'sine';
    osc1.frequency.value = 110; // A2
    osc2.type = 'sine'; 
    osc2.frequency.value = 165; // E3
    
    filter.type = 'lowpass';
    filter.frequency.value = 800;
    
    gain1.gain.value = 0.15;
    gain2.gain.value = 0.1;
    
    osc1.connect(gain1);
    osc2.connect(gain2);
    gain1.connect(filter);
    gain2.connect(filter);
    filter.connect(this.masterGain);
    
    osc1.start();
    osc2.start();
    
    sources.push({ type: 'pad', nodes: [osc1, osc2, gain1, gain2, filter] });
    
    return sources;
  }

  startAmbience(type = 'nature') {
    if (this.isPlaying) {
      this.stopAmbience();
    }

    this.currentAmbience = type;
    this.isPlaying = true;

    switch (type) {
      case 'nature':
        this.sources = this.createNatureAmbience();
        break;
      case 'calm':
        this.sources = this.createCalmAmbience();
        break;
      default:
        this.sources = this.createNatureAmbience();
    }
  }

  stopAmbience() {
    this.isPlaying = false;
    
    this.sources.forEach(source => {
      source.nodes.forEach(node => {
        try {
          if (node.stop) node.stop();
          if (node.disconnect) node.disconnect();
        } catch (e) {
          // Ignore errors from already disconnected nodes
        }
      });
    });
    
    this.sources = [];
  }

  setVolume(volume) {
    if (this.masterGain) {
      this.masterGain.gain.value = Math.max(0, Math.min(1, volume));
    }
  }
}

// Create singleton instance
export const ambienceGenerator = new AmbienceGenerator();
