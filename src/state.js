import poseLibrary from '../poses.json';

const DEFAULT_BACKGROUND = 'rain';

const ACTION_SCHEMA = {
  SELECT_FLOW: {
    required: ['flowId'],
    validate: (payload, state) => state.catalog.flows.some((flow) => flow.id === payload.flowId),
  },
  START_SESSION: {
    required: [],
    validate: (_, state) => ['idle', 'completed', 'terminated'].includes(state.session.status),
  },
  MODELS_READY: {
    required: [],
    validate: (_, state) => state.session.status === 'preparing',
  },
  MARK_READY: {
    required: [],
    validate: (_, state) => state.session.status === 'waiting_ready',
  },
  PAUSE_SESSION: {
    required: [],
    validate: (_, state) => state.session.status === 'active',
  },
  RESUME_SESSION: {
    required: [],
    validate: (_, state) => state.session.status === 'paused',
  },
  TERMINATE_SESSION: {
    required: [],
    validate: (_, state) => !['idle', 'terminated'].includes(state.session.status),
  },
  NEXT_BREATH: {
    required: [],
    validate: (_, state) => state.session.status === 'active',
  },
  SKIP_POSE: {
    required: [],
    validate: (_, state) => state.session.status === 'active',
  },
  SET_INSTRUCTION_MODE: {
    required: ['mode'],
    validate: (payload) => ['brief', 'full'].includes(payload.mode),
  },
  SET_INSTRUCTION_SCOPE: {
    required: ['scope'],
    validate: (payload) => ['pose', 'flow', 'all'].includes(payload.scope),
  },
  SET_BREATH_PACE: {
    required: ['inhaleSeconds', 'exhaleSeconds'],
    validate: (payload) =>
      Number.isInteger(payload.inhaleSeconds) &&
      Number.isInteger(payload.exhaleSeconds) &&
      payload.inhaleSeconds >= 2 &&
      payload.inhaleSeconds <= 12 &&
      payload.exhaleSeconds >= 2 &&
      payload.exhaleSeconds <= 12,
  },
  SET_BREATHS_PER_POSE: {
    required: ['breaths'],
    validate: (payload) => Number.isInteger(payload.breaths) && payload.breaths >= 1 && payload.breaths <= 12,
  },
  TOGGLE_BREATH_MARKER: {
    required: [],
    validate: () => true,
  },
  TOGGLE_BACKGROUND_SOUND: {
    required: [],
    validate: () => true,
  },
  SET_BACKGROUND_SOUND: {
    required: ['sound'],
    validate: (payload, state) => state.catalog.backgroundSoundOptions.includes(payload.sound),
  },
  START_VOICE_PLAYBACK: {
    required: ['text'],
    validate: (payload) => typeof payload.text === 'string' && payload.text.trim().length > 0,
  },
  STOP_VOICE_PLAYBACK: {
    required: [],
    validate: () => true,
  },
};

function safeText(value, fallback = 'No description yet.') {
  if (!value || typeof value !== 'string') {
    return fallback;
  }
  return value.replaceAll('//', '').trim();
}

function createCatalog(poses) {
  const posesByName = {};
  for (const pose of poses) {
    posesByName[pose.name] = pose;
  }

  const preferredSample = ['MountainArmsSide', 'BoundAngle', 'BoatHalf', 'Corpse'];
  const samplePoses = preferredSample
    .map((name) => posesByName[name])
    .filter(Boolean);

  const fallbackPoses = poses.filter((pose) => pose.visibility === 'primary').slice(0, 4);
  const selectedPoses = samplePoses.length >= 3 ? samplePoses : fallbackPoses;

  const steps = selectedPoses.map((pose, index) => ({
    id: `step-${index + 1}`,
    poseName: pose.name,
    breaths: inferBreaths(pose),
  }));

  const flows = [
    {
      id: 'foundation-flow',
      name: 'Foundation Flow',
      description: 'Small starter flow proving the state model and transitions.',
      stepIds: steps.map((step) => step.id),
      steps,
    },
  ];

  return {
    posesByName,
    flows,
    backgroundSoundOptions: ['rain', 'river', 'wind', 'city', 'brown-noise'],
    breathMarkerOptions: ['detune-note', 'dissonance-resolve', 'brown-breath'],
  };
}

function inferBreaths(pose) {
  if (pose.difficulty === 'expert') return 6;
  if (pose.difficulty === 'intermediate') return 5;
  return 4;
}

function defaultSideForPose(pose) {
  return pose?.preferred_side ?? 'left';
}

function oppositeSide(side) {
  return side === 'left' ? 'right' : 'left';
}

