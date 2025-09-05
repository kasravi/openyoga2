import { detectWebGPU } from "./utils.js";

// Polyfill ReadableStream async iterator (some browsers/build setups may lack it inside workers)
if (typeof ReadableStream !== "undefined" && ReadableStream.prototype && !ReadableStream.prototype[Symbol.asyncIterator]) {
  // eslint-disable-next-line no-extend-native
  ReadableStream.prototype[Symbol.asyncIterator] = async function* () {
    const reader = this.getReader();
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) return;
        yield value;
      }
    } finally {
      reader.releaseLock();
    }
  };
}

// Wrapped fetch to ensure a body with async iterator (fallback to full buffering)
async function robustFetch(input, init) {
  const res = await fetch(input, init);
  const body = res.body;
  if (body && typeof body[Symbol.asyncIterator] === "function") {
    return res; // streaming OK
  }
  // Fallback: buffer entirely so downstream code can still iterate chunks (it will see one chunk)
  const buf = await res.arrayBuffer();
  return new Response(buf, { status: res.status, statusText: res.statusText, headers: res.headers });
}

// Allow forcing device via query param (for debugging): ?device=wasm
let forcedDevice;
try {
  const url = new URL(self.location.href);
  forcedDevice = url.searchParams.get("device");
} catch {}

// Device detection (optionally overridden)
let device = forcedDevice || ((await detectWebGPU()) ? "webgpu" : "wasm");
if (!["webgpu", "wasm"].includes(device)) device = "wasm";
self.postMessage({ status: "device", device });

// Helpful debug logging toggle
const DEBUG = true;
const log = (...a) => DEBUG && console.log("[worker]", ...a);

// Dynamically import kokoro-js AFTER polyfills
let tts;
const { KokoroTTS } = await import("kokoro-js");

// Model ID & options
const model_id = "onnx-community/Kokoro-82M-v1.0-ONNX";

log("Loading model", model_id, "device=", device);

try {
  tts = await KokoroTTS.from_pretrained(model_id, {
    dtype: device === "wasm" ? "q8" : "fp32",
    device,
    fetch: robustFetch,
  });
  self.postMessage({ status: "ready", voices: tts.voices, device });
  log("Model ready, voices:", tts.voices);
} catch (e) {
  log("Model load failed", e);
  self.postMessage({ status: "error", error: e?.message || String(e), stack: e?.stack });
  // Fallback: try forcing wasm once if webgpu failed
  if (device === "webgpu") {
    try {
      device = "wasm";
      self.postMessage({ status: "device", device });
      log("Retrying load with wasm fallback");
      tts = await KokoroTTS.from_pretrained(model_id, { dtype: "q8", device, fetch: robustFetch });
      self.postMessage({ status: "ready", voices: tts.voices, device });
    } catch (e2) {
      log("Fallback load failed", e2);
      throw e2;
    }
  } else {
    throw e;
  }
}

self.addEventListener("message", async (e) => {
  const { text } = e.data || {};
  if (!tts) {
    self.postMessage({ status: "error", error: "TTS not initialized" });
    return;
  }

  const VOICE_ID = "af_nicole";
  const SPEED = 0.9; // Requested playback speed (model prosody speed if supported)

  try {
    log("Generating audio", { voice: VOICE_ID, speed: SPEED, length: text?.length });
    const audio = await tts.generate(text, { voice: VOICE_ID, speed: SPEED });
    if (!audio || typeof audio.toBlob !== "function") throw new Error("Unexpected audio object");
    const blob = audio.toBlob();
    const url = URL.createObjectURL(blob);
    self.postMessage({ status: "complete", audio: url, text, voice: VOICE_ID, speed: SPEED });
  } catch (err) {
    log("Generation error", err);
    self.postMessage({ status: "error", error: err?.message || String(err), stack: err?.stack });
  }
});