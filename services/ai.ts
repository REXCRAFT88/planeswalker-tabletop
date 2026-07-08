// Browser-side client for the server AI endpoints (/api/ai/*). The API is served
// by the same Node process as Socket.IO: same origin in production, localhost:3001
// in dev.
import type {
    GameStateView, AiDeckCard, AiToolResult, AiTurnResponse, AiMulliganResponse,
    AiPersonaId, AiDifficulty, AiCardRef,
} from './aiTypes';

const API_BASE = import.meta.env.PROD ? '' : 'http://localhost:3001';

async function post<T>(path: string, body: any): Promise<T> {
    const resp = await fetch(`${API_BASE}/api/ai${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    });
    if (!resp.ok) {
        let detail = '';
        try { detail = (await resp.json())?.error || ''; } catch { /* ignore */ }
        throw new Error(detail || `AI request failed (${resp.status})`);
    }
    return resp.json();
}

let cachedEnabled: boolean | null = null;

// Whether the server has an API key configured. Cached after the first check.
export async function aiStatus(): Promise<{ enabled: boolean; model: string }> {
    try {
        const resp = await fetch(`${API_BASE}/api/ai/status`);
        if (!resp.ok) return { enabled: false, model: '' };
        const data = await resp.json();
        cachedEnabled = !!data.enabled;
        return data;
    } catch {
        cachedEnabled = false;
        return { enabled: false, model: '' };
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
}

export function requestTurn(args: TurnArgs): Promise<AiTurnResponse> {
    return post<AiTurnResponse>('/turn', args);
}

export function continueTurn(conversationId: string, toolResults: AiToolResult[]): Promise<AiTurnResponse> {
    return post<AiTurnResponse>('/continue', { conversationId, toolResults });
}
