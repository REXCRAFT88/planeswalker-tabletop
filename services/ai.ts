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
}

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

// Whether the server has any provider configured, and which are available.
export async function aiStatus(): Promise<AiStatus> {
    try {
        const resp = await fetch(`${API_BASE}/api/ai/status`);
        if (!resp.ok) return { enabled: false, providers: [], defaultProvider: null };
        const data = await resp.json();
        cachedEnabled = !!data.enabled;
        return { enabled: !!data.enabled, providers: data.providers || [], defaultProvider: data.defaultProvider ?? null };
    } catch {
        cachedEnabled = false;
        return { enabled: false, providers: [], defaultProvider: null };
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
