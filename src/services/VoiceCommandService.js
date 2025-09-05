/**
 * Voice Command Service for Yoga App
 * Handles speech recognition and command parsing for yoga session control
 */

import { VOICE_COMMAND_CONFIG, getConfidenceThreshold } from '../config/voiceCommands.js';

export class VoiceCommandService {
  constructor(onCommand, onStatus) {
    this.onCommand = onCommand || (() => {});
    this.onStatus = onStatus || (() => {});
    this.recognition = null;
    this.isListening = false;
    this.shouldBeListening = false; // Track if we should be actively listening
    this.initSpeechRecognition();
  }

  initSpeechRecognition() {
    // Check for speech recognition support
    if (!('webkitSpeechRecognition' in window) && !('SpeechRecognition' in window)) {
      this.onStatus({ status: 'error', message: 'Speech recognition not supported' });
      return;
    }

    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    this.recognition = new SpeechRecognition();
    
    // Configure recognition settings for continuous use
    this.recognition.continuous = true; // Keep listening continuously
    this.recognition.interimResults = VOICE_COMMAND_CONFIG.recognition.interimResults;
    this.recognition.lang = VOICE_COMMAND_CONFIG.recognition.language;
    this.recognition.maxAlternatives = VOICE_COMMAND_CONFIG.recognition.maxAlternatives;

    // Set up event handlers
    this.recognition.onstart = () => {
      this.isListening = true;
      this.onStatus({ status: 'listening', message: 'Voice recognition active' });
    };

    this.recognition.onend = () => {
      this.isListening = false;
      this.onStatus({ status: 'stopped', message: 'Voice recognition stopped' });
      
      // Auto-restart if we should be listening (for continuous operation)
      if (this.shouldBeListening) {
        console.log('Auto-restarting voice recognition');
        setTimeout(() => {
          if (this.shouldBeListening) {
            this.startListening();
          }
        }, 1000);
      }
    };

    this.recognition.onerror = (event) => {
      console.warn('Speech recognition error:', event.error);
      
      // Handle specific errors gracefully
      if (event.error === 'no-speech') {
        // Don't treat no-speech as a real error during continuous listening
        this.onStatus({ status: 'listening', message: 'Listening for commands...' });
      } else if (event.error === 'audio-capture') {
        this.onStatus({ status: 'error', message: 'Microphone access required for voice commands' });
      } else {
        this.onStatus({ status: 'warning', message: `Recognition issue: ${event.error}` });
      }
    };

    this.recognition.onresult = (event) => {
      const lastResultIndex = event.results.length - 1;
      const transcript = event.results[lastResultIndex][0].transcript.toLowerCase().trim();
      
      this.onStatus({ status: 'transcript', message: `Heard: "${transcript}"` });
      
      // Parse the transcript into commands
      const command = this.parseCommand(transcript);
      if (command) {
        this.onCommand(command);
      }
    };
  }

