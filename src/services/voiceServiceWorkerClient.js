/**
 * Voice Service Worker Client
 * Manages communication with the voice command service worker
 */

export class VoiceServiceWorkerClient {
  constructor(onCommand) {
    this.onCommand = onCommand || (() => {});
    this.serviceWorker = null;
    this.isRegistered = false;
    this.heartbeatInterval = null;
    this.init();
  }

  async init() {
    if (!('serviceWorker' in navigator)) {
      console.warn('Service workers not supported');
      return false;
    }

    try {
      // Register the service worker
      const registration = await navigator.serviceWorker.register('/voice-service-worker.js', {
        scope: '/'
      });

      console.log('Voice service worker registered:', registration);

      // Wait for the service worker to be ready
      const sw = await navigator.serviceWorker.ready;
      this.serviceWorker = sw.active;

      // Listen for messages from service worker
      navigator.serviceWorker.addEventListener('message', this.handleServiceWorkerMessage.bind(this));

      // Register this client with the service worker
      this.registerClient();

      // Start heartbeat to keep connection alive
      this.startHeartbeat();

      this.isRegistered = true;
      return true;
    } catch (error) {
      console.error('Failed to register voice service worker:', error);
      return false;
    }
  }

  registerClient() {
    if (this.serviceWorker) {
      this.serviceWorker.postMessage({ 
        type: 'REGISTER_CLIENT' 
      });
    }
  }

  unregisterClient() {
    if (this.serviceWorker) {
      this.serviceWorker.postMessage({ 
        type: 'UNREGISTER_CLIENT' 
      });
    }
    this.stopHeartbeat();
    this.isRegistered = false;
  }

  handleServiceWorkerMessage(event) {
    const { type, command, timestamp } = event.data;

    switch (type) {
      case 'VOICE_COMMAND':
        console.log('Received voice command from service worker:', command);
        this.onCommand(command);
        
        // Acknowledge the command was processed
        this.serviceWorker.postMessage({
          type: 'VOICE_COMMAND_PROCESSED',
          data: { command, timestamp, processed: Date.now() }
        });
        break;

      case 'SW_HEARTBEAT':
        // Service worker is alive, respond
        this.serviceWorker.postMessage({ type: 'HEARTBEAT_ACK' });
        break;

      case 'HEARTBEAT_ACK':
        // Service worker acknowledged our heartbeat
        console.log('Service worker heartbeat acknowledged');
        break;
    }
  }

  startHeartbeat() {
    this.heartbeatInterval = setInterval(() => {
      if (this.serviceWorker) {
        this.serviceWorker.postMessage({ type: 'KEEP_ALIVE' });
      }
    }, 25000); // Every 25 seconds
  }

  stopHeartbeat() {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
  }

  // Simulate sending a voice command (for testing)
  simulateVoiceCommand(command) {
    if (this.serviceWorker) {
      this.serviceWorker.postMessage({
        type: 'VOICE_COMMAND',
        command: command,
        timestamp: Date.now()
      });
    }
  }

  destroy() {
    this.unregisterClient();
    this.stopHeartbeat();
  }
}

// Create a singleton instance
export const voiceServiceWorkerClient = new VoiceServiceWorkerClient();
