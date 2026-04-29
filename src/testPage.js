import { createYogaStore } from './state.js';
import { createYogaIntentAdapter } from './llmContract.js';
export function initTestPage(app) {
const store = createYogaStore();
const intentAdapter = createYogaIntentAdapter(store);

window.yogaIntentAdapter = intentAdapter;

let modelPrepTimer = null;
let breathTimer = null;
let breathTimerMs = null;
let statusRenderTimer = null;
let intentConsoleInput = JSON.stringify({ intent: 'mark_ready' }, null, 2);
let intentConsoleResult = 'No intent executed yet.';

const gemmaRuntime = {
  modelId: 'onnx-community/gemma-4-E2B-it-ONNX',
  device: 'auto',
  dtype: 'q4f16',
  status: 'not initialized',
  loading: false,
  generating: false,
  prompt: 'Give one short calming instruction for yoga breathing.',
  output: '',
  processor: null,
  model: null,
  progressPercent: -1,
  stage: 'idle',
  debugEvents: [],
  conversationStatus: 'idle',
  turnDetectionActive: false,
  autoRunOnTurnEnd: true,
  audioContext: null,
  mediaStream: null,
  analyser: null,
  detectorFrameId: null,
  detectorData: null,
  speechThreshold: 0.02,
  silenceMs: 900,
  minSpeechMs: 250,
  speechStartedAt: 0,
  lastVoiceAt: 0,
  isHandlingTurn: false,
};

const kokoroRuntime = {
  modelId: 'onnx-community/Kokoro-82M-v1.0-ONNX',
  device: 'wasm',
  dtype: 'q8',
  status: 'not initialized',
  loading: false,
  generating: false,
  text: 'Inhale softly through your nose. Exhale slowly and release tension.',
  voice: 'af_nicole',
  speed: 1,
  audioUrl: '',
  tts: null,
  progressPercent: -1,
};

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}

function scheduleRender() {
  if (statusRenderTimer) {
    return;
  }

  statusRenderTimer = setTimeout(() => {
    statusRenderTimer = null;
    render(store.getState());
  }, 150);
}

function setConversationStatus(status, immediate = false) {
  if (gemmaRuntime.conversationStatus === status) {
    return;
  }
  gemmaRuntime.conversationStatus = status;
  if (immediate) {
    render(store.getState());
  } else {
    scheduleRender();
  }
}

function setGemmaStatus(status, immediate = false) {
  if (gemmaRuntime.status === status) {
    return;
  }

  gemmaRuntime.status = status;
  if (immediate) {
    render(store.getState());
    return;
  }

  scheduleRender();
}

function pushGemmaDebug(event, details = '') {
  const line = `${new Date().toLocaleTimeString()} · ${event}${details ? ` · ${details}` : ''}`;
  gemmaRuntime.debugEvents = [line, ...gemmaRuntime.debugEvents].slice(0, 30);
}

function gemmaDebugDump() {
  return JSON.stringify(
    {
      modelId: gemmaRuntime.modelId,
      device: gemmaRuntime.device,
      dtype: gemmaRuntime.dtype,
      status: gemmaRuntime.status,
      stage: gemmaRuntime.stage,
      progressPercent: gemmaRuntime.progressPercent,
      loading: gemmaRuntime.loading,
      generating: gemmaRuntime.generating,
      hasProcessor: Boolean(gemmaRuntime.processor),
      hasModel: Boolean(gemmaRuntime.model),
      conversationStatus: gemmaRuntime.conversationStatus,
      events: gemmaRuntime.debugEvents,
    },
    null,
    2,
  );
}

function setKokoroStatus(status, immediate = false) {
  if (kokoroRuntime.status === status) {
    return;
  }

  kokoroRuntime.status = status;
  if (immediate) {
    render(store.getState());
    return;
  }

  scheduleRender();
}

