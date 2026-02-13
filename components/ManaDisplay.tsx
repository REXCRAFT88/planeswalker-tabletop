import React, { useState, useEffect, useMemo } from 'react';
import { ManaPool, CategorizedManaInfo, MANA_COLORS, BASE_COLORS, parseManaCost, poolTotal, ManaColor } from '../services/mana';
import { Eye, EyeOff, Plus, Minus, X, Zap, CheckCircle, Crown } from 'lucide-react';
import { CardData } from '../types';

interface ManaDisplayProps {
    manaInfo: CategorizedManaInfo;
    floatingMana: ManaPool;
    onAddMana: (type: keyof ManaPool) => void;
    onRemoveMana: (type: keyof ManaPool) => void;
    onAutoTapColor?: (color: string) => void;
}

const DISPLAY_COLORS = ['W', 'U', 'B', 'R', 'G', 'C', 'CMD'] as const;

// Helper function for getting mana icon paths - defined at module level for reuse
const getIconPath = (type: string) => {
    switch (type) {
        case 'W': return '/mana/white.png';
        case 'U': return '/mana/blue.png';
        case 'B': return '/mana/black.png';
        case 'R': return '/mana/red.png';
        case 'G': return '/mana/green.png';
        case 'C': return '/mana/colorless.png';
        case 'CMD': return '/mana/all.png'; // Placeholder for CMD if no img
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
            <div className="bg-black/60 backdrop-blur-sm rounded-l-xl px-3 py-1.5 pointer-events-auto flex items-center gap-2 mb-1 border-l-2 border-amber-500 shadow-2xl">
                <div className="flex flex-col items-center">
                    <span className="text-[10px] text-amber-500 font-bold uppercase">Pool</span>
                    <span className="font-bold text-2xl leading-none text-amber-400 drop-shadow-md">
                        {totalFloating}
                    </span>
                </div>
                <div className="w-px h-8 bg-gray-700 mx-1" />
                <div className="flex flex-col items-center">
                    <span className="text-[10px] text-cyan-400 font-bold uppercase">Available</span>
                    <span className="font-bold text-xl leading-none text-white drop-shadow-md">
                        {manaInfo.availableTotal}
                    </span>
                    {manaInfo.potentialTotal > 0 && (
                        <span className="text-[9px] text-cyan-500 font-mono leading-none">+{manaInfo.potentialTotal}</span>
                    )}
                </div>
                <div className="w-px h-8 bg-gray-700 mx-1" />
                <div className="flex flex-col items-center">
                    <span className="text-[10px] text-gray-500 font-bold uppercase">Capacity</span>
                    <span className="font-bold text-base leading-none text-gray-400 drop-shadow-md">
                        {manaInfo.totalBoardPotential}
                    </span>
                    <span className="text-[8px] text-gray-600 font-mono leading-none">Total</span>
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

                        <div className="flex flex-col items-center justify-center w-12 mr-1">
                            {/* Counts */}
                            <div className="flex items-center gap-1.5">
                                {available > 0 ? (
                                    <span className="font-bold text-lg text-white drop-shadow-md" title="Available Board">
                                        {available}
                                    </span>
                                ) : (
                                    <span className="text-gray-700 font-bold">0</span>
                                )}
                            </div>
                            {potential > 0 && (
                                <span className="text-[9px] text-cyan-500 font-mono leading-none" title="Potential Tap Sources">+{potential}</span>
                            )}
                        </div>

                        <div
                            className="relative w-8 h-8 cursor-pointer hover:scale-110 active:scale-95 transition-transform flex items-center justify-center"
                            onClick={(e) => {
                                e.stopPropagation();
                                onAutoTapColor?.(type);
                            }}
                            title={`Click to auto-tap a ${type} source`}
                        >
                            {type === 'CMD' ? (
                                <Crown size={24} className="text-amber-500 drop-shadow-md fill-amber-500/20" />
                            ) : (
                                <>
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
                                </>
                            )}
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

// Mana Payment Sidebar Component - interactive tallying for costs
interface ManaPaymentSidebarProps {
    card: CardData;
    floatingMana: ManaPool;
    allocatedMana: ManaPool;
    onAllocate: (type: ManaColor) => void;
    onUnallocate: (type: ManaColor) => void;
    onXValueChange: (value: number) => void;
    onDismiss: () => void;
    onConfirm: () => void;
    availableMana?: ManaPool; // Remaining untapped mana sources
}

export const ManaPaymentSidebar: React.FC<ManaPaymentSidebarProps> = ({
    card,
    floatingMana,
    allocatedMana,
    onAllocate,
    onUnallocate,
    onXValueChange,
    onDismiss,
    onConfirm,
    availableMana
}) => {
    const xValue = (card as any).userXValue || 0;
    const [xInput, setXInput] = useState(String(xValue));
    const [hasAutoAllocated, setHasAutoAllocated] = useState(false);

    // Parse the mana cost
    const parsed = useMemo(() => parseManaCost(card.manaCost || ""), [card.manaCost]);
    const symbols = parsed.symbols;
    const hasX = parsed.hasX;

    // Calculate requirements
    const totalAllocated = Object.values(allocatedMana).reduce((a, b) => a + b, 0);
    const requiredTotal = parsed.cmc + xValue;

    // Group colored requirements by color with counts
    const getColoredRequirements = useMemo(() => {
        const coloredReqs: { color: ManaColor; count: number }[] = [];
        const hybridReqs: ManaColor[][] = [];

        for (const sym of symbols) {
            if (sym.type === 'colored') {
                const existing = coloredReqs.find(r => r.color === sym.color);
                if (existing) existing.count++;
                else coloredReqs.push({ color: sym.color, count: 1 });
            } else if (sym.type === 'hybrid') {
                hybridReqs.push(sym.options);
            }
        }

        return { coloredReqs, hybridReqs };
    }, [symbols]);

    // Determine missing requirements (colored costs) with counts
    const getRemainingColoredCosts = useMemo(() => {
        const remaining: { color: ManaColor; count: number }[] = [];
        const tempAllocated = { ...allocatedMana };

        // Process colored requirements
        for (const req of getColoredRequirements.coloredReqs) {
            let needed = req.count;

            // Use exact color from allocated
            if ((tempAllocated[req.color] || 0) > 0) {
                const used = Math.min(tempAllocated[req.color] || 0, needed);
                tempAllocated[req.color] = (tempAllocated[req.color] || 0) - used;
                needed -= used;
            }

            // Try WUBRG wildcard
            if (needed > 0 && (tempAllocated.WUBRG || 0) > 0) {
                const used = Math.min(tempAllocated.WUBRG || 0, needed);
                tempAllocated.WUBRG -= used;
                needed -= used;
            }

            // Try CMD wildcard
            if (needed > 0 && (tempAllocated.CMD || 0) > 0) {
                const used = Math.min(tempAllocated.CMD || 0, needed);
                tempAllocated.CMD -= used;
                needed -= used;
            }

            if (needed > 0) {
                remaining.push({ color: req.color, count: needed });
            }
        }

        // Process hybrid requirements
        for (const options of getColoredRequirements.hybridReqs) {
            let satisfied = false;

            // Try each option
            for (const opt of options) {
                if ((tempAllocated[opt] || 0) > 0) {
                    tempAllocated[opt]--;
                    satisfied = true;
                    break;
                }
            }

            // Try wildcards
            if (!satisfied && (tempAllocated.WUBRG || 0) > 0) {
                tempAllocated.WUBRG--;
                satisfied = true;
            }
            if (!satisfied && (tempAllocated.CMD || 0) > 0) {
                tempAllocated.CMD--;
                satisfied = true;
            }

            if (!satisfied) {
                // Show first option as the requirement with count 1
                remaining.push({ color: options[0], count: 1 });
            }
        }

        return remaining;
    }, [allocatedMana, getColoredRequirements]);

    const remainingColored = getRemainingColoredCosts;

    // Auto-allocate specific colored mana reactively
    useEffect(() => {
        // Try to pull colors for remaining colored requirements
        for (const req of remainingColored) {
            // If we have this exact color in floating pool, allocate it
            if ((floatingMana[req.color] || 0) > 0) {
                onAllocate(req.color);
                break; // One at a time for state stability
            }
        }
    }, [floatingMana, remainingColored, onAllocate]);

    // Improved isPaid logic: Total must be met AND all specific color requirements must be satisfied
    const isPaid = totalAllocated >= requiredTotal && remainingColored.length === 0;

    // Handle X input change
    useEffect(() => {
        const num = parseInt(xInput) || 0;
        if (num >= 0 && num !== xValue) {
            onXValueChange(num);
        }
    }, [xInput, onXValueChange, xValue]);

    // Calculate available mana remaining (from untapped sources)
    const totalAvailable = availableMana ? Object.values(availableMana).reduce((a, b) => a + b, 0) : 0;

    return (
        <div className="fixed right-2 bottom-20 z-[90] pointer-events-auto animate-in slide-in-from-right duration-300">
            <div className="bg-gray-900/50 backdrop-blur-md border border-white/10 rounded-xl p-3 shadow-xl w-52">
                <div className="flex justify-between items-start mb-2">
                    <div className="flex gap-2 items-center">
                        <img src={card.imageUrl} className="w-8 h-11 rounded object-cover border border-gray-700/50 shadow-md" alt="" />
                        <div>
                            <h3 className="text-xs font-bold text-white leading-tight">{card.name}</h3>
                            <div className="flex items-center gap-1 flex-wrap mt-0.5">
                                {symbols.reduce((acc, sym) => {
                                    const key = sym.type === 'generic' ? 'G' : (sym.type === 'colored' ? sym.color : (sym.type === 'x' ? 'X' : 'H'));
                                    const existing = acc.find(g => g.key === key);
                                    if (existing) existing.count += (sym.type === 'generic' ? sym.count : 1);
                                    else acc.push({ key, type: sym.type, color: (sym as any).color, count: (sym.type === 'generic' ? sym.count : 1) });
                                    return acc;
                                }, [] as any[]).map((group, idx) => (
                                    <div key={idx} className="flex items-center bg-black/40 rounded-full pr-1 font-bold border border-white/10 overflow-hidden">
                                        {group.type === 'colored' ? (
                                            <img src={getIconPath(group.color)} className="w-3.5 h-3.5" alt={group.color} />
                                        ) : (
                                            <div className="w-3.5 h-3.5 flex items-center justify-center text-[8px] text-gray-300">
                                                {group.type === 'x' ? 'X' : (group.type === 'generic' ? group.count : '?')}
                                            </div>
                                        )}
                                        {group.count > 1 && group.type !== 'generic' && (
                                            <span className="text-[10px] ml-0.5 text-white/90 leading-none">{group.count}</span>
                                        )}
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div>
                    <button onClick={onDismiss} className="p-1 hover:bg-red-900/40 rounded text-gray-400 hover:text-red-400 transition-colors">
                        <X size={14} />
                    </button>
                </div>

                {/* X Value Interactive Area */}
                {hasX && (
                    <div className="mb-2 bg-purple-900/20 border border-purple-500/20 rounded-lg p-2">
                        <div className="flex justify-between items-center mb-1">
                            <span className="text-[8px] text-purple-300 uppercase font-bold tracking-widest">X Value</span>
                            <span className="text-lg font-mono font-bold text-purple-400">{xValue}</span>
                        </div>
                        <div className="flex items-center gap-1">
                            <button
                                onClick={() => setXInput(String(Math.max(0, (parseInt(xInput) || 0) - 1)))}
                                className="flex-1 h-8 bg-gray-800 hover:bg-gray-700 rounded text-white font-bold text-lg active:scale-95 transition-all"
                            >-</button>
                            <input
                                type="number"
                                value={xInput}
                                onChange={(e) => setXInput(e.target.value)}
                                className="w-12 bg-black/40 border border-gray-700 rounded py-1 text-white text-center font-bold text-sm focus:border-purple-500 outline-none"
                            />
                            <button
                                onClick={() => setXInput(String((parseInt(xInput) || 0) + 1))}
                                className="flex-1 h-8 bg-gray-800 hover:bg-gray-700 rounded text-white font-bold text-lg active:scale-95 transition-all"
                            >+</button>
                        </div>
                    </div>
                )}

                {/* Status Bar */}
                <div className="flex justify-between items-center mb-2 px-1">
                    <span className="text-[9px] text-gray-400 uppercase font-bold">Payment</span>
                    <span className={`text-xs font-mono font-bold ${isPaid ? 'text-green-400' : 'text-amber-400'}`}>
                        {totalAllocated}/{requiredTotal}
                    </span>
                </div>

                {/* Mana Allocation Grid */}
                <div className="grid grid-cols-4 gap-1 mb-2">
                    {(['W', 'U', 'B', 'R', 'G', 'C'] as ManaColor[]).map(type => {
                        const inPool = floatingMana[type] || 0;
                        const allocated = allocatedMana[type] || 0;
                        if (inPool === 0 && allocated === 0) return null;

                        return (
                            <div key={type} className="bg-gray-800/40 border border-gray-700/50 rounded-lg p-1 flex flex-col items-center gap-0.5">
                                <img src={getIconPath(type)} className="w-4 h-4" alt={type} />
                                <div className="flex items-center justify-between w-full gap-0.5">
                                    <button
                                        onClick={() => onUnallocate(type)}
                                        disabled={allocated === 0}
                                        className="w-5 h-5 flex items-center justify-center bg-gray-700 hover:bg-gray-600 disabled:opacity-30 rounded text-white font-bold text-xs"
                                    >-</button>
                                    <span className="text-xs font-bold text-white">{allocated}</span>
                                    <button
                                        onClick={() => onAllocate(type)}
                                        disabled={inPool === 0}
                                        className="w-5 h-5 flex items-center justify-center bg-gray-700 hover:bg-gray-600 disabled:opacity-30 rounded text-white font-bold text-xs"
                                    >+</button>
                                </div>
                            </div>
                        );
                    })}
                </div>

                {/* Required Colors (symbol only, with count) */}
                {remainingColored.length > 0 && (
                    <div className="bg-amber-900/20 rounded-lg p-2 mb-2 border border-amber-700/30">
                        <span className="text-[8px] text-amber-500 font-bold uppercase block mb-1">Still Need:</span>
                        <div className="flex gap-1.5 flex-wrap">
                            {remainingColored.map((req, i) => (
                                <div key={i} className="flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-amber-900/40 border border-amber-700/50">
                                    <img src={getIconPath(req.color)} className="w-4 h-4" alt={req.color} />
                                    <span className="text-amber-400 text-xs font-bold">{req.count}</span>
                                </div>
                            ))}
                        </div>
                    </div>
                )}

                {/* Available Mana Indicator */}
                <div className="text-[9px] text-gray-500 mb-2 px-1 flex justify-between">
                    <span>Untapped sources:</span>
                    <span className="text-cyan-400 font-bold">{totalAvailable}</span>
                </div>

                {/* Confirm Button */}
                <button
                    onClick={onConfirm}
                    disabled={!isPaid}
                    className={`w-full py-2 rounded-lg font-bold text-xs shadow-lg transition-all flex items-center justify-center gap-1 ${isPaid
                        ? 'bg-green-600 hover:bg-green-500 text-white active:scale-95'
                        : 'bg-gray-800 text-gray-500 cursor-not-allowed border border-gray-700'
                        }`}
                >
                    <Zap size={14} fill={isPaid ? "currentColor" : "none"} />
                    {isPaid ? 'Confirm' : 'Need Mana'}
                </button>
            </div>
        </div>
    );
};

// Export getIconPath for use in other components
export { getIconPath };