function buildInitialState() {
  const catalog = createCatalog(poseLibrary);
  const selectedFlowId = catalog.flows[0]?.id;

  const state = {
    schemaVersion: '0.1.0',
    catalog,
    settings: {
      instructionMode: 'brief',
      instructionScope: 'flow',
      inhaleSeconds: 4,
      exhaleSeconds: 6,
      breathsPerPose: 4,
      breathMarkerEnabled: true,
      backgroundSoundEnabled: true,
      backgroundSound: DEFAULT_BACKGROUND,
      breathMarkerStyle: 'brown-breath',
    },
    models: {
      gemma4Small: 'not_loaded',
      kokoroTts: 'not_loaded',
      primed: false,
    },
    session: {
      status: 'idle',
      selectedFlowId,
      currentStepIndex: 0,
      currentBreath: 0,
      sidePhase: 'first',
      currentSide: 'left',
    },
    output: {
      spokenText: '',
      breathText: '',
      backgroundText: '',
      statusText: '',
      voicePlaybackText: '',
    },
    voicePlayback: {
      status: 'idle',
      text: '',
    },
  };

  return recalcOutput(state);
}

function getFlow(state) {
  return state.catalog.flows.find((flow) => flow.id === state.session.selectedFlowId) ?? null;
}

function getCurrentStep(state) {
  const flow = getFlow(state);
  if (!flow) return null;
  return flow.steps[state.session.currentStepIndex] ?? null;
}

function getCurrentPose(state) {
  const step = getCurrentStep(state);
  if (!step) return null;
  return state.catalog.posesByName[step.poseName] ?? null;
}

function targetBreathsForCurrentPose(state) {
  const step = getCurrentStep(state);
  if (!step) {
    return state.settings.breathsPerPose;
  }
  return state.settings.breathsPerPose ?? step.breaths;
}

function formatPosePrompt(state) {
  const pose = getCurrentPose(state);
  const step = getCurrentStep(state);
  const targetBreaths = targetBreathsForCurrentPose(state);
  if (!pose || !step) {
    return 'Flow complete. Sit comfortably and notice your breath.';
  }

  const sideText = pose.two_sided ? ` (${state.session.currentSide} side)` : '';
  const header = `${pose.display_name}${sideText}. Hold for ${targetBreaths} breaths.`;

  if (state.settings.instructionMode === 'brief') {
    return header;
  }

  const description = safeText(pose.description);
  const benefits = safeText(pose.benefits, 'Benefits not specified yet.');
  return `${header} ${description} Benefits: ${benefits}`;
}

function recalcOutput(state) {
  const pose = getCurrentPose(state);
  const step = getCurrentStep(state);

  let statusText = 'Waiting to start.';
  if (state.session.status === 'preparing') {
    statusText = 'Preparing Gemma 4 and Kokoro models...';
  } else if (state.session.status === 'waiting_ready') {
    statusText = 'Models ready. Say or press Ready to begin.';
  } else if (state.session.status === 'active') {
    statusText = `Pose ${state.session.currentStepIndex + 1}${step ? `/${getFlow(state).steps.length}` : ''}`;
  } else if (state.session.status === 'paused') {
    statusText = 'Session paused.';
  } else if (state.session.status === 'completed') {
    statusText = 'Session complete.';
  } else if (state.session.status === 'terminated') {
    statusText = 'Session ended.';
  }

  state.output.spokenText = formatPosePrompt(state);
  state.output.breathText = state.settings.breathMarkerEnabled
    ? `Inhale ${state.settings.inhaleSeconds}s · Exhale ${state.settings.exhaleSeconds}s`
    : 'Breath marker muted';
  state.output.backgroundText = state.settings.backgroundSoundEnabled
    ? `Background sound: ${state.settings.backgroundSound}`
    : 'Background sound muted';
  state.output.voicePlaybackText =
    state.voicePlayback.status === 'playing'
      ? `Voice playback: playing (${state.voicePlayback.text})`
      : 'Voice playback: idle';
  state.output.statusText = statusText;

  if (!pose) {
    state.session.currentSide = 'left';
  }

  return state;
}

function resetSessionProgress(state) {
  const flow = getFlow(state);
  const firstStep = flow?.steps[0] ?? null;
  const firstPose = firstStep ? state.catalog.posesByName[firstStep.poseName] : null;

  state.session.currentStepIndex = 0;
  state.session.currentBreath = 0;
  state.session.sidePhase = 'first';
  state.session.currentSide = defaultSideForPose(firstPose);
}

function advanceToNextStep(state) {
  const flow = getFlow(state);
  if (!flow) return;

  state.session.currentStepIndex += 1;
  state.session.currentBreath = 0;
  state.session.sidePhase = 'first';

  if (state.session.currentStepIndex >= flow.steps.length) {
    state.session.status = 'completed';
    state.session.currentStepIndex = flow.steps.length;
    return;
  }

  const nextStep = flow.steps[state.session.currentStepIndex];
  const nextPose = state.catalog.posesByName[nextStep.poseName];
  state.session.currentSide = defaultSideForPose(nextPose);
}

