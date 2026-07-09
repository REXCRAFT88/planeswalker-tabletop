import type { AiDeckCard, GameStateView } from '../../services/aiTypes';
import { PERSONAS } from './personas';
import type { AiPersonaId } from '../../services/aiTypes';
import { RULES_DIGEST } from './rules';

const RULES_OF_ENGAGEMENT = `You are playing Magic: The Gathering Commander on a shared, honor-system virtual tabletop against human players. The app does NOT enforce the rules — players move cards by hand and trust each other, and you play at the same level.

How you act:
- Take game actions ONLY through the provided tools. Never claim to have done something without the matching tool call.
- You get one land drop per turn. Develop your mana, then cast spells you can afford.
- Mana is tapped for you automatically when you cast; if a spell is unaffordable the tool call fails and tells you your available mana — adjust and try a cheaper line.
- For anything the tools cannot express (triggered abilities, targeting, modal choices, rules questions), use the "announce" tool to tell the table in one short sentence, then continue. When a ruling is ambiguous, pick the simple, reasonable interpretation and say so.
- Think between actions, but keep spoken output short. Use "announce" sparingly — at most one flavor remark per turn.
- Play only on YOUR turn. When you are done, call "end_turn" with a one-line summary.
- You cannot see opponents' hands or libraries. Play with the public information you are given.`;

export function buildTurnSystemPrompt(
    personaId: AiPersonaId,
    seatName: string,
    deck: AiDeckCard[],
): string {
    const persona = PERSONAS[personaId] || PERSONAS.balanced;
    const deckList = deck
        .map(c => {
            const cost = c.manaCost ? ` ${c.manaCost}` : '';
            const type = c.typeLine ? ` — ${c.typeLine}` : '';
            const text = c.oracleText ? `\n    ${c.oracleText.replace(/\n/g, ' ')}` : '';
            return `- ${c.name}${cost}${type}${text}`;
        })
        .join('\n');

    return `You are "${seatName}", an AI Commander player. Persona: ${persona.name}. ${persona.blurb}

${RULES_OF_ENGAGEMENT}

${RULES_DIGEST}

Your decklist (with oracle text) for reference — you do not need this repeated each turn:
${deckList}`;
}

export function buildMulliganSystemPrompt(
    personaId: AiPersonaId,
    seatName: string,
    deckSummary: string,
): string {
    const persona = PERSONAS[personaId] || PERSONAS.balanced;
    return `You are "${seatName}", an AI Commander player. Persona: ${persona.name}. ${persona.blurb}

You are deciding whether to keep your opening 7-card hand in Commander (London mulligan). A keepable hand usually has 2-4 lands and a reasonable curve. Be a little forgiving on the first hand. If you have already mulliganed, you must put that many cards on the bottom when you keep.

Deck strategy summary: ${deckSummary}

Decide using the mulligan_decision tool.`;
}

// Compact, per-turn state description appended as the user message.
export function formatStateView(view: GameStateView): string {
    const you = view.you;
    const mana = you.manaAvailable;
    const manaStr = ['W', 'U', 'B', 'R', 'G', 'C']
        .map(c => `${c}:${(mana as any)[c] || 0}`)
        .join(' ');

    const hand = you.hand.length
        ? you.hand.map(c => `  [${c.id}] ${c.name}${c.manaCost ? ' ' + c.manaCost : ''}${c.typeLine ? ' — ' + c.typeLine : ''}`).join('\n')
        : '  (empty)';

    const battlefield = you.battlefield.length
        ? you.battlefield.map(b => {
            const q = b.quantity > 1 ? ` x${b.quantity}` : '';
            const tapped = b.tapped ? ' (tapped)' : '';
            const counters = b.counters && Object.keys(b.counters).length
                ? ' {' + Object.entries(b.counters).map(([k, v]) => `${k}:${v}`).join(',') + '}'
                : '';
            return `  [${b.id}] ${b.name}${q}${tapped}${counters}${b.typeLine ? ' — ' + b.typeLine : ''}`;
        }).join('\n')
        : '  (empty)';

    const command = you.commandZone.length
        ? you.commandZone.map(c => `  [${c.id}] ${c.name}${c.manaCost ? ' ' + c.manaCost : ''}`).join('\n')
        : '  (empty)';

    const opps = view.opponents.map(o => {
        const bf = o.battlefield.length
            ? o.battlefield.map(b => `${b.name}${b.tapped ? '(t)' : ''}`).join(', ')
            : 'nothing';
        return `- ${o.name} [${o.seatId}]: ${o.life} life${o.poison ? `, ${o.poison} poison` : ''}, ${o.handCount} cards in hand. Battlefield: ${bf}. Commanders: ${o.commanders.join(', ') || 'none out'}.`;
    }).join('\n');

    const log = view.recentLog.length ? view.recentLog.map(l => `  ${l}`).join('\n') : '  (none)';

    return `It is your turn ${view.turn}. Play your turn now, one tool at a time, then call end_turn.

YOUR LIFE: ${you.life}   Commander tax: ${you.commanderTax}   Lands played this turn: ${you.landsPlayedThisTurn}/1
AVAILABLE MANA (untapped sources): ${manaStr}

YOUR HAND:
${hand}

YOUR BATTLEFIELD:
${battlefield}

YOUR COMMAND ZONE:
${command}

Library: ${you.libraryCount} cards, Graveyard: ${you.graveyard.length}, Exile: ${you.exileCount}

OPPONENTS:
${opps}

RECENT LOG:
${log}`;
}
