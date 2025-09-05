import { useCallback, useEffect, useRef, useState } from "react";
import { speakWith, createTTSClient } from "../services/ttsWorkerClient";
import { breathSoundGenerator } from "../services/breathSounds";
import { ambienceGenerator } from "../services/ambienceGenerator";

export const FlowState = { IDLE: "IDLE", WAITING_FOR_READY: "WAITING_FOR_READY", RUNNING: "RUNNING", PAUSED: "PAUSED", COMPLETE: "COMPLETE" };

// timing constants
const BREATH_IN_MS = 1500;
const BREATH_HOLD_MS = 300;
const BREATH_OUT_MS = 1500;
const BREATH_FALLBACK_START_MS = 1200;

export function useYogaFlow() {
  const [flowState, setFlowState] = useState(FlowState.IDLE);
  const [status, setStatus] = useState("Loading TTS…");
  const [device, setDevice] = useState("");
  const [ready, setReady] = useState(false);
  const [flow, setFlow] = useState([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [remainingBreaths, setRemainingBreaths] = useState(0);
  const [currentText, setCurrentText] = useState("Welcome to your session");
  const [poseDifficulty, setPoseDifficulty] = useState(0);
  const [describeMode, setDescribeMode] = useState(false);
  const [waitingForTTS, setWaitingForTTS] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);

  const workerRef = useRef(null);
  const audioRef = useRef(null);
  const awaitingPoseAudioRef = useRef(false);
  const lastPoseRef = useRef(null);
  const pausedRef = useRef(false);
  const breathTimeoutRef = useRef(null);
  const flowRef = useRef([]);
  const currentIndexRef = useRef(0);
  const microphoneActiveRef = useRef(false);

  const clearBreathTimer = () => {
    if (breathTimeoutRef.current) {
      clearTimeout(breathTimeoutRef.current);
      breathTimeoutRef.current = null;
    }
  };

  // keep refs in sync with state
  useEffect(() => { flowRef.current = flow; }, [flow]);
  useEffect(() => { currentIndexRef.current = currentIndex; }, [currentIndex]);

  // init worker and audio systems
  useEffect(() => {
    const init = async () => {
      setStatus("Initializing audio...");
      
      // Initialize breath sound generator (same as test component)
      const breathInitialized = await breathSoundGenerator.init();
      if (!breathInitialized) {
        setStatus("Failed to initialize audio");
        return;
      }
      
      // Make breathSoundGenerator globally accessible for voice component checks
      window.breathSoundGenerator = breathSoundGenerator;
      
      setStatus("Loading TTS...");
      
      // Create audio element for TTS playback
      audioRef.current = new Audio();
      
      workerRef.current = createTTSClient((e) => {
        const { status: st, device: dev, audio, error } = e.data || {};
        if (st === "device") setDevice(dev);
        else if (st === "ready") {
          setStatus("Ready");
          setReady(true);
          setDevice(dev);
          // Initialize audio generators
          ambienceGenerator.init();
        } else if (st === "complete") {
          setIsSpeaking(false);
          setStatus("Audio received");
          if (audio && audioRef.current) {
            console.log('Playing TTS audio:', audio);
            audioRef.current.src = audio;
            audioRef.current.play()
              .then(() => {
                console.log('TTS audio playing successfully');
                setStatus("Playing");
              })
              .catch(e => {
                console.warn('TTS audio play failed:', e);
                setStatus("Play failed: " + e.message);
              });
            audioRef.current.onended = () => {
              console.log('TTS audio ended');
              setIsSpeaking(false);
              setStatus("Ready");
            };
          } else {
            console.warn('TTS audio blob or audioRef missing:', { hasAudio: !!audio, hasAudioRef: !!audioRef.current });
          }
          if (awaitingPoseAudioRef.current) {
            awaitingPoseAudioRef.current = false;
            setWaitingForTTS(false);
            beginBreathsForCurrentPose();
          }
        } else if (st === "error") {
          setStatus("Error: " + error);
          setIsSpeaking(false);
          awaitingPoseAudioRef.current = false;
          setWaitingForTTS(false);
        }
      });
    };
    
    init();
    
    return () => {
      clearBreathTimer();
      breathSoundGenerator.stopBreathingCycle();
      ambienceGenerator.stopAmbience();
      workerRef.current?.terminate();
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current = null;
      }
    };
  }, []);

  const speak = useCallback(
    (text) => {
      if (!ready || !workerRef.current) {
        console.warn('TTS not ready:', { ready, hasWorker: !!workerRef.current });
        return;
      }
      setStatus("Generating…");
      setIsSpeaking(true);
      speakWith(workerRef.current, text);
    },
    [ready]
  );

  const beep = useCallback((freq = 110, duration = 120, type = "sine") => {
    // Use breathSoundGenerator for beeps (same as test component)
    playBeep(freq, duration);
  }, []);

  const announcePose = useCallback(
    (index) => {
      const pose = flowRef.current[index];
      if (!pose) return;
      lastPoseRef.current = pose;
      const base = pose.name;
      const variant = poseDifficulty === 0 ? "" : poseDifficulty > 0 ? " (harder variation)" : " (easier variation)";
      const description = describeMode ? pose.description || "" : "";
      const line = [base + variant, description].filter(Boolean).join(". ");
      awaitingPoseAudioRef.current = true;
      setWaitingForTTS(true);
      setCurrentText(line);
      speak(line);
      const fallbackDelay = Math.max(1500, BREATH_FALLBACK_START_MS);
      setTimeout(() => {
        if (awaitingPoseAudioRef.current) {
          awaitingPoseAudioRef.current = false;
          setWaitingForTTS(false);
          beginBreathsForCurrentPose();
        }
      }, fallbackDelay);
    },
    [poseDifficulty, describeMode, speak]
  );

  const advancePoseRef = useRef(null);

  // Simple beep function for testing (same as test component)
  const playBeep = (frequency = 110, duration = 120) => {
    if (!breathSoundGenerator.audioContext) return;
    
    try {
      const ctx = breathSoundGenerator.audioContext;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      
      osc.type = 'sine';
      osc.frequency.value = frequency;
      
      gain.gain.setValueAtTime(0.001, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.3, ctx.currentTime + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + duration / 1000);
      
      osc.connect(gain).connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + duration / 1000);
    } catch (e) {
      console.warn('Beep failed', e);
    }
  };

  const runNextBreathCycle = useCallback(
    (breathsLeft) => {
      if (pausedRef.current) return;
      if (breathsLeft <= 0) {
        advancePoseRef.current?.();
        return;
      }
      setRemainingBreaths(breathsLeft);
      
      // Use the exact same timing as test component
      const totalCycleTime = breathSoundGenerator.settings.inhaleTime + 
                            breathSoundGenerator.settings.holdTime + 
                            breathSoundGenerator.settings.exhaleTime + 
                            breathSoundGenerator.settings.holdTime;
      breathTimeoutRef.current = setTimeout(() => runNextBreathCycle(breathsLeft - 1), totalCycleTime);
    },
    []
  );

  const beginBreathsForCurrentPose = useCallback(() => {
    clearBreathTimer();
    const pose = lastPoseRef.current || flowRef.current[currentIndexRef.current];
    if (!pose) return;
    const breaths = typeof pose.breaths === "number" && pose.breaths > 0 ? pose.breaths : 1;
    setRemainingBreaths(breaths);
    
    // Use exact same breath cycle pattern as test component
    if (!breathSoundGenerator.isPlaying) {
      breathSoundGenerator.isPlaying = true;
      breathSoundGenerator.currentSources = [];
      
      const breathCycle = () => {
        if (!breathSoundGenerator.isPlaying) return;

        // Play beep like in test component
        playBeep(110, 120);

        // 1. Inhale phase (includes hold time in the sound envelope)
        const inhaleSource = breathSoundGenerator.createBreathSound(
          null,
          breathSoundGenerator.settings.inhaleTime / 1000, 
          'inhale'
        );

        // 2. Exhale phase starts after inhale+hold time
        const inhaleAndHoldTime = breathSoundGenerator.settings.inhaleTime + breathSoundGenerator.settings.holdTime;
        setTimeout(() => {
          if (breathSoundGenerator.isPlaying) {
            const exhaleSource = breathSoundGenerator.createBreathSound(
              null,
              breathSoundGenerator.settings.exhaleTime / 1000, 
              'exhale'
            );
          }
        }, inhaleAndHoldTime);

        // Schedule next complete breath cycle
        const totalCycleTime = breathSoundGenerator.settings.inhaleTime + 
                              breathSoundGenerator.settings.holdTime + 
                              breathSoundGenerator.settings.exhaleTime + 
                              breathSoundGenerator.settings.holdTime;
        breathSoundGenerator.breathLoop = setTimeout(() => {
          breathCycle();
        }, totalCycleTime);
      };

      console.log('Starting yoga breath cycle with test component pattern');
      breathCycle();
    }
    
    // Start the countdown
    runNextBreathCycle(breaths);
  }, [runNextBreathCycle]);

  const advancePose = useCallback(() => {
    clearBreathTimer();
    setRemainingBreaths(0);
    const next = currentIndexRef.current + 1;
    if (next >= flowRef.current.length) {
      setFlowState(FlowState.COMPLETE);
      setStatus("Flow complete");
      return;
    }
    currentIndexRef.current = next;
    setCurrentIndex(next);
    requestAnimationFrame(() => announcePose(next));
  }, [announcePose]);

  // Keep advancePose ref in sync
  useEffect(() => { advancePoseRef.current = advancePose; }, [advancePose]);

  // commands
  const commands = {
    skip: () => {
      if (flowState !== FlowState.RUNNING) return;
      advancePose();
    },
    pause: () => {
      if (flowState === FlowState.RUNNING) {
        pausedRef.current = true;
        setFlowState(FlowState.PAUSED);
        clearBreathTimer();
        breathSoundGenerator.stopBreathingCycle();
        setStatus("Paused");
      }
    },
    continue: () => {
      if (flowState === FlowState.PAUSED) {
        pausedRef.current = false;
        setFlowState(FlowState.RUNNING);
        beginBreathsForCurrentPose();
        setStatus("Resumed");
      }
    },
    resume: () => {
      if (flowState === FlowState.PAUSED) {
        pausedRef.current = false;
        setFlowState(FlowState.RUNNING);
        beginBreathsForCurrentPose();
        setStatus("Resumed");
      }
    },
    ready: () => {
      if (flowState === FlowState.WAITING_FOR_READY) {
        setFlowState(FlowState.RUNNING);
        setStatus("Starting your practice...");
        speak("Perfect! Let's begin.");
        // Small delay then announce first pose
        setTimeout(() => {
          announcePose(0);
        }, 10000);
      }
    },
    stop: () => {
      setFlowState(FlowState.IDLE);
      setCurrentIndex(0);
      setRemainingBreaths(0);
      clearBreathTimer();
      breathSoundGenerator.stopBreathingCycle();
      ambienceGenerator.stopAmbience();
      pausedRef.current = false;
      speak("Practice complete. Thank you for your session.");
    },
    easier: () => {
      setPoseDifficulty(-1);
      speak("Adjusting: use supportive props to ease the pose.");
    },
    harder: () => {
      setPoseDifficulty(1);
      speak("Adjusting: deepen the pose maintaining alignment.");
    },
    neutral: () => {
      setPoseDifficulty(0);
      speak("Returning to base variation.");
    },
    describe: () => {
      setDescribeMode(true);
      speak("Descriptions enabled.");
    },
    nameOnly: () => {
      setDescribeMode(false);
      speak("Name only mode.");
    },
    toggleDescribe: () => {
      const newMode = !describeMode;
      setDescribeMode(newMode);
      speak(newMode ? "Descriptions enabled." : "Name only mode.");
    },
  };

  const startFlow = (selectedFlow) => {
    // Convert the flow data to the format expected by the app
    const flowPoses = selectedFlow.poses.map((pose, index) => ({
      id: `${selectedFlow.id}_${index}`,
      name: pose.name,
      breaths: pose.breaths,
      description: pose.instruction
    }));
    
    flowRef.current = flowPoses;
    currentIndexRef.current = 0;
    setFlow(flowPoses);
    setCurrentIndex(0);
    setFlowState(FlowState.WAITING_FOR_READY);
    pausedRef.current = false;
    
    // Start background sounds but no breath sounds yet
    ambienceGenerator.startAmbience('nature');
    
    // Welcome message and wait for ready
    speak(`Welcome to ${selectedFlow.display_name}. Say "ready" when you're prepared to begin your practice.`);
    setStatus("Waiting for you to say 'ready'...");
  };

  const startDemoFlow = () => {
    const demoFlow = [
      { id: "pose1", name: "Seated Centering", breaths: 2, description: "Sit tall, relax shoulders, gentle core engagement" },
      { id: "pose2", name: "Mountain Pose", breaths: 3, description: "Stand tall, weight balanced, lift through crown" },
      { id: "pose3", name: "Forward Fold", breaths: 3, description: "Hinge at hips, relax neck, slight knee softness" },
      { id: "pose4", name: "Half Lift", breaths: 2, description: "Lengthen spine, shoulder blades back" },
    ];
    flowRef.current = demoFlow; // Set ref immediately
    currentIndexRef.current = 0; // Reset index ref
    setFlow(demoFlow);
    setCurrentIndex(0);
    setFlowState(FlowState.RUNNING);
    pausedRef.current = false;
    announcePose(0);
  };

  return {
    // state
    flowState,
    status,
    device,
    ready,
    flow,
    currentIndex,
    remainingBreaths,
    currentText,
    poseDifficulty,
    describeMode,
    waitingForTTS,
    isSpeaking,
    // actions
    speak,
    startFlow,
    startDemoFlow,
    commands,
    setCurrentText,
  };
}
