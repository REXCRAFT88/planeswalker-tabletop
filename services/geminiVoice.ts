export interface GeminiLiveOptions {
    apiKey: string;
    systemInstruction: string;
    onText: (text: string) => void;
    onAudio: (audioData: Uint8Array) => void; // 24kHz PCM16
    onConnected?: () => void;
    onDisconnected?: (reason: string) => void;
    onError?: (error: any) => void;
}

export class GeminiLiveClient {
    private ws: WebSocket | null = null;
    private options: GeminiLiveOptions;
    private audioContext: AudioContext | null = null;
    private mediaStream: MediaStream | null = null;
    private audioContextOutput: AudioContext | null = null;
    private nextPlayTime: number = 0;
    private processor: ScriptProcessorNode | null = null;
    private micSource: MediaStreamAudioSourceNode | null = null;
    private isMicActive: boolean = false;

    constructor(options: GeminiLiveOptions) {
        this.options = options;
    }

    public async connect(): Promise<void> {
        return new Promise((resolve, reject) => {
            try {
                const url = `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContent?key=${this.options.apiKey}`;
                this.ws = new WebSocket(url);

                this.ws.onopen = () => {
                    this.sendSetup();
                    this.options.onConnected?.();
                    this.initAudioOutput();
                    resolve();
                };

                this.ws.onmessage = (event) => {
                    this.handleMessage(event);
                };

                this.ws.onclose = (event) => {
                    this.options.onDisconnected?.(`Closed with code ${event.code}: ${event.reason}`);
                };

                this.ws.onerror = (error) => {
                    this.options.onError?.(error);
                    reject(error);
                };
            } catch (err) {
                reject(err);
            }
        });
    }

    public disconnect() {
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

    private sendSetup() {
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;

        const setupMessage = {
            setup: {
                model: "models/gemini-2.0-flash",
                generationConfig: {
                    responseModalities: ["AUDIO", "TEXT"],
                    speechConfig: {
                        voiceConfig: {
                            prebuiltVoiceConfig: {
                                voiceName: "Aoede" // Other options: "Puck", "Charon", etc.
                            }
                        }
                    }
                },
                systemInstruction: {
                    parts: [{ text: this.options.systemInstruction }]
                }
            }
        };
        this.ws.send(JSON.stringify(setupMessage));
    }

    private handleMessage(event: MessageEvent) {
        if (typeof event.data === "string") {
            try {
                const data = JSON.parse(event.data);
                if (data.serverContent?.modelTurn?.parts) {
                    for (const part of data.serverContent.modelTurn.parts) {
                        if (part.text) {
                            this.options.onText(part.text);
                        }
                        if (part.inlineData && part.inlineData.mimeType.startsWith('audio/pcm')) {
                            const buffer = this.base64ToArrayBuffer(part.inlineData.data) as ArrayBuffer;
                            this.playAudioChunk(new Uint8Array(buffer));
                            this.options.onAudio(new Uint8Array(buffer));
                        }
                    }
                }
            } catch (e) {
                console.warn("Failed to parse Gemini message", e);
            }
        } else if (event.data instanceof Blob) {
            // Unlikely with the current API format (usually JSON string), but handle if binary
            const reader = new FileReader();
            reader.onload = () => {
                const text = reader.result as string;
                this.handleMessage({ data: text } as MessageEvent);
            };
            reader.readAsText(event.data);
        }
    }

    public sendText(text: string) {
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
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
            this.mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
            this.audioContext = new AudioContext({ sampleRate: 16000 });
            this.micSource = this.audioContext.createMediaStreamSource(this.mediaStream);

            // Use ScriptProcessorNode (deprecated but highly compatible) or AudioWorklet for simplicity here
            this.processor = this.audioContext.createScriptProcessor(4096, 1, 1);

            this.processor.onaudioprocess = (e) => {
                if (!this.isMicActive) return;
                const inputData = e.inputBuffer.getChannelData(0);
                const pcm16 = new Int16Array(inputData.length);
                for (let i = 0; i < inputData.length; i++) {
                    const s = Math.max(-1, Math.min(1, inputData[i]));
                    pcm16[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
                }
                this.sendAudioChunk(new Uint8Array(pcm16.buffer));
            };

            this.micSource.connect(this.processor);
            this.processor.connect(this.audioContext.destination);
            this.isMicActive = true;
        } catch (e) {
            console.error("Failed to start mic:", e);
            this.options.onError?.(e);
        }
    }

    public stopMic() {
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
            this.audioContext.close();
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

    private playAudioChunk(pcmData: Uint8Array) {
        if (!this.audioContextOutput) return;

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