async function initGemmaModel() {
  if (gemmaRuntime.loading) {
    return;
  }

  gemmaRuntime.model = null;
  gemmaRuntime.processor = null;
  gemmaRuntime.loading = true;
  gemmaRuntime.progressPercent = -1;
  gemmaRuntime.stage = 'initializing';
  setGemmaStatus('initializing... this may take several minutes and multiple GB download');
  pushGemmaDebug('init_start', `${gemmaRuntime.modelId} (${gemmaRuntime.device}/${gemmaRuntime.dtype})`);

  try {
    const { AutoProcessor, Gemma4ForConditionalGeneration } = await import('@huggingface/transformers');
    const preferredDevice = gemmaRuntime.device === 'auto' ? 'webgpu' : gemmaRuntime.device;

    gemmaRuntime.stage = 'loading_processor';
    setGemmaStatus('downloading processor files...');
    gemmaRuntime.processor = await AutoProcessor.from_pretrained(gemmaRuntime.modelId);
    pushGemmaDebug('processor_ready');

    try {
      gemmaRuntime.stage = `loading_model_${preferredDevice}`;
      setGemmaStatus(`downloading model files (${preferredDevice})...`);
      gemmaRuntime.model = await Gemma4ForConditionalGeneration.from_pretrained(gemmaRuntime.modelId, {
        dtype: gemmaRuntime.dtype,
        device: preferredDevice,
        progress_callback: (info) => {
          if (info?.status === 'progress' || info?.status === 'progress_total') {
            const nextProgress = Math.max(gemmaRuntime.progressPercent, Math.round(info.progress ?? 0));
            if (nextProgress > gemmaRuntime.progressPercent) {
              gemmaRuntime.progressPercent = nextProgress;
              setGemmaStatus(`downloading model files... ${nextProgress}%`);
              if (nextProgress % 10 === 0) {
                pushGemmaDebug('download_progress', `${nextProgress}%`);
              }
            }
          }
        },
      });
    } catch (primaryError) {
      if (gemmaRuntime.device === 'auto') {
        pushGemmaDebug('webgpu_failed', primaryError?.message || 'unknown');
        setGemmaStatus('webgpu failed, retrying with wasm...');
        gemmaRuntime.progressPercent = -1;
        gemmaRuntime.stage = 'loading_model_wasm';
        gemmaRuntime.model = await Gemma4ForConditionalGeneration.from_pretrained(gemmaRuntime.modelId, {
          dtype: 'q4',
          device: 'wasm',
          progress_callback: (info) => {
            if (info?.status === 'progress' || info?.status === 'progress_total') {
              const nextProgress = Math.max(gemmaRuntime.progressPercent, Math.round(info.progress ?? 0));
              if (nextProgress > gemmaRuntime.progressPercent) {
                gemmaRuntime.progressPercent = nextProgress;
                setGemmaStatus(`downloading model files (wasm)... ${nextProgress}%`);
                if (nextProgress % 10 === 0) {
                  pushGemmaDebug('download_progress_wasm', `${nextProgress}%`);
                }
              }
            }
          },
        });
      } else {
        throw primaryError;
      }
    }

    gemmaRuntime.stage = 'ready';
    pushGemmaDebug('init_ready');
    setGemmaStatus('ready', true);
  } catch (error) {
    gemmaRuntime.stage = 'failed';
    pushGemmaDebug('init_failed', error.message);
    setGemmaStatus(`failed: ${error.message}`, true);
  } finally {
    gemmaRuntime.loading = false;
    render(store.getState());
  }
}

async function runGemmaPrompt() {
  if (gemmaRuntime.loading) {
    setGemmaStatus('Gemma is still downloading/loading. Please wait until status is ready.');
    pushGemmaDebug('run_blocked', 'loading_in_progress');
    return;
  }

  if (!gemmaRuntime.model || !gemmaRuntime.processor) {
    setGemmaStatus('initialize Gemma first (model not ready yet)');
    pushGemmaDebug('run_blocked', 'model_or_processor_missing');
    return;
  }

  if (gemmaRuntime.generating) {
    return;
  }

  gemmaRuntime.generating = true;
  gemmaRuntime.stage = 'generating';
  pushGemmaDebug('run_start');
  setGemmaStatus('generating...', true);

  try {
    const messages = [
      {
        role: 'user',
        content: [{ type: 'text', text: gemmaRuntime.prompt }],
      },
    ];

    const prompt = gemmaRuntime.processor.apply_chat_template(messages, {
      enable_thinking: false,
      add_generation_prompt: true,
    });

    const inputs = await gemmaRuntime.processor(prompt, null, null, {
      add_special_tokens: false,
    });

    const outputs = await gemmaRuntime.model.generate({
      ...inputs,
      max_new_tokens: 120,
      do_sample: true,
      temperature: 0.9,
      top_p: 0.95,
    });

    const promptTokenLength = inputs.input_ids.dims.at(-1);
    const generatedOnly = outputs.slice(null, [promptTokenLength, null]);
    const decoded = gemmaRuntime.processor.batch_decode(generatedOnly, {
      skip_special_tokens: true,
    });

    gemmaRuntime.output = (decoded?.[0] ?? '').trim();
    gemmaRuntime.stage = 'ready';
    pushGemmaDebug('run_success', `${gemmaRuntime.output.length} chars`);
    setGemmaStatus('ready', true);
    return { ok: true, text: gemmaRuntime.output };
  } catch (error) {
    gemmaRuntime.stage = 'failed';
    pushGemmaDebug('run_failed', error.message);
    setGemmaStatus(`generation failed: ${error.message}`, true);
    return { ok: false, reason: error.message };
  } finally {
    gemmaRuntime.generating = false;
    render(store.getState());
  }
}

