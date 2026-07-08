import Anthropic from '@anthropic-ai/sdk';
import type { AiToolCall, AiUsage } from '../../services/aiTypes';

const MODEL = process.env.AI_MODEL || 'claude-opus-4-8';

let client: Anthropic | null = null;

// The SDK reads ANTHROPIC_API_KEY from the environment. We construct the client
// lazily so an unset key doesn't throw at import time — it just means AI is off.
export function aiEnabled(): boolean {
    return !!process.env.ANTHROPIC_API_KEY;
}

function getClient(): Anthropic {
    if (!client) client = new Anthropic();
    return client;
}

export interface ClaudeCallParams {
    system: string;
    messages: any[];
    tools: any[];
    effort?: 'low' | 'medium' | 'high';
    toolChoice?: any;
    maxTokens?: number;
}

export interface ClaudeCallResult {
    content: any[];          // raw response content blocks (assistant turn)
    stopReason: string | null;
    toolCalls: AiToolCall[];
    text: string;
    usage: AiUsage;
}

// One round-trip to Claude. System prompt gets a cache breakpoint so the large,
// stable persona + decklist prefix is cheap to re-read across the turn's loop.
export async function callClaude(params: ClaudeCallParams): Promise<ClaudeCallResult> {
    const req: any = {
        model: MODEL,
        max_tokens: params.maxTokens ?? 8192,
        thinking: { type: 'adaptive' },
        output_config: { effort: params.effort ?? 'medium' },
        system: [{ type: 'text', text: params.system, cache_control: { type: 'ephemeral' } }],
        tools: params.tools,
        messages: params.messages,
    };
    if (params.toolChoice) req.tool_choice = params.toolChoice;

    const resp: any = await getClient().messages.create(req);

    const content: any[] = resp.content || [];
    const toolCalls: AiToolCall[] = content
        .filter(b => b.type === 'tool_use')
        .map(b => ({ id: b.id, name: b.name, input: b.input }));
    const text = content
        .filter(b => b.type === 'text')
        .map(b => b.text)
        .join(' ')
        .trim();

    const usage: AiUsage = {
        inputTokens: resp.usage?.input_tokens ?? 0,
        cacheReadTokens: resp.usage?.cache_read_input_tokens ?? 0,
        outputTokens: resp.usage?.output_tokens ?? 0,
    };

    return { content, stopReason: resp.stop_reason ?? null, toolCalls, text, usage };
}
