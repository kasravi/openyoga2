const COMMAND_DEFINITIONS = {
  select_flow: {
    actionType: 'SELECT_FLOW',
    audience: 'internal',
    params: {
      flowId: { type: 'string', source: 'catalog.flows[].id' },
    },
    allowedStatuses: ['idle', 'completed', 'terminated'],
  },
  start_session: {
    actionType: 'START_SESSION',
    audience: 'internal',
    params: {},
    allowedStatuses: ['idle', 'completed', 'terminated'],
  },
  confirm_models_ready: {
    actionType: 'MODELS_READY',
    audience: 'internal',
    params: {},
    allowedStatuses: ['preparing'],
  },
  mark_ready: {
    actionType: 'MARK_READY',
    audience: 'llm',
    params: {},
    allowedStatuses: ['waiting_ready'],
  },
  pause_session: {
    actionType: 'PAUSE_SESSION',
    audience: 'llm',
    params: {},
    allowedStatuses: ['active'],
  },
  resume_session: {
    actionType: 'RESUME_SESSION',
    audience: 'llm',
    params: {},
    allowedStatuses: ['paused'],
  },
  terminate_session: {
    actionType: 'TERMINATE_SESSION',
    audience: 'llm',
    params: {},
    allowedStatuses: ['preparing', 'waiting_ready', 'active', 'paused', 'completed'],
  },
  next_breath: {
    actionType: 'NEXT_BREATH',
    audience: 'llm',
    params: {},
    allowedStatuses: ['active'],
  },
  skip_pose: {
    actionType: 'SKIP_POSE',
    audience: 'llm',
    params: {},
    allowedStatuses: ['active'],
  },
  set_instruction_mode: {
    actionType: 'SET_INSTRUCTION_MODE',
    audience: 'llm',
    params: {
      mode: { type: 'enum', values: ['brief', 'full'] },
    },
    allowedStatuses: ['preparing', 'waiting_ready', 'active', 'paused', 'completed', 'terminated'],
  },
  set_instruction_scope: {
    actionType: 'SET_INSTRUCTION_SCOPE',
    audience: 'llm',
    params: {
      scope: { type: 'enum', values: ['pose', 'flow', 'all'] },
    },
    allowedStatuses: ['preparing', 'waiting_ready', 'active', 'paused', 'completed', 'terminated'],
  },
  set_breath_pace: {
    actionType: 'SET_BREATH_PACE',
    audience: 'llm',
    params: {
      inhaleSeconds: { type: 'integer', min: 2, max: 12 },
      exhaleSeconds: { type: 'integer', min: 2, max: 12 },
    },
    allowedStatuses: ['preparing', 'waiting_ready', 'active', 'paused', 'completed', 'terminated'],
  },
  set_breaths_per_pose: {
    actionType: 'SET_BREATHS_PER_POSE',
    audience: 'llm',
    params: {
      breaths: { type: 'integer', min: 1, max: 12 },
    },
    allowedStatuses: ['preparing', 'waiting_ready', 'active', 'paused', 'completed', 'terminated'],
  },
  toggle_breath_marker: {
    actionType: 'TOGGLE_BREATH_MARKER',
    audience: 'llm',
    params: {},
    allowedStatuses: ['preparing', 'waiting_ready', 'active', 'paused', 'completed', 'terminated'],
  },
  toggle_background_sound: {
    actionType: 'TOGGLE_BACKGROUND_SOUND',
    audience: 'llm',
    params: {},
    allowedStatuses: ['preparing', 'waiting_ready', 'active', 'paused', 'completed', 'terminated'],
  },
  set_background_sound: {
    actionType: 'SET_BACKGROUND_SOUND',
    audience: 'llm',
    params: {
      sound: { type: 'string', source: 'catalog.backgroundSoundOptions[]' },
    },
    allowedStatuses: ['preparing', 'waiting_ready', 'active', 'paused', 'completed', 'terminated'],
  },
  start_voice_playback: {
    actionType: 'START_VOICE_PLAYBACK',
    audience: 'llm',
    params: {
      text: { type: 'string' },
    },
    allowedStatuses: ['preparing', 'waiting_ready', 'active', 'paused', 'completed', 'terminated'],
  },
  stop_voice_playback: {
    actionType: 'STOP_VOICE_PLAYBACK',
    audience: 'llm',
    params: {},
    allowedStatuses: ['preparing', 'waiting_ready', 'active', 'paused', 'completed', 'terminated'],
  },
};

