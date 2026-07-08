import OpenAI from 'openai';
import type { LLMProvider, LLMRequest, LLMResult, NormMessage } from './types';
import { safeParseJson } from './types';
import type { AiToolCall } from '../../../services/aiTypes';

const DEFAULT_MODEL = process.env.OPENAI_MODEL || 'gpt-4o';

let client: OpenAI | null = null;
const getClient = () => (client ||= new OpenAI());

// Reasoning models (o-series, gpt-5) take reasoning_effort + max_completion_tokens
// and reject temperature; classic chat models take temperature + max_tokens.
const isReasoningModel = (m: string) => /^o\d/.test(m) || /gpt-5/.test(m);

export function toOpenAIMessages(system: string, msgs: NormMessage[]): any[] {
    const out: any[] = [{ role: 'system', content: system }];
    for (const m of msgs) {
        if (m.role === 'user') {
            out.push({ role: 'user', content: m.text });
        } else if (m.role === 'assistant') {
            const msg: any = { role: 'assistant', content: m.text || null };
            if (m.toolCalls?.length) {
                msg.tool_calls = m.toolCalls.map(tc => ({
                    id: tc.id, type: 'function',
                    function: { name: tc.name, arguments: JSON.stringify(tc.input ?? {}) },
                }));
            }
            out.push(msg);
        } else {
            for (const r of m.results) {
                out.push({ role: 'tool', tool_call_id: r.id, content: JSON.stringify({ ok: r.ok, error: r.error, detail: r.detail }) });
            }
        }
    }
    return out;
}

export const openaiProvider: LLMProvider = {
    id: 'openai',
    label: 'ChatGPT',
    enabled: () => !!process.env.OPENAI_API_KEY,
    async generate(req: LLMRequest): Promise<LLMResult> {
        const model = DEFAULT_MODEL;
        const body: any = {
            model,
            messages: toOpenAIMessages(req.system, req.messages),
            tools: req.tools.map(t => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.input_schema } })),
        };
        if (req.toolChoice) body.tool_choice = { type: 'function', function: { name: req.toolChoice } };

        if (isReasoningModel(model)) {
            body.max_completion_tokens = req.maxTokens ?? 8192;
            body.reasoning_effort = req.effort ?? 'medium';
        } else {
            body.max_tokens = req.maxTokens ?? 4096;
            body.temperature = req.effort === 'high' ? 0.4 : req.effort === 'low' ? 1.0 : 0.8;
        }

        const resp: any = await getClient().chat.completions.create(body);
        const choice = resp.choices?.[0];
        const msg = choice?.message || {};
        const toolCalls: AiToolCall[] = (msg.tool_calls || [])
            .filter((tc: any) => tc.type === 'function')
            .map((tc: any) => ({ id: tc.id, name: tc.function.name, input: safeParseJson(tc.function.arguments) }));
        const text = (msg.content || '').trim();
        return {
            text,
            toolCalls,
            done: choice?.finish_reason !== 'tool_calls',
            usage: {
                inputTokens: resp.usage?.prompt_tokens ?? 0,
                cacheReadTokens: resp.usage?.prompt_tokens_details?.cached_tokens ?? 0,
                outputTokens: resp.usage?.completion_tokens ?? 0,
            },
        };
    },
};
