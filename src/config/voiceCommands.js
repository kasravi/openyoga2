/**
 * Voice Command Configuration for Yoga App
 * Contains all the voice command patterns and their mappings
 */

export const VOICE_COMMAND_CONFIG = {
  // Speech recognition settings
  recognition: {
    continuous: true,
    interimResults: false,
    language: 'en-US',
    maxAlternatives: 1
  },

  // Command categories and their patterns
  commandPatterns: {
    flowControl: {
      pause: ['pause', 'stop', 'hold on', 'wait'],
      resume: ['continue', 'resume', 'go on', 'keep going'],
      skip: ['skip', 'next', 'move on'],
      start: ['ready', 'start', 'begin'],
      end: ['end', 'finish', 'quit', 'stop session']
    },
    
    difficulty: {
      easier: ['easier', 'easy', 'make it easier', 'too hard', 'too difficult'],
      harder: ['harder', 'difficult', 'make it harder', 'too easy', 'more challenging']
    },
    
    description: {
      describePose: ['describe', 'how to do', 'explain', 'instructions'],
      fullDescriptionMode: ['full description', 'detailed instructions', 'more details']
    },
    
    breathing: {
      slower: ['slower breath', 'breathe slower', 'longer breath'],
      faster: ['faster breath', 'breathe faster', 'shorter breath'],
      mute: ['mute breath', 'no breath sounds', 'quiet breathing']
    },
    
    background: {
      mute: ['mute background', 'no background', 'quiet background'],
      change: ['change background', 'different sound', 'new background']
    },
    
    guidance: {
      muscleFocus: ['muscles', 'which muscles', 'focus muscles']
    }
  },

  // Confidence thresholds for different command types
  confidenceThresholds: {
    flowControl: 0.9,
    difficulty: 0.8,
    description: 0.8,
    breathing: 0.7,
    background: 0.7,
    guidance: 0.7
  }
};

/**
 * Get the confidence threshold for a command type
 */
export function getConfidenceThreshold(commandType) {
  return VOICE_COMMAND_CONFIG.confidenceThresholds[commandType] || 0.5;
}

/**
 * Get all command patterns for a specific category
 */
export function getCommandPatterns(category) {
  return VOICE_COMMAND_CONFIG.commandPatterns[category] || {};
}
