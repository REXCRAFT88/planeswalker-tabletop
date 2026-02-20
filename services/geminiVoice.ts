export interface GeminiLiveOptions {
    apiKey: string;
    systemInstruction: string;
    onText: (text: string) => void;
    onAudio: (audioData: Uint8Array) => void; // 24kHz PCM16
    onConnected?: () => void;
    onDisconnected?: (reason: string) => void;
    onError?: (error: any) => void;
    enableVoice?: boolean; // New: Enable voice responses for conversational feedback
}

export class GeminiLiveClient {
    private ws: WebSocket | null = null;
    private wsVoice: WebSocket | null = null; // New: Second connection for voice
    private options: GeminiLiveOptions;
    private audioContext: AudioContext | null = null;
    private mediaStream: MediaStream | null = null;
    private audioContextOutput: AudioContext | null = null;
    private nextPlayTime: number = 0;
    private processor: ScriptProcessorNode | AudioWorkletNode | null = null;
    private micSource: MediaStreamAudioSourceNode | null = null;
    private isMicActive: boolean = false;
    private currentConversation: Array<{role: string, content: string}> = []; // Track conversation for voice

    constructor(options: GeminiLiveOptions) {
        this.options = options;
    }

    public async connect(): Promise<void> {
        return new Promise((resolve, reject) => {
            try {
                // Main text connection for game commands
                const url = `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent?key=${this.options.apiKey}`;
                console.log("Connecting to Gemini Live WebSocket (Text)...");
                this.ws = new WebSocket(url);

                this.ws.onopen = () => {
                    console.log("Gemini Live WebSocket connected (Text).");
                    this.sendSetup();
                    this.initAudioOutput(); // Initialize audio output for voice responses
                    resolve();
                };

                this.ws.onmessage = (event) => {
                    this.handleMessage(event);
                };

                this.ws.onclose = (event) => {
                    console.log(`Gemini Live WebSocket closed. Code: ${event.code}, Reason: ${event.reason}`);
                    this.options.onDisconnected?.(`Closed with code ${event.code}: ${event.reason}`);
                };

                this.ws.onerror = (error) => {
                    console.error("Gemini Live WebSocket error:", error);
                    this.options.onError?.(error);
                    reject(error);
                };

                // Optional voice connection for conversational responses
                if (this.options.enableVoice) {
                    this.connectVoiceConnection();
                } else {
                    this.options.onConnected?.();
                }
            } catch (err) {
                console.error("Gemini Live connection attempt failed:", err);
                reject(err);
            }
        });
    }

    private async connectVoiceConnection(): Promise<void> {
        return new Promise((resolve, reject) => {
            try {
                const url = `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent?key=${this.options.apiKey}`;
                console.log("Connecting to Gemini Live WebSocket (Voice)...");
                this.wsVoice = new WebSocket(url);

                this.wsVoice.onopen = () => {
                    console.log("Gemini Live WebSocket connected (Voice).");
                    this.sendVoiceSetup();
                    this.options.onConnected?.();
                    resolve();
                };

                this.wsVoice.onmessage = (event) => {
                    this.handleVoiceMessage(event);
                };

                this.wsVoice.onclose = (event) => {
                    console.log(`Gemini Voice WebSocket closed. Code: ${event.code}, Reason: ${event.reason}`);
                };

                this.wsVoice.onerror = (error) => {
                    console.error("Gemini Voice WebSocket error:", error);
                    this.options.onError?.(error);
                    reject(error);
                };
            } catch (err) {
                console.error("Gemini Voice connection attempt failed:", err);
                reject(err);
            }
        });
    }

    public disconnect() {
        console.log("Disconnecting Gemini Live...");
        this.stopMic();

        // Close text connection
        if (this.ws) {
            this.ws.close();
            this.ws = null;
        }

        // Close voice connection
        if (this.wsVoice) {
            this.wsVoice.close();
            this.wsVoice = null;
        }

        if (this.audioContextOutput) {
            this.audioContextOutput.close();
            this.audioContextOutput = null;
        }
    }

    private sendSetup() {
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;

        console.log("Sending Gemini Setup message...");
        const setupMessage = {
            setup: {
                model: "models/gemini-2.5-flash-native-audio-preview-12-2025",
                generationConfig: {
                    responseModalities: ["TEXT"], // Only TEXT for text-based interaction
                    temperature: 0.7,
                    maxOutputTokens: 4096
                },
                systemInstruction: {
                    parts: [{ text: this.options.systemInstruction }]
                }
            }
        };
        this.ws.send(JSON.stringify(setupMessage));
    }

