# Voice Commands Integration - Usage Guide

## Overview
The yoga app now supports voice commands for hands-free interaction during yoga sessions. The voice recognition system converts spoken commands into structured JSON format for easy integration with the yoga flow logic.

## Supported Voice Commands

### Flow Control
- **"pause"** / **"stop"** / **"hold on"** → Pause the current session
- **"continue"** / **"resume"** / **"go on"** → Resume the session
- **"skip"** / **"next"** → Skip to the next pose
- **"ready"** / **"start"** → Begin the session or resume if paused
- **"end"** / **"finish"** / **"quit"** → End the session

### Difficulty Adjustment
- **"easier"** / **"make it easier"** / **"too hard"** → Request easier variation
- **"harder"** / **"make it harder"** / **"too easy"** → Request harder variation

### Pose Description
- **"describe"** / **"how to do"** / **"explain"** → Get pose instructions
- **"full description"** / **"more details"** → Enable detailed description mode

### Breathing Control *(coming soon)*
- **"breathe slower"** / **"longer breath"** → Slow down breathing guide
- **"breathe faster"** / **"shorter breath"** → Speed up breathing guide
- **"mute breath sounds"** → Turn off breathing audio cues

### Background Sounds *(coming soon)*
- **"mute background"** → Turn off background sounds
- **"change background"** → Switch to different background sound

## Technical Details

### Command Structure
All voice commands are converted to this JSON format:
```json
{
  "type": "flow_control",
  "action": "pause",
  "confidence": 0.9,
  "originalText": "pause please",
  "timestamp": 1693934400000
}
```

### Integration Points
Voice commands are integrated into the existing yoga flow through the `handleVoiceCommand` function in `App.jsx`, which maps voice commands to the existing command system.

### Browser Compatibility
- **Chrome/Edge**: Full support with Web Speech API
- **Safari**: Limited support (may require user permission)
- **Firefox**: Limited support
- **Mobile**: Works on most modern mobile browsers

### Privacy
- All voice processing happens locally in the browser
- No voice data is sent to external servers
- Speech recognition uses the browser's built-in API

## Development Notes

### Files Structure
```
src/
├── services/
│   └── VoiceCommandService.js     # Core voice recognition logic
├── components/
│   └── VoiceCommands.jsx          # React component for voice UI
└── config/
    └── voiceCommands.js           # Command patterns and configuration
```

### Adding New Commands
1. Add patterns to `config/voiceCommands.js`
2. Update the command mapping in `App.jsx`
3. Implement the corresponding action in the yoga flow logic

### Error Handling
The system gracefully handles:
- Unsupported browsers (falls back to manual controls)
- Speech recognition errors
- Unrecognized commands
- Permission denied scenarios
