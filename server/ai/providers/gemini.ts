import { GoogleGenerativeAI } from '@google/generative-ai';
import type { LLMProvider, LLMRequest, LLMResult, NormMessage } from './types';
import { stripUnsupportedSchema } from './types';
import type { AiToolCall } from '../../../services/aiTypes';
import { getEnv } from '../runtimeConfig';

const DEFAULT_MODEL = process.env.GEMINI_MODEL || 'gemini-2.0-flash';
const getKey = (req?: LLMRequest) => req?.apiKeys?.gemini || getEnv('GEMINI_API_KEY') || getEnv('GOOGLE_API_KEY') || '';

// Gemini function calls carry no ids. We encode the function name into the synthetic
// tool-call id ("name##index") so we can supply it back on the functionResponse.
const geminiId = (name: string, i: number) => `${name}##${i}`;
const nameFromId = (id: string) => id.split('##')[0];

export function toGeminiContents(msgs: NormMessage[]): any[] {
    const contents: any[] = [];
    for (const m of msgs) {
        if (m.role === 'user') {
            contents.push({ role: 'user', parts: [{ text: m.text }] });
        } else if (m.role === 'assistant') {
            const parts: any[] = [];
            if (m.text) parts.push({ text: m.text });
            for (const tc of m.toolCalls || []) parts.push({ functionCall: { name: tc.name, args: tc.input ?? {} } });
            if (parts.length) contents.push({ role: 'model', parts });
        } else {
            contents.push({
                role: 'user',
                parts: m.results.map(r => ({
                    functionResponse: { name: nameFromId(r.id), response: { ok: r.ok, error: r.error, detail: r.detail } },
                })),
            });
        }
    }
    return contents;
}

export const geminiProvider: LLMProvider = {
    id: 'gemini',
    label: 'Gemini',
    enabled: () => !!getKey(),
    async generate(req: LLMRequest): Promise<LLMResult> {
        const genAI = new GoogleGenerativeAI(getKey(req));
        const tools = [{
            functionDeclarations: req.tools.map(t => ({
                name: t.name,
                description: t.description,
                parameters: stripUnsupportedSchema(t.input_schema),
            })),
        }];
        const toolConfig = req.toolChoice
            ? { functionCallingConfig: { mode: 'ANY' as const, allowedFunctionNames: [req.toolChoice] } }
            : { functionCallingConfig: { mode: 'AUTO' as const } };

        const isReasoning = (req.model || DEFAULT_MODEL).includes('thinking');
        const model = genAI.getGenerativeModel({
            model: req.model || DEFAULT_MODEL,
            systemInstruction: req.system,
            tools: isReasoning ? [] : tools as any,
            toolConfig: isReasoning ? undefined : toolConfig as any,
        });

        const result = await model.generateContent({ contents: toGeminiContents(req.messages) });
        const resp: any = result.response;
        const parts: any[] = resp?.candidates?.[0]?.content?.parts || [];
        let fnIdx = 0;
        const toolCalls: AiToolCall[] = parts
            .filter(p => p.functionCall)
            .map(p => ({ id: geminiId(p.functionCall.name, fnIdx++), name: p.functionCall.name, input: p.functionCall.args || {} }));
        const text = parts.filter(p => typeof p.text === 'string').map(p => p.text).join(' ').trim();
        return {
            text,
            toolCalls,
            done: toolCalls.length === 0,
            usage: {
                inputTokens: resp?.usageMetadata?.promptTokenCount ?? 0,
                cacheReadTokens: resp?.usageMetadata?.cachedContentTokenCount ?? 0,
                outputTokens: resp?.usageMetadata?.candidatesTokenCount ?? 0,
            },
        };
    },
};
