// Tiny WebAudio sound-effects engine (synthesized, no asset files needed).
let ctx = null;
let muted = localStorage.getItem('cayacards.muted') === '1';
let master = null;

function ensure() {
  if (ctx) return;
  try {
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    master = ctx.createGain();
    master.gain.value = muted ? 0 : 0.5;
    master.connect(ctx.destination);
  } catch { ctx = null; }
}

// browsers require a user gesture before audio can start
['pointerdown', 'keydown', 'touchstart'].forEach((ev) =>
  window.addEventListener(ev, () => { ensure(); if (ctx && ctx.state === 'suspended') ctx.resume(); }, { once: false }));

function tone(freq, t0, dur, { type = 'sine', gain = 0.25, slideTo = null } = {}) {
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t0);
  if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t0 + dur);
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(gain, t0 + 0.012);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  o.connect(g); g.connect(master);
  o.start(t0); o.stop(t0 + dur + 0.02);
}

function noise(t0, dur, gain = 0.2) {
  const n = Math.floor(ctx.sampleRate * dur);
  const buf = ctx.createBuffer(1, n, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
  const src = ctx.createBufferSource(); src.buffer = buf;
  const g = ctx.createGain(); g.gain.value = gain;
  const f = ctx.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = 1200;
  src.connect(f); f.connect(g); g.connect(master);
  src.start(t0);
}

// ---- victory anthem: "TOXIC VICTORY" (original synthesized loop) -----------
// note name -> frequency (equal temperament, A4 = 440), octaves 1..6
const NF = (() => {
  const names = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  const map = {};
  for (let oct = 1; oct <= 6; oct++) {
    for (let i = 0; i < 12; i++) {
      const midi = (oct + 1) * 12 + i;
      map[names[i] + oct] = 440 * Math.pow(2, (midi - 69) / 12);
    }
  }
  return map;
})();

let anthem = null; // { out } while playing

function aTone(dest, freq, t0, dur, { type = 'sine', gain = 0.25, slideTo = null, attack = 0.006 } = {}) {
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t0);
  if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t0 + dur);
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(gain, t0 + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  o.connect(g); g.connect(dest);
  o.start(t0); o.stop(t0 + dur + 0.03);
}
function aKick(dest, t0, gain = 0.85) {
  const o = ctx.createOscillator(); const g = ctx.createGain();
  o.type = 'sine'; o.frequency.setValueAtTime(155, t0); o.frequency.exponentialRampToValueAtTime(45, t0 + 0.13);
  g.gain.setValueAtTime(gain, t0); g.gain.exponentialRampToValueAtTime(0.001, t0 + 0.17);
  o.connect(g); g.connect(dest); o.start(t0); o.stop(t0 + 0.2);
}
function aSnare(dest, t0, gain = 0.3) {
  const n = Math.floor(ctx.sampleRate * 0.13); const buf = ctx.createBuffer(1, n, ctx.sampleRate);
  const d = buf.getChannelData(0); for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
  const src = ctx.createBufferSource(); src.buffer = buf;
  const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 1900;
  const g = ctx.createGain(); g.gain.value = gain;
  src.connect(f); f.connect(g); g.connect(dest); src.start(t0);
}
function aHat(dest, t0, gain = 0.12) {
  const n = Math.floor(ctx.sampleRate * 0.03); const buf = ctx.createBuffer(1, n, ctx.sampleRate);
  const d = buf.getChannelData(0); for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
  const src = ctx.createBufferSource(); src.buffer = buf;
  const f = ctx.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = 8000;
  const g = ctx.createGain(); g.gain.value = gain;
  src.connect(f); f.connect(g); g.connect(dest); src.start(t0);
}

