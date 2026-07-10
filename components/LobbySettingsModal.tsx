import React, { useState, useEffect } from "react";
import { X, Keyboard, Volume2, Palette, ChevronRight, Archive, Trash2 } from "lucide-react";
import { KEY_ACTIONS, defaultKeyBindings, KEYBINDINGS_STORAGE, keyLabel } from "../keybindings";
import { AppearanceSettingsModal } from "./AppearanceSettingsModal";

export const LobbySettingsModal = ({ onClose }: { onClose: () => void }) => {
    const [showShortcuts, setShowShortcuts] = useState(false);
    const [showCustomizeModal, setShowCustomizeModal] = useState(false);
    const [rebindingActionId, setRebindingActionId] = useState<string | null>(null);
    const [keyBindings, setKeyBindings] = useState<Record<string, string>>(() => {
        const defaults = defaultKeyBindings();
        try {
            return { ...defaults, ...JSON.parse(localStorage.getItem(KEYBINDINGS_STORAGE) || "{}") };
        } catch { return defaults; }
    });
    const [controlMode, setControlMode] = useState<"auto" | "mobile">(() => (localStorage.getItem("planeswalker_control_mode") as any) || "auto");
    const [soundMuted, setSoundMuted] = useState(() => localStorage.getItem("planeswalker_mute_sound") === "true");
    const [storageUsage, setStorageUsage] = useState({ total: 0, max: 5 * 1024 * 1024, pct: 0, color: "bg-blue-500" });

    useEffect(() => {
        let total = 0;
        for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            if (key) total += (localStorage.getItem(key)?.length || 0) * 2;
        }
        const max = 5 * 1024 * 1024;
        const pct = Math.min(100, Math.max(0, (total / max) * 100));
        setStorageUsage({ total, max, pct, color: pct > 90 ? "bg-red-500" : pct > 70 ? "bg-yellow-500" : "bg-blue-500" });
    }, []);

    useEffect(() => { localStorage.setItem("planeswalker_control_mode", controlMode); }, [controlMode]);
    useEffect(() => { localStorage.setItem("planeswalker_mute_sound", String(soundMuted)); }, [soundMuted]);
    useEffect(() => { localStorage.setItem(KEYBINDINGS_STORAGE, JSON.stringify(keyBindings)); }, [keyBindings]);

    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (!rebindingActionId) return;
            e.preventDefault();
            const k = e.key === " " ? " " : e.key.toLowerCase();
            if (k === "escape") { setRebindingActionId(null); return; }
            if (["shift", "control", "alt", "meta"].includes(k)) return;
            if (k === " " || k === "tab") return;
            setKeyBindings(prev => {
                const next = { ...prev };
                Object.keys(next).forEach(keyId => { if (next[keyId] === k) next[keyId] = ""; });
                next[rebindingActionId] = k;
                return next;
            });
            setRebindingActionId(null);
        };
        window.addEventListener("keydown", handleKeyDown);
        return () => window.removeEventListener("keydown", handleKeyDown);
    }, [rebindingActionId]);

    const handleClearBackups = () => {
        Object.keys(localStorage).forEach(key => {
            if (key.startsWith("planeswalker_backup_")) localStorage.removeItem(key);
        });
        setStorageUsage(prev => ({ ...prev, total: 0, pct: 0, color: "bg-blue-500" }));
        alert("Memory cleanup complete: all old backups removed.");
    };

    if (showCustomizeModal) return <AppearanceSettingsModal onClose={() => setShowCustomizeModal(false)} />;

    if (showShortcuts) return (
        <div className="fixed inset-0 z-[11000] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4" onClick={() => { setShowShortcuts(false); setRebindingActionId(null); }}>
            <div className="bg-gray-800 border border-gray-600 rounded-xl p-6 shadow-2xl max-w-lg w-full max-h-[90vh] flex flex-col animate-in zoom-in-95" onClick={e => e.stopPropagation()}>
                <div className="flex justify-between items-center mb-4">
                    <h3 className="text-xl font-bold text-white flex items-center gap-2"><Keyboard className="text-blue-400" /> Controls</h3>
                    <button onClick={() => { setShowShortcuts(false); setRebindingActionId(null); }} className="text-gray-400 hover:text-white"><X size={20} /></button>
                </div>
                <p className="text-xs text-gray-400 mb-4">Click a key to rebind it. Press the new key, or <kbd className="bg-black/40 px-1 rounded">Esc</kbd> to cancel. Assigning a key already in use clears it from the other action.</p>
                <div className="flex-1 overflow-y-auto custom-scrollbar pr-1 space-y-4">
                    {["Board", "Turn", "Zones", "Panels"].map(group => (
                        <div key={group}>
                            <div className="text-xs text-gray-500 font-bold uppercase mb-1.5">{group}</div>
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-sm">
                                {KEY_ACTIONS.filter(a => a.group === group).map(a => {
                                    const isRebinding = rebindingActionId === a.id;
                                    const key = keyBindings[a.id];
                                    return (
                                        <div key={a.id} className="flex justify-between items-center gap-2 p-2 bg-gray-700/50 rounded">
                                            <span className="text-gray-300 truncate">{a.label}</span>
                                            <button
                                                onClick={() => setRebindingActionId(isRebinding ? null : a.id)}
                                                className={`min-w-[3rem] px-2 py-1 rounded font-mono text-sm border shrink-0 transition-colors ${isRebinding ? "bg-blue-600 border-blue-400 text-white animate-pulse" : key ? "bg-black/50 border-gray-600 text-white hover:border-blue-400" : "bg-red-900/40 border-red-800 text-red-300 hover:border-red-500"}`}
                                            >
                                                {isRebinding ? "Press..." : keyLabel(key)}
                                            </button>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    ))}
                    <div>
                        <div className="text-xs text-gray-500 font-bold uppercase mb-1.5">Fixed</div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-sm">
                            <div className="flex justify-between items-center p-2 bg-gray-700/50 rounded"><span className="text-gray-300">Pan camera</span><kbd className="bg-black/50 px-2 py-1 rounded text-white font-mono border border-gray-600 text-xs">Right / Mid / Space-drag</kbd></div>
                            <div className="flex justify-between items-center p-2 bg-gray-700/50 rounded"><span className="text-gray-300">Zoom camera</span><kbd className="bg-black/50 px-2 py-1 rounded text-white font-mono border border-gray-600">Wheel</kbd></div>
                            <div className="flex justify-between items-center p-2 bg-gray-700/50 rounded"><span className="text-gray-300">Play hand card</span><kbd className="bg-black/50 px-2 py-1 rounded text-white font-mono border border-gray-600">1 - 0</kbd></div>
                            <div className="flex justify-between items-center p-2 bg-gray-700/50 rounded"><span className="text-gray-300">Switch opponent</span><kbd className="bg-black/50 px-2 py-1 rounded text-white font-mono border border-gray-600">Left / Right</kbd></div>
                        </div>
                    </div>
                </div>
                <div className="mt-4 pt-4 border-t border-gray-700 flex justify-end"><button onClick={() => setKeyBindings(defaultKeyBindings())} className="text-sm text-gray-400 hover:text-white underline">Reset to defaults</button></div>
            </div>
        </div>
    );

    return (
        <div className="fixed inset-0 z-[12000] bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in">
            <div className="bg-gray-800 border border-gray-600 rounded-xl p-6 shadow-2xl max-w-md w-full">
                <div className="flex justify-between items-center mb-6">
                    <h3 className="text-xl font-bold text-white flex items-center gap-2">Settings</h3>
                    <button onClick={onClose} className="text-gray-400 hover:text-white"><X size={20} /></button>
                </div>
                <div className="space-y-4">
                    <div className="bg-gray-700/50 p-4 rounded-lg border border-gray-600">
                        <label className="flex justify-between items-center cursor-pointer">
                            <div><h4 className="font-bold text-white">Force Mobile Controls</h4><p className="text-xs text-gray-400">Enable touch-friendly controls on desktop.</p></div>
                            <div onClick={() => setControlMode(prev => prev === "auto" ? "mobile" : "auto")} className={`w-14 h-8 rounded-full p-1 flex items-center transition-colors ${controlMode === "mobile" ? "bg-blue-600 justify-end" : "bg-gray-600 justify-start"}`}><div className="w-6 h-6 bg-white rounded-full shadow-md" /></div>
                        </label>
                    </div>
                    <div className="bg-gray-700/50 p-4 rounded-lg border border-gray-600">
                        <label className="flex justify-between items-center cursor-pointer">
                            <div><h4 className="font-bold text-white flex items-center gap-2"><Volume2 size={16} className={soundMuted ? "text-gray-500" : "text-green-400"} /> Sound Effects</h4><p className="text-xs text-gray-400">Procedural cues for plays, draws, life.</p></div>
                            <div onClick={() => setSoundMuted(!soundMuted)} className={`w-14 h-8 rounded-full p-1 flex items-center transition-colors ${!soundMuted ? "bg-green-600 justify-end" : "bg-gray-600 justify-start"}`}><div className="w-6 h-6 bg-white rounded-full shadow-md" /></div>
                        </label>
                    </div>
                    <button onClick={() => setShowCustomizeModal(true)} className="w-full bg-gray-700/50 hover:bg-gray-700 p-4 rounded-lg border border-gray-600 flex justify-between items-center transition-colors group">
                        <div className="flex flex-col items-start"><h4 className="font-bold text-white flex items-center gap-2"><Palette size={16} className="text-purple-400" /> Table Appearance</h4><p className="text-xs text-gray-400">Custom playmat & sleeve</p></div><ChevronRight className="text-gray-500 group-hover:text-white" size={20} />
                    </button>
                    <button onClick={() => setShowShortcuts(true)} className="w-full bg-gray-700/50 hover:bg-gray-700 p-4 rounded-lg border border-gray-600 flex justify-between items-center transition-colors group">
                        <div className="flex flex-col items-start"><h4 className="font-bold text-white flex items-center gap-2"><Keyboard size={16} className="text-blue-400" /> Keyboard Shortcuts</h4><p className="text-xs text-gray-400">View and edit hotkeys</p></div><ChevronRight className="text-gray-500 group-hover:text-white" size={20} />
                    </button>
                    <div className="w-full bg-gray-700/50 p-4 rounded-lg border border-gray-600 flex flex-col gap-4">
                        <div className="flex flex-col gap-2">
                            <div className="flex justify-between items-center text-xs"><span className="text-gray-300 font-bold flex items-center gap-1"><Archive size={14} /> Local Storage</span><span className={storageUsage.pct > 90 ? "text-red-400 font-bold" : "text-gray-400"}>{(storageUsage.total / 1024 / 1024).toFixed(2)} MB / 5.00 MB</span></div>
                            <div className="w-full bg-gray-900 rounded-full h-1.5 overflow-hidden"><div className={`h-full ${storageUsage.color} transition-all duration-500`} style={{ width: `${storageUsage.pct}%` }} /></div>
                        </div>
                        <button onClick={handleClearBackups} className="w-full bg-red-900/40 hover:bg-red-800/60 p-3 rounded-lg border border-red-900/50 flex justify-between items-center transition-colors group">
                            <div className="flex flex-col items-start"><h4 className="font-bold text-red-200 flex items-center gap-2"><Trash2 size={16} className="text-red-400" /> Clean Up Memory</h4><p className="text-xs text-red-300/70">Remove old backups</p></div><ChevronRight className="text-red-500" size={20} />
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
};

