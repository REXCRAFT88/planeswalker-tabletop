import React, { useState, useEffect } from 'react';
import { ManaPool, CategorizedManaInfo, MANA_COLORS, BASE_COLORS, parseManaCost, poolTotal } from '../services/mana';
import { Eye, EyeOff, Plus, Minus, X, Zap } from 'lucide-react';

interface ManaDisplayProps {
    manaInfo: CategorizedManaInfo;
    floatingMana: ManaPool;
    onAddMana: (type: keyof ManaPool) => void;
    onRemoveMana: (type: keyof ManaPool) => void;
    onAutoTapColor?: (color: string) => void;
}

const DISPLAY_COLORS = ['W', 'U', 'B', 'R', 'G', 'C'] as const;

// Helper function for getting mana icon paths - defined at module level for reuse
const getIconPath = (type: string) => {
    switch (type) {
        case 'W': return '/mana/white.png';
        case 'U': return '/mana/blue.png';
        case 'B': return '/mana/black.png';
        case 'R': return '/mana/red.png';
        case 'G': return '/mana/green.png';
        case 'C': return '/mana/colorless.png';
        default: return '/mana/all.png';
    }
};

export const ManaDisplay: React.FC<ManaDisplayProps> = ({ manaInfo, floatingMana, onAddMana, onRemoveMana, onAutoTapColor }) => {
    const [showAll, setShowAll] = useState(false);

    const hasMana = (type: keyof ManaPool) =>
        (manaInfo.available[type] || 0) > 0 ||
        (manaInfo.potential[type] || 0) > 0 ||
        (floatingMana[type] || 0) > 0;

    const getFallbackColor = (type: string) => {
        switch (type) {
            case 'W': return 'bg-yellow-100 text-yellow-800';
            case 'U': return 'bg-blue-200 text-blue-900';
            case 'B': return 'bg-gray-800 text-white';
            case 'R': return 'bg-red-200 text-red-900';
            case 'G': return 'bg-green-200 text-green-900';
            case 'C': return 'bg-gray-400 text-gray-900';
            default: return 'bg-purple-200 text-purple-900';
        }
    };

    const totalFloating = BASE_COLORS.reduce((sum, c) => sum + (floatingMana[c] || 0), 0);
    const grandTotal = manaInfo.availableTotal + totalFloating;

    return (
        <div className="absolute right-0 top-1/4 flex flex-col items-end gap-1 p-2 pointer-events-none z-40">
            {/* Total Mana Header */}
            <div className="bg-black/60 backdrop-blur-sm rounded-l-xl px-3 py-1.5 pointer-events-auto flex items-center gap-2 mb-1">
                <img src="/mana/all.png" alt="Total" className="w-5 h-5 object-contain opacity-70" />
                <div className="flex flex-col items-center">
                    <span className={`font-bold text-xl leading-none drop-shadow-[0_2px_2px_rgba(0,0,0,0.8)] ${totalFloating > 0 ? 'text-amber-400' : 'text-white'}`}>
                        {grandTotal}
                    </span>
                    {manaInfo.potentialTotal > 0 && (
                        <span className="text-[9px] text-cyan-400 font-mono leading-none">+{manaInfo.potentialTotal}</span>
                    )}
                </div>
            </div>

            {/* Section Label */}
            <div className="text-[8px] text-gray-500 font-bold uppercase tracking-wider mr-2 mb-0.5">
                Available
            </div>

            {DISPLAY_COLORS.map(type => {
                if (!showAll && !hasMana(type)) return null;

                const available = manaInfo.available[type] || 0;
                const potential = manaInfo.potential[type] || 0;
                const floating = floatingMana[type] || 0;
                const total = available + floating;

                return (
                    <div
                        key={type}
                        className="flex items-center gap-1 bg-black/40 rounded-l-full pr-1 pl-1 py-1 backdrop-blur-sm pointer-events-auto transition-all hover:pr-4 group"
                        onWheel={(e) => {
                            e.stopPropagation();
                            if (e.deltaY < 0) onAddMana(type);
                            else onRemoveMana(type);
                        }}
                    >
                        {/* Controls (visible on hover) */}
                        <div className="flex flex-col gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity -mr-2 w-0 group-hover:w-6 overflow-hidden">
                            <button onClick={() => onAddMana(type)} className="w-5 h-5 flex items-center justify-center bg-gray-700 hover:bg-gray-600 rounded-full text-white"><Plus size={10} /></button>
                            <button onClick={() => onRemoveMana(type)} className="w-5 h-5 flex items-center justify-center bg-gray-700 hover:bg-gray-600 rounded-full text-white"><Minus size={10} /></button>
                        </div>

                        <div className="flex flex-col items-center justify-center w-10 mr-1">
                            {/* Total Count */}
                            <span className={`font-bold text-xl drop-shadow-[0_2px_2px_rgba(0,0,0,0.8)] leading-none ${floating > 0 ? 'text-amber-400' : 'text-white'}`}>
                                {total}
                            </span>

                            {/* Breakdown: Potential shown in cyan */}
                            <div className="flex gap-1 text-[9px] font-mono leading-none">
                                {floating > 0 && <span className="text-amber-400" title="Floating Mana">{floating}</span>}
                                {potential > 0 && <span className="text-cyan-400" title="Potential">{`+${potential}`}</span>}
                            </div>
                        </div>

                        <div
                            className="relative w-8 h-8 cursor-pointer hover:scale-110 active:scale-95 transition-transform"
                            onClick={(e) => {
                                e.stopPropagation();
                                onAutoTapColor?.(type);
                            }}
                            title={`Click to auto-tap a ${type} source`}
                        >
                            <img
                                src={getIconPath(type)}
                                alt={type}
                                className="w-full h-full object-contain drop-shadow-lg"
                                onError={(e) => {
                                    e.currentTarget.style.display = 'none';
                                    e.currentTarget.nextElementSibling?.classList.remove('hidden');
                                }}
                            />
                            {/* Fallback Circle */}
                            <div className={`hidden w-8 h-8 rounded-full border-2 border-white/30 flex items-center justify-center font-bold text-sm shadow-inner ${getFallbackColor(type)}`}>
                                {type}
                            </div>
                        </div>
                    </div>
                );
            })}

            {/* Potential Mana Section Removed as Redundant */}


            {/* Floating Mana Section with granular controls */}
            {totalFloating > 0 && (
                <>
                    <div className="text-[8px] text-amber-400 font-bold uppercase tracking-wider mr-2 mt-2 mb-0.5">
                        Pool
                    </div>
                    <div className="bg-black/40 rounded-l-lg px-2 py-1 pointer-events-auto flex flex-col gap-1 items-end">
                        <div className="flex items-center gap-2 mb-1">
                            <span className="text-amber-400 font-bold text-sm">Total: {totalFloating}</span>
                            <button
                                onClick={() => {
                                    // Remove one mana from the first non-zero color
                                    for (const c of DISPLAY_COLORS) {
                                        if ((floatingMana[c] || 0) > 0) {
                                            onRemoveMana(c);
                                            break;
                                        }
                                    }
                                }}
                                className="p-1 bg-red-900/50 hover:bg-red-800 rounded text-red-400"
                                title="Remove 1 mana (any)"
                            >
                                <Minus size={12} />
                            </button>
                        </div>

                        <div className="flex flex-col gap-1 w-full">
                            {DISPLAY_COLORS.map(type => {
                                const count = floatingMana[type] || 0;
                                if (count === 0) return null;
                                return (
                                    <div key={type} className="flex items-center justify-end gap-2 px-1 rounded hover:bg-white/5 transition-colors">
                                        <div className="flex items-center gap-1">
                                            <img src={getIconPath(type)} className="w-4 h-4 ml-1" alt={type} />
                                            <span className="text-amber-400 text-xs font-bold w-4 text-center">{count}</span>
                                        </div>
                                        <div className="flex gap-0.5">
                                            <button
                                                onClick={() => onAddMana(type)}
                                                className="w-5 h-5 flex items-center justify-center bg-gray-700 hover:bg-gray-600 rounded-full text-white"
                                                title={`Add ${type} mana`}
                                            >
                                                <Plus size={10} />
                                            </button>
                                            <button
                                                onClick={() => onRemoveMana(type)}
                                                className="w-5 h-5 flex items-center justify-center bg-red-900/50 hover:bg-red-800 rounded-full text-red-200"
                                                title={`Remove ${type} mana`}
                                            >
                                                <Minus size={10} />
                                            </button>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                </>
            )}

            <div className="flex flex-col items-end mt-2">
                <div className="text-[10px] text-white/50 font-bold uppercase tracking-wider mb-1 mr-2 opacity-0 hover:opacity-100 transition-opacity">
                    Scroll to +/-
                </div>
                <button
                    onClick={() => setShowAll(!showAll)}
                    className="pointer-events-auto p-1.5 bg-black/30 hover:bg-black/50 text-white/70 hover:text-white rounded-full transition-colors"
                    title={showAll ? "Hide unused mana types" : "Show all mana types"}
                >
                    {showAll ? <EyeOff size={14} /> : <Eye size={14} />}
                </button>
            </div>
        </div>
    );
};

// Mana Cost Sidebar Component - shows when playing a card with mana cost
interface ManaCostSidebarProps {
    cardName: string;
    manaCost: string;
    floatingMana: ManaPool;
    xValue: number;
    autoTapEnabled: boolean;
    onXValueChange: (value: number) => void;
    onDismiss: () => void;
    onPay?: () => void; // Only used when autoTap is enabled
}

export const ManaCostSidebar: React.FC<ManaCostSidebarProps> = ({
    cardName,
    manaCost,
    floatingMana,
    xValue,
    autoTapEnabled,
    onXValueChange,
    onDismiss,
    onPay
}) => {
    const [xInput, setXInput] = useState(String(xValue));

    // Parse the mana cost
    const parsed = parseManaCost(manaCost);
    const symbols = parsed.symbols;
    const hasX = parsed.hasX;

    // Calculate remaining cost after applying floating mana
    const getRemainingCost = () => {
        const tempPool = { ...floatingMana };
        const remaining: { value: string; paid: boolean }[] = [];

        for (const sym of symbols) {
            if (sym.type === 'x') {
                remaining.push({ value: 'X', paid: false });
            } else if (sym.type === 'generic') {
                let toPay = sym.count;
                // Pay with colorless first
                if (tempPool.C > 0) {
                    const paid = Math.min(tempPool.C, toPay);
                    tempPool.C -= paid;
                    toPay -= paid;
                }
                // Then pay with colored mana
                for (const c of BASE_COLORS) {
                    if (toPay <= 0) break;
                    if (c === 'C') continue;
                    if ((tempPool[c] || 0) > 0) {
                        const paid = Math.min(tempPool[c] || 0, toPay);
                        tempPool[c] = (tempPool[c] || 0) - paid;
                        toPay -= paid;
                    }
                }
                if (toPay > 0) {
                    remaining.push({ value: String(toPay), paid: false });
                }
            } else if (sym.type === 'colored') {
                const color = sym.color;
                if ((tempPool[color] || 0) > 0) {
                    tempPool[color] = (tempPool[color] || 0) - 1;
                } else {
                    remaining.push({ value: color, paid: false });
                }
            } else if (sym.type === 'hybrid') {
                // Try to pay with any of the options
                let paid = false;
                for (const opt of sym.options) {
                    if ((tempPool[opt] || 0) > 0) {
                        tempPool[opt] = (tempPool[opt] || 0) - 1;
                        paid = true;
                        break;
                    }
                }
                if (!paid) {
                    remaining.push({ value: sym.options.join('/'), paid: false });
                }
            }
        }

        // Add X costs if xValue > 0
        for (let i = 0; i < xValue; i++) {
            let toPay = 1;
            if (tempPool.C > 0) {
                tempPool.C -= 1;
                toPay = 0;
            } else {
                for (const c of BASE_COLORS) {
                    if (toPay <= 0) break;
                    if (c === 'C') continue;
                    if ((tempPool[c] || 0) > 0) {
                        tempPool[c] = (tempPool[c] || 0) - 1;
                        toPay = 0;
                        break;
                    }
                }
            }
            if (toPay > 0) {
                remaining.push({ value: '1', paid: false });
            }
        }

        return remaining;
    };

    const remaining = getRemainingCost();
    const isPaid = remaining.length === 0;

    // Handle X input change
    useEffect(() => {
        const num = parseInt(xInput) || 0;
        if (num >= 0) {
            onXValueChange(num);
        }
    }, [xInput]);

    return (
        <div className="fixed left-0 top-1/2 -translate-y-1/2 z-50 pointer-events-auto animate-in slide-in-from-left">
            <div className="bg-gray-900/95 backdrop-blur border border-gray-700 rounded-r-xl p-4 shadow-2xl w-72">
                <div className="flex justify-between items-center mb-3">
                    <h3 className="text-sm font-bold text-white truncate flex-1 mr-2">{cardName}</h3>
                    <button onClick={onDismiss} className="p-1 hover:bg-gray-700 rounded text-gray-400 hover:text-white flex-shrink-0">
                        <X size={16} />
                    </button>
                </div>

                {/* Mana Cost Display */}
                <div className="mb-3">
                    <span className="text-[10px] text-gray-500 uppercase">Cost:</span>
                    <div className="flex items-center gap-1 mt-1 flex-wrap">
                        {symbols.map((sym, idx) => {
                            let display = '';
                            let colorClass = 'bg-gray-800 border-gray-600 text-white';

                            if (sym.type === 'x') {
                                display = 'X';
                                colorClass = 'bg-purple-900/50 border-purple-600 text-purple-300';
                            } else if (sym.type === 'generic') {
                                display = String(sym.count);
                            } else if (sym.type === 'colored') {
                                display = sym.color;
                                if (sym.color === 'W') colorClass = 'bg-yellow-100 border-yellow-300 text-yellow-800';
                                else if (sym.color === 'U') colorClass = 'bg-blue-300 border-blue-500 text-blue-900';
                                else if (sym.color === 'B') colorClass = 'bg-gray-700 border-gray-500 text-white';
                                else if (sym.color === 'R') colorClass = 'bg-red-300 border-red-500 text-red-900';
                                else if (sym.color === 'G') colorClass = 'bg-green-300 border-green-500 text-green-900';
                                else if (sym.color === 'C') colorClass = 'bg-gray-400 border-gray-500 text-gray-800';
                            } else if (sym.type === 'hybrid') {
                                display = sym.options.join('/');
                            }

                            return (
                                <div key={idx} className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold border ${colorClass}`}>
                                    {display}
                                </div>
                            );
                        })}
                    </div>
                </div>

                {/* X Value Input */}
                {hasX && (
                    <div className="mb-3 bg-purple-900/20 border border-purple-800/30 rounded-lg p-2">
                        <label className="text-[10px] text-purple-300 uppercase font-bold">X Value:</label>
                        <div className="flex items-center gap-2 mt-1">
                            <button
                                onClick={() => setXInput(String(Math.max(0, (parseInt(xInput) || 0) - 1)))}
                                className="w-8 h-8 bg-gray-700 hover:bg-gray-600 rounded text-white font-bold"
                            >
                                -
                            </button>
                            <input
                                type="number"
                                value={xInput}
                                onChange={(e) => setXInput(e.target.value)}
                                className="w-16 bg-gray-800 border border-gray-600 rounded px-2 py-1 text-white text-center font-bold"
                                min="0"
                            />
                            <button
                                onClick={() => setXInput(String((parseInt(xInput) || 0) + 1))}
                                className="w-8 h-8 bg-gray-700 hover:bg-gray-600 rounded text-white font-bold"
                            >
                                +
                            </button>
                        </div>
                        {xValue > 0 && (
                            <div className="text-[10px] text-purple-300 mt-1">
                                Total X cost: {xValue} mana
                            </div>
                        )}
                    </div>
                )}

                {/* Remaining Cost */}
                {!isPaid && (
                    <div className="mb-3">
                        <span className="text-[10px] text-amber-400 uppercase font-bold">Remaining:</span>
                        <div className="flex items-center gap-1 mt-1 flex-wrap">
                            {remaining.map((sym, idx) => (
                                <div key={idx} className="w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold bg-amber-900/50 border border-amber-700 text-amber-400">
                                    {sym.value}
                                </div>
                            ))}
                        </div>
                    </div>
                )}

                {isPaid && (
                    <div className="mb-3 text-green-400 text-sm font-bold flex items-center gap-2 bg-green-900/20 border border-green-700/30 rounded-lg p-2">
                        <span className="w-3 h-3 rounded-full bg-green-500"></span>
                        Cost Covered by Pool!
                    </div>
                )}

                {/* Floating Mana Available */}
                <div className="border-t border-gray-700 pt-2">
                    <span className="text-[10px] text-gray-500 uppercase">Current Pool:</span>
                    <div className="flex gap-2 mt-2 flex-wrap">
                        {DISPLAY_COLORS.map(type => {
                            const count = floatingMana[type] || 0;
                            return (
                                <div
                                    key={type}
                                    className={`flex items-center gap-1 px-2 py-1 rounded ${count > 0 ? 'bg-gray-800' : 'bg-gray-800/30 opacity-50'}`}
                                >
                                    <img src={getIconPath(type)} className="w-4 h-4" alt={type} />
                                    <span className="text-white text-xs font-bold">{count}</span>
                                </div>
                            );
                        })}
                        {poolTotal(floatingMana) === 0 && (
                            <span className="text-gray-600 text-xs">Empty - tap cards to add</span>
                        )}
                    </div>
                </div>

                {/* Pay Button - Only shows when autoTap is enabled */}
                {autoTapEnabled && onPay && !isPaid && (
                    <button
                        onClick={onPay}
                        className="w-full mt-3 py-2 bg-blue-600 hover:bg-blue-500 text-white font-bold rounded-lg flex items-center justify-center gap-2"
                    >
                        <Zap size={16} />
                        Pay {remaining.length > 0 ? `(${remaining.length} to tap)` : ''}
                    </button>
                )}

            </div>
        </div>
    );
};

// Export getIconPath for use in other components
export { getIconPath };