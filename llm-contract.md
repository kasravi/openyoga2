# Yoga LLM Action Contract

This file describes the app-level LLM intent contract for future Gemma integration.

## Goal
The LLM should **not** mutate state directly. It should emit a single LLM intent command:

```json
{
  "intent": "set_breath_pace",
  "params": {
    "inhaleSeconds": 5,
    "exhaleSeconds": 7
  }
}
```

The intent is translated to a store action and validated against transition + payload rules.

`start_session` is intentionally **not** an LLM intent. The user starts from UI button.

## Runtime API
The app exposes an adapter on `window.yogaIntentAdapter`:

- `getContract()` → returns dynamic contract (allowed values and current status)
- `listValidLLMIntents()` → LLM intents valid in the current session status
- `applyIntent({ intent, params })` → validates and dispatches to state

## LLM Intent set (v0.1.0)
- `mark_ready`
- `pause_session`
- `resume_session`
- `terminate_session`
- `next_breath`
- `skip_pose`
- `set_instruction_mode`
- `set_instruction_scope`
- `set_breath_pace`
- `set_breaths_per_pose`
- `toggle_breath_marker`
- `toggle_background_sound`
- `set_background_sound`
- `start_voice_playback`
- `stop_voice_playback`

## Internal-only commands
- `select_flow`
- `start_session`
- `confirm_models_ready`

## Notes
- State constraints and payload guards remain enforced in `src/state.js`.
- Contract and adapter are implemented in `src/llmContract.js`.
- This is intentionally abstract and model-agnostic so STT/TTS/LLM can be integrated later without changing app core logic.
