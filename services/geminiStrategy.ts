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
    action: 'draw_card' | 'move_card' | 'tap_untap' | 'change_life' | 'add_counter' | 'mulligan' | 'pass_turn';
    args: any;
}

export class GeminiStrategyClient {
    private apiKey: string;
    private systemInstruction: string;
    private onText: (text: string) => void;
    private onConnected?: () => void;
    private onError?: (error: any) => void;
    private isConnecting: boolean = false;

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
        try {
            const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${this.apiKey}`;

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
     * Extract JSON command from AI response
     */
    public static extractCommand(response: string): GameCommand | null {
        // Try to find JSON in markdown code blocks
        const jsonMatch = response.match(/```json\n?([\s\S]*?)\n?```/i);
        if (jsonMatch && jsonMatch[1]) {
            try {
                return JSON.parse(jsonMatch[1]);
            } catch (e) {
                console.warn('Failed to parse JSON command:', e);
            }
        }
        return null;
    }

    public disconnect() {
        // No persistent connection to close
        console.log('Strategy AI disconnected');
    }
}
