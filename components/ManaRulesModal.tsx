import React, { useState, useEffect } from 'react';
import { CardData, CustomManaRules } from '../types';
import { MANA_COLORS as colors } from '../services/mana';
import { X, Save, RotateCw, Hand, Zap, Infinity, Clock, PlayCircle, Plus } from 'lucide-react';

interface ManaRulesModalProps {
    isOpen: boolean;
    onClose: () => void;
    card: CardData | null;
    onSave: (rules: CustomManaRules) => void;
}

const DEFAULT_RULES: CustomManaRules = {
    trigger: 'tap',
    costType: 'none',
    cost: {},
    calculationType: 'fixed',
    calculationDetail: { multiplier: 1 },
    producedMana: ['C'],
    persistence: 'none',
    autoTap: true,
    priority: 3
};

export const ManaRulesModal: React.FC<ManaRulesModalProps> = ({ isOpen, onClose, card, onSave }) => {
    const [rules, setRules] = useState<CustomManaRules>(DEFAULT_RULES);

    useEffect(() => {
        if (isOpen && card) {
            setRules(card.customManaRules || DEFAULT_RULES);
        }
    }, [isOpen, card]);

    if (!isOpen || !card) return null;

    const handleMultiplierChange = (idx: number, color: string) => {
        const newProduced = [...rules.producedMana];
        newProduced[idx] = color;
        setRules({ ...rules, producedMana: newProduced });
    };

    const addProduced = () => setRules({ ...rules, producedMana: [...rules.producedMana, 'C'] });
    const removeProduced = (idx: number) => setRules({ ...rules, producedMana: rules.producedMana.filter((_, i) => i !== idx) });

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
            <div className="bg-gray-800 border border-gray-700 rounded-xl w-full max-w-2xl max-h-[90vh] flex flex-col shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-200">

                {/* Header */}
                <div className="p-4 border-b border-gray-700 flex justify-between items-center bg-gray-900">
                    <h2 className="text-xl font-bold flex items-center gap-2 text-white">
                        <Zap className="text-yellow-500" />
                        Mana Rules: <span className="text-blue-400">{card.name}</span>
                    </h2>
                    <button onClick={onClose} className="p-1 hover:bg-gray-700 rounded-full text-gray-400 hover:text-white transition-colors">
                        <X size={24} />
                    </button>
                </div>

                <div className="p-6 overflow-y-auto space-y-6 text-gray-200 flex-1 custom-scrollbar">

                    {/* Trigger Section */}
                    <div className="space-y-3">
                        <label className="text-sm font-bold uppercase text-gray-500 tracking-wider">Activation Trigger</label>
                        <div className="grid grid-cols-3 gap-3">
                            {[
                                { id: 'tap', label: 'On Tap', icon: RotateCw },
                                { id: 'activated', label: 'Activated Ability', icon: Hand },
                                { id: 'passive', label: 'Passive / State', icon: Infinity }
                            ].map((opt) => (
                                <button
                                    key={opt.id}
                                    onClick={() => setRules({ ...rules, trigger: opt.id as any })}
                                    className={`flex flex-col items-center gap-2 p-3 rounded-lg border-2 transition-all ${rules.trigger === opt.id ? 'border-blue-500 bg-blue-900/20 text-white' : 'border-gray-700 bg-gray-800 hover:border-gray-600 text-gray-400'}`}
                                >
                                    <opt.icon size={24} />
                                    <span className="font-bold text-sm">{opt.label}</span>
                                </button>
                            ))}
                        </div>
                    </div>

                    {/* Calculation Type */}
                    <div className="space-y-3">
                        <label className="text-sm font-bold uppercase text-gray-500 tracking-wider">Mana Calculation</label>
                        <select
                            value={rules.calculationType}
                            onChange={(e) => setRules({ ...rules, calculationType: e.target.value as any })}
                            className="w-full bg-gray-900 border border-gray-600 rounded p-3 text-white focus:ring-2 focus:ring-blue-500 outline-none"
                        >
                            <option value="fixed">Fixed Amount (e.g. Sol Ring)</option>
                            <option value="counters">Based on Counters (e.g. Shrine of Boundless Growth)</option>
                            <option value="creatures">Based on Creatures (e.g. Elvish Archdruid)</option>
                            <option value="basic_lands">Based on Basic Lands (e.g. Cabal Coffers)</option>
                            <option value="custom_multiplier">Custom Multiplier</option>
                        </select>

                        {/* Detail Inputs based on Type */}
                        {rules.calculationType === 'creatures' && (
                            <input
                                placeholder="Creature Type (e.g. Elf) - leave empty for all"
                                className="w-full bg-gray-900 border border-gray-600 rounded p-2 text-white"
                                value={rules.calculationDetail?.creatureType || ''}
                                onChange={e => setRules({ ...rules, calculationDetail: { ...rules.calculationDetail, creatureType: e.target.value } })}
                            />
                        )}
                        {rules.calculationType === 'counters' && (
                            <input
                                placeholder="Counter Type (e.g. +1/+1, charge)"
                                className="w-full bg-gray-900 border border-gray-600 rounded p-2 text-white"
                                value={rules.calculationDetail?.counterType || ''}
                                onChange={e => setRules({ ...rules, calculationDetail: { ...rules.calculationDetail, counterType: e.target.value } })}
                            />
                        )}
                        {rules.calculationType === 'custom_multiplier' && (
                            <input
                                type="number"
                                placeholder="Multiplier (e.g. 2 for doublers)"
                                className="w-full bg-gray-900 border border-gray-600 rounded p-2 text-white"
                                value={rules.calculationDetail?.multiplier || 1}
                                onChange={e => setRules({ ...rules, calculationDetail: { ...rules.calculationDetail, multiplier: parseFloat(e.target.value) } })}
                            />
                        )}
                    </div>

                    {/* Produced Mana */}
                    <div className="space-y-3">
                        <label className="text-sm font-bold uppercase text-gray-500 tracking-wider">Produced Mana Types</label>
                        <div className="flex flex-wrap gap-2">
                            {rules.producedMana.map((color, idx) => (
                                <div key={idx} className="flex items-center bg-gray-900 rounded-full border border-gray-600 pl-1 pr-2 py-1">
                                    <select
                                        value={color}
                                        onChange={(e) => handleMultiplierChange(idx, e.target.value)}
                                        className="bg-transparent text-white font-bold outline-none mr-1 cursor-pointer"
                                    >
                                        {[...colors, 'C'].map(c => <option key={c} value={c} className="bg-gray-800">{c}</option>)}
                                    </select>
                                    <button onClick={() => removeProduced(idx)} className="text-red-400 hover:text-red-200"><X size={14} /></button>
                                </div>
                            ))}
                            <button onClick={addProduced} className="px-3 py-1 bg-blue-600 hover:bg-blue-500 text-white rounded-full text-sm font-bold flex items-center gap-1">
                                <Plus size={14} /> Add Type
                            </button>
                        </div>
                        <p className="text-xs text-gray-500">
                            For variable calculations (like creatures), this defines the *type* of mana produced per unit.
                            For fixed, this is the exact pool produced.
                        </p>
                    </div>

                    {/* Priority & Auto-Tap */}
                    <div className="grid grid-cols-2 gap-6">
                        <div className="space-y-2">
                            <label className="text-sm font-bold uppercase text-gray-500 tracking-wider">Auto-Tap Priority</label>
                            <input
                                type="number"
                                className="w-full bg-gray-900 border border-gray-600 rounded p-2 text-white"
                                value={rules.priority}
                                onChange={e => setRules({ ...rules, priority: parseFloat(e.target.value) })}
                            />
                            <p className="text-xs text-gray-500">Lower = Used first. Basic Lands are 0.</p>
                        </div>
                        <div className="flex items-center gap-3 pt-6">
                            <input
                                type="checkbox"
                                id="autoTap"
                                checked={rules.autoTap}
                                onChange={e => setRules({ ...rules, autoTap: e.target.checked })}
                                className="w-5 h-5 rounded border-gray-600 bg-gray-700 text-blue-600 focus:ring-blue-500"
                            />
                            <label htmlFor="autoTap" className="text-white font-bold cursor-pointer select-none">Allow Auto-Tap</label>
                        </div>
                    </div>

                    {/* Persistence */}
                    <div className="space-y-3">
                        <label className="text-sm font-bold uppercase text-gray-500 tracking-wider">Mana Persistence</label>
                        <div className="flex gap-2">
                            {[
                                { id: 'none', label: 'Normal (Empties)', icon: Clock },
                                { id: 'until_end_of_turn', label: 'Until End of Turn', icon: PlayCircle },
                                { id: 'until_next_turn', label: 'Until Next Turn', icon: Infinity }
                            ].map((opt) => (
                                <button
                                    key={opt.id}
                                    onClick={() => setRules({ ...rules, persistence: opt.id as any })}
                                    className={`flex-1 flex flex-col items-center gap-1 p-2 rounded border transition-all ${rules.persistence === opt.id ? 'border-purple-500 bg-purple-900/20 text-white' : 'border-gray-700 bg-gray-900 text-gray-500'}`}
                                >
                                    <opt.icon size={16} />
                                    <span className="text-xs font-bold text-center">{opt.label}</span>
                                </button>
                            ))}
                        </div>
                    </div>

                </div>

                <div className="p-4 border-t border-gray-700 bg-gray-900 flex justify-end gap-3">
                    <button onClick={onClose} className="px-4 py-2 text-gray-400 hover:text-white font-bold">Cancel</button>
                    <button onClick={() => onSave(rules)} className="px-6 py-2 bg-green-600 hover:bg-green-500 text-white rounded-lg font-bold shadow-lg flex items-center gap-2">
                        <Save size={18} /> Save Rules
                    </button>
                </div>
            </div>
        </div>
    );
};
