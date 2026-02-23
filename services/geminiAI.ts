/**
 * AI Manager - Coordinates Strategy and Conversation AI services
 * Strategy: Fast text-based API for game commands
 * Conversation: Real-time voice for player interaction
 */

import { GeminiStrategyClient, GameCommand, GeminiStrategyOptions } from './geminiStrategy';
export type { GameCommand };
import { GeminiConversationClient, GeminiConversationOptions } from './geminiConversation';

export interface AIOptions {
    apiKey: string;
    playerName: string;
    aiName?: string;
    aiDeckMarkdown: string;
    opponentDeckMarkdown: string;
    magicRulesMarkdown: string;
    onGameCommand: (commands: GameCommand[]) => void;
    onConnected?: () => void;
    onError?: (error: any) => void;
}

export class GeminiAIManager {
    private strategyClient: GeminiStrategyClient | null = null;
    private conversationClient: GeminiConversationClient | null = null;
    private options: AIOptions;

    constructor(options: AIOptions) {
        this.options = options;
        this.initializeStrategy();
        this.initializeConversation();
    }

    /**
     * Initialize strategy AI for game commands
     */
    private initializeStrategy() {
        const systemInstruction = `You are playing a Magic: The Gathering Commander game against another player.
Your name is ${this.options.aiName || 'Gemini AI'}.
Your job is to use your deck to win by playing strictly by the rules.
You are an opponent to the other player. Do not reveal or tell them your cards or plan unless you find it advantageous to winning.
You should always announce the actions you are doing and try to be friendly and helpful to your opponent if they are confused or have questions.

IMPORTANT: You are playing in REAL TIME. We will send you updates on the opponent's turn. YOU HAVE PRIORITY to cast instants and activate abilities in response to their actions!
If you are prompted during the opponent's turn and wish to take NO ACTION, use the "no_action" command to pass priority!

You have been provided with the database for the Magic rules, as well as your deck and your opponent's deck.
Use these to make sure you are playing by the rules and not making illegal moves or actions.
You can also use this to try to plan ahead and strategize.

Here is the Magic Rules Database:
---
${this.options.magicRulesMarkdown.substring(0, 10000)}
---

Here is YOUR Deck:
---
${this.options.aiDeckMarkdown}
---

Here is your OPPONENT'S Deck:
---
${this.options.opponentDeckMarkdown}
---

### Interacting with the Game Board (Commands)
You also have a list of commands. These are how you interact with the board and get it to do your actions.
Whenever you want to perform a physical action on the board, you MUST output a JSON code block in your response. 
You should output an ARRAY of these action objects if you are doing multiple things.
Include a "commentary" string in your action object to provide a dramatic or descriptive vocalization of that action to the player!

\`\`\`json
[
  {
    "action": "ACTION_TYPE",
    "args": { ... },
    "commentary": "Ah, you thought you could attack me? I play this!"
  }
]
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
[ { "action": "mulligan", "args": { "keep": true } } ]
\`\`\`

7. **Pass Priority / No Action**: (Crucial for when you are prompted during the opponent's turn but do not wish to cast an instant).
\`\`\`json
[ { "action": "no_action", "args": {} } ]
\`\`\`

### Persona Bridge
Whatever text you write inside the "commentary" field will be immediately sent to your Conversation Brain, which will vocalize it out loud to the player! Use this to talk trash, explain your moves, or react to the game!

### Game State & Logs
You will be fed with the game logs continuously. This is simply so that you know what is happening during the game, what the other player is doing, and to confirm if you did your actions correctly.
At the start of your turn, or when you RECEIVE PRIORITY on an opponent's turn, you will be given a summary of the board state.
If you have instants or flash cards in your hand, you CAN play them on the opponent's turn!`;

        const strategyOptions: GeminiStrategyOptions = {
            apiKey: this.options.apiKey,
            systemInstruction: systemInstruction,
            onText: (text) => {
                // Extract game commands from AI response
                const commands = GeminiStrategyClient.extractCommands(text);
                if (commands && commands.length > 0) {
                    console.log('Game Commands:', commands);
                    this.options.onGameCommand(commands);

                    // Bridge commentary to Conversation AI
                    const commentaries = commands.filter(c => c.commentary).map(c => c.commentary);
                    if (commentaries.length > 0 && this.conversationClient) {
                        this.conversationClient.sendGameEvent(`Voice the following exactly: "${commentaries.join(' ')}"`);
                    }
                }
            },
            onConnected: () => {
                this.options.onConnected?.();
            },
            onError: this.options.onError
        };

        this.strategyClient = new GeminiStrategyClient(strategyOptions);
    }

    /**
     * Initialize conversation AI for player interaction
     */
    private initializeConversation() {
        const conversationOptions: GeminiConversationOptions = {
            apiKey: this.options.apiKey,
            onAudioOutput: (audioData) => {
                // Audio responses are played by the conversation client
                console.log('Conversation Audio received:', audioData.length, 'bytes');
            },
            onConnected: () => {
                console.log('Conversation AI connected');
            },
            onError: this.options.onError
        };

        this.conversationClient = new GeminiConversationClient(conversationOptions);
    }

    /**
     * Send game state to strategy AI
     */
    public async sendGameState(gameState: string): Promise<void> {
        if (this.strategyClient) {
            await this.strategyClient.sendGameState(gameState);
        }
    }

    /**
     * Send game event to conversation AI for commentary
     */
    public sendGameEvent(eventDescription: string): void {
        if (this.conversationClient) {
            this.conversationClient.sendGameEvent(eventDescription);
        }
    }

    /**
     * Start/Stop microphone for talking to conversation AI
     */
    public async startMic(): Promise<void> {
        if (this.conversationClient) {
            await this.conversationClient.startMic();
        }
    }

    public stopMic(): void {
        if (this.conversationClient) {
            this.conversationClient.stopMic();
        }
    }

    /**
     * Connect both AI services
     */
    public async connectAll(): Promise<void> {
        const [strategy, conversation] = await Promise.all([
            this.strategyClient?.sendGameState('Initializing game...').catch(() => null),
            this.conversationClient?.connect().catch(() => null)
        ]);

        if (strategy) {
            this.options.onConnected?.();
        }
    }

    /**
     * Disconnect both AI services
     */
    public disconnect(): void {
        console.log('Disconnecting AI Manager...');
        this.strategyClient?.disconnect();
        this.conversationClient?.disconnect();
        this.strategyClient = null;
        this.conversationClient = null;
    }
}

export function generateDeckMarkdown(deck: import('../types').CardData[]): string {
    const counts: { [name: string]: { count: number, card: import('../types').CardData } } = {};
    for (const card of deck) {
        if (!counts[card.name]) {
            counts[card.name] = { count: 1, card };
        } else {
            counts[card.name].count++;
        }
    }

    let md = "# Deck Contents\n\n";
    for (const { count, card } of Object.values(counts)) {
        md += `## ${count}x ${card.name}\n`;
        md += `- **Cost:** ${card.manaCost || 'None'}\n`;
        md += `- **Type:** ${card.typeLine}\n`;
        if (card.power && card.toughness) md += `- **Stats:** ${card.power}/${card.toughness}\n`;
        if (card.oracleText) md += `- **Text:** ${card.oracleText.replace(/\n/g, ' ')}\n`;
        md += `\n`;
    }
    return md;
}