function stopTurnDetection() {
  gemmaRuntime.turnDetectionActive = false;

  if (gemmaRuntime.detectorFrameId) {
    cancelAnimationFrame(gemmaRuntime.detectorFrameId);
    gemmaRuntime.detectorFrameId = null;
  }

  if (gemmaRuntime.mediaStream) {
    for (const track of gemmaRuntime.mediaStream.getTracks()) {
      track.stop();
    }
    gemmaRuntime.mediaStream = null;
  }

  if (gemmaRuntime.audioContext) {
    gemmaRuntime.audioContext.close();
    gemmaRuntime.audioContext = null;
  }

  gemmaRuntime.analyser = null;
  gemmaRuntime.detectorData = null;
  gemmaRuntime.speechStartedAt = 0;
  gemmaRuntime.lastVoiceAt = 0;
  setConversationStatus('idle', true);
}

async function handleCompletedTurn() {
  if (gemmaRuntime.isHandlingTurn) {
    return;
  }

  gemmaRuntime.isHandlingTurn = true;
  setConversationStatus('assistant_processing', true);
  const result = await runGemmaPrompt();

  if (result?.ok) {
    intentAdapter.applyIntent({
      intent: 'start_voice_playback',
      params: { text: result.text || 'Assistant response ready.' },
    });
    setConversationStatus('assistant_done', true);
  } else {
    setConversationStatus('listening', true);
  }

  gemmaRuntime.isHandlingTurn = false;
}

function detectorLoop() {
  if (!gemmaRuntime.turnDetectionActive || !gemmaRuntime.analyser || !gemmaRuntime.detectorData) {
    return;
  }

  gemmaRuntime.analyser.getFloatTimeDomainData(gemmaRuntime.detectorData);
  let sumSquares = 0;
  for (let i = 0; i < gemmaRuntime.detectorData.length; i += 1) {
    const sample = gemmaRuntime.detectorData[i];
    sumSquares += sample * sample;
  }

  const rms = Math.sqrt(sumSquares / gemmaRuntime.detectorData.length);
  const now = performance.now();

  if (rms >= gemmaRuntime.speechThreshold) {
    gemmaRuntime.lastVoiceAt = now;
    if (gemmaRuntime.speechStartedAt === 0) {
      gemmaRuntime.speechStartedAt = now;
      setConversationStatus('user_speaking');
    }
  }

  const speechDuration = gemmaRuntime.speechStartedAt > 0 ? now - gemmaRuntime.speechStartedAt : 0;
  const silenceDuration = gemmaRuntime.lastVoiceAt > 0 ? now - gemmaRuntime.lastVoiceAt : 0;

  if (
    gemmaRuntime.speechStartedAt > 0 &&
    speechDuration >= gemmaRuntime.minSpeechMs &&
    silenceDuration >= gemmaRuntime.silenceMs &&
    !gemmaRuntime.isHandlingTurn
  ) {
    gemmaRuntime.speechStartedAt = 0;
    gemmaRuntime.lastVoiceAt = 0;
    setConversationStatus('turn_ended', true);

    if (gemmaRuntime.autoRunOnTurnEnd) {
      handleCompletedTurn().finally(() => {
        if (gemmaRuntime.turnDetectionActive) {
          setConversationStatus('listening', true);
        }
      });
    }
  }

  gemmaRuntime.detectorFrameId = requestAnimationFrame(detectorLoop);
}

