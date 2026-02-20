import { CardData } from '../types';

export function generateDeckMarkdown(name: string, deck: CardData[], tokens: CardData[]): string {
    let md = `# Deck: ${name}\n\n`;

    // Group cards to avoid repeating identical entries
    const deckMap = new Map<string, { count: number; card: CardData }>();
    deck.forEach(c => {
        if (!deckMap.has(c.scryfallId)) {
            deckMap.set(c.scryfallId, { count: 0, card: c });
        }
        deckMap.get(c.scryfallId)!.count++;
    });

    md += `## Main Deck (${deck.length} cards)\n`;
    for (const { count, card } of deckMap.values()) {
        md += `### ${count}x ${card.name}\n`;
        if (card.manaCost) md += `- **Mana Cost**: ${card.manaCost}\n`;
        md += `- **Type**: ${card.typeLine}\n`;
        if (card.power !== undefined && card.toughness !== undefined) {
            md += `- **P/T**: ${card.power}/${card.toughness}\n`;
        }
        if (card.oracleText) {
            // Reformat oracle text to be a bit more compact but readable
            const text = card.oracleText.replace(/\n/g, ' | ');
            md += `- **Oracle Text**: ${text}\n`;
        }
        if (card.isCommander) {
            md += `- **Role**: COMMANDER\n`;
        }
        md += '\n';
    }

    if (tokens.length > 0) {
        md += `## Tokens (${tokens.length} cards)\n`;
        const tokenMap = new Map<string, { count: number; card: CardData }>();
        tokens.forEach(c => {
            if (!tokenMap.has(c.scryfallId)) {
                tokenMap.set(c.scryfallId, { count: 0, card: c });
            }
            tokenMap.get(c.scryfallId)!.count++;
        });

        for (const { count, card } of tokenMap.values()) {
            md += `### ${count}x ${card.name}\n`;
            md += `- **Type**: ${card.typeLine}\n`;
            if (card.power !== undefined && card.toughness !== undefined) {
                md += `- **P/T**: ${card.power}/${card.toughness}\n`;
            }
            if (card.oracleText) {
                const text = card.oracleText.replace(/\n/g, ' | ');
                md += `- **Oracle Text**: ${text}\n`;
            }
            md += '\n';
        }
    }

    return md;
}

export function generateAiSystemPrompt(
    aiName: string,
    aiDeckMd: string,
    opponentDeckMd: string,
    magicRulesMd: string
): string {
    return `You are playing a Magic: The Gathering Commander game against another player. 
Your name is ${aiName}. Your job is to use your deck to win by playing strictly by the rules. 
You are an opponent to the other player. Do not reveal or tell them your cards or plan unless you find it advantageous to winning. 
You should always announce the actions you are doing verbally, and try to be friendly and helpful to your opponent if they are confused or have questions.

You have been provided with the database for the Magic rules, as well as your deck and your opponent's deck. 
Use these to make sure you are playing by the rules and not making illegal moves or actions. 
You can also use this to try to plan ahead and strategize.

Here is the Magic Rules Database:
---
${magicRulesMd.substring(0, 10000) /* Safety truncation if it is too huge, though Gemini 2.0 has 1M context */}
---

Here is YOUR Deck:
---
${aiDeckMd}
---

Here is your OPPONENT'S Deck:
---
${opponentDeckMd}
---

### Interacting with the Game Board (Commands)
You also have a list of commands. These are how you interact with the board and get it to do your actions. 
Whenever you want to perform a physical action on the board, you MUST output a JSON code block in your response using the following format. 
You can output multiple JSON code blocks if you are doing multiple actions in a sequence. 

\`\`\`json
{
  "action": "ACTION_TYPE",
  "args": { ... }
}
\`\`\`

**Available Actions:**

1. **Draw Card(s)**: Moves cards from your library to your hand.
\`\`\`json
{ "action": "draw_card", "args": { "amount": 1 } }
\`\`\`

2. **Move Card**: Moves a specific card to a new zone.
\`\`\`json
{ "action": "move_card", "args": { "cardName": "string", "zone": "battlefield" | "graveyard" | "exile" | "command" | "hand" } }
\`\`\`

3. **Tap / Untap Card**: Taps or untaps a card on the battlefield.
\`\`\`json
{ "action": "tap_untap", "args": { "cardName": "string" } }
\`\`\`

4. **Change Life**: Adjust your life total (use negative amounts to take damage).
\`\`\`json
{ "action": "change_life", "args": { "amount": -3 } }
\`\`\`

5. **Modify Counters**: Add or remove counters on a card.
\`\`\`json
{ "action": "add_counter", "args": { "cardName": "string", "counterType": "+1/+1", "amount": 1 } }
\`\`\`

6. **Mulligan Decision**: (Only used at the start of the game when prompted).
\`\`\`json
{ "action": "mulligan", "args": { "keep": true } }
\`\`\`

### Game State & Logs
You will be fed with the game logs continuously. This is simply so that you know what is happening during the game, what the other player is doing, and to confirm if you did your actions correctly. 
At the start of your turn, you will be given a summary of your hand, the board state, and the opponent's state. 
When it is your turn, tell the player what you are doing, then use the JSON commands to execute it!
`;
}
