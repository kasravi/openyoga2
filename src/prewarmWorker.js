import { KokoroTTS } from 'kokoro-js';

let tts = null;
let configKey = '';

function keyFor(config) {
  return [config.modelId, config.device, config.dtype].join('|');
}

async function ensureTTS(config) {
  const key = keyFor(config);
  if (tts && configKey === key) {
    return tts;
  }

  tts = await KokoroTTS.from_pretrained(config.modelId, {
    device: config.device,
    dtype: config.dtype,
  });
  configKey = key;
  return tts;
}

self.onmessage = async (event) => {
  const data = event.data || {};
  if (data.type !== 'generate' || !data.id || !data.text || !data.config) {
    return;
  }

  try {
    const engine = await ensureTTS(data.config);
    const generated = await engine.generate(data.text, {
      voice: data.config.voice,
      speed: Number(data.config.speed),
    });
    const blob = generated.toBlob();
    const arrayBuffer = await blob.arrayBuffer();
    self.postMessage({ id: data.id, ok: true, arrayBuffer }, [arrayBuffer]);
  } catch (error) {
    self.postMessage({
      id: data.id,
      ok: false,
      error: error instanceof Error ? error.message : 'worker_generate_failed',
    });
  }
};
