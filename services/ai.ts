// Browser-side client for the server AI endpoints (/api/ai/*). The API is served
// by the same Node process as Socket.IO: same origin in production, localhost:3001
// in dev.
import type {
    GameStateView, AiDeckCard, AiToolResult, AiTurnResponse, AiMulliganResponse,
    AiPersonaId, AiDifficulty, AiCardRef, AiProviderId,
} from './aiTypes';

const API_BASE = import.meta.env.PROD ? '' : 'http://localhost:3001';

export interface AiStatus {
    enabled: boolean;
    providers: { id: AiProviderId; label: string }[];
    defaultProvider: AiProviderId | null;
    realtimeVoice: boolean; // OpenAI Realtime voice backend available
}

// fetch() has no default timeout, so a stalled network request would hang an AI
// turn forever. Bound each call (a little above the server's own 75s ceiling so
// the server's structured error wins the race when it can) and abort otherwise.
const CLIENT_TIMEOUT_MS = 90_000;

async function post<T>(path: string, body: any): Promise<T> {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), CLIENT_TIMEOUT_MS);
    let resp: Response;
    try {
        resp = await fetch(`${API_BASE}/api/ai${path}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
            signal: ctrl.signal,
        });
    } catch (e: any) {
        if (e?.name === 'AbortError') throw new Error('AI request timed out');
        throw e;
    } finally {
        clearTimeout(timer);
    }
    if (!resp.ok) {
        let detail = '';
        try { detail = (await resp.json())?.error || ''; } catch { /* ignore */ }
        throw new Error(detail || `AI request failed (${resp.status})`);
    }
    return resp.json();
}

let cachedEnabled: boolean | null = null;

// Whether the server has any provider configured, and which are available.
export async function aiStatus(): Promise<AiStatus> {
    try {
        const resp = await fetch(`${API_BASE}/api/ai/status`);
        if (!resp.ok) return { enabled: false, providers: [], defaultProvider: null, realtimeVoice: false };
        const data = await resp.json();
        cachedEnabled = !!data.enabled;
        return { enabled: !!data.enabled, providers: data.providers || [], defaultProvider: data.defaultProvider ?? null, realtimeVoice: !!data.realtimeVoice };
    } catch {
        cachedEnabled = false;
        return { enabled: false, providers: [], defaultProvider: null, realtimeVoice: false };
    }
}

export function aiKnownEnabled(): boolean | null {
    return cachedEnabled;
}

export interface MulliganArgs {
    seatName: string;
    persona: AiPersonaId;
    difficulty: AiDifficulty;
    deckSummary: string;
    hand: AiCardRef[];
    provider?: AiProviderId;
}

export function requestMulligan(args: MulliganArgs): Promise<AiMulliganResponse> {
    return post<AiMulliganResponse>('/mulligan', args);
}

export interface TurnArgs {
    seatName: string;
    persona: AiPersonaId;
    difficulty: AiDifficulty;
    deck: AiDeckCard[];
    stateView: GameStateView;
    provider?: AiProviderId;
}

export function requestTurn(args: TurnArgs): Promise<AiTurnResponse> {
    return post<AiTurnResponse>('/turn', args);
}

export function continueTurn(conversationId: string, toolResults: AiToolResult[]): Promise<AiTurnResponse> {
    return post<AiTurnResponse>('/continue', { conversationId, toolResults });
}
