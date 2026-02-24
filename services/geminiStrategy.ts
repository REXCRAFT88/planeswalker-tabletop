/**
 * Gemini Strategy AI Service
 * Uses REST API for text-based game strategy and command generation
 * Optimized for fast, reliable game interactions
 */

export interface GeminiStrategyOptions {
    apiKey: string;
    systemInstruction: string;
    onText: (text: string) => void;
    onConnected?: () => void;
    onError?: (error: any) => void;
}

export interface GameCommand {
    action: 'draw_card' | 'move_card' | 'tap_untap' | 'change_life' | 'add_counter' | 'mulligan' | 'pass_turn' | 'no_action';
    args: any;
    commentary?: string;
}

export class GeminiStrategyClient {
    private apiKey: string;
    private systemInstruction: string;
    private onText: (text: string) => void;
    private onConnected?: () => void;
    private onError?: (error: any) => void;
    private isConnecting: boolean = false;
    private lastRequestTime: number = 0;
    private requestQueue: Array<() => void> = [];
    private isProcessingQueue: boolean = false;

    constructor(options: GeminiStrategyOptions) {
        this.apiKey = options.apiKey;
        this.systemInstruction = options.systemInstruction;
        this.onText = options.onText;
        this.onConnected = options.onConnected;
        this.onError = options.onError;
    }

    /**
     * Send game state to AI and get strategic response
     */
    public async sendGameState(gameState: string): Promise<void> {
        // Rate limiting: Ensure at least 3 seconds between requests to avoid hitting API limits
        const now = Date.now();
        const timeSinceLastRequest = now - this.lastRequestTime;
        const minRequestInterval = 3000; // 3 seconds minimum between requests

        if (timeSinceLastRequest < minRequestInterval) {
            const delay = minRequestInterval - timeSinceLastRequest;
            console.log(`[Rate Limit] Throttling request for ${delay}ms`);
            return new Promise((resolve, reject) => {
                setTimeout(async () => {
                    try {
                        await this.executeRequest(gameState);
                        resolve();
                    } catch (error) {
                        reject(error);
                    }
                }, delay);
            });
        }

        return this.executeRequest(gameState);
    }

    private async executeRequest(gameState: string): Promise<void> {
        this.lastRequestTime = Date.now();

        try {
            // Using gemini-2.0-flash for general commands and large free tier limit
            const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${this.apiKey}`;

            const payload = {
                contents: [{
                    role: "user",
                    parts: [{
                        text: `${this.systemInstruction}\n\nCurrent Game State:\n${gameState}\n\nWhat action will you take? Respond with a JSON command in the format:\n\`\`\`json\n{\n  "action": "ACTION_TYPE",\n  "args": { ... }\n}\n\`\`\``
                    }]
                }],
                generationConfig: {
                    temperature: 0.7,
                    maxOutputTokens: 1024,
                    responseMimeType: "text/plain"
                }
            };

            const response = await fetch(url, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(payload)
            });

            if (!response.ok) {
                const errorData = await response.json();

                // Handle 429 rate limit specifically
                if (response.status === 429) {
                    console.warn('[Rate Limit] API quota exceeded. Retrying after delay...');
                    // Exponential backoff: wait longer on repeated 429s
                    const retryDelay = Math.min(10000 * Math.pow(2, this.requestQueue.length), 60000); // Up to 1 min
                    return new Promise((resolve, reject) => {
                        setTimeout(async () => {
                            try {
                                await this.executeRequest(gameState);
                                resolve();
                            } catch (error) {
                                reject(error);
                            }
                        }, retryDelay);
                    });
                }

                throw new Error(`API Error: ${JSON.stringify(errorData)}`);
            }

            const data = await response.json();

            if (data.candidates && data.candidates[0]?.content?.parts[0]?.text) {
                const aiResponse = data.candidates[0].content.parts[0].text;
                console.log('AI Strategy Response:', aiResponse);
                this.onText(aiResponse);
            } else {
                throw new Error('No valid response from AI');
            }

        } catch (error) {
            console.error('Strategy AI Error:', error);
            this.onError?.(error);
            throw error;
        }
    }

    /**
     * Extract JSON commands from AI response
     */
    public static extractCommands(response: string): GameCommand[] {
        const commands: GameCommand[] = [];
        // Match all json blocks
        const regex = /```json\n?([\s\S]*?)\n?```/gi;
        let match;
        while ((match = regex.exec(response)) !== null) {
            try {
                const parsed = JSON.parse(match[1]);
                if (Array.isArray(parsed)) {
                    commands.push(...parsed);
                } else {
                    commands.push(parsed);
                }
            } catch (e) {
                console.warn('Failed to parse JSON command block:', e);
            }
        }
        return commands;
    }

    public disconnect() {
        // No persistent connection to close
        console.log('Strategy AI disconnected');
    }
}
