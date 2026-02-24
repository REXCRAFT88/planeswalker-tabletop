/**
 * Gemini Conversation AI Service
 * Uses Live API for conversational voice interaction with players
 * Handles real-time audio input/output for chatting with the AI
 */

export interface GeminiConversationOptions {
    apiKey: string;
    onAudioOutput: (audioData: Uint8Array) => void;
    onConnected?: () => void;
    onDisconnected?: (reason: string) => void;
    onError?: (error: any) => void;
    selectedVoice?: string;
}

export class GeminiConversationClient {
    private ws: WebSocket | null = null;
    private apiKey: string;
    private onAudioOutput: (audioData: Uint8Array) => void;
    private onConnected?: () => void;
    private onDisconnected?: (reason: string) => void;
    private onError?: (error: any) => void;
    private audioContextOutput: AudioContext | null = null;
    private nextPlayTime: number = 0;
    private mediaStream: MediaStream | null = null;
    private processor: ScriptProcessorNode | AudioWorkletNode | null = null;
    private micSource: MediaStreamAudioSourceNode | null = null;
    private isMicActive: boolean = false;
    private selectedVoice: string;
    private lastEventTime: number = 0;
    private eventQueue: Array<string> = [];

    constructor(options: GeminiConversationOptions) {
        this.apiKey = options.apiKey;
        this.onAudioOutput = options.onAudioOutput;
        this.onConnected = options.onConnected;
        this.onDisconnected = options.onDisconnected;
        this.onError = options.onError;
        this.selectedVoice = options.selectedVoice || "Aoede";
    }

    /**
     * Connect to Gemini Live API for voice conversation
     */
    public async connect(): Promise<void> {
        return new Promise((resolve, reject) => {
            try {
                const url = `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent?key=${this.apiKey}`;
                console.log("Connecting to Gemini Conversation WebSocket...");
                this.ws = new WebSocket(url);

                this.ws.onopen = () => {
                    console.log("Gemini Conversation WebSocket connected.");
                    this.sendSetup();
                    this.initAudioOutput();
                    this.onConnected?.();
                    resolve();
                };

                this.ws.onmessage = (event) => {
                    this.handleMessage(event);
                };

                this.ws.onclose = (event) => {
                    console.log(`Gemini Conversation WebSocket closed. Code: ${event.code}, Reason: ${event.reason}`);
                    this.onDisconnected?.(`Closed with code ${event.code}: ${event.reason}`);
                };

                this.ws.onerror = (error) => {
                    console.error("Gemini Conversation WebSocket error:", error);
                    this.onError?.(error);
                    reject(error);
                };
            } catch (err) {
                console.error("Gemini Conversation connection attempt failed:", err);
                reject(err);
            }
        });
    }

    /**
     * Setup voice connection with audio output configuration
     */
    private sendSetup() {
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;

        console.log("Sending Gemini Conversation Setup message...");
        const setupMessage = {
            setup: {
                model: "models/gemini-2.0-flash", // Using 2.0-flash for audio support and large free tier limit
                generationConfig: {
                    responseModalities: ["AUDIO"], // Audio responses only
                    speechConfig: {
                        voiceConfig: {
                            prebuiltVoiceConfig: {
                                voiceName: this.selectedVoice // Configurable voice
                            }
                        }
                    }
                },
                systemInstruction: {
                    parts: [{
                        text: "You are a friendly, conversational AI assistant for a Magic: The Gathering game. Your role is to speak to the player with game commentary and engage in conversation. Keep responses natural and conversational, but brief (1-2 sentences max). When you receive a game event or commentary, SPEAK IT ALOUD to the player in a natural way."
                    }]
                }
            }
        };
        this.ws.send(JSON.stringify(setupMessage));
    }

