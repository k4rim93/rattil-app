// Microphone capture that keeps running while the page is busy drawing.
// AudioWorklet resamples to 16 kHz with continuous phase and posts 50 ms chunks.
// Falls back to ScriptProcessor where AudioWorklet is missing or fails.
const WORKLET = `
class Capture extends AudioWorkletProcessor {
  constructor() { super(); this.pos = 0; this.last = 0; this.out = new Float32Array(800); this.n = 0; this.sum = 0; this.cnt = 0; this.ratio = sampleRate / 16000; }
  process(inputs) {
    const input = inputs[0] && inputs[0][0];
    if (!input) return true;
    for (let i = 0; i < input.length; i++) { this.sum += input[i] * input[i]; this.cnt++; }
    // pos counts input frames (fractional) relative to the start of this block, carried across blocks.
    while (this.pos < input.length) {
      const left = Math.floor(this.pos), frac = this.pos - left;
      const a = left < 0 ? this.last : input[left];
      const b = left + 1 < input.length ? input[left + 1] : input[input.length - 1];
      this.out[this.n++] = a * (1 - frac) + b * frac;
      this.pos += this.ratio;
      if (this.n === this.out.length) { const chunk = this.out; this.out = new Float32Array(800); this.n = 0; this.port.postMessage({ chunk, at: Date.now() }, [chunk.buffer]); }
    }
    this.pos -= input.length; this.last = input[input.length - 1];
    if (this.cnt >= 2400) { this.port.postMessage({ level: Math.sqrt(this.sum / this.cnt) }); this.sum = 0; this.cnt = 0; }
    return true;
  }
}
registerProcessor('rattil-capture', Capture);
`;

export async function startCapture(context, source, onChunk, onLevel) {
  if (context.audioWorklet && typeof AudioWorkletNode !== 'undefined') {
    try {
      const url = URL.createObjectURL(new Blob([WORKLET], { type: 'text/javascript' }));
      try { await context.audioWorklet.addModule(url); } finally { URL.revokeObjectURL(url); }
      const node = new AudioWorkletNode(context, 'rattil-capture', { numberOfInputs: 1, numberOfOutputs: 1, channelCount: 1 });
      const mute = context.createGain(); mute.gain.value = 0;
      node.port.onmessage = event => { const m = event.data; if (m.chunk) onChunk(m.chunk, m.at); else if (m.level != null) onLevel?.(m.level); };
      source.connect(node); node.connect(mute); mute.connect(context.destination);
      return { kind: 'worklet', stop() { node.port.onmessage = null; try { source.disconnect(node); } catch {} try { node.disconnect(); mute.disconnect(); } catch {} } };
    } catch (error) { console.warn('AudioWorklet unavailable, using fallback', error); }
  }
  const processor = context.createScriptProcessor(2048, 1, 1);
  let carry = new Float32Array(0), phase = 0, last = 0; const ratio = context.sampleRate / 16000;
  processor.onaudioprocess = event => {
    const input = event.inputBuffer.getChannelData(0), out = [];
    let sum = 0; for (let i = 0; i < input.length; i++) sum += input[i] * input[i];
    onLevel?.(Math.sqrt(sum / input.length));
    while (phase < input.length) {
      const left = Math.floor(phase), frac = phase - left;
      const a = left < 0 ? last : input[left], b = left + 1 < input.length ? input[left + 1] : input[input.length - 1];
      out.push(a * (1 - frac) + b * frac); phase += ratio;
    }
    phase -= input.length; last = input[input.length - 1];
    const merged = new Float32Array(carry.length + out.length); merged.set(carry); merged.set(out, carry.length);
    let offset = 0;
    while (merged.length - offset >= 800) { onChunk(merged.slice(offset, offset + 800), Date.now()); offset += 800; }
    carry = merged.slice(offset);
  };
  source.connect(processor); processor.connect(context.destination);
  return { kind: 'script-processor', stop() { processor.onaudioprocess = null; try { source.disconnect(processor); } catch {} try { processor.disconnect(); } catch {} } };
}
