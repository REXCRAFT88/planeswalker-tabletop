import React, { useState, useEffect } from 'react';
import { X, RotateCcw, Plus, Minus, Info, Crown, Ban, Copy, Trash2 } from 'lucide-react';
import { CardData, ManaRule, ManaColor, EMPTY_MANA_RULE } from '../types';

const MANA_COLORS: ManaColor[] = ['W', 'U', 'B', 'R', 'G', 'C'];

const getIconPath = (type: string) => {
    switch (type) {
        case 'W': return '/mana/white.png';
        case 'U': return '/mana/blue.png';
        case 'B': return '/mana/black.png';
        case 'R': return '/mana/red.png';
        case 'G': return '/mana/green.png';
        case 'C': return '/mana/colorless.png';
        default: return '/mana/colorless.png';
    }
};

const MANA_LABELS: Record<ManaColor, string> = {
    W: 'White', U: 'Blue', B: 'Black', R: 'Red', G: 'Green', C: 'Colorless'
};

interface ManaRulesModalProps {
    card: CardData;
    existingRule?: ManaRule;
    commanderColors?: ManaColor[];
    onSave: (rule: ManaRule | null) => void; // null = reset to default
    onClose: () => void;
}

// Mana icon + count with +/- buttons
const ManaCounter: React.FC<{
    color: ManaColor;
    value: number;
    onChange: (val: number) => void;
    min?: number;
}> = ({ color, value, onChange, min = 0 }) => (
    <div className="flex flex-col items-center gap-1">
        <button
            onClick={() => onChange(value + 1)}
            className="w-6 h-6 flex items-center justify-center bg-gray-700 hover:bg-gray-600 rounded-full text-white text-xs"
        >
            <Plus size={12} />
        </button>
        <div className="relative w-9 h-9">
            <img src={getIconPath(color)} alt={color} className="w-full h-full object-contain drop-shadow-md" />
            {value > 0 && (
                <span className="absolute -bottom-1 -right-1 bg-amber-500 text-black text-[10px] font-bold rounded-full w-4 h-4 flex items-center justify-center">
                    {value}
                </span>
            )}
        </div>
        <button
            onClick={() => onChange(Math.max(min, value - 1))}
            className="w-6 h-6 flex items-center justify-center bg-gray-700 hover:bg-gray-600 rounded-full text-white text-xs"
        >
            <Minus size={12} />
        </button>
    </div>
);

// Radio group helper
const RadioGroup: React.FC<{
    options: { value: string; label: string; desc?: string }[];
    selected: string;
    onChange: (val: any) => void;
    disabled?: boolean;
}> = ({ options, selected, onChange, disabled }) => (
    <div className="flex flex-wrap gap-2">
        {options.map(opt => (
            <button
                key={opt.value}
                onClick={() => !disabled && onChange(opt.value)}
                className={`px-3 py-2 rounded-lg text-sm font-medium transition-all border ${disabled ? 'opacity-40 cursor-not-allowed ' : ''
                    }${selected === opt.value
                        ? 'bg-blue-600 border-blue-500 text-white shadow-lg shadow-blue-900/30'
                        : 'bg-gray-800 border-gray-600 text-gray-300 hover:border-gray-500'
                    }`}
                title={opt.desc}
                disabled={disabled}
            >
                {opt.label}
            </button>
        ))}
    </div>
);

