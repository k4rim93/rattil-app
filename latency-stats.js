// Measures this device's own speed during a session. Nothing leaves the device.
const pct = (values, p) => { if (!values.length) return 0; const s = [...values].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };
export function createLatencyStats() {
  const s = { startedAt: 0, firstChunkAt: 0, firstWordAt: 0, firstLockAt: 0, audioMs: 0, feedMs: 0, lags: [], draws: [], paintDelays: [], mode: '' };
  return {
    start(mode) { Object.assign(s, { startedAt: performance.now(), firstChunkAt: 0, firstWordAt: 0, firstLockAt: 0, audioMs: 0, feedMs: 0, lags: [], draws: [], paintDelays: [], mode }); },
    chunk() { if (!s.firstChunkAt) s.firstChunkAt = performance.now(); },
    worker({ ms, samples, lagMs }) { s.feedMs += ms; s.audioMs += samples / 16; s.lags.push(lagMs); },
    word() { if (!s.firstWordAt) s.firstWordAt = performance.now(); },
    lock() { if (!s.firstLockAt) s.firstLockAt = performance.now(); },
    draw(ms) { s.draws.push(ms); },
    paint(ms) { s.paintDelays.push(ms); },
    summary() {
      if (!s.startedAt || !s.audioMs) return null;
      const sec = value => value ? Math.round((value - (s.firstChunkAt || s.startedAt)) / 100) / 10 : null;
      return {
        at: Date.now(), mode: s.mode, audioSeconds: Math.round(s.audioMs / 100) / 10,
        engineSpeed: Math.round(s.audioMs / Math.max(1, s.feedMs) * 10) / 10,
        lagMedianMs: Math.round(pct(s.lags, .5)), lagP95Ms: Math.round(pct(s.lags, .95)), lagMaxMs: Math.round(Math.max(0, ...s.lags)),
        drawMedianMs: Math.round(pct(s.draws, .5) * 10) / 10, drawMaxMs: Math.round(Math.max(0, ...s.draws) * 10) / 10,
        paintMedianMs: Math.round(pct(s.paintDelays, .5)), paintP95Ms: Math.round(pct(s.paintDelays, .95)),
        firstWordSec: sec(s.firstWordAt), firstLockSec: sec(s.firstLockAt),
      };
    },
  };
}
