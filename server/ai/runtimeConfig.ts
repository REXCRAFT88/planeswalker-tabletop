// In-memory AI configuration, settable at runtime from the home-screen settings
// page. These override the corresponding environment variables for THIS process
// only: they are never written to disk and never sent back to any client (the
// status endpoint reports booleans, not the secrets themselves). This lets users
// configure provider keys without a redeploy while keeping keys server-side, the
// same security posture as the env-var path.
const overrides: Record<string, string> = {};

// Resolve a config value: runtime override first, then the process environment.
export function getEnv(name: string): string | undefined {
    return overrides[name] ?? process.env[name];
}

export function isConfigured(name: string): boolean {
    return !!getEnv(name);
}

// Apply a batch of updates. An empty/null value clears the override (falling back
// to the env var, if any). Values are held in memory only.
export function setConfig(updates: Record<string, string | null | undefined>) {
    for (const [k, v] of Object.entries(updates)) {
        if (v === null || v === undefined || String(v).trim() === '') delete overrides[k];
        else overrides[k] = String(v).trim();
    }
}
