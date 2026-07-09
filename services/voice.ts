// Client voice layer. Speech in/out is behind a small backend abstraction so the user
// can pick their priority (free vs. quality). The zero-cost default is the browser's
// built-in Web Speech API; other backends (OpenAI Realtime, cloud STT+TTS) can be added
// as additional VoiceBackend implementations without touching the rest of the app.
import type {
    GameStateView, VoiceChatTurn, VoiceReplyResponse, AiPersonaId, AiProviderId, VoiceBackendId,
} from './aiTypes';

const API_BASE = import.meta.env.PROD ? '' : 'http://localhost:3001';

export interface VoiceBackend {
    id: VoiceBackendId;
    isSupported(): boolean;
    // Begin capturing speech. Interim transcripts stream via onPartial; the final
    // transcript resolves when stopListening() is called (push-to-talk).
    startListening(onPartial?: (text: string) => void): void;
    stopListening(): Promise<string>;
    speak(text: string): Promise<void>;
    cancelSpeech(): void;
}

// --- Web Speech backend (free, no keys) ---
class WebSpeechBackend implements VoiceBackend {
    id: VoiceBackendId = 'web-speech';
    private recog: any = null;
    private finalText = '';
    private resolveStop: ((t: string) => void) | null = null;

    isSupported(): boolean {
        const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
        return !!SR && typeof window.speechSynthesis !== 'undefined';
    }

    startListening(onPartial?: (text: string) => void): void {
        const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
        if (!SR) return;
        this.finalText = '';
        const recog = new SR();
        recog.lang = 'en-US';
        recog.continuous = true;
        recog.interimResults = true;
        recog.onresult = (e: any) => {
            let interim = '';
            for (let i = e.resultIndex; i < e.results.length; i++) {
                const r = e.results[i];
                if (r.isFinal) this.finalText += r[0].transcript;
                else interim += r[0].transcript;
            }
            onPartial?.((this.finalText + ' ' + interim).trim());
        };
        recog.onend = () => {
            if (this.resolveStop) { this.resolveStop(this.finalText.trim()); this.resolveStop = null; }
        };
        recog.onerror = () => {
            if (this.resolveStop) { this.resolveStop(this.finalText.trim()); this.resolveStop = null; }
        };
        this.recog = recog;
        try { recog.start(); } catch { /* already started */ }
    }

    stopListening(): Promise<string> {
        return new Promise<string>((resolve) => {
            if (!this.recog) { resolve(''); return; }
            this.resolveStop = resolve;
            try { this.recog.stop(); } catch { resolve(this.finalText.trim()); this.resolveStop = null; }
        });
    }

    speak(text: string): Promise<void> {
        return new Promise<void>((resolve) => {
            if (!text || typeof window.speechSynthesis === 'undefined') { resolve(); return; }
            const u = new SpeechSynthesisUtterance(text);
            u.rate = 1.0;
            u.onend = () => resolve();
            u.onerror = () => resolve();
            window.speechSynthesis.speak(u);
        });
    }

    cancelSpeech(): void {
        try { window.speechSynthesis?.cancel(); } catch { /* noop */ }
    }
}

const webSpeech = new WebSpeechBackend();

// Only the free backend is implemented today; the others are declared so the UI can
// present them and explain what they need. They report unsupported until wired up.
class UnimplementedBackend implements VoiceBackend {
    constructor(public id: VoiceBackendId) {}
    isSupported() { return false; }
    startListening() { /* not available */ }
    async stopListening() { return ''; }
    async speak() { /* not available */ }
    cancelSpeech() { /* noop */ }
}

const BACKENDS: Record<VoiceBackendId, VoiceBackend> = {
    'web-speech': webSpeech,
    'openai-realtime': new UnimplementedBackend('openai-realtime'),
    'cloud-pipeline': new UnimplementedBackend('cloud-pipeline'),
};

export function getVoiceBackend(id: VoiceBackendId = 'web-speech'): VoiceBackend {
    return BACKENDS[id] || webSpeech;
}

export function voiceInputSupported(): boolean {
    return webSpeech.isSupported();
}

// --- Negotiation request to the server voice model ---
export interface VoiceReplyArgs {
    seatName: string;
    persona: AiPersonaId;
    provider?: AiProviderId;
    view: GameStateView;
    dealLog: string[];
    history: VoiceChatTurn[];
    userText: string;
}

export async function requestVoiceReply(args: VoiceReplyArgs): Promise<VoiceReplyResponse> {
    const resp = await fetch(`${API_BASE}/api/ai/voice`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(args),
    });
    if (!resp.ok) {
        let detail = '';
        try { detail = (await resp.json())?.error || ''; } catch { /* ignore */ }
        throw new Error(detail || `Voice request failed (${resp.status})`);
    }
    return resp.json();
}
