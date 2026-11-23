// Small synthesized sound effects (Web Audio, no audio files) plus vibration where supported.
// Every sound is triggered by a tap or key press, so browsers allow the audio context to start.

export type Sound = 'select' | 'error' | 'guess' | 'hint' | 'fact' | 'hot' | 'win' | 'lose';

let ctx: AudioContext | null = null;
let muted = false;

export const setMuted = (m: boolean) => { muted = m; };
export const isMuted = () => muted;

function audio(): AudioContext | null {
  if (!ctx) {
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
  }
  if (ctx.state === 'suspended') void ctx.resume();
  return ctx;
}

/** One soft note: frequency (Hz), start offset and length (s), waveform, peak volume. */
function note(a: AudioContext, freq: number, at: number, len: number, type: OscillatorType = 'sine', vol = 0.18) {
  const t = a.currentTime + at;
  const osc = a.createOscillator();
  const gain = a.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t);
  gain.gain.setValueAtTime(0.0001, t);
  gain.gain.exponentialRampToValueAtTime(vol, t + 0.012);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + len);
  osc.connect(gain).connect(a.destination);
  osc.start(t);
  osc.stop(t + len + 0.02);
}

const VIBRATE: Partial<Record<Sound, number | number[]>> = { error: 40, hot: [30, 60, 30], win: [40, 50, 40, 50, 120], lose: 120 };

export function play(s: Sound) {
  if (muted) return;
  const buzz = VIBRATE[s];
  if (buzz) try { navigator.vibrate?.(buzz); } catch { /* not allowed yet */ }
  const a = audio();
  if (!a) return;
  switch (s) {
    case 'select': note(a, 660, 0, 0.07, 'triangle', 0.08); break;
    case 'error': note(a, 160, 0, 0.16, 'square', 0.05); break;
    case 'guess': note(a, 520, 0, 0.09, 'triangle', 0.12); note(a, 390, 0.08, 0.12, 'triangle', 0.1); break;
    case 'hint': note(a, 660, 0, 0.12); note(a, 880, 0.1, 0.2); break;
    case 'fact': [988, 1319, 1568].forEach((f, i) => note(a, f, i * 0.07, 0.18, 'sine', 0.1)); break;
    case 'hot': [440, 554, 659, 880].forEach((f, i) => note(a, f, i * 0.06, 0.12, 'triangle', 0.12)); break;
    case 'win': [523, 659, 784, 1047, 1319].forEach((f, i) => note(a, f, i * 0.09, i === 4 ? 0.6 : 0.16, 'triangle', 0.16)); break;
    case 'lose': [392, 330, 262].forEach((f, i) => note(a, f, i * 0.16, 0.3, 'sine', 0.12)); break;
  }
}
