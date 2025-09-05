(function () {
  // Minimal TTSService using kokoro-js streaming API with Web Speech fallback
  const KOKORO_JS_URL = 'https://cdn.jsdelivr.net/npm/kokoro-js@1.2.1/+esm';
  const KOKORO_SETTINGS = {
    modelId: 'onnx-community/Kokoro-82M-v1.0-ONNX',
    dtype: 'fp32', // 'fp32' | 'fp16' | 'q8' | 'q4' | 'q4f16'
    device: 'webgpu', // 'wasm' | 'webgpu' (if supported)
    voice: 'af_bella',    // e.g., 'af_bella'
    rate: 0.95,
    volume: 1.0
  };

  class KokoroJsEngine {
    constructor() {
      this.tts = null;
      this.mod = null; // access TextSplitterStream
      this.audioContext = null;
      this._currentSource = null;
    }

    async _ensureLoaded() {
      if (this.tts) return true;
      const mod = await import(/* @vite-ignore */ KOKORO_JS_URL);
      const KokoroTTS = mod.KokoroTTS || mod.default?.KokoroTTS;
      if (!KokoroTTS) throw new Error('KokoroTTS export not found');
      this.mod = mod;
      this.tts = await KokoroTTS.from_pretrained(KOKORO_SETTINGS.modelId, {
        dtype: KOKORO_SETTINGS.dtype,
        device: KOKORO_SETTINGS.device,
      });
      console.log('[TTS] kokoro-js ready');
      return true;
    }

    _ensureAudioContext() {
      if (!this.audioContext) this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
      return this.audioContext;
    }

    _playPCMFloat32(samples, sampleRate) {
      const ac = this._ensureAudioContext();
      const start = () => {
        try { this._currentSource?.stop(); } catch (_) {}
        const buf = ac.createBuffer(1, samples.length, sampleRate);
        buf.copyToChannel(samples, 0, 0);
        const src = ac.createBufferSource();
        src.buffer = buf;
        src.playbackRate.value = KOKORO_SETTINGS.rate;
        const gain = ac.createGain();
        gain.gain.value = KOKORO_SETTINGS.volume;
        src.connect(gain).connect(ac.destination);
        this._currentSource = src;
        return new Promise((resolve) => {
          src.onended = () => resolve(true);
          try { src.start(); } catch (_) { resolve(false); }
        });
      };
      if (ac.state === 'suspended') return ac.resume().then(start).catch(start);
      return start();
    }

    cancel() {
      try { this._currentSource?.stop(); } catch (_) {}
      this._currentSource = null;
    }

    async speak(text) {
      const utterance = String(text || '').trim();
      if (!utterance) return true;
      await this._ensureLoaded();

      const TextSplitterStream = this.mod.TextSplitterStream || this.mod.default?.TextSplitterStream;
      if (!TextSplitterStream) throw new Error('TextSplitterStream export not found');
      const splitter = new TextSplitterStream();
      const opts = KOKORO_SETTINGS.voice ? { voice: KOKORO_SETTINGS.voice } : undefined;
      const stream = this.tts.stream(splitter, opts);

      const chunks = [];
      let sr = 24000;
      const consume = (async () => {
        try {
          for await (const { audio } of stream) {
            const rate = audio?.sample_rate || audio?.sampleRate; if (rate) sr = rate;
            let pcm = null;
            if (audio instanceof Float32Array) pcm = audio;
            else if (audio?.float32Array) pcm = audio.float32Array;
            else if (audio?.array) pcm = new Float32Array(audio.array);
            else if (Array.isArray(audio)) pcm = new Float32Array(audio);
            if (pcm && pcm.length) chunks.push(pcm);
          }
        } catch (e) { console.warn('[TTS] kokoro stream error:', e); }
      })();

      // Push tokens quickly (word by word), then close
      const tokens = utterance.match(/\s*\S+/g) || [utterance];
      for (const tok of tokens) splitter.push(tok);
      splitter.close();

      await consume;

      if (!chunks.length) return false;
      if (chunks.length === 1) return this._playPCMFloat32(chunks[0], sr);
      let total = 0; for (const c of chunks) total += c.length;
      const merged = new Float32Array(total);
      let off = 0; for (const c of chunks) { merged.set(c, off); off += c.length; }
      return this._playPCMFloat32(merged, sr);
    }
  }

  class WebSpeechEngine {
    constructor(opts = {}) {
      this.rate = opts.rate ?? 1.0;
      this.pitch = opts.pitch ?? 1.0;
      this.volume = opts.volume ?? 1.0;
      this._voice = null;
      this._initVoices();
    }
    static isSupported() { return 'speechSynthesis' in window && 'SpeechSynthesisUtterance' in window; }
    _initVoices() {
      const pick = () => {
        const voices = window.speechSynthesis.getVoices();
        if (!voices?.length) return;
        this._voice = voices.find(v => /en/i.test(v.lang)) || voices[0] || null;
      };
      pick();
      window.speechSynthesis.onvoiceschanged = pick;
    }
    speak(text) {
      if (!WebSpeechEngine.isSupported()) return Promise.resolve();
      try { window.speechSynthesis.cancel(); } catch (_) {}
      return new Promise((resolve) => {
        const u = new SpeechSynthesisUtterance(String(text || ''));
        u.rate = this.rate; u.pitch = this.pitch; u.volume = this.volume;
        if (this._voice) u.voice = this._voice;
        u.onend = () => resolve();
        u.onerror = () => resolve();
        try { window.speechSynthesis.speak(u); } catch (_) { resolve(); }
      });
    }
    cancel() { try { window.speechSynthesis.cancel(); } catch (_) {} }
  }

  class TTSService {
    constructor(opts = {}) {
      this.engine = 'kokoro';
      this.kokoro = new KokoroJsEngine();
      this.webspeech = new WebSpeechEngine(opts);
    }
    static isSupported() { return true; }
    async speak(text) {
      try {
        if (this.engine === 'kokoro') {
          const ok = await this.kokoro.speak(text);
          if (ok) return;
        }
      } catch (e) { console.warn('[TTS] Kokoro failed, falling back:', e); }
      return this.webspeech.speak(text);
    }
    cancel() { this.kokoro.cancel(); this.webspeech.cancel(); }
    setEngine(name) { this.engine = name; }
    setVoice(idOrNull) { KOKORO_SETTINGS.voice = idOrNull || null; }
    setRate(r) { KOKORO_SETTINGS.rate = r; }
    setVolume(v) { KOKORO_SETTINGS.volume = v; }
  }

  window.TTSService = TTSService;
})();