// --- Mana Rule Editor (reusable for primary + alternative) ---
const ManaRuleEditor: React.FC<{
    rule: ManaRule;
    onChange: (rule: ManaRule) => void;
    commanderColors?: ManaColor[];
    disabled?: boolean;
    isAlternative?: boolean;
}> = ({ rule, onChange, commanderColors, disabled, isAlternative }) => {
    const [hasAlt, setHasAlt] = useState(!!rule.producedAlt);

    const updateRule = <K extends keyof ManaRule>(key: K, value: ManaRule[K]) => {
        onChange({ ...rule, [key]: value });
    };

    const updateProduced = (color: ManaColor, value: number) => {
        onChange({ ...rule, produced: { ...rule.produced, [color]: Math.max(0, value) } });
    };

    const updateProducedAlt = (color: ManaColor, value: number) => {
        onChange({
            ...rule,
            producedAlt: { ...(rule.producedAlt || { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 }), [color]: Math.max(0, value) }
        });
    };

    const updateActivationCost = (color: ManaColor, value: number) => {
        onChange({ ...rule, activationCost: { ...rule.activationCost, [color]: Math.max(0, value) } });
    };

    const toggleAlt = () => {
        if (hasAlt) {
            setHasAlt(false);
            onChange({ ...rule, producedAlt: undefined });
        } else {
            setHasAlt(true);
            onChange({ ...rule, producedAlt: { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 } });
        }
    };

    return (
        <div className={`space-y-5 ${disabled ? 'opacity-40 pointer-events-none' : ''}`}>
            {/* Activation Trigger */}
            <div>
                <h4 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-2">Activation Trigger</h4>
                <RadioGroup
                    options={[
                        { value: 'tap', label: '⟳ When Tapped', desc: 'Mana produced when this card is tapped' },
                        { value: 'activated', label: '⚡ When Activated', desc: 'Mana produced when player presses mana button' },
                        { value: 'passive', label: '🔵 Passive', desc: 'Mana auto-added when card is on the battlefield' },
                    ]}
                    selected={rule.trigger}
                    onChange={(v) => updateRule('trigger', v)}
                    disabled={disabled}
                />
            </div>

            {/* Activation Cost */}
            {rule.trigger === 'activated' && (
                <div>
                    <h4 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-2">Activation Cost</h4>
                    <p className="text-[11px] text-gray-500 mb-3">Mana required to activate this ability</p>
                    <div className="flex gap-3 justify-center bg-gray-900/50 rounded-xl p-3">
                        {MANA_COLORS.map(color => (
                            <ManaCounter
                                key={color}
                                color={color}
                                value={rule.activationCost[color]}
                                onChange={(v) => updateActivationCost(color, v)}
                            />
                        ))}
                    </div>
                </div>
            )}

            {/* Mana Calculation */}
            <div>
                <h4 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-2">Mana Calculation</h4>
                <p className="text-[11px] text-gray-500 mb-3">How the amount of mana to produce is determined</p>
                <RadioGroup
                    options={[
                        { value: 'set', label: 'Set Value', desc: 'Produces a fixed amount' },
                        { value: 'counters', label: '× Counters', desc: 'Amount = +1/+1 counters on this card' },
                        { value: 'creatures', label: '× Creatures', desc: 'Amount = creature cards you control' },
                        { value: 'basicLands', label: '× Basic Lands', desc: 'Amount = basic lands you control' },
                    ]}
                    selected={rule.calcMode}
                    onChange={(v) => updateRule('calcMode', v)}
                    disabled={disabled}
                />
                {rule.calcMode !== 'set' && (
                    <div className="mt-3 flex items-center gap-3">
                        <label className="text-sm text-gray-300">Multiplier:</label>
                        <input
                            type="number"
                            value={rule.calcMultiplier}
                            onChange={(e) => updateRule('calcMultiplier', Math.max(1, parseFloat(e.target.value) || 1))}
                            className="w-20 bg-gray-900 border border-gray-600 rounded px-2 py-1 text-white text-center"
                            min={1}
                            step={1}
                        />
                        <span className="text-xs text-gray-500">× {rule.calcMode}</span>
                    </div>
                )}
                {/* Include Base Power option for counters mode */}
                {rule.calcMode === 'counters' && (
                    <label className="flex items-center gap-2 cursor-pointer mt-3 bg-gray-900/50 rounded-lg p-2.5 border border-gray-700">
                        <input
                            type="checkbox"
                            checked={rule.includeBasePower || false}
                            onChange={(e) => updateRule('includeBasePower', e.target.checked)}
                            className="w-4 h-4 rounded bg-gray-700 border-gray-600 text-blue-500 focus:ring-blue-500"
                        />
                        <div>
                            <span className="text-sm text-gray-300 font-medium">Include Base Power</span>
                            <p className="text-[10px] text-gray-500">Adds creature's base power to counter total for calculation</p>
                        </div>
                    </label>
                )}
            </div>

            {/* Mana Produced */}
            <div>
                <h4 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-2">Mana Produced</h4>

                <RadioGroup
                    options={[
                        { value: 'standard', label: 'Standard', desc: 'Produces specific mana types' },
                        { value: 'multiplied', label: 'Multiplied', desc: 'Multiplies your existing mana production' },
                        { value: 'available', label: '🌊 Available', desc: 'Produces one mana of any color you have lands for' },
                        { value: 'chooseColor', label: '🎨 Choose Color', desc: 'Player picks a color when triggered' },
                    ]}
                    selected={rule.prodMode}
                    onChange={(v) => updateRule('prodMode', v)}
                    disabled={disabled}
                />

                <div className="mt-3">
                    {rule.prodMode === 'standard' ? (
                        <div className="space-y-3">
                            {/* Primary production */}
                            <div>
                                <span className="text-xs text-gray-500 mb-2 block">Produces:</span>
                                {/* Preset buttons */}
                                <div className="flex gap-2 mb-2">
                                    {commanderColors && commanderColors.length > 0 && (
                                        <button
                                            onClick={() => {
                                                const preset: Record<ManaColor, number> = { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 };
                                                commanderColors.forEach(c => { preset[c] = 1; });
                                                updateRule('produced', preset);
                                            }}
                                            className="flex items-center gap-1.5 px-3 py-1.5 bg-gray-700 hover:bg-gray-600 border border-gray-600 hover:border-purple-500 rounded-lg text-xs font-medium text-gray-300 hover:text-white transition-all"
                                            title="Set to commander color identity"
                                        >
                                            <Crown size={12} className="text-purple-400" />
                                            Commander Color
                                        </button>
                                    )}
                                    <button
                                        onClick={() => {
                                            updateRule('produced', { W: 1, U: 1, B: 1, R: 1, G: 1, C: 0 });
                                        }}
                                        className="flex items-center gap-1.5 px-3 py-1.5 bg-gray-700 hover:bg-gray-600 border border-gray-600 hover:border-amber-500 rounded-lg text-xs font-medium text-gray-300 hover:text-white transition-all"
                                        title="Set to all 5 colors (WUBRG)"
                                    >
                                        <img src="/mana/all.png" alt="WUBRG" className="w-4 h-4 object-contain" />
                                        WUBRG
                                    </button>
                                </div>
                                <div className="flex gap-3 justify-center bg-gray-900/50 rounded-xl p-3">
                                    {MANA_COLORS.map(color => (
                                        <ManaCounter
                                            key={color}
                                            color={color}
                                            value={rule.produced[color]}
                                            onChange={(v) => updateProduced(color, v)}
                                        />
                                    ))}
                                </div>
                            </div>

                            {/* OR alternative */}
                            <div className="flex items-center gap-2">
                                <button
                                    onClick={toggleAlt}
                                    className={`px-3 py-1.5 text-xs font-bold rounded-lg border transition-all ${hasAlt
                                        ? 'bg-amber-600 border-amber-500 text-white'
                                        : 'bg-gray-800 border-gray-600 text-gray-400 hover:border-gray-500'
                                        }`}
                                >
                                    {hasAlt ? 'Remove OR Option' : '+ Add OR Option'}
                                </button>
                                {!hasAlt && <span className="text-[11px] text-gray-600">e.g. produces {'{W}'} OR {'{U}'}</span>}
                            </div>

                            {hasAlt && rule.producedAlt && (
                                <div>
                                    <span className="text-xs text-amber-400 mb-2 block">OR produces:</span>
                                    <div className="flex gap-3 justify-center bg-gray-900/50 rounded-xl p-3 border border-amber-800/30">
                                        {MANA_COLORS.map(color => (
                                            <ManaCounter
                                                key={`alt-${color}`}
                                                color={color}
                                                value={rule.producedAlt![color]}
                                                onChange={(v) => updateProducedAlt(color, v)}
                                            />
                                        ))}
                                    </div>
                                </div>
                            )}
                        </div>
                    ) : rule.prodMode === 'multiplied' ? (
                        /* Multiplied mode */
                        <div className="space-y-3 bg-gray-900/50 rounded-xl p-4">
                            <p className="text-xs text-gray-400">
                                Multiplies selected mana types by the calculated amount.
                            </p>
                            <div className="flex gap-3 justify-center">
                                {MANA_COLORS.map(color => (
                                    <ManaCounter
                                        key={color}
                                        color={color}
                                        value={rule.produced[color]}
                                        onChange={(v) => updateProduced(color, v)}
                                    />
                                ))}
                            </div>
                            <label className="flex items-center gap-2 cursor-pointer">
                                <input
                                    type="checkbox"
                                    checked={rule.includeNonBasics || false}
                                    onChange={(e) => updateRule('includeNonBasics', e.target.checked)}
                                    className="w-4 h-4 rounded bg-gray-700 border-gray-600 text-blue-500 focus:ring-blue-500"
                                />
                                <span className="text-sm text-gray-300">Include non-basic lands in calculation</span>
                            </label>
                        </div>
                    ) : rule.prodMode === 'available' ? (
                        /* Available Mana mode */
                        <div className="bg-gray-900/50 rounded-xl p-4 border border-cyan-800/30">
                            <div className="flex items-center gap-2 mb-2">
                                <img src="/mana/all.png" alt="Available" className="w-6 h-6 object-contain" />
                                <span className="text-sm font-medium text-cyan-300">Available Mana</span>
                            </div>
                            <p className="text-xs text-gray-400">
                                Produces one mana of any color you currently have lands on the battlefield for.
                                The system checks your lands and offers those colors as available options.
                            </p>
                            <div className="mt-3 flex items-center gap-3">
                                <label className="text-sm text-gray-300">Amount of mana:</label>
                                <input
                                    type="number"
                                    value={Object.values(rule.produced).reduce((a, b) => a + b, 0) || 1}
                                    onChange={(e) => {
                                        const val = Math.max(1, parseInt(e.target.value) || 1);
                                        updateRule('produced', { W: val, U: 0, B: 0, R: 0, G: 0, C: 0 });
                                    }}
                                    className="w-20 bg-gray-900 border border-gray-600 rounded px-2 py-1 text-white text-center"
                                    min={1}
                                />
                            </div>
                        </div>
                    ) : (
                        /* Choose Color mode */
                        <div className="bg-gray-900/50 rounded-xl p-4 border border-purple-800/30">
                            <div className="flex items-center gap-2 mb-2">
                                <span className="text-lg">🎨</span>
                                <span className="text-sm font-medium text-purple-300">Choose Color at Runtime</span>
                            </div>
                            <p className="text-xs text-gray-400">
                                When this card's mana ability is triggered, a modal opens allowing the player
                                to pick one of the 5 mana colors. The chosen color is added to the mana pool.
                            </p>
                            <div className="mt-3 flex items-center gap-3">
                                <label className="text-sm text-gray-300">Amount of mana:</label>
                                <input
                                    type="number"
                                    value={Object.values(rule.produced).reduce((a, b) => a + b, 0) || 1}
                                    onChange={(e) => {
                                        const val = Math.max(1, parseInt(e.target.value) || 1);
                                        updateRule('produced', { W: val, U: 0, B: 0, R: 0, G: 0, C: 0 });
                                    }}
                                    className="w-20 bg-gray-900 border border-gray-600 rounded px-2 py-1 text-white text-center"
                                    min={1}
                                />
                            </div>
                            <div className="mt-2 flex gap-1">
                                {['W', 'U', 'B', 'R', 'G'].map(c => (
                                    <img key={c} src={getIconPath(c)} alt={c} className="w-6 h-6 object-contain opacity-60" />
                                ))}
                                <span className="text-[10px] text-gray-500 ml-1 self-center">Player selects one</span>
                            </div>
                        </div>
                    )}
                </div>
            </div>

            {/* Persistence */}
            <div>
                <h4 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-2">Mana Persistence</h4>
                <RadioGroup
                    options={[
                        { value: 'permanent', label: '♾ Permanent', desc: 'Mana stays in pool indefinitely' },
                        { value: 'untilNextTurn', label: '↻ Until Next Turn', desc: 'Mana clears at start of next turn' },
                        { value: 'untilEndOfTurn', label: '⏱ Until End of Turn', desc: 'Mana clears at end of current turn' },
                    ]}
                    selected={rule.persistence}
                    onChange={(v) => updateRule('persistence', v)}
                    disabled={disabled}
                />
            </div>

            {/* Auto-Tap */}
            <div className="flex flex-col md:flex-row gap-4">
                <div className="flex-1">
                    <h4 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-2">Auto-Tap</h4>
                    <label className="flex items-center gap-3 cursor-pointer">
                        <div
                            onClick={() => updateRule('autoTap', !rule.autoTap)}
                            className={`w-10 h-6 rounded-full transition-colors relative cursor-pointer ${rule.autoTap ? 'bg-green-600' : 'bg-gray-600'
                                }`}
                        >
                            <div className={`absolute top-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${rule.autoTap ? 'translate-x-4' : 'translate-x-0.5'
                                }`} />
                        </div>
                        <span className="text-sm text-gray-300">{rule.autoTap ? 'Yes — include in auto-tap' : 'No — skip during auto-tap'}</span>
                    </label>
                </div>

                <div>
                    <h4 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-2">Auto-Tap Priority</h4>
                    <input
                        type="number"
                        value={rule.autoTapPriority}
                        onChange={(e) => updateRule('autoTapPriority', parseFloat(e.target.value) || 0)}
                        className="w-24 bg-gray-900 border border-gray-600 rounded px-3 py-1.5 text-white text-center"
                        step={0.1}
                    />
                    <p className="text-[10px] text-gray-500 mt-1">Lower = tapped first</p>
                </div>
            </div>
        </div>
    );
};

