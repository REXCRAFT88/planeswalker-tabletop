// Shared types for the AI-opponent feature, used by both the browser client
// (state serialization, driver) and the server (Claude API proxy).

export type AiDifficulty = 'casual' | 'competitive';
export type AiPersonaId = 'timmy' | 'spike' | 'johnny' | 'balanced';

export const AI_PERSONA_LABELS: Record<AiPersonaId, string> = {
    timmy: 'Timmy — big, splashy plays',
    spike: 'Spike — tight and competitive',
    johnny: 'Johnny — combos and synergy',
    balanced: 'Balanced — solid all-rounder',
};

export interface AiCardRef {
    id: string;
    name: string;
    manaCost?: string;
    typeLine?: string;
}

export interface AiBoardRef {
    id: string;
    name: string;
    tapped: boolean;
    isToken?: boolean;
    quantity: number;
    counters?: Record<string, number>;
    typeLine?: string;
}

export interface AiManaPool {
    W: number; U: number; B: number; R: number; G: number; C: number;
}

export interface AiSelfView {
    seatId: string;
    name: string;
    life: number;
    commanderTax: number;
    hand: AiCardRef[];
    battlefield: AiBoardRef[];
    graveyard: string[];
    exileCount: number;
    libraryCount: number;
    commandZone: AiCardRef[];
    manaAvailable: AiManaPool;
    landsPlayedThisTurn: number;
}

export interface AiOpponentView {
    seatId: string;
    name: string;
    life: number;
    poison: number;
    battlefield: AiBoardRef[];
    handCount: number;
    graveyardTop: string[];
    commanders: string[];
    commanderDamageTakenFromYou: number;
}

export interface GameStateView {
    turn: number;
    phase: string;
    you: AiSelfView;
    opponents: AiOpponentView[];
    recentLog: string[];
}

// One card in the deck summary that seeds the system prompt (name + oracle text).
export interface AiDeckCard {
    name: string;
    manaCost?: string;
    typeLine?: string;
    oracleText?: string;
}

// A single tool invocation returned by Claude for the host to apply.
export interface AiToolCall {
    id: string; // tool_use id
    name: string;
    input: any;
}

// The host's response to one tool call, fed back into the conversation.
export interface AiToolResult {
    id: string; // matching tool_use id
    ok: boolean;
    error?: string;
    detail?: string;
}

export interface AiUsage {
    inputTokens: number;
    cacheReadTokens: number;
    outputTokens: number;
}

export interface AiTurnResponse {
    conversationId: string;
    toolCalls: AiToolCall[];
    text: string;
    done: boolean;
    usage?: AiUsage;
}

export interface AiMulliganResponse {
    keep: boolean;
    bottomCards: string[];
    comment: string;
    usage?: AiUsage;
}

// The list of tool names the host knows how to apply. Kept here so both the
// server tool schema and the client driver reference a single source of truth.
export const AI_TOOL_NAMES = [
    'play_land',
    'cast_spell',
    'cast_commander',
    'activate_mana',
    'tap_permanent',
    'untap_permanent',
    'create_token',
    'add_counter',
    'move_card',
    'declare_attackers',
    'adjust_life',
    'announce',
    'end_turn',
] as const;

export type AiToolName = typeof AI_TOOL_NAMES[number];