function nextBreath(state) {
  const targetBreaths = targetBreathsForCurrentPose(state);
  const pose = getCurrentPose(state);
  if (!pose) {
    state.session.status = 'completed';
    return;
  }

  state.session.currentBreath += 1;

  if (state.session.currentBreath < targetBreaths) {
    return;
  }

  if (pose.two_sided && state.session.sidePhase === 'first') {
    state.session.sidePhase = 'second';
    state.session.currentSide = oppositeSide(state.session.currentSide);
    state.session.currentBreath = 0;
    return;
  }

  advanceToNextStep(state);
}

function validateAction(action, state) {
  const definition = ACTION_SCHEMA[action.type];
  if (!definition) {
    return { ok: false, reason: `Unknown action: ${action.type}` };
  }

  for (const key of definition.required) {
    if (!(key in (action.payload ?? {}))) {
      return { ok: false, reason: `Missing payload key: ${key}` };
    }
  }

  const isValid = definition.validate(action.payload ?? {}, state);
  if (!isValid) {
    return { ok: false, reason: `Invalid action transition/payload: ${action.type}` };
  }

  return { ok: true };
}

function reduceState(currentState, action) {
  const nextState = structuredClone(currentState);

  switch (action.type) {
    case 'SELECT_FLOW': {
      nextState.session.selectedFlowId = action.payload.flowId;
      nextState.session.status = 'idle';
      resetSessionProgress(nextState);
      break;
    }
    case 'START_SESSION': {
      resetSessionProgress(nextState);

      if (!nextState.models.primed) {
        nextState.models.gemma4Small = 'loading';
        nextState.models.kokoroTts = 'loading';
        nextState.session.status = 'preparing';
      } else {
        nextState.session.status = 'waiting_ready';
      }

      break;
    }
    case 'MODELS_READY': {
      nextState.models.gemma4Small = 'ready';
      nextState.models.kokoroTts = 'ready';
      nextState.models.primed = true;
      nextState.session.status = 'waiting_ready';
      break;
    }
    case 'MARK_READY': {
      nextState.session.status = 'active';
      break;
    }
    case 'PAUSE_SESSION': {
      nextState.session.status = 'paused';
      break;
    }
    case 'RESUME_SESSION': {
      nextState.session.status = 'active';
      break;
    }
    case 'TERMINATE_SESSION': {
      nextState.session.status = 'terminated';
      break;
    }
    case 'NEXT_BREATH': {
      nextBreath(nextState);
      break;
    }
    case 'SKIP_POSE': {
      advanceToNextStep(nextState);
      if (nextState.session.status !== 'completed') {
        nextState.session.status = 'active';
      }
      break;
    }
    case 'SET_INSTRUCTION_MODE': {
      nextState.settings.instructionMode = action.payload.mode;
      break;
    }
    case 'SET_INSTRUCTION_SCOPE': {
      nextState.settings.instructionScope = action.payload.scope;
      break;
    }
    case 'SET_BREATH_PACE': {
      nextState.settings.inhaleSeconds = action.payload.inhaleSeconds;
      nextState.settings.exhaleSeconds = action.payload.exhaleSeconds;
      break;
    }
    case 'SET_BREATHS_PER_POSE': {
      nextState.settings.breathsPerPose = action.payload.breaths;
      break;
    }
    case 'TOGGLE_BREATH_MARKER': {
      nextState.settings.breathMarkerEnabled = !nextState.settings.breathMarkerEnabled;
      break;
    }
    case 'TOGGLE_BACKGROUND_SOUND': {
      nextState.settings.backgroundSoundEnabled = !nextState.settings.backgroundSoundEnabled;
      break;
    }
    case 'SET_BACKGROUND_SOUND': {
      nextState.settings.backgroundSound = action.payload.sound;
      break;
    }
    case 'START_VOICE_PLAYBACK': {
      nextState.voicePlayback.status = 'playing';
      nextState.voicePlayback.text = action.payload.text;
      break;
    }
    case 'STOP_VOICE_PLAYBACK': {
      nextState.voicePlayback.status = 'idle';
      nextState.voicePlayback.text = '';
      break;
    }
    default:
      break;
  }

  return recalcOutput(nextState);
}

export function createYogaStore() {
  let state = buildInitialState();
  const subscribers = new Set();

  function emit() {
    for (const subscriber of subscribers) {
      subscriber(state);
    }
  }

  return {
    actionSchema: ACTION_SCHEMA,
    getState() {
      return state;
    },
    subscribe(callback) {
      subscribers.add(callback);
      callback(state);
      return () => subscribers.delete(callback);
    },
    dispatch(action) {
      const validation = validateAction(action, state);
      if (!validation.ok) {
        return validation;
      }

      state = reduceState(state, action);
      emit();
      return { ok: true };
    },
  };
}
