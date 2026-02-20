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
    private processor: ScriptProcessorNode | AudioWorkletNode | null = null;
    private micSource: MediaStreamAudioSourceNode | null = null;
    private isMicActive: boolean = false;

    constructor(options: GeminiLiveOptions) {
        this.options = options;
    }

    public async connect(): Promise<void> {
        return new Promise((resolve, reject) => {
            try {
                const url = `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent?key=${this.options.apiKey}`;
                console.log("Connecting to Gemini Live WebSocket...");
                this.ws = new WebSocket(url);

                this.ws.onopen = () => {
                    console.log("Gemini Live WebSocket connected.");
                    this.sendSetup();
                    this.options.onConnected?.();
                    this.initAudioOutput();
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
            } catch (err) {
                console.error("Gemini Live connection attempt failed:", err);
                reject(err);
            }
        });
    }

    public disconnect() {
        console.log("Disconnecting Gemini Live...");
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

        console.log("Sending Gemini Setup message...");
        const setupMessage = {
            setup: {
                model: "models/gemini-2.5-flash-native-audio-preview-12-2025",
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
                            console.log("Gemini Response Text:", part.text);
                            this.options.onText(part.text);
                        }
                        if (part.inlineData && part.inlineData.mimeType.startsWith('audio/pcm')) {
                            const buffer = this.base64ToArrayBuffer(part.inlineData.data) as ArrayBuffer;
                            this.playAudioChunk(new Uint8Array(buffer));
                            this.options.onAudio(new Uint8Array(buffer));
                        }
                    }
                }
                if (data.serverContent?.turnComplete) {
                    console.log("Gemini Turn Complete");
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