async function startTurnDetection() {
  if (gemmaRuntime.turnDetectionActive) {
    return;
  }

  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    const context = new AudioCtx();
    const source = context.createMediaStreamSource(stream);
    const analyser = context.createAnalyser();
    analyser.fftSize = 1024;
    source.connect(analyser);

    gemmaRuntime.mediaStream = stream;
    gemmaRuntime.audioContext = context;
    gemmaRuntime.analyser = analyser;
    gemmaRuntime.detectorData = new Float32Array(analyser.fftSize);
    gemmaRuntime.turnDetectionActive = true;
    gemmaRuntime.speechStartedAt = 0;
    gemmaRuntime.lastVoiceAt = 0;
    setConversationStatus('listening', true);
    detectorLoop();
  } catch (error) {
    setConversationStatus(`mic_error: ${error.message}`, true);
  }
}

async function initKokoroModel() {
  if (kokoroRuntime.loading) {
    return;
  }

  kokoroRuntime.loading = true;
  kokoroRuntime.progressPercent = -1;
  setKokoroStatus('initializing...');

  try {
    const { KokoroTTS } = await import('kokoro-js');
    kokoroRuntime.tts = await KokoroTTS.from_pretrained(kokoroRuntime.modelId, {
      dtype: kokoroRuntime.dtype,
      device: kokoroRuntime.device,
      progress_callback: (info) => {
        if (info?.status === 'progress' || info?.status === 'progress_total') {
          const nextProgress = Math.max(kokoroRuntime.progressPercent, Math.round(info.progress ?? 0));
          if (nextProgress > kokoroRuntime.progressPercent) {
            kokoroRuntime.progressPercent = nextProgress;
            setKokoroStatus(`initializing... ${nextProgress}%`);
          }
        }
      },
    });

    setKokoroStatus('ready', true);
  } catch (error) {
    setKokoroStatus(`failed: ${error.message}`, true);
  } finally {
    kokoroRuntime.loading = false;
    render(store.getState());
  }
}

async function synthesizeWithKokoro() {
  if (!kokoroRuntime.tts) {
    setKokoroStatus('initialize Kokoro first');
    return;
  }

  if (kokoroRuntime.generating) {
    return;
  }

  kokoroRuntime.generating = true;
  setKokoroStatus('synthesizing...', true);

  try {
    const audio = await kokoroRuntime.tts.generate(kokoroRuntime.text, {
      voice: kokoroRuntime.voice,
      speed: Number(kokoroRuntime.speed),
    });

    if (kokoroRuntime.audioUrl) {
      URL.revokeObjectURL(kokoroRuntime.audioUrl);
    }

    const blob = audio.toBlob();
    kokoroRuntime.audioUrl = URL.createObjectURL(blob);
    setKokoroStatus('ready', true);
  } catch (error) {
    setKokoroStatus(`synthesis failed: ${error.message}`, true);
  } finally {
    kokoroRuntime.generating = false;
    render(store.getState());
  }
}

function canDispatch(actionType) {
  return store.actionSchema[actionType] !== undefined;
}

function dispatch(action) {
  if (!canDispatch(action.type)) {
    return;
  }
  const result = store.dispatch(action);
  if (!result.ok) {
    console.warn(result.reason);
  }
}

function flowFrom(state) {
  return state.catalog.flows.find((flow) => flow.id === state.session.selectedFlowId);
}

function currentStep(state) {
  const flow = flowFrom(state);
  return flow?.steps[state.session.currentStepIndex] ?? null;
}

function currentPose(state) {
  const step = currentStep(state);
  return step ? state.catalog.posesByName[step.poseName] : null;
}

function targetBreaths(state) {
  return state.settings.breathsPerPose;
}

