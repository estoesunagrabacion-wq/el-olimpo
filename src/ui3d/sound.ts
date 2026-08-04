/**
 * Efectos de sonido sintetizados con WebAudio: sin archivos externos, así el
 * juego sigue siendo un único HTML autocontenido. Tono general: maderas y
 * campanas suaves, acorde al carácter místico del original.
 */

let ctx: AudioContext | null = null;
let muted = false;

try {
  muted = localStorage.getItem('el-olimpo-mute') === '1';
} catch {
  /* sin almacenamiento */
}

function ac(): AudioContext | null {
  if (typeof AudioContext === 'undefined') return null;
  if (!ctx) ctx = new AudioContext();
  if (ctx.state === 'suspended') void ctx.resume();
  return ctx;
}

export function isMuted(): boolean {
  return muted;
}

export function setMuted(m: boolean): void {
  muted = m;
  try {
    localStorage.setItem('el-olimpo-mute', m ? '1' : '0');
  } catch {
    /* sin almacenamiento */
  }
}

/** Tono simple con envolvente exponencial. */
function tone(
  freq: number,
  dur: number,
  gain: number,
  type: OscillatorType = 'sine',
  delay = 0,
  glideTo?: number,
): void {
  const a = ac();
  if (!a || muted) return;
  const t0 = a.currentTime + delay;
  const osc = a.createOscillator();
  const g = a.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  if (glideTo) osc.frequency.exponentialRampToValueAtTime(glideTo, t0 + dur);
  g.gain.setValueAtTime(gain, t0);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(g).connect(a.destination);
  osc.start(t0);
  osc.stop(t0 + dur + 0.05);
}

/** Golpe seco de madera (ficha que se apoya). */
function knock(delay = 0, pitch = 1): void {
  const a = ac();
  if (!a || muted) return;
  const t0 = a.currentTime + delay;
  const len = 0.09;
  const buf = a.createBuffer(1, a.sampleRate * len, a.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / d.length, 3);
  const src = a.createBufferSource();
  src.buffer = buf;
  const filter = a.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.value = 900 * pitch;
  const g = a.createGain();
  g.gain.setValueAtTime(0.5, t0);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + len);
  src.connect(filter).connect(g).connect(a.destination);
  src.start(t0);
  tone(170 * pitch, 0.1, 0.18, 'triangle', delay);
}

export const sfx = {
  select(): void {
    tone(880, 0.06, 0.06, 'triangle');
  },
  move(): void {
    knock(0, 1);
  },
  capture(): void {
    knock(0, 0.8);
    tone(320, 0.3, 0.12, 'sawtooth', 0.06, 110);
  },
  canje(): void {
    tone(110, 0.8, 0.16, 'sawtooth', 0, 220);
    tone(220, 0.9, 0.1, 'sine', 0.15, 440);
    knock(0.85, 0.7);
  },
  win(): void {
    [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => tone(f, 0.5, 0.12, 'triangle', i * 0.14));
  },
  draw(): void {
    tone(392, 0.4, 0.1, 'triangle');
    tone(392, 0.5, 0.08, 'triangle', 0.25);
  },
};
