import React, { useEffect, useState } from 'react';
import { X, Check, Loader, Bot, Eye, EyeOff } from 'lucide-react';
import { aiStatus, saveAiConfig, getLocalAiKeys, type AiStatus } from '../services/ai';
import { AI_PROVIDER_LABELS, type AiProviderId } from '../services/aiTypes';

interface Props {
    onClose: () => void;
}

// Home-screen settings for AI opponents. Keys are sent to the server and held in
// its memory only — they are never stored in the browser and never returned, so
// each field shows a "configured" badge rather than the secret itself.
export const AiSettingsModal: React.FC<Props> = ({ onClose }) => {
    const [status, setStatus] = useState<AiStatus | null>(null);
    const [anthropicKey, setAnthropicKey] = useState('');
    const [openaiKey, setOpenaiKey] = useState('');
    const [geminiKey, setGeminiKey] = useState('');
    const [defaultProvider, setDefaultProvider] = useState<AiProviderId | ''>('');
    const [adminPin, setAdminPin] = useState('');
    const [reveal, setReveal] = useState(false);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState('');
    const [saved, setSaved] = useState(false);
    
    const [mics, setMics] = useState<MediaDeviceInfo[]>([]);
    const [selectedMic, setSelectedMic] = useState(localStorage.getItem('planeswalker_mic_id') || '');

    const refresh = () => aiStatus().then(s => {
        const localKeys = getLocalAiKeys();
        const configured = {
            anthropic: !!localKeys.anthropic || s.configured?.anthropic || false,
            openai: !!localKeys.openai || s.configured?.openai || false,
            gemini: !!localKeys.gemini || s.configured?.gemini || false,
        };
        setStatus({ ...s, configured });
        setDefaultProvider(s.defaultProvider ?? '');
    }).catch(() => setStatus(null));

    useEffect(() => { 
        refresh(); 
        navigator.mediaDevices?.enumerateDevices().then(devices => {
            setMics(devices.filter(d => d.kind === 'audioinput'));
        }).catch(() => {});
    }, []);

    const configured = status?.configured || { anthropic: false, openai: false, gemini: false };

    const rows: { id: AiProviderId; key: string; set: (v: string) => void; on: boolean }[] = [
        { id: 'anthropic', key: anthropicKey, set: setAnthropicKey, on: configured.anthropic },
        { id: 'openai', key: openaiKey, set: setOpenaiKey, on: configured.openai },
        { id: 'gemini', key: geminiKey, set: setGeminiKey, on: configured.gemini },
    ];

    const save = async () => {
        setSaving(true); setError(''); setSaved(false);
        try {
            // Only send fields the user actually typed into (empty string = leave as-is).
            const s = await saveAiConfig({
                ...(anthropicKey ? { anthropicKey } : {}),
                ...(openaiKey ? { openaiKey } : {}),
                ...(geminiKey ? { geminiKey } : {}),
                defaultProvider: defaultProvider,
                ...(adminPin ? { adminPin } : {}),
            });
            setStatus(s);
            setDefaultProvider(s.defaultProvider ?? '');
            setAnthropicKey(''); setOpenaiKey(''); setGeminiKey('');
            localStorage.setItem('planeswalker_mic_id', selectedMic);
            setSaved(true);
            setTimeout(() => setSaved(false), 2500);
        } catch (e: any) {
            setError(e?.message || 'Failed to save settings');
        } finally {
            setSaving(false);
        }
    };

    const enabledProviders = rows.filter(r => r.on).map(r => r.id);

    return (
        <div className="fixed inset-0 z-[100] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4" onClick={onClose}>
            <div
                className="bg-gray-800 border border-gray-700 rounded-2xl shadow-2xl w-full max-w-md max-h-[90vh] overflow-y-auto custom-scrollbar"
                onClick={e => e.stopPropagation()}
            >
                <div className="flex items-center justify-between p-4 border-b border-gray-700 sticky top-0 bg-gray-800 z-10">
                    <h2 className="text-lg font-bold text-white flex items-center gap-2"><Bot size={20} className="text-orange-400" /> AI Opponent Settings</h2>
                    <button onClick={onClose} className="text-gray-400 hover:text-white p-1"><X size={20} /></button>
                </div>

                <div className="p-4 space-y-4">
                    <p className="text-xs text-gray-400">
                        Add an API key for any provider to enable AI opponents and voice negotiation. Keys are stored on the server only — never in your browser — and are never displayed back.
                    </p>

                    {rows.map(r => (
                        <div key={r.id}>
                            <label className="flex items-center justify-between text-xs font-semibold text-gray-300 uppercase tracking-wider mb-1.5">
                                <span>{AI_PROVIDER_LABELS[r.id]} API Key</span>
                                {r.on
                                    ? <span className="text-green-400 flex items-center gap-1 normal-case"><Check size={12} /> Configured</span>
                                    : <span className="text-gray-500 normal-case">Not set</span>}
                            </label>
                            <input
                                type={reveal ? 'text' : 'password'}
                                value={r.key}
                                onChange={e => r.set(e.target.value)}
                                placeholder={r.on ? 'Enter a new key to replace' : `Paste your ${AI_PROVIDER_LABELS[r.id]} key`}
                                autoComplete="off"
                                spellCheck={false}
                                className="w-full bg-gray-900 border border-gray-600 rounded-lg py-2 px-3 text-white text-sm focus:ring-2 focus:ring-orange-500 focus:outline-none"
                            />
                        </div>
                    ))}

                    <button onClick={() => setReveal(v => !v)} className="text-xs text-gray-400 hover:text-white flex items-center gap-1">
                        {reveal ? <EyeOff size={12} /> : <Eye size={12} />} {reveal ? 'Hide' : 'Show'} keys while typing
                    </button>

                    <div>
                        <label className="block text-xs font-semibold text-gray-300 uppercase tracking-wider mb-1.5">Default Provider</label>
                        <select
                            value={defaultProvider}
                            onChange={e => setDefaultProvider(e.target.value as AiProviderId | '')}
                            className="w-full bg-gray-900 border border-gray-600 rounded-lg py-2 px-3 text-white text-sm focus:ring-2 focus:ring-orange-500 focus:outline-none"
                        >
                            <option value="">Auto (first configured)</option>
                            {(['anthropic', 'openai', 'gemini'] as AiProviderId[]).map(id => (
                                <option key={id} value={id} disabled={!configured[id]}>
                                    {AI_PROVIDER_LABELS[id]}{configured[id] ? '' : ' (no key)'}
                                </option>
                            ))}
                        </select>
                    </div>

                    {mics.length > 0 && (
                        <div>
                            <label className="block text-xs font-semibold text-gray-300 uppercase tracking-wider mb-1.5">Microphone</label>
                            <select
                                value={selectedMic}
                                onChange={e => setSelectedMic(e.target.value)}
                                className="w-full bg-gray-900 border border-gray-600 rounded-lg py-2 px-3 text-white text-sm focus:ring-2 focus:ring-orange-500 focus:outline-none"
                            >
                                <option value="">System Default</option>
                                {mics.map(m => (
                                    <option key={m.deviceId} value={m.deviceId}>{m.label || `Microphone ${m.deviceId.slice(0, 5)}`}</option>
                                ))}
                            </select>
                        </div>
                    )}

                    <div>
                        <label className="block text-xs font-semibold text-gray-300 uppercase tracking-wider mb-1.5">Admin PIN <span className="text-gray-500 normal-case">(only if the server requires one)</span></label>
                        <input
                            type="password"
                            value={adminPin}
                            onChange={e => setAdminPin(e.target.value)}
                            placeholder="Leave blank unless set on the server"
                            autoComplete="off"
                            className="w-full bg-gray-900 border border-gray-600 rounded-lg py-2 px-3 text-white text-sm focus:ring-2 focus:ring-orange-500 focus:outline-none"
                        />
                    </div>

                    {error && <div className="text-red-400 text-xs bg-red-500/10 border border-red-500/30 rounded-lg p-2">{error}</div>}

                    <div className="flex items-center justify-between gap-3 pt-1">
                        <div className="text-xs text-gray-400">
                            {enabledProviders.length > 0
                                ? <span className="text-green-400">AI enabled ({enabledProviders.map(id => AI_PROVIDER_LABELS[id]).join(', ')})</span>
                                : <span>No providers configured yet</span>}
                        </div>
                        <button
                            onClick={save}
                            disabled={saving}
                            className="bg-orange-600 hover:bg-orange-500 disabled:opacity-50 text-white font-bold py-2 px-5 rounded-lg flex items-center gap-2 transition-colors"
                        >
                            {saving ? <Loader size={16} className="animate-spin" /> : saved ? <Check size={16} /> : null}
                            {saved ? 'Saved' : 'Save'}
                        </button>
                    </div>
                    <p className="text-[10px] text-gray-500">
                        Tip: keys set here last until the server restarts. For a permanent setup, set ANTHROPIC_API_KEY / OPENAI_API_KEY / GEMINI_API_KEY as environment variables.
                    </p>
                </div>
            </div>
        </div>
    );
};