function onAppClick(event) {
  if (event.target.id === 'startConversation') {
    startTurnDetection();
    return;
  }

  if (event.target.id === 'stopConversation') {
    stopTurnDetection();
    return;
  }

  if (event.target.id === 'initGemma') {
    initGemmaModel();
    return;
  }

  if (event.target.id === 'runGemma') {
    runGemmaPrompt();
    return;
  }

  if (event.target.id === 'copyGemmaDebug') {
    const dump = gemmaDebugDump();
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(dump).then(
        () => setGemmaStatus('debug copied to clipboard', true),
        () => setGemmaStatus('copy failed; use the debug text box', true),
      );
    } else {
      setGemmaStatus('clipboard API unavailable; copy from debug text box', true);
    }
    return;
  }

  if (event.target.id === 'initKokoro') {
    initKokoroModel();
    return;
  }

  if (event.target.id === 'runKokoro') {
    synthesizeWithKokoro();
    return;
  }

  if (event.target.id === 'runIntent') {
    try {
      const command = JSON.parse(intentConsoleInput);
      const result = intentAdapter.applyIntent(command);
      intentConsoleResult = result.ok ? '✅ Intent applied successfully.' : `❌ ${result.reason}`;
      if (!result.ok) {
        render(store.getState());
      }
    } catch (error) {
      intentConsoleResult = `❌ Invalid JSON: ${error.message}`;
      render(store.getState());
    }
    return;
  }

  const actionType = event.target.dataset.action;
  if (!actionType) {
    return;
  }

  dispatch({ type: actionType });
}

function onAppInput(event) {
  const target = event.target;
  if (target.id === 'intentJson') {
    intentConsoleInput = target.value;
    return;
  }

  if (target.id === 'gemmaModelId') {
    gemmaRuntime.modelId = target.value;
    return;
  }

  if (target.id === 'gemmaPrompt') {
    gemmaRuntime.prompt = target.value;
    return;
  }

  if (target.id === 'kokoroModelId') {
    kokoroRuntime.modelId = target.value;
    return;
  }

  if (target.id === 'kokoroText') {
    kokoroRuntime.text = target.value;
  }
}

function onAppChange(event) {
  const target = event.target;
  const state = store.getState();

  if (target.id === 'flowSelect') {
    dispatch({ type: 'SELECT_FLOW', payload: { flowId: target.value } });
    return;
  }

  if (target.id === 'instructionMode') {
    dispatch({ type: 'SET_INSTRUCTION_MODE', payload: { mode: target.value } });
    return;
  }

  if (target.id === 'instructionScope') {
    dispatch({ type: 'SET_INSTRUCTION_SCOPE', payload: { scope: target.value } });
    return;
  }

  if (target.id === 'backgroundSound') {
    dispatch({ type: 'SET_BACKGROUND_SOUND', payload: { sound: target.value } });
    return;
  }

  if (target.id === 'inhaleSeconds' || target.id === 'exhaleSeconds') {
    const inhaleInput = document.querySelector('#inhaleSeconds');
    const exhaleInput = document.querySelector('#exhaleSeconds');
    dispatch({
      type: 'SET_BREATH_PACE',
      payload: {
        inhaleSeconds: Number(inhaleInput.value),
        exhaleSeconds: Number(exhaleInput.value),
      },
    });
    return;
  }

  if (target.id === 'breathsPerPose') {
    dispatch({
      type: 'SET_BREATHS_PER_POSE',
      payload: { breaths: Number(target.value) },
    });
    return;
  }

  if (target.id === 'breathMarkerEnabled') {
    if (target.checked !== state.settings.breathMarkerEnabled) {
      dispatch({ type: 'TOGGLE_BREATH_MARKER' });
    }
    return;
  }

  if (target.id === 'backgroundSoundEnabled') {
    if (target.checked !== state.settings.backgroundSoundEnabled) {
      dispatch({ type: 'TOGGLE_BACKGROUND_SOUND' });
    }
    return;
  }

  if (target.id === 'gemmaDevice') {
    gemmaRuntime.device = target.value;
    return;
  }

  if (target.id === 'gemmaDtype') {
    gemmaRuntime.dtype = target.value;
    return;
  }

  if (target.id === 'gemmaAutoRunOnTurnEnd') {
    gemmaRuntime.autoRunOnTurnEnd = target.checked;
    return;
  }

  if (target.id === 'kokoroDevice') {
    kokoroRuntime.device = target.value;
    return;
  }

  if (target.id === 'kokoroDtype') {
    kokoroRuntime.dtype = target.value;
    return;
  }

  if (target.id === 'kokoroVoice') {
    kokoroRuntime.voice = target.value;
    return;
  }

  if (target.id === 'kokoroSpeed') {
    kokoroRuntime.speed = Number(target.value);
  }
}