  /**
   * Parse natural language transcript into structured command JSON
   */
  parseCommand(transcript) {
    if (transcript.trim() === '') return null;
    const words = transcript.toLowerCase().split(/\s+/);
    
    // Define command patterns and their corresponding actions
    const commandPatterns = [
      // Flow control commands
      {
        patterns: ['pause', 'stop', 'hold on', 'wait'],
        command: { type: 'flow_control', action: 'pause', confidence: 0.9 }
      },
      {
        patterns: ['continue', 'resume', 'go on', 'keep going'],
        command: { type: 'flow_control', action: 'resume', confidence: 0.9 }
      },
      {
        patterns: ['skip', 'next', 'move on'],
        command: { type: 'flow_control', action: 'skip', confidence: 0.9 }
      },
      {
        patterns: ['ready', 'I\'m ready', 'let\'s go', 'let\'s begin'],
        command: { type: 'flow_control', action: 'ready', confidence: 0.9 }
      },
      {
        patterns: ['start', 'begin'],
        command: { type: 'flow_control', action: 'start', confidence: 0.9 }
      },
      {
        patterns: ['end', 'finish', 'quit', 'stop session'],
        command: { type: 'flow_control', action: 'end', confidence: 0.9 }
      },

      // Difficulty adjustment commands
      {
        patterns: ['easier', 'easy', 'make it easier', 'too hard', 'too difficult'],
        command: { type: 'difficulty', action: 'easier', confidence: 0.8 }
      },
      {
        patterns: ['harder', 'difficult', 'make it harder', 'too easy', 'more challenging'],
        command: { type: 'difficulty', action: 'harder', confidence: 0.8 }
      },

      // Description commands
      {
        patterns: ['describe', 'how to do', 'explain', 'instructions'],
        command: { type: 'description', action: 'describe_pose', confidence: 0.8 }
      },
      {
        patterns: ['full description', 'detailed instructions', 'more details'],
        command: { type: 'description', action: 'full_description_mode', confidence: 0.8 }
      },

      // Breathing commands
      {
        patterns: ['slower breath', 'breathe slower', 'longer breath'],
        command: { type: 'breathing', action: 'slower', confidence: 0.7 }
      },
      {
        patterns: ['faster breath', 'breathe faster', 'shorter breath'],
        command: { type: 'breathing', action: 'faster', confidence: 0.7 }
      },
      {
        patterns: ['mute breath', 'no breath sounds', 'quiet breathing'],
        command: { type: 'breathing', action: 'mute', confidence: 0.7 }
      },

      // Background sound commands
      {
        patterns: ['mute background', 'no background', 'quiet background'],
        command: { type: 'background', action: 'mute', confidence: 0.7 }
      },
      {
        patterns: ['change background', 'different sound', 'new background'],
        command: { type: 'background', action: 'change', confidence: 0.6 }
      },

      // Muscle awareness commands
      {
        patterns: ['muscles', 'which muscles', 'focus muscles'],
        command: { type: 'guidance', action: 'muscle_focus', confidence: 0.7 }
      }
    ];

    // Find matching patterns
    for (const pattern of commandPatterns) {
      for (const phrase of pattern.patterns) {
        if (this.matchesPhrase(transcript, phrase)) {
          return {
            ...pattern.command,
            originalText: transcript,
            timestamp: Date.now()
          };
        }
      }
    }

    // Return null if no command pattern matches
    return null;
  }

  /**
   * Check if transcript matches a command phrase
   */
  matchesPhrase(transcript, phrase) {
    const transcriptWords = transcript.toLowerCase().split(/\s+/);
    const phraseWords = phrase.toLowerCase().split(/\s+/);
    
    // Exact phrase match
    if (transcript.includes(phrase)) {
      return true;
    }
    
    // Partial word matching (at least 70% of phrase words present)
    const matchCount = phraseWords.filter(word => 
      transcriptWords.some(tWord => tWord.includes(word) || word.includes(tWord))
    ).length;
    
    return matchCount >= Math.ceil(phraseWords.length * 0.7);
  }

  /**
   * Start listening for voice commands
   */
  startListening() {
    if (!this.recognition) {
      this.onStatus({ status: 'error', message: 'Speech recognition not available' });
      return;
    }
    
    this.shouldBeListening = true; // Mark that we want to be listening
    
    if (this.isListening) {
      this.onStatus({ status: 'listening', message: 'Already listening for commands' });
      return;
    }

    try {
      this.recognition.start();
    } catch (error) {
      console.warn('Failed to start voice recognition:', error.message);
      this.onStatus({ status: 'error', message: `Failed to start: ${error.message}` });
      
      // Retry after a delay if we should be listening
      if (this.shouldBeListening) {
        setTimeout(() => {
          if (this.shouldBeListening && !this.isListening) {
            this.startListening();
          }
        }, 2000);
      }
    }
  }

  /**
   * Stop listening for voice commands
   */
  stopListening() {
    this.shouldBeListening = false; // Mark that we no longer want to listen
    
    if (this.recognition && this.isListening) {
      this.recognition.stop();
    }
  }

  /**
   * Get current listening status
   */
  getStatus() {
    return {
      isListening: this.isListening,
      isSupported: !!this.recognition
    };
  }
}
