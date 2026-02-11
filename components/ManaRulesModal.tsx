import React, { useState, useEffect } from 'react';
import { X, RotateCcw, Plus, Minus, Info, Crown, Ban, Copy, Trash2, Users, Map as MapIcon, Eye } from 'lucide-react';
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
        case 'CMD': return ''; // Using Crown Icon
        case 'ALL': return '/mana/all.png';
        default: return '/mana/colorless.png';
    }
};

const MANA_LABELS: Record<ManaColor, string> = {
    W: 'White', U: 'Blue', B: 'Black', R: 'Red', G: 'Green', C: 'Colorless', CMD: 'Commander', ALL: 'WUBRG'
};

interface ManaRulesModalProps {
    card: CardData;
    existingRule?: ManaRule;
    commanderColors?: ManaColor[];
    allSources?: { id: string; name: string; priority: number }[]; // For priority list
    onSave: (rule: ManaRule | null) => void; // null = reset to default
    onClose: () => void;
    onViewCard?: (card: CardData) => void; // Added for View Card feature
}

// Mana icon + count with +/- buttons
const ManaCounter: React.FC<{
    color: ManaColor;
    value: number;
    onChange: (val: number) => void;
    min?: number;
    isCmd?: boolean;
}> = ({ color, value, onChange, min = 0, isCmd }) => (
    <div className="flex flex-col items-center gap-1">
        <button
            onClick={() => onChange(value + 1)}
            className="w-6 h-6 flex items-center justify-center bg-gray-700 hover:bg-gray-600 rounded-full text-white text-xs"
        >
            <Plus size={12} />
        </button>
        <div className="relative w-9 h-9 flex items-center justify-center">
            {isCmd ? (
                <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-yellow-500 to-amber-700 rounded-full p-1 shadow-lg border border-yellow-300">
                    <Crown size={20} className="text-white drop-shadow-md" />
                </div>
            ) : (
                <img src={getIconPath(color)} alt={color} className="w-full h-full object-contain drop-shadow-md transition-transform hover:scale-110" />
            )}
            {value > 0 && (
                <span className="absolute -bottom-1 -right-1 bg-amber-500 text-black text-[10px] font-bold rounded-full w-4 h-4 flex items-center justify-center border border-black shadow">
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
    allSources?: { id: string; name: string; priority: number }[];
}> = ({ rule, onChange, commanderColors, disabled, isAlternative, allSources }) => {
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
            // Ensure full record
            producedAlt: {
                ...(rule.producedAlt || { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0, CMD: 0, ALL: 0 }),
                [color]: Math.max(0, value)
            }
        });
    };

    const updateActivationCost = (color: ManaColor, value: number) => {
        onChange({ ...rule, activationCost: { ...(rule.activationCost || { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0, CMD: 0, ALL: 0 }), [color]: Math.max(0, value) } });
    };

    const toggleAlt = () => {
        if (hasAlt) {
            setHasAlt(false);
            onChange({ ...rule, producedAlt: undefined });
        } else {
            setHasAlt(true);
            onChange({ ...rule, producedAlt: { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0, CMD: 0, ALL: 0 } });
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
            {(rule.trigger === 'activated' || rule.trigger === 'tap') && (
                <div className="mt-2 bg-gray-900/50 rounded-lg p-3 border border-amber-900/30">
                    <p className="text-xs text-amber-500 mb-1 font-bold flex items-center gap-2">
                        <span className="text-lg">⚡</span> Activation Cost
                    </p>
                    <div className="flex flex-wrap gap-2 items-center">
                        {/* Simple cost inputs standard colors */}
                        {MANA_COLORS.map(c => (
                            <div key={`cost-${c}`} className="flex flex-col items-center">
                                <img src={getIconPath(c)} className="w-4 h-4 mb-1 opacity-70" />
                                <input
                                    type="number"
                                    min={0}
                                    value={rule.activationCost?.[c] || 0}
                                    onChange={(e) => updateActivationCost(c, parseInt(e.target.value) || 0)}
                                    className="w-10 bg-gray-950 border border-gray-700 rounded text-center text-xs py-1 text-white"
                                />
                            </div>
                        ))}
                        {/* Tap Symbol Toggle */}
                        <button
                            onClick={() => {
                                // We might need a separate field for 'tap' cost if trigger is activated? 
                                // Usually 'activated' implies [Cost]: Effect. If Tap is part of cost, user marks it.
                                // For simplicity, we assume Activation Trigger handles the logic, but usually cost includes Tap.
                                // Let's just assume valid generic/colored inputs for now as requested.
                            }}
                            className="text-xs text-gray-500 italic ml-2"
                        >
                            (Tap is determined by "When Tapped" trigger, but here you define extra mana costs)
                        </button>
                    </div>
                </div>
            )}

            {/* Production Mode */}
            <div>
                <h4 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-2">Production Logic</h4>
                <RadioGroup
                    options={[
                        { value: 'standard', label: 'Standard', desc: 'Produces specific mana colors (e.g. {G})' },
                        { value: 'multiplied', label: 'Multiplied', desc: 'Existing mana production × Amount' },
                        { value: 'available', label: 'Available', desc: 'Any color you have lands for' },
                        { value: 'chooseColor', label: 'Choose Color', desc: 'Player picks color at runtime' },
                    ]}
                    selected={rule.prodMode}
                    onChange={(v) => updateRule('prodMode', v)}
                    disabled={disabled}
                />
            </div>

            {/* Production Details */}
            <div className="animate-in slide-in-from-top-2 duration-200">
                {rule.prodMode === 'standard' ? (
                    <div className="space-y-4">
                        <p className="text-xs text-gray-500">
                            {rule.calcMode === 'set' ? 'Produces:' : 'Multiplies selected colors by amount:'}
                        </p>
                        <div className="flex flex-wrap gap-4 justify-center bg-gray-900/50 rounded-xl p-4 border border-gray-700">
                            {/* Standard WUBRGC */}
                            {MANA_COLORS.map(color => (
                                <ManaCounter
                                    key={color}
                                    color={color}
                                    value={rule.produced[color] || 0}
                                    onChange={(v: number) => updateProduced(color, v)}
                                />
                            ))}
                            {/* Special Counters */}
                            <div className="w-px h-10 bg-gray-700 mx-2 self-center"></div>
                            <ManaCounter
                                color="CMD"
                                value={rule.produced['CMD'] || 0}
                                onChange={(v: number) => updateProduced('CMD', v)}
                                isCmd={true}
                            />
                            <ManaCounter
                                color="ALL"
                                value={rule.produced['ALL'] || 0}
                                onChange={(v: number) => updateProduced('ALL', v)}
                            />
                        </div>

                        {/* Split / Option Logic */}
                        <div className="mt-4 border-t border-gray-800 pt-3">
                            <div className="flex items-center justify-between mb-2">
                                <label className="flex items-center gap-2 text-sm text-gray-300 cursor-pointer">
                                    <input
                                        type="checkbox"
                                        checked={hasAlt}
                                        onChange={toggleAlt}
                                        className="w-4 h-4 rounded bg-gray-800 border-gray-600 text-amber-500 focus:ring-amber-500"
                                    />
                                    <span>Has "OR" Option?</span>
                                </label>
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
                                    updateRule('produced', { W: val, U: 0, B: 0, R: 0, G: 0, C: 0, CMD: 0, ALL: 0 });
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
                                    updateRule('produced', { W: val, U: 0, B: 0, R: 0, G: 0, C: 0, CMD: 0, ALL: 0 });
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

            {/* Calculation Logic (hidden for set mode unless counters/etc) */}
            <div className="border-t border-gray-800 pt-4">
                <h4 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-2">Quantity Calculation</h4>
                <div className="flex gap-4">
                    <div className="flex-1">
                        <label className="block text-xs text-gray-500 mb-1">Based On</label>
                        <select
                            value={rule.calcMode}
                            onChange={(e) => updateRule('calcMode', e.target.value as any)}
                            className="w-full bg-gray-900 border border-gray-600 rounded px-2 py-1.5 text-white text-sm"
                            disabled={disabled}
                        >
                            <option value="set">Fixed Value (Set by counters above)</option>
                            <option value="counters">Counters on Card</option>
                            <option value="creatures">Number of Creatures</option>
                            <option value="basicLands">Number of Basic Lands</option>
                        </select>
                    </div>
                    {rule.calcMode !== 'set' && (
                        <div className="w-24">
                            <label className="block text-xs text-gray-500 mb-1">Multiplier</label>
                            <input
                                type="number"
                                value={rule.calcMultiplier}
                                onChange={(e) => updateRule('calcMultiplier', parseFloat(e.target.value) || 1)}
                                className="w-full bg-gray-900 border border-gray-600 rounded px-2 py-1.5 text-white text-center"
                                step={0.5}
                            />
                        </div>
                    )}
                </div>
            </div>

            {/* Auto-Tap Settings */}
            <div className="border-t border-gray-800 pt-4">
                <div className="flex items-center justify-between mb-2">
                    <h4 className="text-xs font-bold text-gray-400 uppercase tracking-wider">Auto-Tap Priority</h4>
                    <label className="flex items-center gap-2 cursor-pointer">
                        <span className="text-xs text-gray-500">Enable Auto-Tap</span>
                        <div className={`w-10 h-5 rounded-full p-1 transition-colors ${rule.autoTap ? 'bg-green-600' : 'bg-gray-700'}`}
                            onClick={() => !disabled && updateRule('autoTap', !rule.autoTap)}
                        >
                            <div className={`w-3 h-3 bg-white rounded-full shadow-md transform transition-transform ${rule.autoTap ? 'translate-x-5' : 'translate-x-0'}`} />
                        </div>
                    </label>
                </div>

                <div className="bg-gray-900/30 rounded-lg p-3">
                    <div className="flex gap-4 items-start">
                        <div className="flex-1 text-xs text-gray-400">
                            Auto-tap system uses priority to decide which lands to tap first.
                            <br /> Lower numbers = Higher Priority (tapped first).
                            <div className="mt-1 text-gray-500 italic">
                                0 = Basic Land
                                <br />1 = Single Color Non-Basic
                                <br />2 = Dual/Tri
                                <br />3 = Flexible / Any Color
                            </div>
                        </div>
                    </div>

                    <div className="flex gap-4 items-start mt-2">
                        <div className="flex-1">
                            <input
                                type="number"
                                value={rule.autoTapPriority}
                                onChange={(e) => updateRule('autoTapPriority', parseFloat(e.target.value) || 0)}
                                className="w-full bg-gray-900 border border-gray-600 rounded px-3 py-1.5 text-white text-center"
                                step={0.1}
                            />
                            <p className="text-[10px] text-gray-500 mt-1 center">Lower = User First</p>
                        </div>

                        {/* Priority List Display */}
                        {allSources && allSources.length > 0 && (
                            <div className="w-48 bg-gray-900/50 rounded-lg border border-gray-700 p-2 max-h-32 overflow-y-auto custom-scrollbar">
                                <div className="text-[10px] text-gray-400 mb-1 sticky top-0 bg-[#232836] pb-1 border-b border-gray-700 font-bold flex justify-between">
                                    <span>Card</span>
                                    <span>Pri</span>
                                </div>
                                {allSources
                                    .sort((a, b) => a.priority - b.priority)
                                    .map(s => (
                                        <div key={s.id} className="text-[10px] flex justify-between py-0.5 border-b border-gray-800/50 last:border-0">
                                            <span className={`truncate max-w-[120px] ${Math.abs(s.priority - rule.autoTapPriority) < 0.01 ? 'text-blue-400 font-bold' : 'text-gray-500'}`}>
                                                {s.name}
                                            </span>
                                            <span className="text-gray-600 font-mono">{s.priority.toFixed(1)}</span>
                                        </div>
                                    ))}
                            </div>
                        )}
                    </div>
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

export const ManaRulesModal: React.FC<ManaRulesModalProps> = ({ card, existingRule, commanderColors, allSources, onSave, onClose, onViewCard }) => {
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
            alternativeRule: { ...EMPTY_MANA_RULE, produced: { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0, CMD: 0, ALL: 0 } }
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
                        <div className="w-10 h-14 bg-black rounded overflow-hidden flex-shrink-0 relative group cursor-pointer hover:ring-2 ring-blue-500 transition-all">
                            <img src={card.imageUrl} className="w-full h-full object-cover" alt={card.name} />
                            {/* Hover Overlay - View Card */}
                            <div
                                className="absolute inset-0 bg-black/60 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                                onClick={() => onViewCard && onViewCard(card)}
                            >
                                <Eye size={16} className="text-white drop-shadow-md" />
                            </div>
                        </div>
                        <div>
                            <h3 className="font-bold text-white text-lg">Mana Rules</h3>
                            <p className="text-sm text-gray-400">{card.name}</p>
                        </div>
                    </div>
                    <div className="flex gap-2">
                        <button onClick={handleReset} className="p-2 hover:bg-red-900/30 text-red-400 rounded-lg transition-colors flex items-center gap-2 text-sm" title="Remove Custom Rule">
                            <RotateCcw size={16} /> Reset Default
                        </button>
                        <button onClick={onClose} className="p-2 hover:bg-gray-700 rounded-lg transition-colors">
                            <X size={20} className="text-gray-400" />
                        </button>
                    </div>
                </div>

                {/* Content */}
                <div className="flex-1 overflow-y-auto p-6 space-y-6 custom-scrollbar">

                    {/* Enable/Disable Toggle */}
                    <div className="bg-gray-900/30 rounded-xl p-4 flex items-center justify-between border border-gray-700">
                        <div className="flex items-center gap-3">
                            <div className={`p-2 rounded-lg ${isDisabled ? 'bg-red-500/10 text-red-500' : 'bg-green-500/10 text-green-500'}`}>
                                {isDisabled ? <Ban size={20} /> : <Crown size={20} />}
                            </div>
                            <div>
                                <h4 className={`font-bold ${isDisabled ? 'text-gray-500' : 'text-white'}`}>
                                    {isDisabled ? 'Mana Production Disabled' : 'Mana Production Active'}
                                </h4>
                                <p className="text-xs text-gray-500">
                                    {isDisabled ? 'This card will not produce mana.' : 'Configure how this card produces mana.'}
                                </p>
                            </div>
                        </div>
                        <label className="relative inline-flex items-center cursor-pointer">
                            <input type="checkbox" checked={!isDisabled} onChange={(e) => setRule(prev => ({ ...prev, disabled: !e.target.checked }))} className="sr-only peer" />
                            <div className="w-11 h-6 bg-gray-700 peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-blue-500 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-green-600"></div>
                        </label>
                    </div>

                    {/* Main Rule Editor */}
                    <ManaRuleEditor
                        rule={rule}
                        onChange={setRule}
                        commanderColors={commanderColors}
                        disabled={isDisabled}
                        allSources={allSources}
                    />

                    {/* Alternative Rule Section */}
                    <div className={`border-t border-gray-700 pt-6 ${isDisabled ? 'opacity-40 pointer-events-none' : ''}`}>
                        <div className="flex items-center justify-between mb-4">
                            <h3 className="font-bold text-white flex items-center gap-2">
                                <MapIcon size={18} className="text-amber-500" />
                                Alternative Mode
                            </h3>
                            {!showAltEditor ? (
                                <button
                                    onClick={addAlternativeRule}
                                    className="px-3 py-1.5 bg-gray-800 hover:bg-gray-700 border border-gray-600 rounded-lg text-xs text-gray-300 flex items-center gap-2 transition-all"
                                >
                                    <Plus size={14} /> Add Mode
                                </button>
                            ) : (
                                <button
                                    onClick={removeAlternativeRule}
                                    className="px-3 py-1.5 bg-red-900/20 hover:bg-red-900/40 border border-red-900/50 rounded-lg text-xs text-red-400 flex items-center gap-2 transition-all"
                                >
                                    <Trash2 size={14} /> Remove Mode
                                </button>
                            )}
                        </div>

                        {showAltEditor && rule.alternativeRule && (
                            <div className="bg-gray-900/30 border border-gray-700 rounded-xl p-4 relative">
                                <div className="absolute top-0 right-0 p-2 opacity-10 pointer-events-none">
                                    <MapIcon size={100} />
                                </div>
                                <ManaRuleEditor
                                    rule={rule.alternativeRule}
                                    onChange={(newAlt) => setRule(prev => ({ ...prev, alternativeRule: newAlt }))}
                                    commanderColors={commanderColors}
                                    isAlternative={true}
                                />
                            </div>
                        )}
                    </div>

                </div>

                {/* Footer */}
                <div className="p-4 border-t border-gray-700 bg-gray-900 flex justify-end gap-3 z-10">
                    <button onClick={onClose} className="px-5 py-2 rounded-lg text-gray-400 hover:text-white hover:bg-gray-800 transition-colors">
                        Cancel
                    </button>
                    <button onClick={handleSave} className="px-5 py-2 bg-blue-600 hover:bg-blue-500 text-white font-bold rounded-lg shadow-lg hover:shadow-blue-500/20 transition-all transform hover:scale-105 active:scale-95">
                        Save Rules
                    </button>
                </div>
            </div>
        </div>
    );
};