export const sfx = {
  play(name) {
    if (!ctx || muted) return;
    const t = ctx.currentTime;
    switch (name) {
      case 'play':   tone(330, t, 0.12, { type: 'triangle', gain: 0.22, slideTo: 520 }); noise(t, 0.06, 0.12); break;
      case 'whoosh': noise(t, 0.16, 0.10); tone(760, t, 0.14, { type: 'sine', gain: 0.05, slideTo: 200 }); break;
      case 'land':   tone(190, t, 0.08, { type: 'sine', gain: 0.16, slideTo: 110 }); noise(t, 0.03, 0.07); break;
      case 'draw':   noise(t, 0.09, 0.18); tone(220, t, 0.08, { type: 'sine', gain: 0.12 }); break;
      case 'deal':   noise(t, 0.05, 0.1); break;
      case 'turn':   tone(660, t, 0.14, { type: 'sine', gain: 0.2 }); tone(880, t + 0.1, 0.16, { type: 'sine', gain: 0.18 }); break;
      case 'lastcard':    tone(523, t, 0.1, { type: 'square', gain: 0.18 }); tone(784, t + 0.09, 0.16, { type: 'square', gain: 0.18 }); break;
      case 'caught': tone(200, t, 0.3, { type: 'sawtooth', gain: 0.2, slideTo: 90 }); break;
      case 'penalty':tone(160, t, 0.25, { type: 'sawtooth', gain: 0.18, slideTo: 80 }); noise(t, 0.2, 0.12); break;
      case 'win':    [523, 659, 784, 1047].forEach((f, i) => tone(f, t + i * 0.12, 0.22, { type: 'triangle', gain: 0.22 })); break;
      case 'fanfare':[392, 523, 659, 784, 1047, 1319].forEach((f, i) => tone(f, t + i * 0.07, 0.5, { type: 'square', gain: 0.16 })); break;
      case 'click':  tone(440, t, 0.05, { type: 'sine', gain: 0.1 }); break;
      case 'tick':   tone(880, t, 0.04, { type: 'sine', gain: 0.12 }); break;
      default: break;
    }
  },

  // Start the looping victory anthem; auto-fills `durationMs`, mutable via mute.
  startAnthem(durationMs = 11000) {
    ensure();
    if (!ctx) return;
    this.stopAnthem();
    if (ctx.state === 'suspended') ctx.resume();
    const out = ctx.createGain();
    out.gain.value = 0.9;
    out.connect(master);
    anthem = { out };

    const STEP = 0.15;       // an eighth note (~200 BPM feel)
    const BAR = 8, LOOP = 32; // 4 bars per loop
    const startAt = ctx.currentTime + 0.06;
    const endAt = startAt + durationMs / 1000;
    // A natural-minor groove: Am - F - G - Em
    const barRoots = ['A', 'F', 'G', 'E'];
    const chords = { A: ['A', 'C', 'E'], F: ['F', 'A', 'C'], G: ['G', 'B', 'D'], E: ['E', 'G', 'B'] };
    // hooky, syncopated lead line (null = rest)
    const lead = [
      'A5', null, 'C6', null, 'B5', 'A5', 'E5', null,
      'A5', null, 'C6', 'B5', 'A5', null, 'E5', null,
      'F5', null, 'A5', 'G5', 'F5', 'E5', 'D5', null,
      'E5', 'D5', 'C5', 'D5', 'E5', null, 'A5', null,
    ];

    for (let t = startAt; t < endAt; t += LOOP * STEP) {
      for (let s = 0; s < LOOP; s++) {
        const tt = t + s * STEP;
        if (tt >= endAt) break;
        const root = barRoots[Math.floor(s / BAR)];
        // drums
        if (s % 2 === 0) aKick(out, tt, 0.8);
        if (s % BAR === 4) aSnare(out, tt, 0.3);
        aHat(out, tt + STEP * 0.5, 0.1);
        // driving bass (octave bounce)
        const bf = NF[root + '1'];
        aTone(out, s % 2 ? bf * 2 : bf, tt, STEP * 0.92, { type: 'sawtooth', gain: 0.22 });
        // chord stab on the downbeat of each bar
        if (s % BAR === 0) for (const n of chords[root]) aTone(out, NF[n + '4'], tt, STEP * 3.2, { type: 'sawtooth', gain: 0.06 });
        // lead (square + slightly detuned saw layer for an edgy bite)
        const ln = lead[s];
        if (ln && NF[ln]) {
          aTone(out, NF[ln], tt, STEP * 1.15, { type: 'square', gain: 0.16 });
          aTone(out, NF[ln] * 1.006, tt, STEP * 1.15, { type: 'sawtooth', gain: 0.07 });
        }
      }
    }
  },

  stopAnthem() {
    if (!anthem || !ctx) { anthem = null; return; }
    const node = anthem.out;
    anthem = null;
    try {
      const now = ctx.currentTime;
      node.gain.cancelScheduledValues(now);
      node.gain.setValueAtTime(node.gain.value, now);
      node.gain.linearRampToValueAtTime(0.0001, now + 0.25);
      setTimeout(() => { try { node.disconnect(); } catch {} }, 400);
    } catch { try { node.disconnect(); } catch {} }
  },

  toggleMute() {
    muted = !muted;
    localStorage.setItem('cayacards.muted', muted ? '1' : '0');
    if (master) master.gain.value = muted ? 0 : 0.5;
    return muted;
  },
  isMuted() { return muted; },
};
