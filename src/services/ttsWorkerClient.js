// Simple wrapper around the TTS web worker
export function createTTSClient(onMessage){
  const worker = new Worker(new URL('../../worker.js', import.meta.url), { type: 'module' });
  worker.addEventListener('message', onMessage);
  return worker;
}

export function speakWith(worker, text){
  if(!worker) return;
  worker.postMessage({ text });
}