    private sendVoiceSetup() {
        if (!this.wsVoice || this.wsVoice.readyState !== WebSocket.OPEN) return;

        console.log("Sending Gemini Voice Setup message...");
        const setupMessage = {
            setup: {
                model: "models/gemini-2.5-flash-native-audio-preview-12-2025",
                generationConfig: {
                    responseModalities: ["AUDIO"], // AUDIO for voice responses
                    speechConfig: {
                        voiceConfig: {
                            prebuiltVoiceConfig: {
                                voiceName: "Aoede" // Friendly, conversational voice
                            }
                        }
                    }
                },
                systemInstruction: {
                    parts: [{
                        text: "You are a friendly, conversational AI assistant for a Magic: The Gathering game. Your role is to provide encouraging comments and brief strategic insights based on game events. Keep responses conversational and natural. Do not issue game commands or JSON - that's handled by the text connection."
                    }]
                }
            }
        };
        this.wsVoice.send(JSON.stringify(setupMessage));
    }

    private handleMessage(event: MessageEvent) {
        if (typeof event.data === "string") {
            try {
                const data = JSON.parse(event.data);

                // Handle text responses from main game connection
                if (data.serverContent?.modelTurn?.parts) {
                    for (const part of data.serverContent.modelTurn.parts) {
                        if (part.text) {
                            console.log("Gemini Response Text:", part.text);
                            this.options.onText(part.text);

                            // If voice is enabled, also send this to voice connection for conversational feedback
                            if (this.options.enableVoice && this.wsVoice?.readyState === WebSocket.OPEN) {
                                this.sendToVoiceConnection(part.text);
                            }
                        }
                    }
                }

                // Handle function calls (game actions)
                if (data.serverContent?.modelTurn?.parts) {
                    for (const part of data.serverContent.modelTurn.parts) {
                        if (part.functionCall) {
                            console.log("Gemini Function Call:", part.functionCall);
                            // This would be handled by the calling component
                        }
                    }
                }

                if (data.serverContent?.turnComplete) {
                    console.log("Gemini Turn Complete");
                }

                // Handle errors
                if (data.error) {
                    console.error("Gemini Error:", data.error);
                    this.options.onError?.(data.error);
                }
            } catch (e) {
                console.warn("Failed to parse Gemini message", e);
            }
        } else if (event.data instanceof Blob) {
            console.log("Gemini Message: Received Blob");
            const reader = new FileReader();
            reader.onload = () => {
                const text = reader.result as string;
                this.handleMessage({ data: text } as MessageEvent);
            };
            reader.readAsText(event.data);
        }
    }

    private handleVoiceMessage(event: MessageEvent) {
        if (typeof event.data === "string") {
            try {
                const data = JSON.parse(event.data);

                // Handle audio responses from voice connection
                if (data.serverContent?.modelTurn?.parts) {
                    for (const part of data.serverContent.modelTurn.parts) {
                        if (part.inlineData && part.inlineData.mimeType && part.inlineData.mimeType.startsWith('audio/')) {
                            const buffer = this.base64ToArrayBuffer(part.inlineData.data) as ArrayBuffer;
                            this.playAudioChunk(new Uint8Array(buffer));
                            this.options.onAudio(new Uint8Array(buffer));
                        }
                    }
                }

                // Handle text from voice connection (for logging/conversation tracking)
                if (data.serverContent?.modelTurn?.parts) {
                    for (const part of data.serverContent.modelTurn.parts) {
                        if (part.text) {
                            console.log("Voice Conversation:", part.text);
                            // Track conversation for context
                            this.currentConversation.push({ role: 'model', content: part.text });
                            // Keep conversation manageable
                            if (this.currentConversation.length > 10) {
                                this.currentConversation.shift();
                            }
                        }
                    }
                }

                if (data.error) {
                    console.error("Gemini Voice Error:", data.error);
                    this.options.onError?.(data.error);
                }
            } catch (e) {
                console.warn("Failed to parse Gemini voice message", e);
            }
        }
    }

    private sendToVoiceConnection(text: string) {
        if (!this.wsVoice || this.wsVoice.readyState !== WebSocket.OPEN) return;

        // Send game events to voice connection for conversational responses
        const msg = {
            clientContent: {
                turns: [{
                    role: "user",
                    parts: [{ text: `Game Event: ${text}` }]
                }],
                turnComplete: true
            }
        };
        this.wsVoice.send(JSON.stringify(msg));
    }