function render(state) {
  const flow = flowFrom(state);
  const step = currentStep(state);
  const pose = currentPose(state);

  app.innerHTML = `
    <main class="layout">
      <header>
        <h1>Yoga Voice State Prototype</h1>
        <p>Everything on this screen comes from one central state model.</p>
      </header>

      <section class="panel">
        <h2>Flow</h2>
        <label for="flowSelect">Flow selector</label>
        <select id="flowSelect">
          ${state.catalog.flows
            .map(
              (item) =>
                `<option value="${item.id}" ${item.id === state.session.selectedFlowId ? 'selected' : ''}>${item.name}</option>`,
            )
            .join('')}
        </select>
        <p>${flow?.description ?? 'No flow selected.'}</p>
      </section>

      <section class="panel grid-2">
        <div>
          <h2>Session</h2>
          <p><strong>Status:</strong> ${state.session.status}</p>
          <p>${state.output.statusText}</p>
          <p><strong>Current pose:</strong> ${pose?.display_name ?? 'Completed'}</p>
          <p><strong>Breath:</strong> ${state.session.currentBreath}${step ? ` / ${targetBreaths(state)}` : ''}</p>
          <p><strong>Side:</strong> ${pose?.two_sided ? state.session.currentSide : 'n/a'}</p>
          <div class="controls">
            <button data-action="START_SESSION">Start</button>
            <button data-action="MARK_READY">Ready</button>
            <button data-action="NEXT_BREATH">Next Breath</button>
            <button data-action="SKIP_POSE">Skip Pose</button>
            <button data-action="PAUSE_SESSION">Pause</button>
            <button data-action="RESUME_SESSION">Resume</button>
            <button data-action="TERMINATE_SESSION">End</button>
          </div>
        </div>

        <div>
          <h2>Instruction Controls</h2>
          <label for="instructionMode">Instruction mode</label>
          <select id="instructionMode">
            <option value="brief" ${state.settings.instructionMode === 'brief' ? 'selected' : ''}>Brief</option>
            <option value="full" ${state.settings.instructionMode === 'full' ? 'selected' : ''}>Full</option>
          </select>

          <label for="instructionScope">Instruction scope</label>
          <select id="instructionScope">
            <option value="pose" ${state.settings.instructionScope === 'pose' ? 'selected' : ''}>Only this pose</option>
            <option value="flow" ${state.settings.instructionScope === 'flow' ? 'selected' : ''}>This flow</option>
            <option value="all" ${state.settings.instructionScope === 'all' ? 'selected' : ''}>All flows</option>
          </select>

          <label class="checkbox">
            <input id="breathMarkerEnabled" type="checkbox" ${state.settings.breathMarkerEnabled ? 'checked' : ''} />
            Breath marker enabled
          </label>

          <label class="inline" for="inhaleSeconds">Inhale seconds</label>
          <input id="inhaleSeconds" type="range" min="2" max="12" value="${state.settings.inhaleSeconds}" />
          <span>${state.settings.inhaleSeconds}s</span>

          <label class="inline" for="exhaleSeconds">Exhale seconds</label>
          <input id="exhaleSeconds" type="range" min="2" max="12" value="${state.settings.exhaleSeconds}" />
          <span>${state.settings.exhaleSeconds}s</span>

          <label class="inline" for="breathsPerPose">Breaths per pose</label>
          <input id="breathsPerPose" type="range" min="1" max="12" value="${state.settings.breathsPerPose}" />
          <span>${state.settings.breathsPerPose}</span>

          <label class="checkbox">
            <input id="backgroundSoundEnabled" type="checkbox" ${state.settings.backgroundSoundEnabled ? 'checked' : ''} />
            Background sound enabled
          </label>

          <label for="backgroundSound">Background profile</label>
          <select id="backgroundSound">
            ${state.catalog.backgroundSoundOptions
              .map(
                (sound) =>
                  `<option value="${sound}" ${sound === state.settings.backgroundSound ? 'selected' : ''}>${sound}</option>`,
              )
              .join('')}
          </select>
        </div>
      </section>

      <section class="panel">
        <h2>What would be heard (no TTS yet)</h2>
        <p class="spoken">${state.output.spokenText}</p>
        <p>${state.output.breathText}</p>
        <p>${state.output.backgroundText}</p>
        <p>${state.output.voicePlaybackText}</p>
      </section>

      <section class="panel">
        <h2>LLM Contract</h2>
        <p><strong>Contract version:</strong> ${intentAdapter.getContract().contractVersion}</p>
        <p><strong>Valid LLM intents now:</strong> ${intentAdapter.listValidLLMIntents().join(', ') || 'none (press Start first)'}</p>
        <p>Runtime hook: <strong>window.yogaIntentAdapter</strong> (for future Gemma binding).</p>
      </section>

      <section class="panel">
        <h2>Simulated LLM Console</h2>
        <label for="intentJson">Intent JSON</label>
        <textarea id="intentJson" class="intent-json" rows="9" spellcheck="false">${escapeHtml(intentConsoleInput)}</textarea>
        <div class="controls top-gap">
          <button id="runIntent" type="button">Run Intent</button>
        </div>
        <p class="intent-result">${escapeHtml(intentConsoleResult)}</p>
      </section>

      <section class="panel grid-2">
        <div>
          <h2>Gemma 4 Test Panel</h2>
          <p class="small-note">Separate model test surface (not wired into yoga flow yet).</p>
          <label for="gemmaModelId">Model ID</label>
          <input id="gemmaModelId" type="text" value="${escapeHtml(gemmaRuntime.modelId)}" />

          <label for="gemmaDevice">Device</label>
          <select id="gemmaDevice">
            <option value="auto" ${gemmaRuntime.device === 'auto' ? 'selected' : ''}>auto (webgpu → wasm)</option>
            <option value="webgpu" ${gemmaRuntime.device === 'webgpu' ? 'selected' : ''}>webgpu</option>
            <option value="wasm" ${gemmaRuntime.device === 'wasm' ? 'selected' : ''}>wasm</option>
          </select>

          <label for="gemmaDtype">Precision</label>
          <select id="gemmaDtype">
            <option value="q4f16" ${gemmaRuntime.dtype === 'q4f16' ? 'selected' : ''}>q4f16</option>
            <option value="q4" ${gemmaRuntime.dtype === 'q4' ? 'selected' : ''}>q4</option>
            <option value="q8" ${gemmaRuntime.dtype === 'q8' ? 'selected' : ''}>q8</option>
            <option value="fp32" ${gemmaRuntime.dtype === 'fp32' ? 'selected' : ''}>fp32</option>
          </select>

          <label for="gemmaPrompt">Prompt</label>
          <textarea id="gemmaPrompt" class="intent-json" rows="5" spellcheck="false">${escapeHtml(gemmaRuntime.prompt)}</textarea>

          <label class="checkbox">
            <input id="gemmaAutoRunOnTurnEnd" type="checkbox" ${gemmaRuntime.autoRunOnTurnEnd ? 'checked' : ''} />
            Auto-run Gemma when turn ends
          </label>

          <div class="controls top-gap">
            <button id="initGemma" type="button" ${gemmaRuntime.loading ? 'disabled' : ''}>Init Gemma</button>
            <button id="runGemma" type="button" ${gemmaRuntime.loading || gemmaRuntime.generating ? 'disabled' : ''}>Run Prompt</button>
            <button id="startConversation" type="button">Start Conversation</button>
            <button id="stopConversation" type="button">Stop Conversation</button>
            <button id="copyGemmaDebug" type="button">Copy Gemma Debug</button>
          </div>
          <p class="intent-result"><strong>Status:</strong> ${escapeHtml(gemmaRuntime.status)}</p>
          <p class="intent-result"><strong>Stage:</strong> ${escapeHtml(gemmaRuntime.stage)}</p>
          ${gemmaRuntime.loading ? '<p class="small-note">Model is still downloading/loading in background. First run can take several minutes.</p>' : ''}
          <textarea class="intent-json" rows="8" spellcheck="false" readonly>${escapeHtml(gemmaDebugDump())}</textarea>
          <p class="intent-result"><strong>Conversation:</strong> ${escapeHtml(gemmaRuntime.conversationStatus)}</p>
          <p class="model-output">${escapeHtml(gemmaRuntime.output || 'No output yet.')}</p>
        </div>

        <div>
          <h2>Kokoro TTS Test Panel</h2>
          <p class="small-note">Separate model test surface (not wired into yoga flow yet).</p>
          <label for="kokoroModelId">Model ID</label>
          <input id="kokoroModelId" type="text" value="${escapeHtml(kokoroRuntime.modelId)}" />

          <label for="kokoroDevice">Device</label>
          <select id="kokoroDevice">
            <option value="wasm" ${kokoroRuntime.device === 'wasm' ? 'selected' : ''}>wasm</option>
            <option value="webgpu" ${kokoroRuntime.device === 'webgpu' ? 'selected' : ''}>webgpu</option>
          </select>

          <label for="kokoroDtype">Precision</label>
          <select id="kokoroDtype">
            <option value="q8" ${kokoroRuntime.dtype === 'q8' ? 'selected' : ''}>q8</option>
            <option value="q4" ${kokoroRuntime.dtype === 'q4' ? 'selected' : ''}>q4</option>
            <option value="q4f16" ${kokoroRuntime.dtype === 'q4f16' ? 'selected' : ''}>q4f16</option>
            <option value="fp32" ${kokoroRuntime.dtype === 'fp32' ? 'selected' : ''}>fp32</option>
          </select>

          <label for="kokoroVoice">Voice</label>
          <select id="kokoroVoice">
            <option value="af_nicole" ${kokoroRuntime.voice === 'af_nicole' ? 'selected' : ''}>af_nicole</option>
            <option value="am_liam" ${kokoroRuntime.voice === 'am_liam' ? 'selected' : ''}>am_liam</option>
            <option value="af_bella" ${kokoroRuntime.voice === 'af_bella' ? 'selected' : ''}>af_bella</option>
            <option value="af_heart" ${kokoroRuntime.voice === 'af_heart' ? 'selected' : ''}>af_heart</option>
          </select>

          <label for="kokoroSpeed">Speed</label>
          <input id="kokoroSpeed" type="range" min="0.6" max="1.4" step="0.1" value="${kokoroRuntime.speed}" />
          <span>${kokoroRuntime.speed.toFixed(1)}x</span>

          <label for="kokoroText">Text</label>
          <textarea id="kokoroText" class="intent-json" rows="5" spellcheck="false">${escapeHtml(kokoroRuntime.text)}</textarea>

          <div class="controls top-gap">
            <button id="initKokoro" type="button">Init Kokoro</button>
            <button id="runKokoro" type="button">Synthesize</button>
          </div>
          <p class="intent-result"><strong>Status:</strong> ${escapeHtml(kokoroRuntime.status)}</p>
          <audio controls ${kokoroRuntime.audioUrl ? `src="${kokoroRuntime.audioUrl}"` : ''}></audio>
        </div>
      </section>

      <section class="panel">
        <h2>Pose from poses.json</h2>
        <p><strong>Name:</strong> ${pose?.display_name ?? 'None'}</p>
        <p><strong>Category:</strong> ${pose?.category ?? 'n/a'}</p>
        <p><strong>Difficulty:</strong> ${pose?.difficulty ?? 'n/a'}</p>
        <p>${pose?.description?.replaceAll('//', '') ?? 'No pose active.'}</p>
      </section>
    </main>
  `;
}

