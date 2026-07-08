// OpenAI Realtime voice backend (browser WebRTC). The Realtime model is the AI's
// live-voice negotiator. It receives only PUBLIC game state in its instructions (baked
// server-side); to learn anything hidden or strike a deal it must call function tools,
// which we relay to the server (the brain, which sees the hand, answers). The real
// OpenAI key stays on the server — the browser gets only a short-lived ephemeral token.
import type { GameStateView, AiPersonaId, AiProviderId } from './aiTypes';

const API_BASE = import.meta.env.PROD ? '' : 'http://localhost:3001';

export interface RealtimeConnectConfig {
    seatName: string;
    persona: AiPersonaId;
    provider?: AiProviderId;
    view: GameStateView;    // full view — the server uses only the public parts for instructions
    dealLog: string[];
}

export interface RealtimeCallbacks {
    onUserTranscript?(text: string): void;
    onAiTranscript?(text: string): void;
    onDeal?(summary: string): void;
    onState?(s: { connected?: boolean; listening?: boolean; speaking?: boolean }): void;
    onError?(msg: string): void;
    // Relay a consult_strategist call to the server brain; returns the guidance text.
    consult(question: string): Promise<string>;
}

// Ask the server brain (which holds the hand) what the negotiator may reveal.
export async function requestConsult(args: {
    question: string; seatName: string; persona: AiPersonaId; provider?: AiProviderId; view: GameStateView; dealLog: string[];
}): Promise<string> {
    const resp = await fetch(`${API_BASE}/api/ai/consult`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(args),
    });
    const data = await resp.json().catch(() => ({}));
    return data?.guidance || 'Stay vague and reveal nothing specific.';
}

export class RealtimeVoiceSession {
    private pc: RTCPeerConnection | null = null;
    private dc: RTCDataChannel | null = null;
    private micStream: MediaStream | null = null;
    private micTrack: MediaStreamTrack | null = null;
    private audioEl: HTMLAudioElement | null = null;
    private cb: RealtimeCallbacks;
    connected = false;

    constructor(cb: RealtimeCallbacks) { this.cb = cb; }

    async connect(cfg: RealtimeConnectConfig): Promise<void> {
        // 1. Ephemeral token + session config from our server.
        const tokResp = await fetch(`${API_BASE}/api/ai/realtime/token`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ seatName: cfg.seatName, persona: cfg.persona, view: cfg.view, dealLog: cfg.dealLog }),
        });
        const tok = await tokResp.json().catch(() => ({}));
        if (!tokResp.ok || !tok.token) throw new Error(tok.error || 'Could not start realtime session');

        // 2. Microphone (push-to-talk: track starts disabled).
        this.micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
        this.micTrack = this.micStream.getAudioTracks()[0];
        this.micTrack.enabled = false;

        // 3. Peer connection + remote audio playback.
        const pc = new RTCPeerConnection();
        this.pc = pc;
        pc.addTrack(this.micTrack, this.micStream);
        this.audioEl = document.createElement('audio');
        this.audioEl.autoplay = true;
        pc.ontrack = (e) => { if (this.audioEl) this.audioEl.srcObject = e.streams[0]; };

        // 4. Data channel for events (transcripts, function calls).
        const dc = pc.createDataChannel('oai-events');
        this.dc = dc;
        dc.onopen = () => { this.connected = true; this.cb.onState?.({ connected: true }); };
        dc.onclose = () => { this.connected = false; this.cb.onState?.({ connected: false }); };
        dc.onmessage = (e) => { try { this.handleEvent(JSON.parse(e.data)); } catch { /* ignore */ } };

        // 5. SDP offer/answer with OpenAI, authenticated by the ephemeral token.
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        const sdpResp = await fetch(`${tok.callsUrl}?model=${encodeURIComponent(tok.model)}`, {
            method: 'POST', body: offer.sdp,
            headers: { Authorization: `Bearer ${tok.token}`, 'Content-Type': 'application/sdp' },
        });
        if (!sdpResp.ok) throw new Error(`Realtime connection failed (${sdpResp.status})`);
        await pc.setRemoteDescription({ type: 'answer', sdp: await sdpResp.text() });
    }

    private send(obj: any) {
        if (this.dc && this.dc.readyState === 'open') this.dc.send(JSON.stringify(obj));
    }

    // Push-to-talk press: clear any stale audio and open the mic.
    startTalk() {
        if (!this.micTrack) return;
        this.send({ type: 'input_audio_buffer.clear' });
        this.micTrack.enabled = true;
        this.cb.onState?.({ listening: true });
    }

    // Send a typed message into the live session (text fallback for the mic).
    sendText(text: string) {
        if (!text.trim()) return;
        this.send({ type: 'conversation.item.create', item: { type: 'message', role: 'user', content: [{ type: 'input_text', text }] } });
        this.send({ type: 'response.create' });
    }

    // Push-to-talk release: close the mic, commit the audio, and ask for a response.
    endTalk() {
        if (!this.micTrack) return;
        this.micTrack.enabled = false;
        this.cb.onState?.({ listening: false });
        this.send({ type: 'input_audio_buffer.commit' });
        this.send({ type: 'response.create' });
    }

    private async handleEvent(ev: any) {
        switch (ev.type) {
            case 'conversation.item.input_audio_transcription.completed':
                if (ev.transcript) this.cb.onUserTranscript?.(ev.transcript);
                break;
            case 'response.audio_transcript.done':
            case 'response.output_audio_transcript.done':
                if (ev.transcript) this.cb.onAiTranscript?.(ev.transcript);
                break;
            case 'output_audio_buffer.started':
                this.cb.onState?.({ speaking: true });
                break;
            case 'output_audio_buffer.stopped':
            case 'response.done':
                this.cb.onState?.({ speaking: false });
                break;
            case 'response.function_call_arguments.done':
                await this.handleFunctionCall(ev);
                break;
            case 'error':
                this.cb.onError?.(ev.error?.message || 'Realtime error');
                break;
        }
    }

    private async handleFunctionCall(ev: any) {
        const name = ev.name;
        const callId = ev.call_id;
        let args: any = {};
        try { args = JSON.parse(ev.arguments || '{}'); } catch { /* ignore */ }
        let output = '{"ok":true}';
        try {
            if (name === 'consult_strategist') {
                const guidance = await this.cb.consult(String(args.question || ''));
                output = JSON.stringify({ guidance });
            } else if (name === 'commit_deal') {
                this.cb.onDeal?.(String(args.summary || ''));
                output = JSON.stringify({ ok: true, detail: 'deal recorded' });
            }
        } catch (e: any) {
            output = JSON.stringify({ ok: false, error: e?.message || 'failed' });
        }
        // Return the tool result and let the model continue speaking.
        this.send({ type: 'conversation.item.create', item: { type: 'function_call_output', call_id: callId, output } });
        this.send({ type: 'response.create' });
    }

    disconnect() {
        try { this.micTrack?.stop(); } catch { /* noop */ }
        try { this.micStream?.getTracks().forEach(t => t.stop()); } catch { /* noop */ }
        try { this.dc?.close(); } catch { /* noop */ }
        try { this.pc?.close(); } catch { /* noop */ }
        try { this.audioEl?.remove(); } catch { /* noop */ }
        this.pc = null; this.dc = null; this.micTrack = null; this.micStream = null; this.audioEl = null;
        this.connected = false;
        this.cb.onState?.({ connected: false, listening: false, speaking: false });
    }
}