    public sendText(text: string) {
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
            console.warn("Cannot send text: Gemini WebSocket not open");
            return;
        }
        console.log("Sending text to Gemini:", text);
        const msg = {
            clientContent: {
                turns: [{
                    role: "user",
                    parts: [{ text }]
                }],
                turnComplete: true
            }
        };
        this.ws.send(JSON.stringify(msg));
    }

    private sendAudioChunk(pcm16Data: Uint8Array) {
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
        const base64 = this.arrayBufferToBase64(pcm16Data.buffer);
        const msg = {
            realtimeInput: {
                mediaChunks: [{
                    mimeType: "audio/pcm;rate=16000",
                    data: base64
                }]
            }
        };
        this.ws.send(JSON.stringify(msg));
    }

    public async startMic() {
        if (this.isMicActive) return;

        try {
            console.log("Initializing Microphone with AudioWorklet...");
            this.mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });

            // Re-use or create AudioContext for 16kHz
            this.audioContext = new AudioContext({ sampleRate: 16000 });
            await this.audioContext.resume();

            this.micSource = this.audioContext.createMediaStreamSource(this.mediaStream);

            // AudioWorklet approach to replace deprecated ScriptProcessorNode
            const workletCode = `
                class MicProcessor extends AudioWorkletProcessor {
                    process(inputs, outputs, parameters) {
                        const input = inputs[0];
                        if (input.length > 0 && input[0].length > 0) {
                            this.port.postMessage(input[0]);
                        }
                        return true;
                    }
                }
                registerProcessor('mic-processor', MicProcessor);
            `;

            const blob = new Blob([workletCode], { type: 'application/javascript' });
            const workletUrl = URL.createObjectURL(blob);

            await this.audioContext.audioWorklet.addModule(workletUrl);
            const workletNode = new AudioWorkletNode(this.audioContext, 'mic-processor');

            workletNode.port.onmessage = (e) => {
                if (!this.isMicActive) return;
                const inputData = e.data as Float32Array;
                const pcm16 = new Int16Array(inputData.length);
                for (let i = 0; i < inputData.length; i++) {
                    const s = Math.max(-1, Math.min(1, inputData[i]));
                    pcm16[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
                }
                this.sendAudioChunk(new Uint8Array(pcm16.buffer));
            };

            this.processor = workletNode;
            this.micSource.connect(this.processor);
            this.processor.connect(this.audioContext.destination);

            this.isMicActive = true;
            console.log("Microphone active.");
        } catch (e) {
            console.error("Failed to start mic:", e);
            this.options.onError?.(e);
        }
    }

    public stopMic() {
        if (!this.isMicActive) return;
        console.log("Stopping microphone.");
        this.isMicActive = false;

        if (this.processor) {
            this.processor.disconnect();
            this.processor = null;
        }
        if (this.micSource) {
            this.micSource.disconnect();
            this.micSource = null;
        }
        if (this.audioContext) {
            this.audioContext.close().catch(() => { });
            this.audioContext = null;
        }
        if (this.mediaStream) {
            this.mediaStream.getTracks().forEach(t => t.stop());
            this.mediaStream = null;
        }
    }

    private initAudioOutput() {
        this.audioContextOutput = new AudioContext({ sampleRate: 24000 });
        this.nextPlayTime = this.audioContextOutput.currentTime;
    }

    private async playAudioChunk(pcmData: Uint8Array) {
        if (!this.audioContextOutput) return;

        if (this.audioContextOutput.state === 'suspended') {
            await this.audioContextOutput.resume();
        }

        const int16Array = new Int16Array(pcmData.buffer, pcmData.byteOffset, pcmData.byteLength / 2);
        const audioBuffer = this.audioContextOutput.createBuffer(1, int16Array.length, 24000);
        const channelData = audioBuffer.getChannelData(0);

        for (let i = 0; i < int16Array.length; i++) {
            channelData[i] = int16Array[i] / 32768.0;
        }

        const source = this.audioContextOutput.createBufferSource();
        source.buffer = audioBuffer;
        source.connect(this.audioContextOutput.destination);

        // Ensure smooth playback
        if (this.nextPlayTime < this.audioContextOutput.currentTime) {
            this.nextPlayTime = this.audioContextOutput.currentTime + 0.05; // 50ms buffer
        }

        source.start(this.nextPlayTime);
        this.nextPlayTime += audioBuffer.duration;
    }

    // --- Helpers ---
    private arrayBufferToBase64(buffer: ArrayBufferLike): string {
        let binary = '';
        const bytes = new Uint8Array(buffer);
        const len = bytes.byteLength;
        for (let i = 0; i < len; i++) {
            binary += String.fromCharCode(bytes[i]);
        }
        return btoa(binary);
    }

    private base64ToArrayBuffer(base64: string): ArrayBufferLike {
        const binaryString = atob(base64);
        const len = binaryString.length;
        const bytes = new Uint8Array(len);
        for (let i = 0; i < len; i++) {
            bytes[i] = binaryString.charCodeAt(i);
        }
        return bytes.buffer;
    }
}