store.subscribe((state) => {
  render(state);

  if (state.session.status === 'preparing' && !modelPrepTimer) {
    modelPrepTimer = setTimeout(() => {
      modelPrepTimer = null;
      dispatch({ type: 'MODELS_READY' });
    }, 1500);
  }

  if (state.session.status !== 'preparing' && modelPrepTimer) {
    clearTimeout(modelPrepTimer);
    modelPrepTimer = null;
  }

  const desiredBreathMs = (state.settings.inhaleSeconds + state.settings.exhaleSeconds) * 1000;
  const shouldRunBreathTimer = state.session.status === 'active';

  if (shouldRunBreathTimer) {
    if (!breathTimer || breathTimerMs !== desiredBreathMs) {
      if (breathTimer) {
        clearInterval(breathTimer);
      }

      breathTimerMs = desiredBreathMs;
      breathTimer = setInterval(() => {
        const current = store.getState();
        if (current.session.status !== 'active') {
          clearInterval(breathTimer);
          breathTimer = null;
          breathTimerMs = null;
          return;
        }
        dispatch({ type: 'NEXT_BREATH' });
      }, desiredBreathMs);
    }
    return;
  }

  if (breathTimer) {
    clearInterval(breathTimer);
    breathTimer = null;
    breathTimerMs = null;
  }
});

app.addEventListener('click', onAppClick);
app.addEventListener('change', onAppChange);
app.addEventListener('input', onAppInput);

}
