// Pure serialization of the host's game state into the compact, hidden-info-free
// GameStateView the AI sees. Kept separate from the Tabletop component so it can be
// unit-tested and reused by the driver.
import { CardData, BoardObject } from '../types';
import type { ManaPool } from './mana';
import type {
    GameStateView, AiBoardRef, AiCardRef, AiManaPool, AiDeckCard, AiOpponentView, AiPersonaId,
} from './aiTypes';

const toManaPool = (p: ManaPool): AiManaPool => ({
    W: p.W || 0, U: p.U || 0, B: p.B || 0, R: p.R || 0, G: p.G || 0, C: p.C || 0,
});

const cardRef = (c: CardData): AiCardRef => ({
    id: c.id, name: c.name, manaCost: c.manaCost || undefined, typeLine: c.typeLine || undefined,
});

// A board object is "tapped" if a single copy is rotated off its owner's default
// orientation, or every copy in a stack is tapped.
const isTapped = (obj: BoardObject, defaultRotation: number): boolean => {
    if (obj.quantity > 1) return obj.tappedQuantity >= obj.quantity;
    return obj.rotation !== defaultRotation;
};

const boardRef = (obj: BoardObject, defaultRotation: number): AiBoardRef => ({
    id: obj.id,
    name: obj.cardData.name,
    tapped: isTapped(obj, defaultRotation),
    isToken: obj.cardData.isToken || undefined,
    quantity: obj.quantity,
    counters: obj.counters && Object.keys(obj.counters).length ? obj.counters : undefined,
    typeLine: obj.cardData.typeLine || undefined,
});

export interface BuildViewInput {
    turn: number;
    aiSeatId: string;
    aiSeatName: string;
    hand: CardData[];
    libraryCount: number;
    graveyard: CardData[];
    exileCount: number;
    commandZone: CardData[];
    life: number;
    commanderTax: number;
    landsPlayedThisTurn: number;
    manaAvailable: ManaPool;
    boardObjects: BoardObject[];
    opponents: Array<{ seatId: string; name: string; life: number; poison: number; commanders: string[]; handCount: number; commanderDamageTakenFromAi: number }>;
    defaultRotations: Record<string, number>; // seatId -> default board rotation
    recentLog: string[];
}

export function buildGameStateView(input: BuildViewInput): GameStateView {
    const myRot = input.defaultRotations[input.aiSeatId] ?? 0;
    const myBattlefield = input.boardObjects
        .filter(o => o.controllerId === input.aiSeatId && o.type === 'CARD')
        .map(o => boardRef(o, myRot));

    const opponents: AiOpponentView[] = input.opponents.map(op => {
        const rot = input.defaultRotations[op.seatId] ?? 0;
        const battlefield = input.boardObjects
            .filter(o => o.controllerId === op.seatId && o.type === 'CARD')
            .map(o => boardRef(o, rot));
        return {
            seatId: op.seatId,
            name: op.name,
            life: op.life,
            poison: op.poison,
            battlefield,
            handCount: op.handCount,
            graveyardTop: [],
            commanders: op.commanders,
            commanderDamageTakenFromYou: op.commanderDamageTakenFromAi,
        };
    });

    return {
        turn: input.turn,
        phase: 'MAIN',
        you: {
            seatId: input.aiSeatId,
            name: input.aiSeatName,
            life: input.life,
            commanderTax: input.commanderTax,
            hand: input.hand.filter(c => !c.isToken).map(cardRef),
            battlefield: myBattlefield,
            graveyard: input.graveyard.map(c => c.name),
            exileCount: input.exileCount,
            libraryCount: input.libraryCount,
            commandZone: input.commandZone.map(cardRef),
            manaAvailable: toManaPool(input.manaAvailable),
            landsPlayedThisTurn: input.landsPlayedThisTurn,
        },
        opponents,
        recentLog: input.recentLog,
    };
}

// Build the decklist (name + oracle text) that seeds the AI's system prompt.
// Deduped by name so each card appears once.
export function deckToSummaryCards(deck: CardData[]): AiDeckCard[] {
    const seen = new Set<string>();
    const out: AiDeckCard[] = [];
    for (const c of deck) {
        if (seen.has(c.name)) continue;
        seen.add(c.name);
        out.push({
            name: c.name,
            manaCost: c.manaCost || undefined,
            typeLine: c.typeLine || undefined,
            oracleText: c.oracleText || undefined,
        });
    }
    return out;
}

// Suggest a default persona from a deck's shape (client-safe mirror of the
// server's suggestPersona, driven directly by CardData).
export function suggestPersonaForDeck(deck: CardData[]): AiPersonaId {
    if (!deck.length) return 'balanced';
    const creatures = deck.filter(c => (c.typeLine || '').toLowerCase().includes('creature')).length;
    const ratio = creatures / deck.length;
    const avgCmc = deck.reduce((s, c) => s + (c.cmc || 0), 0) / deck.length;
    if (ratio > 0.35 && avgCmc >= 3.5) return 'timmy';
    if (ratio < 0.2) return 'johnny';
    if (avgCmc <= 2.8) return 'spike';
    return 'balanced';
}

// A one-line strategy summary for the mulligan prompt.
export function deckStrategySummary(deck: CardData[]): string {
    const lands = deck.filter(c => c.isLand).length;
    const creatures = deck.filter(c => (c.typeLine || '').toLowerCase().includes('creature')).length;
    const commander = deck.find(c => c.isCommander);
    const avgCmc = deck.length ? (deck.reduce((s, c) => s + (c.cmc || 0), 0) / deck.length) : 0;
    const cmdrPart = commander ? `Commander: ${commander.name}. ` : '';
    return `${cmdrPart}${deck.length} cards, ${lands} lands, ${creatures} creatures, average mana value ${avgCmc.toFixed(1)}.`;
}
