// Procedural sound effects via the Web Audio API — no asset files, so the bundle
// stays tiny and nothing needs preloading. Each cue is a short synthesized blip.
//
// The AudioContext is created lazily on the first play, so we never fight the
// browser autoplay policy (no sound before a user gesture). Muted state persists
// in localStorage and defaults to unmuted; on mobile nothing plays until the user
// interacts anyway.

const MUTE_STORAGE = 'planeswalker_sound_muted';

let ctx: AudioContext | null = null;
let muted = (() => {
    try { return localStorage.getItem(MUTE_STORAGE) === 'true'; } catch { return false; }
})();

const getCtx = (): AudioContext | null => {
    if (typeof window === 'undefined') return null;
    if (!ctx) {
        const AC = window.AudioContext || (window as any).webkitAudioContext;
        if (!AC) return null;
        try { ctx = new AC(); } catch { return null; }
    }
    if (ctx.state === 'suspended') ctx.resume().catch(() => { });
    return ctx;
};

export const isSoundMuted = () => muted;
export const setSoundMuted = (m: boolean) => {
    muted = m;
    try { localStorage.setItem(MUTE_STORAGE, String(m)); } catch { /* ignore */ }
};

// A single enveloped oscillator tone, optionally gliding in pitch.
const tone = (c: AudioContext, o: { freq: number; freqTo?: number; type?: OscillatorType; start: number; dur: number; gain?: number }) => {
    const osc = c.createOscillator();
    const g = c.createGain();
    osc.type = o.type || 'sine';
    osc.frequency.setValueAtTime(o.freq, o.start);
    if (o.freqTo) osc.frequency.exponentialRampToValueAtTime(Math.max(1, o.freqTo), o.start + o.dur);
    const peak = o.gain ?? 0.15;
    g.gain.setValueAtTime(0.0001, o.start);
    g.gain.exponentialRampToValueAtTime(peak, o.start + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, o.start + o.dur);
    osc.connect(g); g.connect(c.destination);
    osc.start(o.start); osc.stop(o.start + o.dur + 0.02);
};

// A short band-passed noise burst (paper swish / shuffle).
const noise = (c: AudioContext, o: { start: number; dur: number; gain?: number; freq?: number }) => {
    const n = Math.max(1, Math.floor(c.sampleRate * o.dur));
    const buffer = c.createBuffer(1, n, c.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < n; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / n); // fade out
    const src = c.createBufferSource(); src.buffer = buffer;
    const bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = o.freq || 2000;
    const g = c.createGain(); g.gain.value = o.gain ?? 0.12;
    src.connect(bp); bp.connect(g); g.connect(c.destination);
    src.start(o.start); src.stop(o.start + o.dur);
};

export type SoundName = 'turnStart' | 'cardPlay' | 'draw' | 'damage' | 'heal' | 'mulligan';

export const playSound = (name: SoundName) => {
    if (muted) return;
    const c = getCtx();
    if (!c) return;
    const t = c.currentTime;
    switch (name) {
        case 'turnStart': // rising two-tone chime
            tone(c, { freq: 440, freqTo: 660, type: 'triangle', start: t, dur: 0.18, gain: 0.16 });
            tone(c, { freq: 660, type: 'sine', start: t + 0.12, dur: 0.2, gain: 0.1 });
            break;
        case 'cardPlay': // soft low thunk
            tone(c, { freq: 200, freqTo: 110, type: 'sine', start: t, dur: 0.12, gain: 0.2 });
            break;
        case 'draw': // paper swish
            noise(c, { start: t, dur: 0.14, gain: 0.1, freq: 3200 });
            break;
        case 'damage': // descending buzz
            tone(c, { freq: 300, freqTo: 90, type: 'sawtooth', start: t, dur: 0.22, gain: 0.12 });
            break;
        case 'heal': // gentle rising sine
            tone(c, { freq: 520, freqTo: 780, type: 'sine', start: t, dur: 0.22, gain: 0.11 });
            break;
        case 'mulligan': // shuffle: two overlapping swishes
            noise(c, { start: t, dur: 0.15, gain: 0.1, freq: 2500 });
            noise(c, { start: t + 0.12, dur: 0.15, gain: 0.09, freq: 1900 });
            break;
    }
};
