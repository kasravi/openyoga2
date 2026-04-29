import { createYogaStore } from './state.js';
import { createYogaIntentAdapter } from './llmContract.js';

const CACHE_DB = 'yoga-tts-cache';
const CACHE_STORE = 'phrases';
const FILLER_PHRASE = 'Keep breathing.';
const CONFIG_COOKIE_PREFIX = 'yoga_cfg_';
const CONFIG_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

export function initAppPage(app) {
  const store = createYogaStore();
  const intentAdapter = createYogaIntentAdapter(store);
  window.yogaIntentAdapter = intentAdapter;

  const ui = {
    view: 'landing',
    selectedFlowId: store.getState().session.selectedFlowId,
    menuOpen: false,
    interactive: false,
    alwaysListening: false,
    detailedInstruction: false,
    startup: {
      running: false,
      progress: 0,
      status: 'idle',
    },
    backgroundMusic: true,
    breathMarker: true,
    startSlideBreathsRemaining: 4,
    conversationStatus: 'idle',
    micListening: false,
    manualTranscript: '',
    utteranceGapMs: 700,
    assistantSpeaking: false,
    ttsQueue: [],
    ttsTimer: null,
    speechToken: 0,
    endingSession: false,
    forceLanding: false,
    speechSupported: typeof window !== 'undefined' && ('SpeechRecognition' in window || 'webkitSpeechRecognition' in window),
    recognition: null,
    turnDetectorActive: false,
    audioContext: null,
    mediaStream: null,
    analyser: null,
    detectorData: null,
    detectorFrameId: null,
    speechThreshold: 0.02,
    silenceMs: 900,
    minSpeechMs: 220,
    speechStartedAt: 0,
    lastVoiceAt: 0,
    pendingTranscript: '',
    interimTranscript: '',
    lastRecognitionAt: 0,
    suppressRecognitionErrors: false,
    debug: {
      lastHeard: '',
      lastRuleMatch: 'none',
      lastGemmaRaw: '',
      lastGemmaParsed: '',
      lastIntentResult: '',
      ttsRequested: '',
      ttsPlayed: '',
      ttsSource: '',
      events: [],
    },
    gemma: {
      loading: false,
      ready: false,
      status: 'idle',
      progressPercent: -1,
      modelId: 'onnx-community/gemma-4-E2B-it-ONNX',
      dtype: 'q4f16',
      device: 'auto',
      processor: null,
      model: null,
    },
    kokoro: {
      modelId: 'onnx-community/Kokoro-82M-v1.0-ONNX',
      device: 'wasm',
      dtype: 'q8',
      voice: 'af_nicole',
      speed: 1,
      tts: null,
      loading: false,
      ready: false,
      status: 'idle',
      configKey: '',
      currentAudio: null,
      currentAudioUrl: '',
    },
    audio: {
      context: null,
      backgroundOsc: null,
      backgroundGain: null,
    },
    prewarm: {
      running: false,
      status: 'idle',
      lastFlowId: '',
      total: 0,
      completed: 0,
      skipped: 0,
      incomplete: false,
      memory: new Map(),
    },
  };

  let breathTimer = null;
  let startSlideTimer = null;
  let poseSignature = '';
  let lastSessionStatus = store.getState().session.status;
  let prewarmWorker = null;
  let prewarmRequestId = 0;
  const prewarmPending = new Map();

  function pushDebug(event, details = '') {
    const line = `${new Date().toLocaleTimeString()} · ${event}${details ? ` · ${details}` : ''}`;
    ui.debug.events = [line, ...ui.debug.events].slice(0, 10);
  }

  function getFlow(state) {
    return state.catalog.flows.find((flow) => flow.id === state.session.selectedFlowId);
  }

  function getStep(state) {
    const flow = getFlow(state);
    if (!flow) return null;
    return flow.steps[state.session.currentStepIndex] ?? null;
  }

  function getPose(state) {
    const step = getStep(state);
    if (!step) return null;
    return state.catalog.posesByName[step.poseName] ?? null;
  }

  function getFlowUsage() {
    try {
      return JSON.parse(localStorage.getItem('yoga.flow.usage') || '{}');
    } catch {
      return {};
    }
  }

  function setConfigCookie(key, value) {
    const encoded = encodeURIComponent(String(value));
    document.cookie = `${CONFIG_COOKIE_PREFIX}${key}=${encoded}; Max-Age=${CONFIG_COOKIE_MAX_AGE}; Path=/; SameSite=Lax`;
  }

  function getConfigCookie(key) {
    const fullKey = `${CONFIG_COOKIE_PREFIX}${key}=`;
    const parts = document.cookie ? document.cookie.split('; ') : [];
    const found = parts.find((entry) => entry.startsWith(fullKey));
    if (!found) return null;
    return decodeURIComponent(found.slice(fullKey.length));
  }

  function parseBooleanCookie(value, fallback) {
    if (value === 'true') return true;
    if (value === 'false') return false;
    return fallback;
  }

  function parseNumberCookie(value, fallback) {
    if (value == null) return fallback;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  function persistConfigChoices() {
    const state = store.getState();
    setConfigCookie('selectedFlowId', ui.selectedFlowId || '');
    setConfigCookie('interactive', ui.interactive);
    setConfigCookie('alwaysListening', ui.alwaysListening);
    setConfigCookie('detailedInstruction', ui.detailedInstruction);
    setConfigCookie('backgroundMusic', ui.backgroundMusic);
    setConfigCookie('breathMarker', ui.breathMarker);
    setConfigCookie('utteranceGapMs', ui.utteranceGapMs);
    setConfigCookie('speechThreshold', ui.speechThreshold);
    setConfigCookie('silenceMs', ui.silenceMs);

    setConfigCookie('inhaleSeconds', state.settings.inhaleSeconds);
    setConfigCookie('exhaleSeconds', state.settings.exhaleSeconds);
    setConfigCookie('breathsPerPose', state.settings.breathsPerPose);

    setConfigCookie('gemmaModelId', ui.gemma.modelId);
    setConfigCookie('gemmaDevice', ui.gemma.device);
    setConfigCookie('gemmaDtype', ui.gemma.dtype);

    setConfigCookie('kokoroModelId', ui.kokoro.modelId);
    setConfigCookie('kokoroDevice', ui.kokoro.device);
    setConfigCookie('kokoroDtype', ui.kokoro.dtype);
    setConfigCookie('kokoroVoice', ui.kokoro.voice);
    setConfigCookie('kokoroSpeed', ui.kokoro.speed);
  }

  function hydrateConfigChoicesFromCookies() {
    const state = store.getState();
    const availableFlowIds = new Set(state.catalog.flows.map((flow) => flow.id));

    const flowId = getConfigCookie('selectedFlowId');
    if (flowId && availableFlowIds.has(flowId)) {
      ui.selectedFlowId = flowId;
      store.dispatch({ type: 'SELECT_FLOW', payload: { flowId } });
    }

    ui.interactive = parseBooleanCookie(getConfigCookie('interactive'), ui.interactive);
    ui.alwaysListening = parseBooleanCookie(getConfigCookie('alwaysListening'), ui.alwaysListening);
    ui.detailedInstruction = parseBooleanCookie(getConfigCookie('detailedInstruction'), ui.detailedInstruction);
    ui.backgroundMusic = parseBooleanCookie(getConfigCookie('backgroundMusic'), ui.backgroundMusic);
    ui.breathMarker = parseBooleanCookie(getConfigCookie('breathMarker'), ui.breathMarker);
    ui.utteranceGapMs = parseNumberCookie(getConfigCookie('utteranceGapMs'), ui.utteranceGapMs);
    ui.speechThreshold = parseNumberCookie(getConfigCookie('speechThreshold'), ui.speechThreshold);
    ui.silenceMs = parseNumberCookie(getConfigCookie('silenceMs'), ui.silenceMs);

    ui.gemma.modelId = getConfigCookie('gemmaModelId') || ui.gemma.modelId;
    ui.gemma.device = getConfigCookie('gemmaDevice') || ui.gemma.device;
    ui.gemma.dtype = getConfigCookie('gemmaDtype') || ui.gemma.dtype;

    ui.kokoro.modelId = getConfigCookie('kokoroModelId') || ui.kokoro.modelId;
    ui.kokoro.device = getConfigCookie('kokoroDevice') || ui.kokoro.device;
    ui.kokoro.dtype = getConfigCookie('kokoroDtype') || ui.kokoro.dtype;
    ui.kokoro.voice = getConfigCookie('kokoroVoice') || ui.kokoro.voice;
    ui.kokoro.speed = parseNumberCookie(getConfigCookie('kokoroSpeed'), ui.kokoro.speed);

    const inhaleSeconds = parseNumberCookie(getConfigCookie('inhaleSeconds'), state.settings.inhaleSeconds);
    const exhaleSeconds = parseNumberCookie(getConfigCookie('exhaleSeconds'), state.settings.exhaleSeconds);
    if (inhaleSeconds !== state.settings.inhaleSeconds || exhaleSeconds !== state.settings.exhaleSeconds) {
      store.dispatch({ type: 'SET_BREATH_PACE', payload: { inhaleSeconds, exhaleSeconds } });
    }

    const breathsPerPose = parseNumberCookie(getConfigCookie('breathsPerPose'), state.settings.breathsPerPose);
    if (breathsPerPose !== state.settings.breathsPerPose) {
      store.dispatch({ type: 'SET_BREATHS_PER_POSE', payload: { breaths: breathsPerPose } });
    }

    syncOptionState();
  }

  function setFlowUsage(flowId) {
    const usage = getFlowUsage();
    usage[flowId] = (usage[flowId] ?? 0) + 1;
    localStorage.setItem('yoga.flow.usage', JSON.stringify(usage));
  }

  function sortedFlows(state) {
    const usage = getFlowUsage();
    return [...state.catalog.flows].sort((a, b) => (usage[b.id] ?? 0) - (usage[a.id] ?? 0));
  }

  async function openCacheDb() {
    return await new Promise((resolve, reject) => {
      const request = indexedDB.open(CACHE_DB, 1);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(CACHE_STORE)) {
          db.createObjectStore(CACHE_STORE, { keyPath: 'key' });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  function phraseKey(text) {
    return [
      ui.kokoro.modelId,
      ui.kokoro.device,
      ui.kokoro.dtype,
      ui.kokoro.voice,
      Number(ui.kokoro.speed).toFixed(2),
      text,
    ].join('|');
  }

  async function getCachedAudioBlob(text) {
    if (!text) return null;
    const key = phraseKey(text);
    if (ui.prewarm.memory.has(key)) {
      return ui.prewarm.memory.get(key);
    }

    try {
      const db = await openCacheDb();
      const blob = await new Promise((resolve, reject) => {
        const tx = db.transaction(CACHE_STORE, 'readonly');
        const request = tx.objectStore(CACHE_STORE).get(key);
        request.onsuccess = () => resolve(request.result?.blob ?? null);
        request.onerror = () => reject(request.error);
      });
      db.close();
      if (blob) {
        ui.prewarm.memory.set(key, blob);
      }
      return blob;
    } catch {
      return null;
    }
  }

  async function setCachedAudioBlob(text, blob, group = 'global') {
    if (!text || !blob) return;
    const key = phraseKey(text);
    ui.prewarm.memory.set(key, blob);

    try {
      const db = await openCacheDb();
      await new Promise((resolve, reject) => {
        const tx = db.transaction(CACHE_STORE, 'readwrite');
        tx.objectStore(CACHE_STORE).put({ key, text, group, blob, createdAt: Date.now() });
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
      db.close();
    } catch {
      return;
    }
  }

  function prewarmConfig() {
    return {
      modelId: ui.kokoro.modelId,
      device: ui.kokoro.device,
      dtype: ui.kokoro.dtype,
      voice: ui.kokoro.voice,
      speed: Number(ui.kokoro.speed),
    };
  }

  function getPrewarmWorker() {
    if (prewarmWorker) {
      return prewarmWorker;
    }

    prewarmWorker = new Worker(new URL('./prewarmWorker.js', import.meta.url), { type: 'module' });

    prewarmWorker.onmessage = (event) => {
      const data = event.data || {};
      const pending = prewarmPending.get(data.id);
      if (!pending) {
        return;
      }
      prewarmPending.delete(data.id);

      if (data.ok) {
        pending.resolve(data.arrayBuffer);
      } else {
        pending.reject(new Error(data.error || 'worker_generation_failed'));
      }
    };

    prewarmWorker.onerror = (error) => {
      for (const [, pending] of prewarmPending) {
        pending.reject(error instanceof Error ? error : new Error('worker_error'));
      }
      prewarmPending.clear();
      prewarmWorker = null;
    };

    return prewarmWorker;
  }

  async function generatePhraseInWorker(text, timeoutMs = 12000) {
    const worker = getPrewarmWorker();
    const id = `pw-${Date.now()}-${++prewarmRequestId}`;
    const config = prewarmConfig();

    const job = new Promise((resolve, reject) => {
      prewarmPending.set(id, { resolve, reject });
      worker.postMessage({ id, type: 'generate', text, config });
    });

    const timeout = new Promise((_, reject) => {
      setTimeout(() => reject(new Error('worker_timeout')), timeoutMs);
    });

    try {
      return await Promise.race([job, timeout]);
    } finally {
      prewarmPending.delete(id);
    }
  }

  async function prewarmPhrases(state) {
    const flow = getFlow(state);
    if (!flow) return;

    if (ui.prewarm.running) {
      return;
    }
    if (ui.prewarm.lastFlowId === flow.id) {
      return;
    }

    ui.prewarm.running = true;
    pushDebug('prewarm_start', flow.name);

    const base = [
      'Session started.',
      'Session paused.',
      'Session resumed.',
      'Session completed.',
      'Session ended.',
      'Ready when you are.',
      'Starting flow.',
      FILLER_PHRASE,
      flow.name,
    ];
    const poseLines = flow.steps
      .map((step) => state.catalog.posesByName[step.poseName])
      .filter(Boolean)
      .flatMap((pose) => {
        return [pose.display_name, pose.description?.replaceAll('//', '') || ''];
      });

    const all = [...new Set([...base, ...poseLines].filter(Boolean))].slice(0, 60);
    ui.prewarm.total = all.length;
    ui.prewarm.completed = 0;
    ui.prewarm.skipped = 0;
    ui.prewarm.incomplete = false;
    ui.prewarm.status = `warming ${flow.name} (0/${ui.prewarm.total})`;
    render();

    let skipped = 0;

    try {
      for (const phrase of all) {
        const cached = await getCachedAudioBlob(phrase);
        if (!cached) {
          try {
            const buffer = await generatePhraseInWorker(phrase, 12000);
            const blob = new Blob([buffer], { type: 'audio/wav' });
            await setCachedAudioBlob(phrase, blob, flow.id);
          } catch {
            skipped += 1;
            pushDebug('prewarm_timeout', phrase.slice(0, 42));
          }
        }

        ui.prewarm.completed += 1;
        ui.prewarm.status = `warming ${flow.name} (${ui.prewarm.completed}/${ui.prewarm.total})`;
        render();
      }

      ui.prewarm.lastFlowId = flow.id;
      ui.prewarm.skipped = skipped;
      ui.prewarm.incomplete = skipped > 0;
      const suffix = skipped > 0 ? `, skipped ${skipped}` : '';
      ui.prewarm.status = skipped > 0
        ? `incomplete ${flow.name} (${ui.prewarm.completed}/${ui.prewarm.total}${suffix})`
        : `ready ${flow.name} (${ui.prewarm.completed}/${ui.prewarm.total})`;
      pushDebug('prewarm_done', `${flow.name}${suffix}`);
    } finally {
      ui.prewarm.running = false;
      render();
    }
  }

  function stopRecognitionOnly() {
    if (ui.alwaysListening) {
      return;
    }
    if (ui.recognition && ui.micListening) {
      try {
        ui.suppressRecognitionErrors = true;
        ui.recognition.stop();
      } catch {
        return;
      }
      ui.micListening = false;
    }
  }

  function startRecognitionOnly() {
    if (ui.recognition && ui.turnDetectorActive && !ui.micListening) {
      try {
        ui.recognition.start();
        ui.micListening = true;
      } catch {
        return;
      }
    }
  }

  function stopAllSpeech({ restartRecognition = true } = {}) {
    ui.speechToken += 1;
    if (typeof speechSynthesis !== 'undefined') speechSynthesis.cancel();
    if (ui.kokoro.currentAudio) {
      ui.kokoro.currentAudio.pause();
      ui.kokoro.currentAudio.src = '';
      ui.kokoro.currentAudio = null;
    }
    if (ui.kokoro.currentAudioUrl) {
      URL.revokeObjectURL(ui.kokoro.currentAudioUrl);
      ui.kokoro.currentAudioUrl = '';
    }
    if (ui.ttsTimer) {
      clearTimeout(ui.ttsTimer);
      ui.ttsTimer = null;
    }
    ui.ttsQueue = [];
    ui.assistantSpeaking = false;
    store.dispatch({ type: 'STOP_VOICE_PLAYBACK' });
    if (restartRecognition) {
      startRecognitionOnly();
    }
  }

  function kokoroConfigKey() {
    return [ui.kokoro.modelId, ui.kokoro.device, ui.kokoro.dtype].join('|');
  }

  async function ensureKokoroReady() {
    const key = kokoroConfigKey();
    if (ui.kokoro.ready && ui.kokoro.tts && ui.kokoro.configKey === key) {
      return true;
    }
    if (ui.kokoro.loading) {
      for (let i = 0; i < 80; i += 1) {
        await new Promise((resolve) => setTimeout(resolve, 50));
        if (!ui.kokoro.loading) {
          break;
        }
      }
      return ui.kokoro.ready && ui.kokoro.tts && ui.kokoro.configKey === key;
    }

    ui.kokoro.loading = true;
    ui.kokoro.status = 'initializing';
    render();

    try {
      const { KokoroTTS } = await import('kokoro-js');
      ui.kokoro.tts = await KokoroTTS.from_pretrained(ui.kokoro.modelId, {
        dtype: ui.kokoro.dtype,
        device: ui.kokoro.device,
      });
      ui.kokoro.ready = true;
      ui.kokoro.configKey = key;
      ui.kokoro.status = 'ready';
      pushDebug('kokoro_ready', `${ui.kokoro.voice}`);
      return true;
    } catch (error) {
      ui.kokoro.ready = false;
      ui.kokoro.status = `failed: ${error.message}`;
      pushDebug('kokoro_failed', error.message);
      return false;
    } finally {
      ui.kokoro.loading = false;
      render();
    }
  }

  async function ensurePhraseAudioCached(text, group = 'global') {
    if (!text) return false;
    const existing = await getCachedAudioBlob(text);
    if (existing) {
      return true;
    }

    const ready = await ensureKokoroReady();
    if (!ready || !ui.kokoro.tts) {
      return false;
    }

    try {
      const generated = await ui.kokoro.tts.generate(text, {
        voice: ui.kokoro.voice,
        speed: Number(ui.kokoro.speed),
      });
      const blob = generated.toBlob();
      await setCachedAudioBlob(text, blob, group);
      return true;
    } catch {
      return false;
    }
  }

  async function playWithKokoro(text, speechTokenAtStart) {
    ui.debug.ttsRequested = text;
    ui.debug.ttsSource = 'kokoro';
    let blob = await getCachedAudioBlob(text);

    if (!blob) {
      const inActiveSession = store.getState().session.status === 'active';
      if (inActiveSession) {
        blob = await getCachedAudioBlob(FILLER_PHRASE);
        if (blob) {
          ui.debug.ttsSource = 'filler';
        }
      } else {
        const prepared = await ensurePhraseAudioCached(text, 'dynamic');
        if (prepared) {
          blob = await getCachedAudioBlob(text);
        }
      }
    }

    if (!blob) {
      return false;
    }

    try {
      if (speechTokenAtStart !== ui.speechToken) {
        return false;
      }

      ui.debug.ttsPlayed = blob ? (ui.debug.ttsSource === 'filler' ? FILLER_PHRASE : text) : '';

      if (ui.kokoro.currentAudioUrl) {
        URL.revokeObjectURL(ui.kokoro.currentAudioUrl);
        ui.kokoro.currentAudioUrl = '';
      }

      const url = URL.createObjectURL(blob);
      ui.kokoro.currentAudioUrl = url;

      await new Promise((resolve, reject) => {
        if (speechTokenAtStart !== ui.speechToken) {
          resolve();
          return;
        }
        const player = new Audio(url);
        ui.kokoro.currentAudio = player;
        player.onended = () => {
          ui.kokoro.currentAudio = null;
          resolve();
        };
        player.onerror = () => {
          ui.kokoro.currentAudio = null;
          reject(new Error('audio_playback_failed'));
        };
        player.play().catch(reject);
      });

      return true;
    } catch (error) {
      ui.kokoro.status = `playback failed: ${error.message}`;
      pushDebug('kokoro_playback_failed', error.message);
      return false;
    }
  }

  async function playWithBrowserTTS(text) {
    if (typeof speechSynthesis === 'undefined') {
      return false;
    }

    ui.debug.ttsSource = 'browser';
    ui.debug.ttsPlayed = text;

    await new Promise((resolve) => {
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.rate = Math.min(1.5, Math.max(0.6, ui.kokoro.speed));
      utterance.onend = () => resolve();
      utterance.onerror = () => resolve();
      speechSynthesis.speak(utterance);
    });

    return true;
  }

  function endSessionNow(source = 'unknown') {
    if (ui.endingSession) {
      return;
    }
    ui.endingSession = true;
    ui.forceLanding = true;
    pushDebug('end_session_now', source);
    stopAllSpeech({ restartRecognition: false });
    stopSessionLoop();
    if (startSlideTimer) {
      clearInterval(startSlideTimer);
      startSlideTimer = null;
    }
    setBackgroundMusic(false);
    stopTurnDetection();
    const status = store.getState().session.status;
    if (!['idle', 'terminated', 'completed'].includes(status)) {
      const result = store.dispatch({ type: 'TERMINATE_SESSION' });
      pushDebug('terminate_dispatch', JSON.stringify(result));
    }
    ui.view = 'landing';
    ui.conversationStatus = 'idle';
    ui.endingSession = false;
    render();
  }

  async function flushSpeechQueue() {
    if (ui.assistantSpeaking || ui.ttsQueue.length === 0) {
      return;
    }

    const text = ui.ttsQueue.shift();
    if (!text) {
      return;
    }

    ui.debug.ttsRequested = text;

    const speechTokenAtStart = ui.speechToken;
    ui.assistantSpeaking = true;
    ui.conversationStatus = 'assistant_speaking';
    stopRecognitionOnly();
    store.dispatch({ type: 'START_VOICE_PLAYBACK', payload: { text } });

    const settle = () => {
      ui.assistantSpeaking = false;
      store.dispatch({ type: 'STOP_VOICE_PLAYBACK' });
      if (ui.turnDetectorActive) {
        ui.conversationStatus = 'listening';
        startRecognitionOnly();
      }
      render();
      if (ui.ttsQueue.length > 0) {
        ui.ttsTimer = setTimeout(() => {
          ui.ttsTimer = null;
          flushSpeechQueue();
        }, ui.utteranceGapMs);
      }
    };

    const inActiveSession = store.getState().session.status === 'active';
    const browserOnlyMode = inActiveSession && ui.prewarm.incomplete;
    const playedWithKokoro = browserOnlyMode ? false : await playWithKokoro(text, speechTokenAtStart);
    if (speechTokenAtStart !== ui.speechToken) {
      settle();
      return;
    }
    if (!playedWithKokoro) {
      if (browserOnlyMode) {
        pushDebug('tts_mode', 'browser_only_incomplete_pack');
      }
      const fallbackOk = await playWithBrowserTTS(text);
      if (fallbackOk) {
        pushDebug('tts_fallback', 'browser_speechsynthesis');
      } else {
        ui.conversationStatus = 'tts_error';
        ui.debug.ttsSource = 'none';
        ui.debug.ttsPlayed = '';
        pushDebug('tts_error', 'kokoro_and_fallback_failed');
      }
    }
    settle();
    render();
  }

  function speak(text) {
    if (!text) return;
    ui.ttsQueue.push(text);
    flushSpeechQueue();
  }

  async function speakPrepared(text, group = 'runtime') {
    if (!text) return;
    speak(text);
  }

  function ensureAudioContext() {
    if (ui.audio.context) return ui.audio.context;
    const Context = window.AudioContext || window.webkitAudioContext;
    if (!Context) return null;
    ui.audio.context = new Context();
    return ui.audio.context;
  }

  function setBackgroundMusic(enabled) {
    const ctx = ensureAudioContext();
    if (!ctx) return;

    if (enabled && !ui.audio.backgroundOsc) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = 172;
      gain.gain.value = 0.015;
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      ui.audio.backgroundOsc = osc;
      ui.audio.backgroundGain = gain;
      return;
    }

    if (!enabled && ui.audio.backgroundOsc) {
      ui.audio.backgroundOsc.stop();
      ui.audio.backgroundOsc.disconnect();
      ui.audio.backgroundGain.disconnect();
      ui.audio.backgroundOsc = null;
      ui.audio.backgroundGain = null;
    }
  }

  function playBreathMarkerTone(isInhale) {
    if (!ui.breathMarker) return;
    const ctx = ensureAudioContext();
    if (!ctx) return;

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.value = isInhale ? 460 : 320;
    gain.gain.value = 0.02;
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.12);
  }

  async function initGemmaIfNeeded() {
    if (!ui.interactive || ui.gemma.ready || ui.gemma.loading) {
      return true;
    }

    ui.gemma.loading = true;
    ui.gemma.progressPercent = -1;
    ui.gemma.status = 'initializing (this can take several minutes)';
    render();

    try {
      const { AutoProcessor, Gemma4ForConditionalGeneration } = await import('@huggingface/transformers');
      ui.gemma.status = 'downloading processor files...';
      render();
      ui.gemma.processor = await AutoProcessor.from_pretrained(ui.gemma.modelId);

      const preferred = ui.gemma.device === 'auto' ? 'webgpu' : ui.gemma.device;
      try {
        ui.gemma.status = `downloading model files (${preferred})...`;
        render();
        ui.gemma.model = await Gemma4ForConditionalGeneration.from_pretrained(ui.gemma.modelId, {
          dtype: ui.gemma.dtype,
          device: preferred,
          progress_callback: (info) => {
            if (info?.status === 'progress' || info?.status === 'progress_total') {
              const nextProgress = Math.max(ui.gemma.progressPercent, Math.round(info.progress ?? 0));
              if (nextProgress > ui.gemma.progressPercent) {
                ui.gemma.progressPercent = nextProgress;
                ui.gemma.status = `downloading model files... ${nextProgress}%`;
                if (ui.startup.running) {
                  ui.startup.progress = Math.max(ui.startup.progress, Math.min(90, 55 + Math.round(nextProgress * 0.35)));
                  ui.startup.status = `Preparing Gemma model... ${nextProgress}% (large download)`;
                }
                render();
              }
            }
          },
        });
      } catch (error) {
        if (ui.gemma.device !== 'auto') {
          throw error;
        }
        ui.gemma.progressPercent = -1;
        ui.gemma.status = 'webgpu failed, retrying with wasm...';
        render();
        ui.gemma.model = await Gemma4ForConditionalGeneration.from_pretrained(ui.gemma.modelId, {
          dtype: 'q4',
          device: 'wasm',
          progress_callback: (info) => {
            if (info?.status === 'progress' || info?.status === 'progress_total') {
              const nextProgress = Math.max(ui.gemma.progressPercent, Math.round(info.progress ?? 0));
              if (nextProgress > ui.gemma.progressPercent) {
                ui.gemma.progressPercent = nextProgress;
                ui.gemma.status = `downloading model files (wasm)... ${nextProgress}%`;
                if (ui.startup.running) {
                  ui.startup.progress = Math.max(ui.startup.progress, Math.min(90, 55 + Math.round(nextProgress * 0.35)));
                  ui.startup.status = `Preparing Gemma model... ${nextProgress}% (large download)`;
                }
                render();
              }
            }
          },
        });
      }

      ui.gemma.ready = true;
      ui.gemma.status = 'ready';
      return true;
    } catch (error) {
      ui.gemma.status = `failed: ${error.message}`;
      return false;
    } finally {
      ui.gemma.loading = false;
      render();
    }
  }

  function applyRuleIntent(text) {
    const lower = text.toLowerCase();

    const run = (intent, params) => {
      const result = intentAdapter.applyIntent({ intent, params });
      ui.debug.lastRuleMatch = intent;
      ui.debug.lastIntentResult = JSON.stringify(result);
      pushDebug('rule_intent', `${intent} => ${result.ok ? 'ok' : 'fail'}`);
      return result.ok;
    };

    if (lower.includes('ready') && store.getState().session.status === 'waiting_ready') {
      store.dispatch({ type: 'MARK_READY' });
      ui.debug.lastRuleMatch = 'mark_ready';
      ui.debug.lastIntentResult = 'ok';
      pushDebug('rule_intent', 'mark_ready => ok');
      return true;
    }
    if (lower.includes('pause')) {
      const ok = run('pause_session');
      if (ok && ui.assistantSpeaking) {
        stopAllSpeech();
      }
      return ok;
    }
    if (lower.includes('resume') || lower.includes('continue')) {
      return run('resume_session');
    }
    if (lower.includes('skip') || lower.includes('next')) {
      return run('skip_pose');
    }
    if (lower.includes('stop speaking') || lower.includes('be quiet')) {
      return run('stop_voice_playback');
    }
    if (lower.includes('speak') || lower.includes('say it')) {
      return run('start_voice_playback', { text: 'Voice playback started.' });
    }
    if (lower.includes('end') || lower.includes('terminate') || lower.includes('quit') || lower.includes('finish session') || lower.includes('stop session')) {
      endSessionNow('voice');
      ui.debug.lastRuleMatch = 'end_session_now';
      ui.debug.lastIntentResult = 'ok';
      return true;
    }
    if (lower.includes('detailed')) {
      return run('set_instruction_mode', { mode: 'full' });
    }
    if (lower.includes('brief')) {
      return run('set_instruction_mode', { mode: 'brief' });
    }
    ui.debug.lastRuleMatch = 'none';
    return false;
  }

  async function inferIntentWithGemma(transcript) {
    if (!ui.gemma.ready || !ui.gemma.model || !ui.gemma.processor) {
      return { ok: false, reason: 'Gemma not ready' };
    }

    const allowed = intentAdapter.listValidLLMIntents().join(', ');
    const instruction = `You map user command to one JSON object with keys intent and params. Allowed intents: ${allowed}. Output only JSON.`;
    const messages = [
      {
        role: 'system',
        content: [{ type: 'text', text: instruction }],
      },
      {
        role: 'user',
        content: [{ type: 'text', text: transcript }],
      },
    ];

    const prompt = ui.gemma.processor.apply_chat_template(messages, {
      enable_thinking: false,
      add_generation_prompt: true,
    });

    const inputs = await ui.gemma.processor(prompt, null, null, { add_special_tokens: false });
    const outputs = await ui.gemma.model.generate({
      ...inputs,
      max_new_tokens: 120,
      do_sample: false,
    });

    const offset = inputs.input_ids.dims.at(-1);
    const generated = outputs.slice(null, [offset, null]);
    const decoded = ui.gemma.processor.batch_decode(generated, { skip_special_tokens: true })?.[0] ?? '';
    ui.debug.lastGemmaRaw = decoded;

    const jsonStart = decoded.indexOf('{');
    const jsonEnd = decoded.lastIndexOf('}');
    if (jsonStart < 0 || jsonEnd < 0 || jsonEnd <= jsonStart) {
      ui.debug.lastGemmaParsed = 'no_json';
      ui.debug.lastIntentResult = 'no_json';
      pushDebug('gemma_parse', 'no_json');
      return { ok: false, reason: 'no_json' };
    }

    const parsed = JSON.parse(decoded.slice(jsonStart, jsonEnd + 1));
    ui.debug.lastGemmaParsed = JSON.stringify(parsed);
    const result = intentAdapter.applyIntent(parsed);
    ui.debug.lastIntentResult = JSON.stringify(result);
    pushDebug('gemma_intent', `${parsed.intent || 'unknown'} => ${result.ok ? 'ok' : 'fail'}`);
    return result;
  }

  async function processUserCommand(transcript) {
    if (!transcript) return;

    ui.manualTranscript = transcript;
    ui.debug.lastHeard = transcript;
    pushDebug('heard', transcript);
    ui.conversationStatus = 'assistant_processing';
    render();

    const matchedRule = applyRuleIntent(transcript);
    if (!matchedRule && ui.gemma.ready) {
      try {
        await inferIntentWithGemma(transcript);
      } catch {
        return;
      }
    }

    ui.conversationStatus = 'assistant_done';
    render();
  }

  async function startTurnDetection() {
    if (!ui.interactive || ui.turnDetectorActive) {
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const Context = window.AudioContext || window.webkitAudioContext;
      const context = new Context();
      const source = context.createMediaStreamSource(stream);
      const analyser = context.createAnalyser();
      analyser.fftSize = 1024;
      source.connect(analyser);

      ui.mediaStream = stream;
      ui.audioContext = context;
      ui.analyser = analyser;
      ui.detectorData = new Float32Array(analyser.fftSize);
      ui.turnDetectorActive = true;
      ui.conversationStatus = 'listening';
      render();

      const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
      if (Recognition && !ui.recognition) {
        const recognition = new Recognition();
        recognition.continuous = true;
        recognition.interimResults = true;
        recognition.lang = 'en-US';
        recognition.onresult = (event) => {
          if (ui.assistantSpeaking && !ui.alwaysListening) {
            return;
          }
          let finalChunk = '';
          let interimChunk = '';
          for (let i = event.resultIndex; i < event.results.length; i += 1) {
            const result = event.results[i];
            if (result.isFinal) {
              finalChunk += result[0].transcript;
            } else {
              interimChunk += result[0].transcript;
            }
          }
          const now = performance.now();
          if (finalChunk.trim() || interimChunk.trim()) {
            ui.lastRecognitionAt = now;
            ui.lastVoiceAt = now;
          }
          if (finalChunk.trim()) {
            ui.pendingTranscript = `${ui.pendingTranscript} ${finalChunk}`.trim();
          }
          ui.interimTranscript = interimChunk.trim();
          ui.debug.lastHeard = `${ui.pendingTranscript} ${ui.interimTranscript}`.trim();
        };
        recognition.onerror = (event) => {
          const code = String(event?.error || 'unknown');
          pushDebug('stt_error', code);

          if (ui.suppressRecognitionErrors || code === 'aborted' || code === 'no-speech') {
            ui.suppressRecognitionErrors = false;
            if (ui.turnDetectorActive && (!ui.assistantSpeaking || ui.alwaysListening) && !ui.endingSession) {
              startRecognitionOnly();
            }
            return;
          }

          ui.conversationStatus = `stt_error:${code}`;
          render();
        };
        recognition.onend = () => {
          ui.micListening = false;
          if (ui.suppressRecognitionErrors) {
            ui.suppressRecognitionErrors = false;
          }
          if (ui.turnDetectorActive && !ui.assistantSpeaking && !ui.endingSession) {
            startRecognitionOnly();
          }
          if (ui.turnDetectorActive && ui.assistantSpeaking && ui.alwaysListening && !ui.endingSession) {
            startRecognitionOnly();
          }
        };
        ui.recognition = recognition;
      }

      if (ui.recognition) {
        ui.recognition.start();
        ui.micListening = true;
      }

      const loop = () => {
        if (!ui.turnDetectorActive || !ui.analyser || !ui.detectorData) {
          return;
        }

        if (ui.assistantSpeaking && !ui.alwaysListening) {
          ui.speechStartedAt = 0;
          ui.lastVoiceAt = 0;
          ui.detectorFrameId = requestAnimationFrame(loop);
          return;
        }

        ui.analyser.getFloatTimeDomainData(ui.detectorData);
        let energy = 0;
        for (let i = 0; i < ui.detectorData.length; i += 1) {
          energy += ui.detectorData[i] * ui.detectorData[i];
        }
        const rms = Math.sqrt(energy / ui.detectorData.length);
        const now = performance.now();

        if (rms >= ui.speechThreshold) {
          ui.lastVoiceAt = now;
          if (ui.speechStartedAt === 0) {
            ui.speechStartedAt = now;
            ui.conversationStatus = 'user_speaking';
            render();
          }
        }

        const speechDuration = ui.speechStartedAt > 0 ? now - ui.speechStartedAt : 0;
        const silenceDuration = ui.lastVoiceAt > 0 ? now - ui.lastVoiceAt : 0;
        const recognitionSilence = ui.lastRecognitionAt > 0 ? now - ui.lastRecognitionAt : Number.POSITIVE_INFINITY;

        if (
          ui.speechStartedAt > 0 &&
          speechDuration >= ui.minSpeechMs &&
          silenceDuration >= ui.silenceMs &&
          recognitionSilence >= 180
        ) {
          ui.speechStartedAt = 0;
          ui.lastVoiceAt = 0;
          ui.conversationStatus = 'turn_ended';
          render();

          const text = `${ui.pendingTranscript} ${ui.interimTranscript}`.trim();
          ui.pendingTranscript = '';
          ui.interimTranscript = '';
          if (!text) {
            ui.conversationStatus = 'listening';
            render();
          } else {
            processUserCommand(text).finally(() => {
              if (ui.turnDetectorActive && (!ui.assistantSpeaking || ui.alwaysListening)) {
                ui.conversationStatus = 'listening';
                render();
              }
            });
          }
        }

        ui.detectorFrameId = requestAnimationFrame(loop);
      };

      ui.detectorFrameId = requestAnimationFrame(loop);
    } catch (error) {
      ui.conversationStatus = `mic_error: ${error.message}`;
      render();
    }
  }

  function stopTurnDetection() {
    ui.turnDetectorActive = false;
    ui.micListening = false;
    if (ui.detectorFrameId) {
      cancelAnimationFrame(ui.detectorFrameId);
      ui.detectorFrameId = null;
    }

    if (ui.recognition) {
      try {
        ui.recognition.stop();
      } catch {
        return;
      }
    }

    if (ui.mediaStream) {
      for (const track of ui.mediaStream.getTracks()) {
        track.stop();
      }
      ui.mediaStream = null;
    }

    if (ui.audioContext) {
      ui.audioContext.close();
      ui.audioContext = null;
    }

    ui.analyser = null;
    ui.detectorData = null;
    ui.pendingTranscript = '';
    ui.interimTranscript = '';
    ui.conversationStatus = 'idle';
  }

  function syncOptionState() {
    const state = store.getState();

    if (ui.detailedInstruction && state.settings.instructionMode !== 'full') {
      store.dispatch({ type: 'SET_INSTRUCTION_MODE', payload: { mode: 'full' } });
    }
    if (!ui.detailedInstruction && state.settings.instructionMode !== 'brief') {
      store.dispatch({ type: 'SET_INSTRUCTION_MODE', payload: { mode: 'brief' } });
    }

    if (ui.backgroundMusic !== state.settings.backgroundSoundEnabled) {
      store.dispatch({ type: 'TOGGLE_BACKGROUND_SOUND' });
    }
    if (ui.breathMarker !== state.settings.breathMarkerEnabled) {
      store.dispatch({ type: 'TOGGLE_BREATH_MARKER' });
    }
  }

  async function startFlow() {
    if (ui.startup.running) {
      return;
    }

    if (ui.prewarm.running) {
      ui.startup.status = 'Voice pack is still downloading. Please wait.';
      ui.startup.progress = 0;
      render();
      return;
    }

    ui.startup.running = true;
    ui.startup.progress = 5;
    ui.startup.status = 'Initializing session...';
    render();

    const state = store.getState();
    if (!ui.selectedFlowId) {
      ui.selectedFlowId = state.catalog.flows[0]?.id;
    }

    syncOptionState();
    store.dispatch({ type: 'SELECT_FLOW', payload: { flowId: ui.selectedFlowId } });
    const startResult = store.dispatch({ type: 'START_SESSION' });
    if (!startResult.ok) {
      ui.startup.running = false;
      ui.startup.progress = 0;
      ui.startup.status = `Cannot start: ${startResult.reason}`;
      render();
      return;
    }

    ui.startup.progress = 20;
    ui.startup.status = 'Preparing voice model (Kokoro)...';
    render();

    const kokoroReady = await ensureKokoroReady();
    if (!kokoroReady) {
      ui.prewarm.incomplete = true;
      pushDebug('kokoro_unavailable', 'using browser fallback voice');
    }

    if (ui.interactive) {
      ui.startup.progress = 55;
      ui.startup.status = 'Preparing Gemma model... this may take several minutes on first run.';
      render();

      const ok = await initGemmaIfNeeded();
      if (!ok) {
        store.dispatch({ type: 'TERMINATE_SESSION' });
        ui.startup.running = false;
        ui.startup.progress = 0;
        ui.startup.status = 'Gemma failed to load. Check model settings.';
        ui.view = 'landing';
        render();
        return;
      }

      ui.startup.progress = 85;
      ui.startup.status = 'Starting microphone and conversation...';
      render();

      store.dispatch({ type: 'MODELS_READY' });
      startTurnDetection();
    } else {
      ui.startup.progress = 90;
      ui.startup.status = 'Finalizing...';
      render();
      store.dispatch({ type: 'MODELS_READY' });
    }

    ui.startSlideBreathsRemaining = 4;
    ui.view = 'start';
    setFlowUsage(ui.selectedFlowId);

    const flow = getFlow(store.getState());
    if (ui.detailedInstruction && flow) {
      speakDetailed(flow.name, flow.description, `flow:${flow.id}`);
    }

    if (!ui.interactive) {
      beginStartSlideCountdown();
    }

    ui.startup.running = false;
    ui.startup.progress = 100;
    ui.startup.status = 'Session started.';

    render();
  }

  function beginStartSlideCountdown() {
    clearInterval(startSlideTimer);
    const state = store.getState();
    const intervalMs = (state.settings.inhaleSeconds + state.settings.exhaleSeconds) * 1000;

    startSlideTimer = setInterval(() => {
      if (ui.view !== 'start' || ui.interactive) {
        clearInterval(startSlideTimer);
        startSlideTimer = null;
        return;
      }

      ui.startSlideBreathsRemaining -= 1;
      playBreathMarkerTone(ui.startSlideBreathsRemaining % 2 === 0);

      if (ui.startSlideBreathsRemaining <= 0) {
        clearInterval(startSlideTimer);
        startSlideTimer = null;
        store.dispatch({ type: 'MARK_READY' });
        ui.view = 'session';
      }

      render();
    }, intervalMs);
  }

  function beginSessionLoop() {
    clearInterval(breathTimer);
    const state = store.getState();
    const intervalMs = (state.settings.inhaleSeconds + state.settings.exhaleSeconds) * 1000;

    breathTimer = setInterval(() => {
      const current = store.getState();
      if (current.session.status !== 'active' || ui.view !== 'session') {
        return;
      }

      playBreathMarkerTone(current.session.currentBreath % 2 === 0);
      store.dispatch({ type: 'NEXT_BREATH' });
      render();
    }, intervalMs);
  }

  async function speakDetailed(title, body, group = 'runtime') {
    if (title) await speakPrepared(title, group);
    if (body) await speakPrepared(body, group);
  }

  function stopSessionLoop() {
    if (breathTimer) {
      clearInterval(breathTimer);
      breathTimer = null;
    }
  }

  function getPoseText(state) {
    const pose = getPose(state);
    const step = getStep(state);
    if (!pose || !step) return 'Session complete.';
    return pose.display_name;
  }

  function renderDebugPanel() {
    return `
      <section class="debug-panel">
        <h3>Debug</h3>
        <p><strong>Conversation:</strong> ${ui.conversationStatus}</p>
        <p><strong>Kokoro:</strong> ${ui.kokoro.status}</p>
        <p><strong>Prewarm:</strong> ${ui.prewarm.status}</p>
        <p><strong>Heard:</strong> ${ui.debug.lastHeard || '—'}</p>
        <p><strong>Rule:</strong> ${ui.debug.lastRuleMatch || '—'}</p>
        <p><strong>Gemma raw:</strong> ${ui.debug.lastGemmaRaw || '—'}</p>
        <p><strong>Gemma parsed:</strong> ${ui.debug.lastGemmaParsed || '—'}</p>
        <p><strong>Intent result:</strong> ${ui.debug.lastIntentResult || '—'}</p>
        <p><strong>TTS requested:</strong> ${ui.debug.ttsRequested || '—'}</p>
        <p><strong>TTS played:</strong> ${ui.debug.ttsPlayed || '—'}</p>
        <p><strong>TTS source:</strong> ${ui.debug.ttsSource || '—'}</p>
        <div class="debug-events">${ui.debug.events.map((line) => `<div>${line}</div>`).join('')}</div>
      </section>
    `;
  }

  function renderLanding(state) {
    const flows = sortedFlows(state);

    return `
      <main class="landing">
        <header class="landing-top">
          <h1>Yoga</h1>
          <button id="toggleMenu" class="icon-btn" aria-label="Menu">☰</button>
        </header>

        <section class="flow-strip">
          ${flows
            .map(
              (flow) => `
            <article class="flow-card ${flow.id === ui.selectedFlowId ? 'selected' : ''}" data-flow-id="${flow.id}">
              <div class="image-placeholder">flow image</div>
              <h2>${flow.name}</h2>
            </article>
          `,
            )
            .join('')}
        </section>

        <section class="toggle-grid">
          <label><input id="optBackground" type="checkbox" ${ui.backgroundMusic ? 'checked' : ''}/> background music</label>
          <label><input id="optBreath" type="checkbox" ${ui.breathMarker ? 'checked' : ''}/> breath marker</label>
          <label><input id="optDetailed" type="checkbox" ${ui.detailedInstruction ? 'checked' : ''}/> detailed instruction</label>
          <label><input id="optInteractive" type="checkbox" ${ui.interactive ? 'checked' : ''}/> interactive</label>
          <label><input id="optAlwaysListening" type="checkbox" ${ui.alwaysListening ? 'checked' : ''}/> gemma available during voice</label>
        </section>

        ${
          ui.menuOpen
            ? `<section class="menu-panel">
                <h3>Session</h3>
                <label>Inhale ${state.settings.inhaleSeconds}s <input id="inhaleRange" type="range" min="2" max="12" value="${state.settings.inhaleSeconds}"/></label>
                <label>Exhale ${state.settings.exhaleSeconds}s <input id="exhaleRange" type="range" min="2" max="12" value="${state.settings.exhaleSeconds}"/></label>
                <label>Breaths/Pose ${state.settings.breathsPerPose} <input id="breathsRange" type="range" min="1" max="12" value="${state.settings.breathsPerPose}"/></label>
                <label>Utterance gap ${ui.utteranceGapMs}ms <input id="utteranceGap" type="range" min="200" max="2000" step="100" value="${ui.utteranceGapMs}"/></label>
                <label>Speech threshold ${ui.speechThreshold.toFixed(3)} <input id="speechThreshold" type="range" min="0.005" max="0.08" step="0.001" value="${ui.speechThreshold}"/></label>
                <label>Silence ${ui.silenceMs}ms <input id="silenceMs" type="range" min="300" max="2000" step="50" value="${ui.silenceMs}"/></label>

                <h3>Gemma</h3>
                <label>Model ID <input id="gemmaModelId" type="text" value="${ui.gemma.modelId}" /></label>
                <label>Device
                  <select id="gemmaDevice">
                    <option value="auto" ${ui.gemma.device === 'auto' ? 'selected' : ''}>auto</option>
                    <option value="webgpu" ${ui.gemma.device === 'webgpu' ? 'selected' : ''}>webgpu</option>
                    <option value="wasm" ${ui.gemma.device === 'wasm' ? 'selected' : ''}>wasm</option>
                  </select>
                </label>
                <label>Precision
                  <select id="gemmaDtype">
                    <option value="q4f16" ${ui.gemma.dtype === 'q4f16' ? 'selected' : ''}>q4f16</option>
                    <option value="q4" ${ui.gemma.dtype === 'q4' ? 'selected' : ''}>q4</option>
                    <option value="q8" ${ui.gemma.dtype === 'q8' ? 'selected' : ''}>q8</option>
                  </select>
                </label>

                <h3>TTS/Kokoro</h3>
                <label>Model ID <input id="kokoroModelId" type="text" value="${ui.kokoro.modelId}" /></label>
                <label>Device
                  <select id="kokoroDevice">
                    <option value="wasm" ${ui.kokoro.device === 'wasm' ? 'selected' : ''}>wasm</option>
                    <option value="webgpu" ${ui.kokoro.device === 'webgpu' ? 'selected' : ''}>webgpu</option>
                  </select>
                </label>
                <label>Precision
                  <select id="kokoroDtype">
                    <option value="q8" ${ui.kokoro.dtype === 'q8' ? 'selected' : ''}>q8</option>
                    <option value="q4" ${ui.kokoro.dtype === 'q4' ? 'selected' : ''}>q4</option>
                  </select>
                </label>
                <label>Speaker <input id="kokoroVoice" type="text" value="${ui.kokoro.voice}" /></label>
                <label>Speed ${ui.kokoro.speed.toFixed(1)}x <input id="kokoroSpeed" type="range" min="0.6" max="1.4" step="0.1" value="${ui.kokoro.speed}"/></label>
              </section>`
            : ''
        }

        <div class="start-wrap">
          <button id="downloadVoicePack" ${ui.prewarm.running ? 'disabled' : ''}>Download Flow Voice Pack</button>
          <p>${ui.prewarm.status}</p>
          <progress max="${Math.max(1, ui.prewarm.total)}" value="${ui.prewarm.completed}"></progress>
          ${ui.prewarm.incomplete ? '<p class="status-line">Voice pack incomplete. Session voice will use browser fallback for consistency.</p>' : ''}
          ${ui.startup.running || ui.startup.status !== 'idle' ? `<p class="status-line">${ui.startup.status}</p><progress max="100" value="${Math.max(0, Math.min(100, ui.startup.progress))}"></progress>` : ''}
          <button id="startFlow" class="start-btn" ${ui.prewarm.running || ui.startup.running ? 'disabled' : ''}>${ui.startup.running ? 'Starting…' : 'Start'}</button>
        </div>

        <button id="addFlow" class="fab" aria-label="Create flow">+</button>
      </main>
    `;
  }

  function renderStart(state) {
    const flow = getFlow(state);
    return `
      <main class="session-screen">
        <h1>${flow?.name || 'Flow'}</h1>
        <div class="image-placeholder big">pose image</div>
        <p class="status-line">
          ${
            ui.interactive
              ? `Model: ${ui.gemma.status} · Conversation: ${ui.conversationStatus}`
              : `Starting in ${ui.startSlideBreathsRemaining} breaths`
          }
        </p>
        <div class="controls">
          ${ui.interactive ? '<button id="readyNow">Ready</button>' : ''}
          <button id="backHome">Back</button>
        </div>
        ${renderDebugPanel()}
      </main>
    `;
  }

  function renderSession(state) {
    const pose = getPose(state);
    const step = getStep(state);
    const breathDuration = state.settings.inhaleSeconds + state.settings.exhaleSeconds;

    return `
      <main class="session-screen">
        <h1>${pose?.display_name || 'Completed'}</h1>
        <div class="image-placeholder big">pose image</div>

        <div class="breath-visual" style="--breathDuration:${breathDuration}s"></div>
        <p class="status-line">Breath ${state.session.currentBreath}${step ? ` / ${state.settings.breathsPerPose}` : ''}</p>
        <p class="status-line">${state.output.voicePlaybackText}</p>

        ${ui.interactive ? `<p class="status-line">Conversation: ${ui.conversationStatus}</p>` : ''}

        <div class="controls">
          <button id="pauseBtn">Pause</button>
          <button id="resumeBtn">Resume</button>
          <button id="endBtn">End</button>
        </div>
        ${renderDebugPanel()}
      </main>
    `;
  }

  function render() {
    const state = store.getState();

    if (ui.view === 'landing') {
      app.innerHTML = renderLanding(state);
      return;
    }

    if (ui.view === 'start') {
      app.innerHTML = renderStart(state);
      return;
    }

    app.innerHTML = renderSession(state);
  }

  function handleFlowCardClick(target) {
    const card = target.closest('[data-flow-id]');
    if (!card) return false;
    ui.selectedFlowId = card.dataset.flowId;
    ui.prewarm.status = 'idle';
    ui.prewarm.total = 0;
    ui.prewarm.completed = 0;
    ui.prewarm.skipped = 0;
    ui.prewarm.incomplete = false;
    ui.startup.status = 'idle';
    ui.startup.progress = 0;
    persistConfigChoices();
    render();
    return true;
  }

  function onClick(event) {
    if (handleFlowCardClick(event.target)) {
      return;
    }

    if (event.target.id === 'toggleMenu') {
      ui.menuOpen = !ui.menuOpen;
      render();
      return;
    }

    if (event.target.id === 'addFlow') {
      alert('Flow builder will open here next.');
      return;
    }

    if (event.target.id === 'startFlow') {
      startFlow();
      return;
    }

    if (event.target.id === 'downloadVoicePack') {
      prewarmPhrases(store.getState());
      return;
    }

    if (event.target.id === 'readyNow') {
      store.dispatch({ type: 'MARK_READY' });
      ui.view = 'session';
      beginSessionLoop();
      render();
      return;
    }

    if (event.target.id === 'backHome') {
      endSessionNow('back_button');
      return;
    }

    if (event.target.id === 'pauseBtn') {
      intentAdapter.applyIntent({ intent: 'pause_session' });
      render();
      return;
    }

    if (event.target.id === 'resumeBtn') {
      intentAdapter.applyIntent({ intent: 'resume_session' });
      render();
      return;
    }

    if (event.target.id === 'endBtn') {
      endSessionNow('end_button');
    }
  }

  function onChange(event) {
    const target = event.target;

    if (target.id === 'optBackground') {
      ui.backgroundMusic = target.checked;
      syncOptionState();
      setBackgroundMusic(ui.backgroundMusic && ui.view !== 'landing');
      persistConfigChoices();
      render();
      return;
    }

    if (target.id === 'optBreath') {
      ui.breathMarker = target.checked;
      syncOptionState();
      persistConfigChoices();
      render();
      return;
    }

    if (target.id === 'optDetailed') {
      ui.detailedInstruction = target.checked;
      syncOptionState();
      persistConfigChoices();
      render();
      return;
    }

    if (target.id === 'optInteractive') {
      ui.interactive = target.checked;
      persistConfigChoices();
      render();
      return;
    }

    if (target.id === 'optAlwaysListening') {
      ui.alwaysListening = target.checked;
      if (ui.alwaysListening) {
        startRecognitionOnly();
      }
      persistConfigChoices();
      render();
      return;
    }

    if (target.id === 'inhaleRange' || target.id === 'exhaleRange') {
      const inhale = Number((document.querySelector('#inhaleRange') || { value: '4' }).value);
      const exhale = Number((document.querySelector('#exhaleRange') || { value: '6' }).value);
      store.dispatch({ type: 'SET_BREATH_PACE', payload: { inhaleSeconds: inhale, exhaleSeconds: exhale } });
      persistConfigChoices();
      render();
      return;
    }

    if (target.id === 'breathsRange') {
      store.dispatch({ type: 'SET_BREATHS_PER_POSE', payload: { breaths: Number(target.value) } });
      persistConfigChoices();
      render();
      return;
    }

    if (target.id === 'utteranceGap') {
      ui.utteranceGapMs = Number(target.value);
      persistConfigChoices();
      render();
      return;
    }

    if (target.id === 'speechThreshold') {
      ui.speechThreshold = Number(target.value);
      persistConfigChoices();
      render();
      return;
    }

    if (target.id === 'silenceMs') {
      ui.silenceMs = Number(target.value);
      persistConfigChoices();
      render();
      return;
    }

    if (target.id === 'gemmaDevice') {
      ui.gemma.device = target.value;
      ui.gemma.ready = false;
      persistConfigChoices();
      render();
      return;
    }

    if (target.id === 'gemmaDtype') {
      ui.gemma.dtype = target.value;
      ui.gemma.ready = false;
      persistConfigChoices();
      render();
      return;
    }

    if (target.id === 'kokoroDevice') {
      ui.kokoro.device = target.value;
      ui.kokoro.ready = false;
      ui.kokoro.tts = null;
      ui.kokoro.status = 'idle';
      ui.prewarm.lastFlowId = '';
      ui.prewarm.status = 'idle';
      ui.prewarm.total = 0;
      ui.prewarm.completed = 0;
      ui.prewarm.skipped = 0;
      ui.prewarm.incomplete = false;
      persistConfigChoices();
      render();
      return;
    }

    if (target.id === 'kokoroDtype') {
      ui.kokoro.dtype = target.value;
      ui.kokoro.ready = false;
      ui.kokoro.tts = null;
      ui.kokoro.status = 'idle';
      ui.prewarm.lastFlowId = '';
      ui.prewarm.status = 'idle';
      ui.prewarm.total = 0;
      ui.prewarm.completed = 0;
      ui.prewarm.skipped = 0;
      ui.prewarm.incomplete = false;
      persistConfigChoices();
      render();
      return;
    }

    if (target.id === 'kokoroSpeed') {
      ui.kokoro.speed = Number(target.value);
      ui.prewarm.lastFlowId = '';
      ui.prewarm.status = 'idle';
      ui.prewarm.total = 0;
      ui.prewarm.completed = 0;
      ui.prewarm.skipped = 0;
      ui.prewarm.incomplete = false;
      persistConfigChoices();
      render();
    }
  }

  function onInput(event) {
    const target = event.target;

    if (target.id === 'gemmaModelId') {
      ui.gemma.modelId = target.value;
      ui.gemma.ready = false;
      persistConfigChoices();
      return;
    }

    if (target.id === 'kokoroModelId') {
      ui.kokoro.modelId = target.value;
      ui.kokoro.ready = false;
      ui.kokoro.tts = null;
      ui.kokoro.status = 'idle';
      ui.prewarm.lastFlowId = '';
      ui.prewarm.status = 'idle';
      ui.prewarm.total = 0;
      ui.prewarm.completed = 0;
      ui.prewarm.skipped = 0;
      ui.prewarm.incomplete = false;
      persistConfigChoices();
      return;
    }

    if (target.id === 'kokoroVoice') {
      ui.kokoro.voice = target.value;
      ui.prewarm.lastFlowId = '';
      ui.prewarm.status = 'idle';
      ui.prewarm.total = 0;
      ui.prewarm.completed = 0;
      ui.prewarm.skipped = 0;
      ui.prewarm.incomplete = false;
      persistConfigChoices();
    }
  }

  store.subscribe((state) => {
    const pose = getPose(state);
    const signature = `${state.session.currentStepIndex}:${state.session.currentSide}:${state.session.status}`;
    const statusChanged = state.session.status !== lastSessionStatus;

    if (ui.view !== 'landing') {
      setBackgroundMusic(ui.backgroundMusic);
    } else {
      setBackgroundMusic(false);
    }

    if (state.session.status === 'active' && ui.view !== 'session' && !ui.forceLanding) {
      ui.view = 'session';
      beginSessionLoop();
    }

    if (state.session.status !== 'active') {
      stopSessionLoop();
    }

    if (statusChanged && state.session.status === 'completed' && !ui.endingSession && !ui.forceLanding) {
      speakPrepared('Session completed.', 'session');
    }

    if (statusChanged && state.session.status === 'terminated' && ui.view !== 'landing') {
      stopAllSpeech();
      ui.view = 'landing';
    }

    if (state.session.status !== 'active' && state.session.status !== 'waiting_ready') {
      ui.forceLanding = false;
    }

    if (state.session.status === 'active' && pose && signature !== poseSignature) {
      poseSignature = signature;
      const line = getPoseText(state);
      if (ui.detailedInstruction) {
        speakDetailed(line, pose.description?.replaceAll('//', '') || '', `pose:${pose.name}`);
      } else {
        speakPrepared(line, `pose:${pose.name}`);
      }
    }

    lastSessionStatus = state.session.status;

    render();
  });

  app.addEventListener('click', onClick);
  app.addEventListener('change', onChange);
  app.addEventListener('input', onInput);

  hydrateConfigChoicesFromCookies();

  window.addEventListener('beforeunload', () => {
    if (prewarmWorker) {
      prewarmWorker.terminate();
      prewarmWorker = null;
    }
  });

  render();
}