function getLLMIntentDefinitions() {
  return Object.fromEntries(
    Object.entries(COMMAND_DEFINITIONS).filter(([, definition]) => definition.audience === 'llm'),
  );
}

function toPayload(definition, rawParams = {}) {
  if (!definition || !definition.params) {
    return undefined;
  }

  const keys = Object.keys(definition.params);
  if (keys.length === 0) {
    return undefined;
  }

  const payload = {};
  for (const key of keys) {
    if (key in rawParams) {
      payload[key] = rawParams[key];
    }
  }
  return payload;
}

export function getYogaLLMContract(state) {
  const llmIntents = getLLMIntentDefinitions();

  return {
    contractVersion: '0.1.0',
    description: 'Yoga app LLM intent contract. LLM should emit one intent with params and never mutate state directly.',
    mutablePaths: [
      'session.status',
      'session.selectedFlowId',
      'session.currentStepIndex',
      'session.currentBreath',
      'session.currentSide',
      'settings.instructionMode',
      'settings.instructionScope',
      'settings.inhaleSeconds',
      'settings.exhaleSeconds',
      'settings.breathsPerPose',
      'settings.breathMarkerEnabled',
      'settings.backgroundSoundEnabled',
      'settings.backgroundSound',
      'voicePlayback.status',
      'voicePlayback.text',
      'models.gemma4Small',
      'models.kokoroTts',
      'models.primed',
    ],
    dynamicContext: {
      currentStatus: state.session.status,
      availableFlowIds: state.catalog.flows.map((flow) => flow.id),
      availableBackgroundSounds: [...state.catalog.backgroundSoundOptions],
      currentFlowId: state.session.selectedFlowId,
      llmEnabled: state.session.status !== 'idle',
    },
    intents: llmIntents,
  };
}

export function listValidLLMIntentsForState(state) {
  return Object.entries(COMMAND_DEFINITIONS)
    .filter(([, def]) => def.audience === 'llm')
    .filter(([, def]) => def.allowedStatuses.includes(state.session.status))
    .map(([intent]) => intent);
}

export function listValidInternalCommandsForState(state) {
  return Object.entries(COMMAND_DEFINITIONS)
    .filter(([, def]) => def.audience === 'internal')
    .filter(([, def]) => def.allowedStatuses.includes(state.session.status))
    .map(([intent]) => intent);
}

export function createYogaIntentAdapter(store) {
  return {
    getContract() {
      return getYogaLLMContract(store.getState());
    },
    listValidLLMIntents() {
      return listValidLLMIntentsForState(store.getState());
    },
    applyIntent(intentCommand) {
      const { intent, params } = intentCommand ?? {};
      const definition = COMMAND_DEFINITIONS[intent];

      if (!definition) {
        return { ok: false, reason: `Unknown intent: ${intent}` };
      }

      if (definition.audience !== 'llm') {
        return { ok: false, reason: `Intent ${intent} is internal and not available to LLM` };
      }

      const currentState = store.getState();
      if (!definition.allowedStatuses.includes(currentState.session.status)) {
        return {
          ok: false,
          reason: `Intent ${intent} is not valid in status ${currentState.session.status}`,
        };
      }

      const action = {
        type: definition.actionType,
      };

      const payload = toPayload(definition, params);
      if (payload) {
        action.payload = payload;
      }

      return store.dispatch(action);
    },
  };
}
