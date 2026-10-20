import { onsets } from './analysis';

// Finding the attacks in a whole song takes about a second, so it runs off the main thread.
self.onmessage = ({ data }: MessageEvent<{ x: Float32Array; rate: number }>) => {
  const found = onsets([data.x], data.rate);
  self.postMessage(found, { transfer: [found.flux.buffer, found.strength.buffer] });
};