// --- Helper: Summarize a rule compactly ---
const ruleSummary = (rule: ManaRule): string => {
    const colors = MANA_COLORS.filter(c => rule.produced[c] > 0);
    const totalMana = Object.values(rule.produced).reduce((a, b) => a + b, 0);
    if (rule.prodMode === 'available') return `Available mana (${totalMana})`;
    if (rule.prodMode === 'chooseColor') return `Choose color (${totalMana})`;
    if (colors.length === 0) return 'No mana';
    const parts = colors.map(c => `${rule.produced[c]}${c}`);
    let base = parts.join(', ');
    if (rule.calcMode !== 'set') base += ` × ${rule.calcMode}`;
    return base;
};

export const ManaRulesModal: React.FC<ManaRulesModalProps> = ({ card, existingRule, commanderColors, onSave, onClose }) => {
    const [rule, setRule] = useState<ManaRule>(() => {
        if (existingRule) return { ...existingRule };
        return { ...EMPTY_MANA_RULE };
    });

    const [showAltEditor, setShowAltEditor] = useState(!!rule.alternativeRule);

    const handleSave = () => {
        onSave(rule);
        onClose();
    };

    const handleReset = () => {
        onSave(null); // null = remove custom rule
        onClose();
    };

    const addAlternativeRule = () => {
        setShowAltEditor(true);
        setRule(prev => ({
            ...prev,
            alternativeRule: { ...EMPTY_MANA_RULE, produced: { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 } }
        }));
    };

    const removeAlternativeRule = () => {
        setShowAltEditor(false);
        setRule(prev => ({ ...prev, alternativeRule: undefined }));
    };

    const isDisabled = !!rule.disabled;

    return (
        <div className="fixed inset-0 z-[200] bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in">
            <div className="bg-gray-800 border border-gray-600 rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-hidden flex flex-col">
                {/* Header */}
                <div className="p-4 border-b border-gray-700 bg-gray-900 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-14 bg-black rounded overflow-hidden flex-shrink-0">
                            <img src={card.imageUrl} className="w-full h-full object-cover" alt={card.name} />
                        </div>
                        <div>
                            <h3 className="font-bold text-white text-lg">Mana Rules</h3>
                            <p className="text-sm text-gray-400">{card.name}</p>
                        </div>
                    </div>
                    <button onClick={onClose} className="text-gray-400 hover:text-white p-1">
                        <X size={20} />
                    </button>
                </div>

                {/* Body */}
                <div className="flex-1 overflow-y-auto p-5 space-y-6 custom-scrollbar">

                    {/* Disable Toggle */}
                    <div className={`flex items-center justify-between p-3 rounded-xl border transition-colors ${isDisabled
                            ? 'bg-red-900/30 border-red-700/50'
                            : 'bg-gray-900/50 border-gray-700'
                        }`}>
                        <div className="flex items-center gap-3">
                            <Ban size={16} className={isDisabled ? 'text-red-400' : 'text-gray-500'} />
                            <div>
                                <span className={`text-sm font-medium ${isDisabled ? 'text-red-300' : 'text-gray-300'}`}>
                                    Disable Mana Production
                                </span>
                                <p className="text-[10px] text-gray-500">
                                    Completely prevent this card from producing mana
                                </p>
                            </div>
                        </div>
                        <div
                            onClick={() => setRule(prev => ({ ...prev, disabled: !prev.disabled }))}
                            className={`w-10 h-6 rounded-full transition-colors relative cursor-pointer ${isDisabled ? 'bg-red-600' : 'bg-gray-600'
                                }`}
                        >
                            <div className={`absolute top-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${isDisabled ? 'translate-x-4' : 'translate-x-0.5'
                                }`} />
                        </div>
                    </div>

                    {/* Primary Rule Editor */}
                    <div>
                        <h4 className="text-xs font-bold text-blue-400 uppercase tracking-wider mb-3 flex items-center gap-2">
                            {showAltEditor ? '📋 Option A — Primary Rule' : '📋 Mana Rule Configuration'}
                        </h4>
                        <ManaRuleEditor
                            rule={rule}
                            onChange={(updated) => setRule(prev => ({ ...prev, ...updated, alternativeRule: prev.alternativeRule, disabled: prev.disabled }))}
                            commanderColors={commanderColors}
                            disabled={isDisabled}
                        />
                    </div>

                    {/* Alternative Rule Section */}
                    {!isDisabled && (
                        <div className="border-t border-gray-700 pt-5">
                            {!showAltEditor ? (
                                <button
                                    onClick={addAlternativeRule}
                                    className="flex items-center gap-2 px-4 py-2.5 bg-gray-700 hover:bg-gray-600 border border-gray-600 hover:border-amber-500 rounded-xl text-sm font-medium text-gray-300 hover:text-white transition-all w-full justify-center"
                                >
                                    <Copy size={14} className="text-amber-400" />
                                    Add Alternative Rule (for multi-choice cards)
                                </button>
                            ) : (
                                <div className="space-y-3">
                                    <div className="flex items-center justify-between">
                                        <h4 className="text-xs font-bold text-amber-400 uppercase tracking-wider flex items-center gap-2">
                                            📋 Option B — Alternative Rule
                                        </h4>
                                        <button
                                            onClick={removeAlternativeRule}
                                            className="flex items-center gap-1 px-2 py-1 text-xs text-red-400 hover:text-red-300 hover:bg-red-900/30 rounded-lg transition-colors"
                                        >
                                            <Trash2 size={12} /> Remove
                                        </button>
                                    </div>
                                    <div className="bg-gray-900/30 border border-amber-800/30 rounded-xl p-4">
                                        <p className="text-[11px] text-amber-500/80 mb-3">
                                            When this card's mana ability triggers, a modal will let the player choose between Option A ({ruleSummary(rule)}) or Option B.
                                        </p>
                                        <ManaRuleEditor
                                            rule={rule.alternativeRule || { ...EMPTY_MANA_RULE }}
                                            onChange={(altRule) => setRule(prev => ({ ...prev, alternativeRule: altRule }))}
                                            commanderColors={commanderColors}
                                            isAlternative
                                        />
                                    </div>
                                </div>
                            )}
                        </div>
                    )}

                    {/* Card Oracle Text Reference */}
                    {card.oracleText && (
                        <div className="bg-gray-900/50 border border-gray-700 rounded-xl p-3">
                            <div className="flex items-center gap-2 mb-1">
                                <Info size={12} className="text-gray-500" />
                                <span className="text-[10px] font-bold text-gray-500 uppercase">Card Oracle Text</span>
                            </div>
                            <p className="text-xs text-gray-400 italic whitespace-pre-wrap">{card.oracleText}</p>
                        </div>
                    )}
                </div>

                {/* Footer */}
                <div className="p-4 border-t border-gray-700 bg-gray-900 flex items-center justify-between gap-3">
                    <button
                        onClick={handleReset}
                        className="flex items-center gap-2 px-4 py-2 bg-gray-700 hover:bg-gray-600 text-gray-300 rounded-lg text-sm font-medium transition-colors"
                    >
                        <RotateCcw size={14} /> Reset to Default
                    </button>
                    <div className="flex gap-2">
                        <button
                            onClick={onClose}
                            className="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-lg text-sm font-medium transition-colors"
                        >
                            Cancel
                        </button>
                        <button
                            onClick={handleSave}
                            className="px-6 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-sm font-bold shadow-lg shadow-blue-900/30 transition-colors"
                        >
                            Save Rules
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
};
