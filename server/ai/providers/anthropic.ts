import Anthropic from '@anthropic-ai/sdk';
import type { LLMProvider, LLMRequest, LLMResult, NormMessage } from './types';
import { emptyUsage } from './types';
import type { AiToolCall } from '../../../services/aiTypes';
import { getEnv, isConfigured } from '../runtimeConfig';

const DEFAULT_MODEL = process.env.ANTHROPIC_MODEL || process.env.AI_MODEL || 'claude-3-5-sonnet-20241022';

// Rebuild the client when the key changes (e.g. set via the settings page).
let client: Anthropic | null = null;
let clientKey: string | undefined;
const getClient = (req?: LLMRequest) => {
    const key = req?.apiKeys?.anthropic || getEnv('ANTHROPIC_API_KEY');
    if (!client || clientKey !== key) { client = new Anthropic({ apiKey: key }); clientKey = key; }
    return client!;
};

export function toAnthropicMessages(msgs: NormMessage[]): any[] {
    return msgs.map(m => {
        if (m.role === 'user') return { role: 'user', content: m.text };
        if (m.role === 'assistant') {
            const content: any[] = [];
            if (m.text) content.push({ type: 'text', text: m.text });
            for (const tc of m.toolCalls || []) content.push({ type: 'tool_use', id: tc.id, name: tc.name, input: tc.input });
            return { role: 'assistant', content };
        }
        return {
            role: 'user',
            content: m.results.map(r => ({
                type: 'tool_result',
                tool_use_id: r.id,
                content: JSON.stringify({ ok: r.ok, error: r.error, detail: r.detail }),
                is_error: !r.ok,
            })),
        };
    });
}

export const anthropicProvider: LLMProvider = {
    id: 'anthropic',
    label: 'Claude',
    enabled: () => isConfigured('ANTHROPIC_API_KEY'),
    async generate(req: LLMRequest): Promise<LLMResult> {
        const body: any = {
            model: req.model || DEFAULT_MODEL,
            max_tokens: req.maxTokens ?? 8192,
            thinking: { type: 'adaptive' },
            output_config: { effort: req.effort ?? 'medium' },
            // Cache the large, stable system prefix across the turn's loop.
            system: [{ type: 'text', text: req.system, cache_control: { type: 'ephemeral' } }],
            tools: req.tools.map(t => ({ name: t.name, description: t.description, input_schema: t.input_schema })),
            messages: toAnthropicMessages(req.messages),
        };
        if (req.toolChoice) body.tool_choice = { type: 'tool', name: req.toolChoice };

        // Stream rather than block. Adaptive-thinking Opus turns can run for tens of
        // seconds; a non-streaming request holds the HTTP connection idle and gets
        // killed by hosting proxies (Render etc.) with a 502 before it finishes.
        // Streaming keeps bytes flowing so the connection stays alive, and we collect
        // the final message once complete.
        const stream = getClient(req).messages.stream(body);
        const resp: any = await stream.finalMessage();
        const content: any[] = resp.content || [];
        const toolCalls: AiToolCall[] = content
            .filter(b => b.type === 'tool_use')
            .map(b => ({ id: b.id, name: b.name, input: b.input }));
        const text = content.filter(b => b.type === 'text').map(b => b.text).join(' ').trim();
        return {
            text,
            toolCalls,
            done: resp.stop_reason !== 'tool_use',
            usage: {
                inputTokens: resp.usage?.input_tokens ?? 0,
                cacheReadTokens: resp.usage?.cache_read_input_tokens ?? 0,
                outputTokens: resp.usage?.output_tokens ?? 0,
            },
        };
    },
};

export { DEFAULT_MODEL as ANTHROPIC_DEFAULT_MODEL };
