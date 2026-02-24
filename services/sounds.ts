/**
 * Game Sound Effects — Procedural Web Audio API
 * No external audio files needed.
 */

let audioCtx: AudioContext | null = null;

const getCtx = (): AudioContext => {
    if (!audioCtx) audioCtx = new AudioContext();
    return audioCtx;
};

const playTone = (freq: number, duration: number, type: OscillatorType = 'sine', volume = 0.15) => {
    try {
        const ctx = getCtx();
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = type;
        osc.frequency.setValueAtTime(freq, ctx.currentTime);
        gain.gain.setValueAtTime(volume, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(ctx.currentTime);
        osc.stop(ctx.currentTime + duration);
    } catch { /* AudioContext not available */ }
};

const playChord = (freqs: number[], duration: number, type: OscillatorType = 'sine', volume = 0.08) => {
    freqs.forEach(f => playTone(f, duration, type, volume));
};

// ─── Public Sound API ───

/** Your turn has started */
export const soundTurnStart = () => {
    playTone(523, 0.12, 'triangle', 0.2);   // C5
    setTimeout(() => playTone(659, 0.12, 'triangle', 0.2), 100); // E5
    setTimeout(() => playTone(784, 0.2, 'triangle', 0.18), 200);  // G5
};

/** A card is played onto the board */
export const soundCardPlay = () => {
    playTone(440, 0.08, 'square', 0.06);
};

/** A card is drawn */
export const soundCardDraw = () => {
    playTone(880, 0.06, 'sine', 0.08);
};

/** Tap / Untap */
export const soundTap = () => {
    playTone(300, 0.05, 'square', 0.04);
};

/** Damage dealt */
export const soundDamage = () => {
    playTone(180, 0.15, 'sawtooth', 0.1);
};

/** Life gained */
export const soundHeal = () => {
    playChord([523, 659, 784], 0.3, 'sine', 0.06);
};

/** Dice roll */
export const soundDiceRoll = () => {
    for (let i = 0; i < 6; i++) {
        setTimeout(() => playTone(200 + Math.random() * 400, 0.04, 'square', 0.05), i * 40);
    }
};

/** Shuffle library */
export const soundShuffle = () => {
    for (let i = 0; i < 8; i++) {
        setTimeout(() => playTone(150 + Math.random() * 100, 0.03, 'sawtooth', 0.03), i * 30);
    }
};

/** Player joined / connected */
export const soundPlayerJoin = () => {
    playTone(440, 0.1, 'sine', 0.12);
    setTimeout(() => playTone(554, 0.1, 'sine', 0.12), 100);
    setTimeout(() => playTone(659, 0.15, 'sine', 0.1), 200);
};

/** Game over / defeat */
export const soundGameOver = () => {
    playTone(392, 0.3, 'triangle', 0.15);
    setTimeout(() => playTone(330, 0.3, 'triangle', 0.15), 300);
    setTimeout(() => playTone(262, 0.5, 'triangle', 0.12), 600);
};

/** Token / copy created */
export const soundCopy = () => {
    playTone(660, 0.06, 'triangle', 0.1);
    setTimeout(() => playTone(880, 0.08, 'triangle', 0.08), 60);
};

/** Counter adjustment (scroll wheel) */
export const soundCounter = () => {
    playTone(600, 0.03, 'sine', 0.04);
};

/** Turn sub-phase advance */
export const soundPhaseAdvance = () => {
    playTone(500, 0.04, 'triangle', 0.06);
};

/** Mulligan */
export const soundMulligan = () => {
    playTone(350, 0.08, 'sawtooth', 0.06);
    setTimeout(() => playTone(300, 0.12, 'sawtooth', 0.05), 80);
};