    /**
     * Handle incoming messages from Gemini
     */
    private handleMessage(event: MessageEvent) {
        if (typeof event.data === "string") {
            try {
                const data = JSON.parse(event.data);

                // Handle audio responses
                if (data.serverContent?.modelTurn?.parts) {
                    for (const part of data.serverContent.modelTurn.parts) {
                        if (part.inlineData && part.inlineData.mimeType && part.inlineData.mimeType.startsWith('audio/')) {
                            const buffer = this.base64ToArrayBuffer(part.inlineData.data) as ArrayBuffer;
                            const audioData = new Uint8Array(buffer);
                            this.playAudioChunk(audioData);
                            this.onAudioOutput(audioData);
                        }
                    }
                }

                // Handle errors
                if (data.error) {
                    console.error("Gemini Conversation Error:", data.error);
                    this.onError?.(data.error);
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

    /**
     * Send game event to conversation AI for commentary
     */
    public sendGameEvent(eventDescription: string) {
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;

        // Rate limiting: Don't send events too frequently
        const now = Date.now();
        const timeSinceLastEvent = now - this.lastEventTime;
        const minEventInterval = 2000; // 2 seconds minimum between events

        if (timeSinceLastEvent < minEventInterval) {
            // Skip this event to prevent spamming the AI
            console.log('[Conversation Rate Limit] Skipping event, too soon after previous one');
            return;
        }

        this.lastEventTime = now;
        console.log('[Conversation] Sending event:', eventDescription);

        const msg = {
            clientContent: {
                turns: [{
                    role: "user",
                    parts: [{
                        text: eventDescription
                    }]
                }],
                turnComplete: true
            }
        };
        this.ws.send(JSON.stringify(msg));
    }

    /**
     * Audio input methods for talking to AI
     */
    public async startMic(): Promise<void> {
        if (this.isMicActive) return;

        try {
            console.log("Starting microphone for conversation...");
            this.mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });

            const audioContext = new AudioContext({ sampleRate: 16000 });
            await audioContext.resume();

            this.micSource = audioContext.createMediaStreamSource(this.mediaStream);

            // AudioWorklet approach
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

            await audioContext.audioWorklet.addModule(workletUrl);
            const workletNode = new AudioWorkletNode(audioContext, 'mic-processor');

            workletNode.port.onmessage = (e) => {
                if (!this.isMicActive) return;
                const inputData = e.data as Float32Array;
                this.sendAudioChunk(inputData);
            };

            this.micSource.connect(workletNode);
            this.processor = workletNode;

            this.isMicActive = true;
            console.log("Conversation microphone active.");
        } catch (e) {
            console.error("Failed to start conversation mic:", e);
            this.onError?.(e);
        }
    }

    public stopMic() {
        if (!this.isMicActive) return;
        console.log("Stopping conversation microphone.");

        if (this.processor) {
            this.processor.disconnect();
            this.processor = null;
        }
        if (this.micSource) {
            this.micSource.disconnect();
            this.micSource = null;
        }
        if (this.mediaStream) {
            this.mediaStream.getTracks().forEach(t => t.stop());
            this.mediaStream = null;
        }
        this.isMicActive = false;
    }

    private sendAudioChunk(pcm16Data: Float32Array) {
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;

        // Convert to 16-bit PCM
        const pcm16 = new Int16Array(pcm16Data.length);
        for (let i = 0; i < pcm16Data.length; i++) {
            const s = Math.max(-1, Math.min(1, pcm16Data[i]));
            pcm16[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
        }

        const base64 = this.arrayBufferToBase64(pcm16.buffer);
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

    private initAudioOutput() {
        this.audioContextOutput = new AudioContext({ sampleRate: 24000 });
        this.nextPlayTime = this.audioContextOutput.currentTime;
    }

    private playAudioChunk(pcmData: Uint8Array) {
        if (!this.audioContextOutput) return;

        if (this.audioContextOutput.state === 'suspended') {
            this.audioContextOutput.resume();
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

        // Smooth playback
        if (this.nextPlayTime < this.audioContextOutput.currentTime) {
            this.nextPlayTime = this.audioContextOutput.currentTime + 0.05;
        }

        source.start(this.nextPlayTime);
        this.nextPlayTime += audioBuffer.duration;
    }

    public disconnect() {
        console.log("Disconnecting Gemini Conversation...");
        this.stopMic();

        if (this.ws) {
            this.ws.close();
            this.ws = null;
        }
        if (this.audioContextOutput) {
            this.audioContextOutput.close();
            this.audioContextOutput = null;
        }
    }

    // --- Helpers ---
    private arrayBufferToBase64(buffer: ArrayBufferLike): string {
        let binary = '';
        const bytes = new Uint8Array(buffer);
        for (let i = 0; i < bytes.byteLength; i++) {
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
