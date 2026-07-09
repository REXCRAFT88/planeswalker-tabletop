// Provider-agnostic LLM interface. The router speaks this normalized shape; each
// provider adapter converts to/from its own wire format. This lets the AI "brain"
// run on Claude, OpenAI, or Gemini with identical calling code.
import type { AiToolCall, AiToolResult, AiUsage, AiProviderId } from '../../../services/aiTypes';

export type { AiProviderId };

// A normalized conversation turn.
export type NormMessage =
    | { role: 'user'; text: string }
    | { role: 'assistant'; text?: string; toolCalls?: AiToolCall[] }
    | { role: 'tool_results'; results: AiToolResult[] };

export interface NormTool {
    name: string;
    description: string;
    input_schema: any; // JSON Schema (object)
}

export interface LLMRequest {
    system: string;
    messages: NormMessage[];
    tools: NormTool[];
    effort?: 'low' | 'medium' | 'high';
    toolChoice?: string; // force a specific tool by name (used for mulligan)
    maxTokens?: number;
    apiKeys?: Record<string, string>;
    model?: string;
}

export interface LLMResult {
    text: string;
    toolCalls: AiToolCall[];
    done: boolean; // true when the model stopped without requesting tool calls
    usage: AiUsage;
}

export interface LLMProvider {
    id: AiProviderId;
    label: string;
    enabled(): boolean;
    generate(req: LLMRequest): Promise<LLMResult>;
}

export const emptyUsage = (): AiUsage => ({ inputTokens: 0, cacheReadTokens: 0, outputTokens: 0 });

// Remove JSON Schema keywords some providers reject (e.g. Gemini doesn't accept
// additionalProperties). Recurses through nested object/array schemas.
export function stripUnsupportedSchema(schema: any): any {
    if (Array.isArray(schema)) return schema.map(stripUnsupportedSchema);
    if (schema && typeof schema === 'object') {
        const out: any = {};
        for (const [k, v] of Object.entries(schema)) {
            if (k === 'additionalProperties') continue;
            out[k] = stripUnsupportedSchema(v);
        }
        return out;
    }
    return schema;
}

export function safeParseJson(s: string): any {
    try { return JSON.parse(s); } catch { return {}; }
}
