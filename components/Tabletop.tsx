import React, { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { CardData, BoardObject, LogEntry, PlayerStats, ManaRule } from '../types';
import { Card } from './Card';
import { GameStatsModal } from './GameStatsModal';
import { ManaDisplay, ManaPaymentSidebar } from './ManaDisplay';
import { searchCards } from '../services/scryfall';
import { socket } from '../services/socket';
import { CARD_WIDTH, CARD_HEIGHT } from '../constants';
import { PLAYER_COLORS } from '../constants';
import {
    calculateAvailableMana, parseManaCost, autoTapForCost, addToManaPool, subtractFromPool,
    poolTotal, MANA_DISPLAY, MANA_COLORS, EMPTY_POOL, isBasicLand, getBasicLandColor, BASE_COLORS,
    type ManaPool, type ManaColor, type ManaSource, type UndoableAction, MAX_UNDO_HISTORY
} from '../services/mana';
import {
    LogOut, Search, ZoomIn, ZoomOut, History, ArrowUp, ArrowDown, GripVertical, Palette, Menu, Maximize, Minimize,
    Archive, X, Eye, Shuffle, Crown, Dices, Layers, ChevronRight, Hand, Play, Settings, Swords, Shield,
    Clock, Users, CheckCircle, Ban, ArrowRight, Disc, ChevronLeft, Trash2, ArrowLeft, Minus, Plus, Keyboard, RefreshCw, Loader, RotateCcw, BarChart3, ChevronUp, ChevronDown, Heart, Undo2, Droplets, Zap
} from 'lucide-react';

interface TabletopProps {
    initialDeck: CardData[];
    initialTokens: CardData[];
    playerName: string;
    sleeveColor?: string;
    roomId: string;
    initialGameStarted?: boolean;
    isLocal?: boolean;
    isLocalTableHost?: boolean;
    localOpponents?: { id?: string, name: string, deck: CardData[], tokens: CardData[], color: string, type?: 'ai' | 'human_local' | 'open_slot' }[];
    manaRules?: Record<string, ManaRule>;
    onExit: () => void;
}

interface LocalPlayerState {
    id: string;
    hand: CardData[];
    library: CardData[];
    graveyard: CardData[];
    exile: CardData[];
    commandZone: CardData[];
    life: number;
    counters: Record<string, number>;
    commanderDamage: Record<string, number>;
    mulliganCount: number;
    hasKeptHand: boolean;
}

interface DieRoll {
    id: string;
    value: number;
    sides: number;
    playerId: string;
    x: number;
    y: number;
}

interface ViewState {
    x: number;
    y: number;
    scale: number;
}

interface SearchState {
    isOpen: boolean;
    source: 'LIBRARY' | 'GRAVEYARD' | 'EXILE' | 'TOKENS' | 'HAND';
    items: { card: CardData; isRevealed: boolean }[];
    tray: CardData[];
    isReadOnly?: boolean;
    playerId?: string;
    tokenQuery?: string;
}

interface LibraryActionState {
    isOpen: boolean;
    cardId: string;
}

// Helper for mana icons
const getIconPath = (type: string) => {
    switch (type) {
        case 'W': return '/mana/white.png';
        case 'U': return '/mana/blue.png';
        case 'B': return '/mana/black.png';
        case 'R': return '/mana/red.png';
        case 'G': return '/mana/green.png';
        case 'C': return '/mana/colorless.png';
        case 'WUBRG': return '/mana/all.png';
        case 'CMD': return '/mana/all.png';
        default: return '/mana/all.png';
    }
};

const ruleToColors = (rule: ManaRule): ManaColor[] => {
    const colors: ManaColor[] = [];
    Object.entries(rule.produced).forEach(([color, count]) => {
        for (let i = 0; i < count; i++) colors.push(color as ManaColor);
    });
    return colors;
};

const ruleToActivationString = (rule: ManaRule): string => {
    const parts: string[] = [];
    if (rule.genericActivationCost && rule.genericActivationCost > 0) {
        parts.push(`{${rule.genericActivationCost}}`);
    }
    Object.entries(rule.activationCost).forEach(([color, count]) => {
        if (count > 0) parts.push(Array(count).fill(`{${color}}`).join(''));
    });
    return parts.join('');
};

// --- Layout Constants ---
const MAT_W = 840; // Wider to fit more cards
const MAT_H = 400;
const MAT_GAP = 20;

// Helper to get layout configurations
const getLayout = (totalPlayers: number, radius: number) => {
    const configs = [];

    if (totalPlayers <= 4) {
        // Standard 1-4 Player Layout
        const getSlot = (i: number, n: number) => {
            if (n === 2) return i === 0 ? 0 : 2;
            return i;
        };

        for (let i = 0; i < totalPlayers; i++) {
            const slot = getSlot(i, totalPlayers);
            let pos = { x: 0, y: 0, rot: 0 };
            if (slot === 0) { pos = { x: -MAT_W / 2, y: radius - MAT_H / 2, rot: 0 }; }
            else if (slot === 1) { pos = { x: -radius - MAT_W / 2, y: -MAT_H / 2, rot: 90 }; }
            else if (slot === 2) { pos = { x: -MAT_W / 2, y: -radius - MAT_H / 2, rot: 180 }; }
            else if (slot === 3) { pos = { x: radius - MAT_W / 2, y: -MAT_H / 2, rot: -90 }; }
            configs.push(pos);
        }
    } else if (totalPlayers === 5) {
        // 5-Player Layout: 2 on bottom, 1 on left end, 2 on top
        // Extra spacing to prevent zone overlap (library/graveyard/exile/command extend ~280px to the right of each mat)
        const sideDist = MAT_W + 350; // Distance from center to side mat (enough for zones)
        const longDist = 750; // Vertical distance from center to top/bottom rows
        const pairGap = 300; // Extra gap between paired mats to prevent deck/zone overlap

        // Bottom row: 2 mats spaced apart
        // Mat 0: Bottom Right
        configs.push({ x: pairGap / 2, y: longDist - MAT_H / 2, rot: 0 });
        // Mat 1: Bottom Left
        configs.push({ x: -MAT_W - pairGap / 2, y: longDist - MAT_H / 2, rot: 0 });

        // Left end: 1 mat rotated 90°
        configs.push({ x: -sideDist - MAT_W / 2, y: -MAT_H / 2, rot: 90 });

        // Top row: 2 mats spaced apart (rotated 180°)
        // Mat 3: Top Left
        configs.push({ x: -MAT_W - pairGap / 2, y: -longDist - MAT_H / 2, rot: 180 });
        // Mat 4: Top Right
        configs.push({ x: pairGap / 2, y: -longDist - MAT_H / 2, rot: 180 });
    } else {
        // 6-Player Layout: 2 on bottom, 1 on left end, 2 on top, 1 on right end
        // Extra spacing to prevent zone overlap
        const sideDist = MAT_W + 350; // Distance from center to side mats (enough for zones)
        const longDist = 750; // Vertical distance from center to top/bottom rows
        const pairGap = 300; // Extra gap between paired mats to prevent deck/zone overlap

        // Bottom row: 2 mats spaced apart
        // Mat 0: Bottom Right
        configs.push({ x: pairGap / 2, y: longDist - MAT_H / 2, rot: 0 });
        // Mat 1: Bottom Left
        configs.push({ x: -MAT_W - pairGap / 2, y: longDist - MAT_H / 2, rot: 0 });

        // Left end: 1 mat rotated 90°
        configs.push({ x: -sideDist - MAT_W / 2, y: -MAT_H / 2, rot: 90 });

        // Top row: 2 mats spaced apart (rotated 180°)
        // Mat 3: Top Left
        configs.push({ x: -MAT_W - pairGap / 2, y: -longDist - MAT_H / 2, rot: 180 });
        // Mat 4: Top Right
        configs.push({ x: pairGap / 2, y: -longDist - MAT_H / 2, rot: 180 });

        // Right end: 1 mat rotated -90°
        configs.push({ x: sideDist - MAT_W / 2, y: -MAT_H / 2, rot: -90 });
    }
    return configs;
};





// Zone Offsets (Relative to Mat Top-Left)
const ZONE_OFFSET_X = MAT_W + 30;
const ZONE_LIBRARY_OFFSET = { x: ZONE_OFFSET_X, y: 0 };
// Command Zone: Right of Library
const ZONE_COMMAND_OFFSET = { x: ZONE_OFFSET_X + CARD_WIDTH + 20, y: 0 };
// Graveyard: Below Library
const ZONE_GRAVEYARD_OFFSET = { x: ZONE_OFFSET_X, y: CARD_HEIGHT + 20 };
// Exile: Below Command (Right of Graveyard)
const ZONE_EXILE_OFFSET = { x: ZONE_OFFSET_X + CARD_WIDTH + 20, y: CARD_HEIGHT + 20 };

// --- Hand Card Component ---
const HandCard: React.FC<{
    card: CardData;
    scale: number;
    onInspect: (card: CardData) => void;
    onPlay: (card: CardData) => void;
    onSendToZone: (card: CardData, zone: 'GRAVEYARD' | 'EXILE') => void;
    isMobile: boolean;
    onMobileAction: (card: CardData) => void;
    onDoubleClick: (card: CardData) => void;
    shortcutKey?: string;
}> = ({ card, scale, onInspect, onPlay, onSendToZone, isMobile, onMobileAction }) => {
    const width = 160 * scale;
    const height = 224 * scale;
    const [showOverlay, setShowOverlay] = useState(false);
    const touchStart = useRef<{ x: number, y: number } | null>(null);
    const longPressTimer = useRef<NodeJS.Timeout | null>(null);

    const handleTouchStart = (e: React.TouchEvent) => {
        if (!isMobile) return;
        touchStart.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
        longPressTimer.current = setTimeout(() => {
            onMobileAction(card);
            touchStart.current = null; // Cancel drag if long press triggered
        }, 500);
    };

    const handleTouchMove = (e: React.TouchEvent) => {
        if (!isMobile || !touchStart.current) return;
        const dy = e.touches[0].clientY - touchStart.current.y;
        // If moved significantly, cancel long press
        if (Math.abs(dy) > 10) {
            if (longPressTimer.current) clearTimeout(longPressTimer.current);
        }
    };

    const handleTouchEnd = (e: React.TouchEvent) => {
        if (longPressTimer.current) clearTimeout(longPressTimer.current);
        if (!isMobile || !touchStart.current) return;

        const dy = e.changedTouches[0].clientY - touchStart.current.y;
        if (dy < -100) { // Dragged up significantly
            onPlay(card);
        }
        touchStart.current = null;
    };

    return (
        <div
            className="relative flex-shrink-0 transition-transform duration-200 ease-out cursor-pointer group hover:-translate-y-4 hover:z-50"
            style={{ width, height }}
            onClick={() => !isMobile && setShowOverlay(!showOverlay)}
            onMouseLeave={() => setShowOverlay(false)}
            onDoubleClick={() => isMobile && onInspect(card)}
            onTouchStart={handleTouchStart}
            onTouchMove={handleTouchMove}
            onTouchEnd={handleTouchEnd}
        >
            <div className="relative w-full h-full rounded-xl overflow-hidden shadow-2xl border border-black/50 bg-gray-800">
                <img src={card.imageUrl} className="w-full h-full object-cover" alt={card.name} />

                {/* Shortcut Indicator */}
                {card.shortcutKey && !isMobile && (
                    <div className="absolute bottom-1 left-1 bg-black/70 text-white text-[10px] font-bold px-1.5 rounded border border-white/20 pointer-events-none z-10 shadow-sm">
                        {card.shortcutKey}
                    </div>
                )}

                <div className={`absolute inset-0 bg-black/60 transition-opacity flex flex-col items-center justify-center gap-2 ${showOverlay && !isMobile ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'} ${isMobile ? 'hidden' : ''}`}>
                    <button onClick={(e) => { e.stopPropagation(); onPlay(card); }} className="px-4 py-1 bg-blue-600 hover:bg-blue-500 text-white rounded-full font-bold text-sm shadow-lg transform hover:scale-105 flex items-center gap-1">
                        <Play size={12} /> Play
                    </button>
                    <div className="flex gap-2">
                        <button onClick={(e) => { e.stopPropagation(); onInspect(card); }} className="p-2 bg-gray-700 hover:bg-gray-600 text-white rounded-full" title="Inspect">
                            <ZoomIn size={16} />
                        </button>
                        <button onClick={(e) => { e.stopPropagation(); onSendToZone(card, 'EXILE'); }} className="p-2 bg-gray-700 hover:bg-gray-600 text-white rounded-full" title="Exile">
                            <X size={16} />
                        </button>
                        <button onClick={(e) => { e.stopPropagation(); onSendToZone(card, 'GRAVEYARD'); }} className="p-2 bg-red-900/80 hover:bg-red-800 text-white rounded-full" title="Discard">
                            <Archive size={16} />
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
};

const Die: React.FC<{ value: number, sides: number, x: number, y: number, color: string, rotation: number }> = ({ value, sides, x, y, color, rotation }) => {
    return createPortal(
        <div
            className="absolute flex items-center justify-center z-[1000] animate-in zoom-in spin-in duration-500 ease-out"
            style={{
                left: x, top: y,
                width: 64, height: 64,
                transform: 'translate(-50%, -50%)'
            }}
        >
            <div
                className="w-full h-full flex items-center justify-center bg-gray-900 border-4 rounded-xl shadow-[0_0_30px_rgba(0,0,0,0.5)] relative overflow-hidden"
                style={{ borderColor: color, boxShadow: `0 0 20px ${color}60` }}
            >
                <div className="absolute inset-0 bg-white/10" />
                <span className="text-3xl font-bold text-white drop-shadow-md" style={{ transform: `rotate(${-rotation}deg)` }}>{value}</span>
                <span className="absolute bottom-1 text-[8px] text-gray-400 font-bold">D{sides}</span>
            </div>
        </div>,
        document.body
    );
};

interface Player {
    id: string;
    userId?: string;
    name: string;
    color: string;
    disconnected?: boolean;
}

interface ZoneLayout {
    library: { x: number; y: number };
    graveyard: { x: number; y: number };
    exile: { x: number; y: number };
    command: { x: number; y: number };
}

interface ZoneCounts {
    library: number;
    graveyard: number;
    exile: number;
    hand: number;
    command: number;
}

// ...

interface PlaymatProps {
    x: number;
    y: number;
    width: number;
    height: number;
    playerName: string;
    rotation: number;
    zones: ZoneLayout;
    counts: ZoneCounts;
    sleeveColor: string;
    topGraveyardCard?: CardData;
    isShuffling: boolean;
    isControlled: boolean;
    commanders: CardData[];
    onDraw: () => void;
    onShuffle: () => void;
    onOpenSearch: (source: 'LIBRARY' | 'GRAVEYARD' | 'EXILE' | 'TOKENS' | 'HAND') => void;
    onPlayCommander: (card: CardData) => void;
    onPlayTopLibrary: () => void;
    onPlayTopGraveyard: () => void;
    onInspectCommander: (card: CardData) => void;
    onViewHand?: () => void;
    isMobile: boolean;
    onMobileZoneAction: (zone: string) => void;
    onDoubleClickZone: (zone: 'LIBRARY' | 'GRAVEYARD' | 'EXILE') => void;
    disconnected?: boolean;
}

const Playmat: React.FC<PlaymatProps> = ({
    x, y, width, height, playerName, rotation, zones, counts, sleeveColor,
    topGraveyardCard, isShuffling, isControlled, commanders,
    onDraw, onShuffle, onOpenSearch, onPlayCommander, onPlayTopLibrary, onPlayTopGraveyard, onInspectCommander, onViewHand,
    isMobile, onMobileZoneAction, onDoubleClickZone, disconnected
}) => {

    const longPressTimer = useRef<NodeJS.Timeout | null>(null);
    const isLongPress = useRef(false);
    const tapTimer = useRef<NodeJS.Timeout | null>(null);
    const tapCount = useRef(0);

    const handleZoneTouch = (zone: string, e: React.TouchEvent) => {
        if (!isMobile || !isControlled) return;
        e.stopPropagation();
        onMobileZoneAction(zone);
    };

    const handleZoneTouchStart = (zone: string, e: React.TouchEvent) => {
        if (!isMobile || !isControlled || disconnected) return;
        e.stopPropagation();
        isLongPress.current = false;

        if (tapTimer.current) clearTimeout(tapTimer.current);
        if (longPressTimer.current) clearTimeout(longPressTimer.current);

        if (zone === 'LIBRARY') {
            tapCount.current += 1;

            longPressTimer.current = setTimeout(() => {
                isLongPress.current = true;
                tapCount.current = 0;
                onMobileZoneAction(zone);
            }, 600);

            if (tapCount.current === 2) {
                onOpenSearch('LIBRARY');
                tapCount.current = 0;
                if (longPressTimer.current) clearTimeout(longPressTimer.current);
            }

        } else {
            // Existing logic for other zones.
            longPressTimer.current = setTimeout(() => {
                isLongPress.current = true;
                onMobileZoneAction(zone);
            }, 500);
        }
    };

    const handleZoneTouchEnd = (zone: string) => {
        if (longPressTimer.current) {
            clearTimeout(longPressTimer.current);
            longPressTimer.current = null;
        }

        if (isLongPress.current) {
            isLongPress.current = false;
            tapCount.current = 0;
            return;
        }

        if (zone === 'LIBRARY') {
            if (tapCount.current === 1) {
                tapTimer.current = setTimeout(() => {
                    onDraw();
                    tapCount.current = 0;
                }, 300);
            }
        }
    };

    const handleLibraryClick = (e: React.MouseEvent) => {
        if (disconnected || isMobile) return;

        // Desktop logic: check for long press
        if (isLongPress.current) {
            e.stopPropagation();
            return;
        }
        onDraw();
    };

    const handleCommanderTouch = (cmd: CardData, e: React.TouchEvent) => {
        if (!isMobile) return;
        e.stopPropagation();
        if (isControlled) onPlayCommander(cmd);
        else onInspectCommander(cmd);
    };

    return (
        <div
            className={`absolute bg-gray-900/40 rounded-3xl border transition-all duration-500 ${disconnected ? 'opacity-50' : ''}`}
            style={{
                left: x, top: y, width, height,
                borderColor: sleeveColor,
                boxShadow: `0 0 15px ${sleeveColor}20`,
                transform: `rotate(${rotation}deg)`
            }}
        >
            <div className="absolute bottom-4 left-6 text-white/30 font-bold text-xl uppercase tracking-widest pointer-events-none">
                {playerName}
            </div>

            {disconnected && (
                <div className="absolute inset-0 flex items-center justify-center bg-black/50 z-50">
                    <div className="text-white font-bold text-2xl uppercase tracking-widest -rotate-45 border-4 border-white/50 p-4 rounded-lg">Disconnected</div>
                </div>
            )}

            {/* Library Zone */}
            <div
                className="absolute group"
                style={{ left: zones.library.x, top: zones.library.y, width: CARD_WIDTH, height: CARD_HEIGHT }}
            >
                <div
                    className="w-full h-full rounded bg-gray-800 border-2 border-white/20 flex items-center justify-center hover:border-blue-400 transition relative overflow-hidden cursor-pointer active:scale-95"
                    onClick={handleLibraryClick}
                    onTouchStart={isMobile ? (e) => handleZoneTouchStart('LIBRARY', e) : undefined}
                    onTouchEnd={isMobile ? () => handleZoneTouchEnd('LIBRARY') : undefined}
                    style={{ backgroundColor: sleeveColor }}
                >
                    <div className="text-white font-bold text-2xl z-10 pointer-events-none">{counts.library}</div>
                    {isShuffling && <div className="absolute inset-0 flex items-center justify-center bg-black/50 text-xs text-white z-20">Shuffling...</div>}

                    {isControlled && !isMobile && <div className="absolute bottom-1 right-1 bg-black/70 text-white text-[10px] font-bold px-1.5 rounded border border-white/20 pointer-events-none z-20 shadow-sm">X</div>}
                    <div className={`absolute inset-0 bg-black/60 opacity-0 ${!isMobile ? 'group-hover:opacity-100' : 'hidden'} transition-opacity flex flex-col items-center justify-center gap-2 z-30`}
                        onClick={(e) => e.stopPropagation()}
                    >
                        {isControlled && (
                            <>
                                <button onClick={onDraw} className="px-3 py-1 bg-green-600 hover:bg-green-500 text-white rounded-full text-xs font-bold shadow-lg w-20 flex items-center justify-center gap-1">
                                    <Hand size={12} /> Draw
                                </button>
                                <button onClick={onPlayTopLibrary} className="px-3 py-1 bg-blue-600 hover:bg-blue-500 text-white rounded-full text-xs font-bold shadow-lg w-20 flex items-center justify-center gap-1">
                                    <Play size={12} /> Play
                                </button>
                            </>
                        )}
                        <div className="flex gap-2">
                            {isControlled && <button onClick={onShuffle} className="p-2 bg-gray-700 hover:bg-gray-600 text-white rounded-full" title="Shuffle">
                                <Shuffle size={14} />
                            </button>}
                            <button onClick={() => onOpenSearch('LIBRARY')} className="p-2 bg-gray-700 hover:bg-gray-600 text-white rounded-full" title="Search">
                                <Search size={14} />
                            </button>
                        </div>
                    </div>
                </div>
                <div className="absolute -top-6 w-full text-center text-xs text-gray-500 font-bold uppercase">Library</div>
            </div>

            {/* Graveyard Zone */}
            <div
                className="absolute group"
                style={{ left: zones.graveyard.x, top: zones.graveyard.y, width: CARD_WIDTH, height: CARD_HEIGHT }}
            >
                <div
                    className="w-full h-full rounded bg-gray-800/50 border-2 border-white/10 flex items-center justify-center relative overflow-hidden cursor-pointer active:scale-95"
                    onClick={isMobile || disconnected ? undefined : () => onOpenSearch('GRAVEYARD')}
                    onTouchStart={isMobile ? (e) => handleZoneTouchStart('GRAVEYARD', e) : undefined}
                    onTouchEnd={isMobile ? () => handleZoneTouchEnd('GRAVEYARD') : undefined}
                    onDoubleClick={() => isMobile && !disconnected && onDoubleClickZone('GRAVEYARD')}
                >
                    {topGraveyardCard ? (
                        <img src={topGraveyardCard.imageUrl} className="w-full h-full object-cover rounded opacity-80 hover:opacity-100" alt="Graveyard" />
                    ) : (
                        <div className="text-white/20 text-3xl"><Archive /></div>
                    )}
                    {isControlled && !isMobile && <div className="absolute bottom-1 right-1 bg-black/70 text-white text-[10px] font-bold px-1.5 rounded border border-white/20 pointer-events-none z-20 shadow-sm">G</div>}
                    <div className="absolute top-0 right-0 bg-black/80 text-white text-xs px-1.5 rounded-bl font-bold z-10">{counts.graveyard}</div>

                    <div className={`absolute inset-0 bg-black/60 opacity-0 ${!isMobile ? 'group-hover:opacity-100' : 'hidden'} transition-opacity flex flex-col items-center justify-center gap-2 z-20`}
                        onClick={(e) => e.stopPropagation()}
                    >
                        {topGraveyardCard && isControlled && (
                            <button onClick={onPlayTopGraveyard} className="px-3 py-1 bg-gray-700 hover:bg-gray-600 text-white rounded-full text-xs font-bold shadow-lg w-20">
                                Play Top
                            </button>
                        )}
                        <button onClick={() => onOpenSearch('GRAVEYARD')} className="p-2 bg-gray-700 hover:bg-gray-600 text-white rounded-full" title="View All">
                            <Search size={14} />
                        </button>
                    </div>
                </div>
                <div className="absolute -top-6 w-full text-center text-xs text-gray-500 font-bold uppercase">Graveyard</div>
            </div>

            {/* Exile Zone */}
            <div
                className="absolute group"
                style={{ left: zones.exile.x, top: zones.exile.y, width: CARD_WIDTH, height: CARD_HEIGHT }}
            >
                <div
                    className="w-full h-full rounded bg-black/40 border-2 border-dashed border-white/10 flex items-center justify-center cursor-pointer hover:border-red-400/50 active:scale-95"
                    onClick={isMobile || disconnected ? undefined : () => onOpenSearch('EXILE')}
                    onTouchStart={isMobile ? (e) => handleZoneTouchStart('EXILE', e) : undefined}
                    onTouchEnd={isMobile ? () => handleZoneTouchEnd('EXILE') : undefined}
                    onDoubleClick={() => isMobile && !disconnected && onDoubleClickZone('EXILE')}
                >
                    <div className="text-white/20 text-sm rotate-45">Exile</div>
                    {isControlled && !isMobile && <div className="absolute bottom-1 right-1 bg-black/70 text-white text-[10px] font-bold px-1.5 rounded border border-white/20 pointer-events-none z-20 shadow-sm">E</div>}
                    <div className="absolute top-0 right-0 bg-black/80 text-white text-xs px-1.5 rounded-bl font-bold">{counts.exile}</div>
                </div>
                <div className="absolute -top-6 w-full text-center text-xs text-gray-500 font-bold uppercase">Exile</div>
            </div>

            {/* Command Zone */}
            <div
                className="absolute flex flex-col gap-2"
                style={{ left: zones.command.x, top: zones.command.y }}
            >
                {commanders.map(cmd => (
                    <div
                        key={cmd.id}
                        className="relative bg-gray-800 border border-amber-500/30 cursor-pointer hover:scale-105 transition-transform"
                        style={{ width: CARD_WIDTH, height: CARD_HEIGHT }}
                        onClick={(e) => isMobile ? handleCommanderTouch(cmd, e as any) : (isControlled ? onPlayCommander(cmd) : onInspectCommander(cmd))}
                        title={isControlled ? "Click to Cast Commander" : "Click to Inspect"}
                    >
                        <img src={cmd.imageUrl} className="w-full h-full object-cover rounded opacity-90" alt={cmd.name} />
                        {isControlled && !isMobile && <div className="absolute bottom-1 right-1 bg-black/70 text-white text-[10px] font-bold px-1.5 rounded border border-white/20 pointer-events-none z-20 shadow-sm">C</div>}
                        <div className="absolute -top-2 -right-2 bg-amber-600 text-black p-1 rounded-full shadow-lg">
                            <Crown size={16} />
                        </div>
                    </div>
                ))}
                {commanders.length === 0 && (
                    <div
                        className="rounded border-2 border-dashed border-white/10 flex items-center justify-center text-center p-2 text-white/20 text-xs"
                        style={{ width: CARD_WIDTH, height: CARD_HEIGHT }}
                    >
                        Command Zone Empty
                    </div>
                )}
            </div>

            {/* Hand Visualization */}
            {counts.hand > 0 && !isControlled && (
                <div
                    className="absolute flex items-center justify-center cursor-help group"
                    style={{
                        left: '50%',
                        bottom: -40,
                        transform: 'translateX(-50%)',
                        width: Math.min(counts.hand * 15 + CARD_WIDTH * 0.6, 200),
                        height: CARD_HEIGHT * 0.6,
                        zIndex: 50
                    }}
                    onClick={(e) => {
                        e.stopPropagation();
                        if (onViewHand) onViewHand();
                    }}
                    title="Click to Request View Hand"
                >
                    {Array.from({ length: Math.min(counts.hand, 7) }).map((_, i) => {
                        const fanAngle = 20;
                        const angleStep = Math.min(counts.hand, 7) > 1 ? fanAngle / (Math.min(counts.hand, 7) - 1) : 0;
                        const rot = -fanAngle / 2 + i * angleStep;

                        return (
                            <div
                                key={`hand-card-${i}`}
                                className="absolute bg-blue-900 border border-white/50 rounded shadow-lg transition-transform group-hover:-translate-y-2 pointer-events-none"
                                style={{
                                    width: CARD_WIDTH * 0.6,
                                    height: CARD_HEIGHT * 0.6,
                                    left: i * 15,
                                    transform: `rotate(${rot}deg)`,
                                    transformOrigin: 'bottom center'
                                }}
                            >
                                <div className="w-full h-full rounded border border-white/10 bg-gradient-to-br from-blue-800 to-blue-950" />
                            </div>
                        );
                    })}
                    {counts.hand > 7 && (
                        <div className="absolute -right-2 -top-2 bg-red-600 text-white text-xs font-bold px-1.5 py-0.5 rounded-full z-10 shadow">
                            +{counts.hand - 7}
                        </div>
                    )}
                    <div className="absolute -bottom-6 w-full text-center text-[10px] text-gray-300 font-bold bg-black/70 rounded px-2 py-0.5 pointer-events-none">
                        {counts.hand} Cards In Hand
                    </div>
                </div>
            )}
        </div>
    );
};

const DamageReportModal: React.FC<{
    isOpen: boolean;
    onClose: () => void;
    players: Player[];
    damage: number;
    healing: number;
    onConfirm: (damageReport: Record<string, number>, healingReport: Record<string, number>) => void;
}> = ({ isOpen, onClose, players, damage, healing, onConfirm }) => {
    const [damageReport, setDamageReport] = useState<Record<string, number>>({});
    const [healingReport, setHealingReport] = useState<Record<string, number>>({});

    if (!isOpen) return null;

    const handleDamageChange = (playerId: string, val: string) => {
        const num = parseInt(val) || 0;
        setDamageReport(prev => ({ ...prev, [playerId]: num }));
    };

    const handleHealingChange = (playerId: string, val: string) => {
        const num = parseInt(val) || 0;
        setHealingReport(prev => ({ ...prev, [playerId]: num }));
    };

    const handleSubmit = () => {
        onConfirm(damageReport, healingReport);
        setDamageReport({});
        setHealingReport({});
        onClose();
    };

    return (
        <div className="fixed inset-0 z-[12000] bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in">
            <div className="bg-gray-800 border border-gray-600 rounded-xl p-6 shadow-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
                <h3 className="text-xl font-bold text-white mb-4">Life Change Report</h3>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                    {damage > 0 && (
                        <div>
                            <h4 className="text-red-400 font-bold mb-2 border-b border-red-900/50 pb-1">Damage Taken ({damage})</h4>
                            <p className="text-xs text-gray-400 mb-3">Who dealt this damage?</p>
                            <div className="space-y-2">
                                {players.map(p => (
                                    <div key={`dmg-${p.id}`} className="flex items-center justify-between bg-gray-700/30 p-2 rounded border border-gray-600">
                                        <span className="text-gray-300 text-sm">{p.name}</span>
                                        <input
                                            type="number"
                                            placeholder="0"
                                            className="w-16 bg-gray-900 border border-gray-500 rounded px-2 py-1 text-white text-right text-sm focus:border-red-500 outline-none"
                                            onChange={(e) => handleDamageChange(p.id, e.target.value)}
                                        />
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}

                    {healing > 0 && (
                        <div>
                            <h4 className="text-green-400 font-bold mb-2 border-b border-green-900/50 pb-1">Healing Received ({healing})</h4>
                            <p className="text-xs text-gray-400 mb-3">Who provided this healing?</p>
                            <div className="space-y-2">
                                {players.map(p => (
                                    <div key={`heal-${p.id}`} className="flex items-center justify-between bg-gray-700/30 p-2 rounded border border-gray-600">
                                        <span className="text-gray-300 text-sm">{p.name}</span>
                                        <input
                                            type="number"
                                            placeholder="0"
                                            className="w-16 bg-gray-900 border border-gray-500 rounded px-2 py-1 text-white text-right text-sm focus:border-green-500 outline-none"
                                            onChange={(e) => handleHealingChange(p.id, e.target.value)}
                                        />
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}
                </div>

                <div className="flex justify-end gap-3 mt-6 pt-4 border-t border-gray-700">
                    <button onClick={onClose} className="px-4 py-2 text-gray-400 hover:text-white">Skip</button>
                    <button onClick={handleSubmit} className="px-6 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg font-bold">Confirm</button>
                </div>
            </div>
        </div>
    );
};

const PlayerManagerModal: React.FC<{
    isOpen: boolean;
    onClose: () => void;
    players: Player[];
    onKick: (id: string) => void;
    onReorder: (fromIdx: number, toIdx: number) => void;
    onAssignState: (playerId: string, seatIdx: number) => void;
    onResetGame: () => void;
    onRestoreBackup: () => void;
}> = ({ isOpen, onClose, players, onKick, onReorder, onAssignState, onResetGame, onRestoreBackup }) => {
    if (!isOpen) return null;

    const handleDragStart = (e: React.DragEvent, index: number) => {
        e.dataTransfer.setData('text/plain', index.toString());
    };

    const handleDrop = (e: React.DragEvent, dropIndex: number) => {
        e.preventDefault();
        const dragIndex = parseInt(e.dataTransfer.getData('text/plain'));
        if (dragIndex !== dropIndex) {
            onReorder(dragIndex, dropIndex);
        }
    };

    return (
        <div className="fixed inset-0 z-[12000] bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in">
            <div className="bg-gray-800 border border-gray-600 rounded-xl p-6 shadow-2xl max-w-lg w-full">
                <div className="flex justify-between items-center mb-6 border-b border-gray-700 pb-4">
                    <h3 className="text-2xl font-bold text-white flex items-center gap-2"><Shield className="text-blue-500" /> Host Controls</h3>
                    <button onClick={onClose} className="text-gray-400 hover:text-white"><X size={24} /></button>
                </div>

                <div className="mb-6">
                    <h4 className="text-sm font-bold text-gray-400 uppercase mb-3">Player Management</h4>
                    <p className="text-xs text-gray-500 mb-2">Drag to reorder seats. Click "Load Data" to assign a player to that seat's saved data.</p>
                    <div className="space-y-2">
                        {players.map((p, idx) => (
                            <div
                                key={p.id}
                                className="flex items-center gap-3 bg-gray-700/50 p-3 rounded-lg border border-gray-600"
                                draggable
                                onDragStart={(e) => handleDragStart(e, idx)}
                                onDragOver={(e) => e.preventDefault()}
                                onDrop={(e) => handleDrop(e, idx)}
                            >
                                <GripVertical className="text-gray-500 cursor-grab" size={16} />
                                <span className="text-gray-400 font-mono w-4">{idx + 1}.</span>
                                <div className="w-6 h-6 rounded-full border border-white/20" style={{ backgroundColor: p.color }} />
                                <span className="flex-1 font-semibold text-white truncate">{p.name} {p.disconnected && '(DC)'}</span>
                                <button onClick={() => onKick(p.id)} className="p-1.5 bg-red-900/30 hover:bg-red-900/50 text-red-400 rounded border border-red-900/50" title="Kick Player"><Ban size={14} /></button>
                            </div>
                        ))}
                    </div>
                </div>

                <div className="pt-4 border-t border-gray-700 flex gap-3">
                    <button onClick={onResetGame} className="flex-1 py-3 bg-red-600 hover:bg-red-500 text-white rounded-lg font-bold flex items-center justify-center gap-2"><RotateCcw size={18} /> Reset Table</button>
                    <button onClick={onRestoreBackup} className="flex-1 py-3 bg-gray-700 hover:bg-gray-600 text-white rounded-lg font-bold flex items-center justify-center gap-2"><History size={18} /> Restore Backup</button>
                </div>
            </div>
        </div>
    );
};

const HealthModal: React.FC<{
    isOpen: boolean;
    onClose: () => void;
    players: Player[];
    life: Record<string, number>;
    commanderDamage: Record<string, Record<string, number>>;
}> = ({ isOpen, onClose, players, life, commanderDamage }) => {
    if (!isOpen) return null;
    return (
        <div className="fixed inset-0 z-[12000] bg-black/90 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in" onClick={onClose}>
            <div className="bg-gray-800 border border-gray-600 rounded-xl p-6 shadow-2xl w-full max-w-md" onClick={e => e.stopPropagation()}>
                <h3 className="text-xl font-bold text-white mb-4 flex items-center gap-2"><Heart className="text-red-500" /> Player Health</h3>
                <div className="space-y-4">
                    {players.map(p => (
                        <div key={p.id} className="bg-gray-700/50 p-3 rounded-lg border border-gray-600">
                            <div className="flex justify-between items-center mb-2">
                                <div className="flex items-center gap-2">
                                    <div className="w-4 h-4 rounded-full" style={{ backgroundColor: p.color }} />
                                    <span className="font-bold text-white">{p.name}</span>
                                </div>
                                <span className="text-2xl font-bold text-white">{life[p.id]}</span>
                            </div>
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
};

const emptyStats: PlayerStats = {
    damageDealt: {}, damageReceived: 0, healingGiven: 0, healingReceived: 0, selfHealing: 0,
    tappedCounts: {},
    totalTurnTime: 0, cardsPlayed: 0, cardsSentToGraveyard: 0,
    cardsExiled: 0, cardsDrawn: 0,
    manaUsed: {}, manaProduced: {}
};

export const Tabletop: React.FC<TabletopProps> = ({ initialDeck, initialTokens, playerName, sleeveColor = '#ef4444', roomId, initialGameStarted, isLocal = false, isLocalTableHost = false, localOpponents = [], manaRules, onExit }) => {
    // --- State Declarations ---
    const [gamePhase, setGamePhase] = useState<'SETUP' | 'MULLIGAN' | 'PLAYING'>('SETUP');
    const [mulligansAllowed, setMulligansAllowed] = useState(true);
    const [freeMulligan, setFreeMulligan] = useState(true);
    const [trackDamage, setTrackDamage] = useState(false);
    const [mulliganCount, setMulliganCount] = useState(0);
    const [mulliganSelectionMode, setMulliganSelectionMode] = useState(false);
    const [cardsToBottom, setCardsToBottom] = useState<CardData[]>([]);

    const [turnStartTime, setTurnStartTime] = useState(Date.now());
    const [elapsedTime, setElapsedTime] = useState(0);
    const [round, setRound] = useState(1);
    const [turn, setTurn] = useState(1);
    const [currentTurnPlayerId, setCurrentTurnPlayerId] = useState<string>('');

    const [playersList, setPlayersList] = useState<Player[]>([
        { id: isLocal ? 'player-0' : 'local-player', name: playerName, color: sleeveColor }
    ]);
    const [turnOrder, setTurnOrder] = useState<string[]>([]);
    const [mySeatIndex, setMySeatIndex] = useState(0);

    const [boardObjects, setBoardObjects] = useState<BoardObject[]>([]);
    const [hand, setHand] = useState<CardData[]>([]);
    const [library, setLibrary] = useState<CardData[]>([]);
    const [graveyard, setGraveyard] = useState<CardData[]>([]);
    const [exile, setExile] = useState<CardData[]>([]);
    const [commandZone, setCommandZone] = useState<CardData[]>([]);
    const [life, setLife] = useState(40);
    const [logs, setLogs] = useState<LogEntry[]>([]);
    const [commanderDamage, setCommanderDamage] = useState<Record<string, Record<string, number>>>({});
    const [opponentsLife, setOpponentsLife] = useState<Record<string, number>>({});

    const [gameStats, setGameStats] = useState<Record<string, PlayerStats>>({});

    // Opponent Counts State
    const [opponentsCounts, setOpponentsCounts] = useState<Record<string, { library: number, graveyard: number, exile: number, hand: number, command: number }>>({});
    const [opponentsCommanders, setOpponentsCommanders] = useState<Record<string, CardData[]>>({});
    const [mobileControllers, setMobileControllers] = useState<Set<string>>(new Set());

    const [incomingViewRequest, setIncomingViewRequest] = useState<{ requesterId: string, requesterName: string, zone: string } | null>(null);
    const [hoveredCardId, setHoveredCardId] = useState<string | null>(null);
    const [pendingPaymentCard, setPendingPaymentCard] = useState<CardData | null>(null);
    const [allocatedMana, setAllocatedMana] = useState<ManaPool>(EMPTY_POOL);
    const isDraggingRef = useRef(false);

    const [showManaCalculator, setShowManaCalculator] = useState(true);
    const [incomingJoinRequest, setIncomingJoinRequest] = useState<{ applicantId: string, name: string, color: string } | null>(null);
    const [areTokensExpanded, setAreTokensExpanded] = useState(false);

    // UI State
    const [isLogOpen, setIsLogOpen] = useState(false);
    const [showShortcuts, setShowShortcuts] = useState(false);
    const [view, setView] = useState<ViewState>({ x: window.innerWidth / 2, y: window.innerHeight / 2, scale: 0.5 });

    // Opponent View State
    const [isOpponentViewOpen, setIsOpponentViewOpen] = useState(false);
    const [opponentView, setOpponentView] = useState<ViewState>({ x: 0, y: 0, scale: 0.6 });
    const [selectedOpponentIndex, setSelectedOpponentIndex] = useState(0);

    const [maxZ, setMaxZ] = useState(100);
    const [isShuffling, setIsShuffling] = useState(false);
    const [statusMessage, setStatusMessage] = useState<string>("");
    const [handScale, setHandScale] = useState(window.innerWidth < 768 ? 0.6 : 1);

    // Modal States
    const [inspectCard, setInspectCard] = useState<CardData | null>(null);
    const [searchModal, setSearchModal] = useState<SearchState>({ isOpen: false, source: 'LIBRARY', items: [], tray: [] });
    const [tokenSearchTerm, setTokenSearchTerm] = useState("token");
    const [libraryAction, setLibraryAction] = useState<LibraryActionState>({ isOpen: false, cardId: '' });
    const [showCmdrDamage, setShowCmdrDamage] = useState(false);
    const [isHost, setIsHost] = useState(false);
    const [showEndGameModal, setShowEndGameModal] = useState(false);
    const [showStatsModal, setShowStatsModal] = useState(false);
    const [revealedCards, setRevealedCards] = useState<CardData[]>([]);
    const [showPlayerManager, setShowPlayerManager] = useState(false);
    const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
    const [showDamageReportModal, setShowDamageReportModal] = useState(false);
    const [mobileZoneMenu, setMobileZoneMenu] = useState<string | null>(null);
    const damageTakenThisTurn = useRef(0);
    const healingReceivedThisTurn = useRef(0);
    const [damageReportData, setDamageReportData] = useState({ damage: 0, healing: 0 });
    const [activeDice, setActiveDice] = useState<DieRoll[]>([]);

    const [autoTapEnabled, setAutoTapEnabled] = useState(false); // Disabled by default
    const [floatingMana, setFloatingMana] = useState<ManaPool>({ ...EMPTY_POOL });
    const [lastPlayedCard, setLastPlayedCard] = useState<CardData | null>(null);
    const [autoTappedIds, setAutoTappedIds] = useState<string[]>([]);
    const autoTapFlashTimer = useRef<NodeJS.Timeout | null>(null);

    const [manaRulesState, setManaRulesState] = useState<Record<string, ManaRule>>(manaRules || {});
    const [choosingColorForId, setChoosingColorForId] = useState<string | null>(null);
    const [choosingRuleForId, setChoosingRuleForId] = useState<string | null>(null);

    // Sync state with prop initially or if prop changes (but allow internal override)
    useEffect(() => {
        if (manaRules) setManaRulesState(manaRules);
    }, [manaRules]);

    // --- Undo System ---
    const [undoHistory, setUndoHistory] = useState<UndoableAction[]>([]);
    const pushUndo = useCallback((action: UndoableAction) => {
        setUndoHistory(prev => [...prev.slice(-(MAX_UNDO_HISTORY - 1)), action]);
    }, []);

    // Persist mana settings
    useEffect(() => {
        localStorage.setItem('planeswalker_auto_tap', String(autoTapEnabled));
    }, [autoTapEnabled]);

    // Local Table Host Logic
    useEffect(() => {
        if (isLocalTableHost && roomId && roomId !== 'LOCAL') {
            const s = socket;
            if (!s.connected) s.connect();

            // Host joins the room as a specific "table" entity or just as a player?
            // For now, let's join as the "Host" player.
            s.emit('join_room', { room: roomId, name: playerName, color: sleeveColor, userId: 'host-table-' + Date.now(), isTable: true });

            // Allow mobile players to join Open Slots
            s.on('get_slots', () => {
                const slots = localOpponents
                    .filter(opp => opp.type === 'open_slot' || opp.type === 'human_local')
                    .map(opp => ({
                        id: opp.id,
                        name: opp.name,
                        isTaken: opp.type === 'human_local' && opp.id !== 'open-slot-placeholder' // Simplification
                    }));

                // For now, let's just send all "Open Slots"
                const openSlots = localOpponents.map(opp => ({
                    id: opp.id,
                    name: opp.type === 'open_slot' ? opp.name : `${opp.name} (Taken)`,
                    isTaken: opp.type !== 'open_slot'
                }));
                s.emit('slots_update', openSlots);
            });

            s.on('slot_claim_request', ({ applicantId, slotId, deck, tokens, playerName }) => {
                // Emit success to the mobile client
                s.emit('confirm_slot_claim', { room: roomId, applicantId, slotId, approved: true });

                // Update local state to reflect the new player
                setPlayersList(prev => prev.map(p => {
                    if (p.id === slotId) {
                        return {
                            ...p,
                            name: playerName,
                            id: applicantId, // Use socket ID from mobile client
                            // color: p.color // Keep associated color
                        };
                    }
                    return p;
                }));

                // Initialize their deck state
                setOpponentsCounts(prev => ({
                    ...prev,
                    [applicantId]: {
                        library: deck.filter(c => !c.isCommander).length,
                        graveyard: 0,
                        exile: 0,
                        hand: 0, // Hand is hidden on table, but we track count
                        command: deck.filter(c => c.isCommander).length
                    }
                }));

                setOpponentsCommanders(prev => ({
                    ...prev,
                    [applicantId]: deck.filter(c => c.isCommander)
                }));

                setOpponentsLife(prev => ({
                    ...prev,
                    [applicantId]: 40
                }));

                // Also update localOpponents reference if possible, or just rely on playersList?
                // PlayersList is the source of truth for rendering the board.

                // Trigger a re-broadcast of slots so other mobile clients see it's taken
                // We can just emit slots_update again if needed, or let them poll.

                // TODO: Store the full deck in a ref for resolving effects later
                localPlayerStates.current[applicantId] = {
                    id: applicantId,
                    hand: [], // Hand is on mobile
                    library: deck.filter(c => !c.isCommander),
                    graveyard: [],
                    exile: [],
                    commandZone: deck.filter(c => c.isCommander),
                    life: 40,
                    counters: {},
                    commanderDamage: {},
                    mulliganCount: 0,
                    hasKeptHand: false
                };

                setMobileControllers(prev => {
                    const next = new Set(prev);
                    next.add(slotId);
                    return next;
                });


            });

            return () => {
                s.off('get_slots');
                s.off('slot_claim_request');
                s.emit('leave_room', { room: roomId });
            };
        }
    }, [isLocalTableHost, roomId, localOpponents]);

    // Override localOpponents handling for Open Slots
    // Override localOpponents handling for Open Slots and Local Table
    useEffect(() => {
        if (isLocal && localOpponents) {
            // Merge localOpponents into playersList
            // This is primarily for "Local Table" where we have "Open Slots" passed in

            const newPlayers = localOpponents.map((opp, index) => ({
                id: opp.id || `opponent-${index}`,
                name: opp.name,
                isAi: opp.type === 'ai',
                color: opp.color,
                life: 40, // standard starting life
                // We could map other fields if needed
            }));

            // If we are the host, we might want to ensure WE are in the list too?
            // Actually Tabletop usually puts the main player in the list or handles it separately.
            // In "Standard" local game, `playersList` is usually empty or just AI?
            // Let's look at how standard local initializes. 
            // It seems standard local might not use `playersList` extensively for the main view?
            // actually `playersList` is used for rendering the board opponents.

            // Let's set the players list
            setPlayersList(newPlayers);

            // Also initialize their state containers
            const newCounts: Record<string, any> = {};
            const newLife: Record<string, number> = {};
            const newCommanders: Record<string, any[]> = {};

            localOpponents.forEach(opp => {
                const id = opp.id || `opponent-unknown`;
                newCounts[id] = {
                    library: opp.deck ? opp.deck.filter(c => !c.isCommander).length : 0,
                    hand: 7, // Assume starting hand
                    graveyard: 0,
                    exile: 0,
                    command: opp.deck ? opp.deck.filter(c => c.isCommander).length : 0
                };
                newLife[id] = 40;
                newCommanders[id] = opp.deck ? opp.deck.filter(c => c.isCommander) : [];

                // Initialize ref state
                localPlayerStates.current[id] = {
                    id: id,
                    hand: [], // We don't know their hand yet if they are remote
                    library: opp.deck ? opp.deck.filter(c => !c.isCommander) : [],
                    graveyard: [],
                    exile: [],
                    commandZone: opp.deck ? opp.deck.filter(c => c.isCommander) : [],
                    life: 40,
                    counters: {},
                    commanderDamage: {},
                    mulliganCount: 0,
                    hasKeptHand: false
                };
            });

            setOpponentsCounts(prev => ({ ...prev, ...newCounts }));
            setOpponentsLife(prev => ({ ...prev, ...newLife }));
            setOpponentsCommanders(prev => ({ ...prev, ...newCommanders }));
        }
    }, [isLocal, localOpponents]);

    const [isFullScreen, setIsFullScreen] = useState(false);
    const [showHealthModal, setShowHealthModal] = useState(false);
    const [showSettingsModal, setShowSettingsModal] = useState(false);

    // Local Game State Storage
    const localPlayerStates = useRef<Record<string, LocalPlayerState>>({});

    // State Refs for Syncing
    const boardObjectsRef = useRef(boardObjects);
    const turnRef = useRef(turn);
    const roundRef = useRef(round);
    const currentTurnPlayerIdRef = useRef(currentTurnPlayerId);
    const commanderDamageRef = useRef(commanderDamage);
    const lifeRef = useRef(life);
    const logsRef = useRef(logs);
    // Refs
    const dragStartRef = useRef<{ x: number, y: number } | null>(null);
    const isSpacePressed = useRef(false);
    const containerRef = useRef<HTMLDivElement>(null);
    const rootRef = useRef<HTMLDivElement>(null);
    const opponentContainerRef = useRef<HTMLDivElement>(null);
    const handContainerRef = useRef<HTMLDivElement>(null);

    // View Control Refs
    const isDraggingView = useRef(false);
    const lastMousePos = useRef({ x: 0, y: 0 });
    const isDraggingOpponentView = useRef(false);
    const lastOpponentMousePos = useRef({ x: 0, y: 0 });

    // Pinch Zoom Refs
    const activePointers = useRef<Map<number, { x: number, y: number }>>(new Map());
    const initialPinchDist = useRef<number | null>(null);
    const initialScale = useRef<number>(1);
    const initialView = useRef<{ x: number, y: number }>({ x: 0, y: 0 });
    const initialPinchCenter = useRef<{ x: number, y: number } | null>(null);

    // State Refs for Socket Handlers
    const libraryRef = useRef(library);
    const playersListRef = useRef(playersList);
    const turnStartTimeRef = useRef(turnStartTime);
    const gamePhaseRef = useRef(gamePhase);
    const prevIsHost = useRef(isHost);
    const startingGameRef = useRef(false);
    const turnOrderRef = useRef(turnOrder);
    const trackDamageRef = useRef(trackDamage);
    const prevPlayersListForLayout = useRef(playersList);
    const hasLoadedState = useRef(false);
    const reconnectedPlayerMap = useRef<Record<string, string>>({}); // oldSocketId -> newSocketId

    const [isMobile, setIsMobile] = useState(false);
    const [mobileActionCardId, setMobileActionCardId] = useState<string | null>(null);
    const [isHandVisible, setIsHandVisible] = useState(true);
    const hasCenteredHand = useRef(false);
    const touchStartRef = useRef<number | null>(null);

    const currentRadius = (playersList.length === 2 || (isLocal && localOpponents.length === 1)) ? 210 : 625;
    const layout = getLayout(playersList.length, currentRadius);

    useEffect(() => { libraryRef.current = library; }, [library]);
    useEffect(() => { playersListRef.current = playersList; }, [playersList]);
    useEffect(() => { turnStartTimeRef.current = turnStartTime; }, [turnStartTime]);
    useEffect(() => { gamePhaseRef.current = gamePhase; }, [gamePhase]);

    const manaInfoRef = useRef<any>(null);
    useEffect(() => { boardObjectsRef.current = boardObjects; }, [boardObjects]);
    useEffect(() => { turnRef.current = turn; }, [turn]);
    useEffect(() => { roundRef.current = round; }, [round]);
    useEffect(() => { currentTurnPlayerIdRef.current = currentTurnPlayerId; }, [currentTurnPlayerId]);
    useEffect(() => { commanderDamageRef.current = commanderDamage; }, [commanderDamage]);
    useEffect(() => { turnOrderRef.current = turnOrder; }, [turnOrder]);
    useEffect(() => { lifeRef.current = life; }, [life]);
    useEffect(() => { logsRef.current = logs; }, [logs]);
    useEffect(() => { trackDamageRef.current = trackDamage; }, [trackDamage]);

    const hoveredCardIdRef = useRef<string | null>(null);
    const lastPlayedCardRef = useRef<CardData | null>(null);
    useEffect(() => { hoveredCardIdRef.current = hoveredCardId; }, [hoveredCardId]);
    useEffect(() => { lastPlayedCardRef.current = lastPlayedCard; }, [lastPlayedCard]);
    useEffect(() => { trackDamageRef.current = trackDamage; }, [trackDamage]);


    // --- Persistence & Auto-Restore ---
    useEffect(() => {
        if (isLocal || gamePhase === 'SETUP') return;

        const backupData = {
            timestamp: Date.now(),
            hand,
            library,
            graveyard,
            exile,
            commandZone,
            life,
            boardObjects,
            gamePhase,
            turn,
            round,
            turnStartTime,
            commanderDamage,
            turnOrder,
            playersList,
            mySeatIndex,
            logs,
            opponentsLife,
            opponentsCounts,
            opponentsCommanders,
            currentTurnPlayerId,
            manaRules: manaRulesState // Use local state for backup
        };
        localStorage.setItem(`planeswalker_backup_${roomId}`, JSON.stringify(backupData));
    }, [hand, library, graveyard, exile, commandZone, life, boardObjects, gamePhase, turn, round, commanderDamage, turnOrder, playersList, mySeatIndex, isLocal, roomId, logs, opponentsLife, opponentsCounts, opponentsCommanders, currentTurnPlayerId, manaRules]);

    const restoreGameFromBackup = () => {
        const backup = localStorage.getItem(`planeswalker_backup_${roomId}`);
        if (!backup) {
            addLog("No local backup found", "SYSTEM");
            return;
        }

        try {
            const data = JSON.parse(backup);
            console.log("Restoring game from backup...", data);

            setHand(data.hand || []);
            setLibrary(data.library || []);
            setGraveyard(data.graveyard || []);
            setExile(data.exile || []);
            setCommandZone(data.commandZone || []);
            setLife(data.life || 40);
            if (data.logs) setLogs(data.logs);
            hasLoadedState.current = true;

            // Fix Board Object Controllers (Map old ID to new Socket ID)
            const myNewId = socket.id;
            const myOldPlayer = data.playersList?.find((p: any) => p.name === playerName);
            const myOldId = myOldPlayer?.id;

            const restoredObjects = (data.boardObjects || []).map((obj: BoardObject) => {
                // If single player or matching name, take control
                if (myOldId && obj.controllerId === myOldId) {
                    return { ...obj, controllerId: myNewId };
                }
                return obj;
            });

            setBoardObjects(restoredObjects);
            setGamePhase(data.gamePhase);
            setTurn(data.turn || 1);
            setRound(data.round || 1);
            setTurnStartTime(data.turnStartTime || Date.now());
            setCommanderDamage(data.commanderDamage || {});
            if (data.manaRules) setManaRulesState(data.manaRules);

            // Sync to Server
            socket.emit('game_action', {
                room: roomId, action: 'GAME_STATE_SYNC', data: {
                    phase: data.gamePhase,
                    boardObjects: restoredObjects,
                    turn: data.turn,
                    round: data.round,
                    currentTurnPlayerId: myNewId,
                    turnStartTime: data.turnStartTime,
                    commanderDamage: data.commanderDamage,
                    manaRules: data.manaRules,
                    turnOrder: [myNewId],
                    logs: data.logs
                }
            });

            addLog("Restored game from local backup", "SYSTEM");
            setShowPlayerManager(false);
        } catch (e) {
            console.error("Failed to restore backup", e);
            addLog("Failed to restore backup", "SYSTEM");
        }
    };

    // Auto-Restore for Single Player Rejoin
    useEffect(() => {
        if (isLocal || !isHost) return;
        // If we are the only player, board is empty, and we have a backup that isn't SETUP
        if (playersList.length === 1 && boardObjects.length === 0 && gamePhase === 'SETUP') {
            const backup = localStorage.getItem(`planeswalker_backup_${roomId}`);
            if (backup) {
                try {
                    const data = JSON.parse(backup);
                    if (Date.now() - data.timestamp < 24 * 60 * 60 * 1000 && data.gamePhase !== 'SETUP') {
                        restoreGameFromBackup();
                    }
                } catch (e) { }
            }
        }
    }, [isHost, playersList.length, boardObjects.length, gamePhase, isLocal, roomId]);

    // --- Layout Update Effect ---
    useEffect(() => {
        const oldPlayers = prevPlayersListForLayout.current;
        const newPlayers = playersList;

        const oldIsTwoPlayer = oldPlayers.length === 2;
        const newIsTwoPlayer = newPlayers.length === 2;

        const oldRadius = oldIsTwoPlayer ? 210 : 625;
        const newRadius = newIsTwoPlayer ? 210 : 625;

        const oldLayout = getLayout(oldPlayers.length, oldRadius);
        const newLayout = getLayout(newPlayers.length, newRadius);

        const updates: { id: string, updates: Partial<BoardObject> }[] = [];
        const oldPlayerMap = new Map<string, { pos: { x: number, y: number }, rot: number }>();

        oldPlayers.forEach((p, idx) => {
            const layoutData = oldLayout[idx];
            if (layoutData) {
                oldPlayerMap.set(p.id, {
                    pos: { x: layoutData.x, y: layoutData.y },
                    rot: layoutData.rot
                });
            }
        });

        const currentBoardObjects = boardObjectsRef.current;

        newPlayers.forEach((p, idx) => {
            const oldData = oldPlayerMap.get(p.id);
            if (!oldData) return;

            const newLayoutData = newLayout[idx];
            if (!newLayoutData) return;

            const newPos = { x: newLayoutData.x, y: newLayoutData.y };
            const newRot = newLayoutData.rot;

            const posChanged = oldData.pos.x !== newPos.x || oldData.pos.y !== newPos.y;
            const rotChanged = oldData.rot !== newRot;

            if (posChanged || rotChanged) {
                const playerObjects = currentBoardObjects.filter(obj => obj.controllerId === p.id);

                const oldCenter = { x: oldData.pos.x + MAT_W / 2, y: oldData.pos.y + MAT_H / 2 };
                const newCenter = { x: newPos.x + MAT_W / 2, y: newPos.y + MAT_H / 2 };

                const rotDiff = newRot - oldData.rot;
                const rad = -rotDiff * (Math.PI / 180);
                const cos = Math.cos(rad);
                const sin = Math.sin(rad);

                playerObjects.forEach(obj => {
                    const w = obj.type === 'CARD' ? CARD_WIDTH : 25;
                    const h = obj.type === 'CARD' ? CARD_HEIGHT : 25;
                    const cx = obj.x + w / 2;
                    const cy = obj.y + h / 2;
                    const rx = cx - oldCenter.x;
                    const ry = cy - oldCenter.y;
                    const rxNew = rx * cos - ry * sin;
                    const ryNew = rx * sin + ry * cos;
                    const newCx = newCenter.x + rxNew;
                    const newCy = newCenter.y + ryNew;

                    updates.push({
                        id: obj.id,
                        updates: { x: newCx - w / 2, y: newCy - h / 2, rotation: obj.rotation + rotDiff }
                    });
                });
            }
        });

        if (updates.length > 0) {
            setBoardObjects(prev => prev.map(obj => { const u = updates.find(up => up.id === obj.id); return u ? { ...obj, ...u.updates } : obj; }));
            if (isHost && !isLocal) updates.forEach(u => socket.emit('game_action', { room: roomId, action: 'UPDATE_OBJECT', data: u }));
        }
        prevPlayersListForLayout.current = newPlayers;
    }, [playersList]);

    const [controlMode, setControlMode] = useState<'auto' | 'mobile'>(() => {
        return (localStorage.getItem('planeswalker_control_mode') as 'auto' | 'mobile') || 'auto';
    });

    useEffect(() => {
        localStorage.setItem('planeswalker_control_mode', controlMode);
    }, [controlMode]);

    // ...
    // ...
    const [isLandscape, setIsLandscape] = useState(window.innerWidth > window.innerHeight);

    useEffect(() => {
        rootRef.current?.focus();
        const checkMobile = () => {
            const isAutoMobile = window.innerWidth < 768 || (window.innerHeight < 600 && window.innerWidth < 1000);
            setIsMobile(controlMode === 'mobile' || (controlMode === 'auto' && isAutoMobile));
            setIsLandscape(window.innerWidth > window.innerHeight);
        };

        checkMobile();
        window.addEventListener('resize', checkMobile);

        const onKeyPress = (e: KeyboardEvent) => {
            // Convert KeyboardEvent to React.KeyboardEvent-like if needed
            // or just use e.key
            if (['INPUT', 'TEXTAREA'].includes((e.target as HTMLElement).tagName)) return;

            const key = e.key.toLowerCase();
            if (key === 'tab') {
                e.preventDefault();
                const cardToTapFor = hoveredCardId
                    ? boardObjects.find(o => o.id === hoveredCardId)?.cardData
                    : lastPlayedCard;

                if (cardToTapFor) {
                    handleAutoTap(cardToTapFor);
                }
            } else if (key === 'enter') {
                nextTurn();
            } else {
                // Call handleKeyDown or inline logic
                // For simplicity, I'll just keep handleKeyDown as a function and call it
                // and I'll update it to handle the window event
                handleKeyDown(e as any);
            }
        };

        window.addEventListener('keydown', onKeyPress);

        return () => {
            window.removeEventListener('resize', checkMobile);
            window.removeEventListener('keydown', onKeyPress);
        };
    }, [controlMode]);

    useEffect(() => {
        const checkFullScreen = () => setIsFullScreen(!!document.fullscreenElement);
        document.addEventListener('fullscreenchange', checkFullScreen);
        return () => document.removeEventListener('fullscreenchange', checkFullScreen);
    }, []);

    // Center hand logic
    useEffect(() => {
        if ((gamePhase === 'MULLIGAN' || gamePhase === 'PLAYING') && hand.length > 0 && !hasCenteredHand.current) {
            if (handContainerRef.current) {
                const cardWidth = 140 * handScale;
                const gap = 8;
                const totalWidth = hand.length * cardWidth + (hand.length - 1) * gap;
                const centerOffset = (totalWidth / 2) - (cardWidth / 2);
                handContainerRef.current.scrollTo({ left: centerOffset, behavior: 'smooth' });
                hasCenteredHand.current = true;
            }
        }
    }, [hand.length, gamePhase, handScale]);

    // Reset centering flag when game restarts
    useEffect(() => { if (gamePhase === 'SETUP') hasCenteredHand.current = false; }, [gamePhase]);

    useEffect(() => {
        if (isLocal) {
            const p1 = playersList[0];
            const usedColors = new Set([p1.color]);

            const opponents = localOpponents.map((opp, idx) => {
                let color = opp.color;
                if (usedColors.has(color)) {
                    color = PLAYER_COLORS.find(c => !usedColors.has(c)) || color;
                }
                usedColors.add(color);
                return {
                    id: opp.id || `player-${idx + 1}`,
                    name: opp.name,
                    color: color
                };
            });
            const allPlayers = [playersList[0], ...opponents];
            setPlayersList(allPlayers);
            setIsHost(true); // Local player is always host

            // Initialize Local States
            const states: Record<string, LocalPlayerState> = {};

            // Player 1 (Me)
            states[playersList[0].id] = createInitialState(playersList[0].id, initialDeck, initialTokens);

            // Opponents
            localOpponents.forEach((opp, idx) => {
                // Ensure we have a valid ID, fallback to player-X if needed
                const pid = opp.id || playersList[idx + 1]?.id || `player-${idx + 1}`;
                states[pid] = createInitialState(pid, opp.deck, opp.tokens);
            });

            localPlayerStates.current = states;

            // Force update to ensure counts are rendered
            setPlayersList([...allPlayers]);
            hasLoadedState.current = true;
        }
    }, [isLocal, initialDeck, localOpponents]);

    useEffect(() => {
        if (!prevIsHost.current && isHost) {
            addLog("You are now the Host", "SYSTEM");
        }
        prevIsHost.current = isHost;
    }, [isHost]);

    useEffect(() => {
        // This effect handles the game's initial start.
        if (gamePhase !== 'SETUP') return;

        if (isLocal) {
            // For local games, we always want to show the setup screen first.
            // The user must click "Start Game" manually. So, do nothing here.
            return;
        }

        // For online games, if the game has already started (e.g., rejoining),
        // only start game logic if we DON'T have a local backup (truly new join).
        // If we have a backup, the state was already restored from localStorage.
        if (initialGameStarted && !hasLoadedState.current) {
            const backup = localStorage.getItem(`planeswalker_backup_${roomId}`);
            if (!backup) {
                // Truly new player joining mid-game, start fresh
                handleStartGameLogic({ mulligansAllowed: true, trackDamage: false });
            }
            // If backup exists, state was already restored in the initialization useEffect
        }
    }, [isLocal, initialGameStarted, gamePhase]);

    // --- Game Phase Persistence ---
    useEffect(() => {
        if (isLocal) {
            // For local games, we always want a fresh start, so ignore any persisted phase.
            localStorage.removeItem(`game_phase_${roomId}`);
            return;
        }

        const savedPhase = localStorage.getItem(`game_phase_${roomId}`);
        if (savedPhase && (savedPhase === 'MULLIGAN' || savedPhase === 'PLAYING')) {
            if (gamePhase === 'SETUP') {
                setGamePhase(savedPhase as any);
            }
        }
    }, [isLocal, roomId]);

    useEffect(() => {
        if (gamePhase !== 'SETUP') {
            localStorage.setItem(`game_phase_${roomId}`, gamePhase);
        }
    }, [gamePhase, roomId]);

    // --- Session Persistence & Reconnect ---
    useEffect(() => {
        if (isLocal) return;
        // Save session on mount
        sessionStorage.setItem('active_game_session', roomId);

        const getUserIdForRoom = (room: string) => {
            return localStorage.getItem(`planeswalker_user_id_${room}`);
        };

        // Handle socket reconnection
        const handleReconnection = () => {
            console.log("Socket reconnected, re-joining room...");
            const userId = getUserIdForRoom(roomId);
            socket.emit('join_room', { room: roomId, name: playerName, color: sleeveColor, userId });
        };

        socket.on('connect', handleReconnection);

        // Initial join
        const userId = getUserIdForRoom(roomId);
        socket.emit('join_room', { room: roomId, name: playerName, color: sleeveColor, userId });


        return () => {
            socket.off('connect', handleReconnection);
        };
    }, [roomId, playerName, sleeveColor, isLocal]);

    const handleExit = () => {
        socket.emit('leave_room', { room: roomId });
        localStorage.removeItem(`game_phase_${roomId}`);
        sessionStorage.removeItem('active_game_session');
        onExit();
    };

    // Emit life changes
    // Emit life changes (Remote)
    useEffect(() => {
        if (!isLocal && (gamePhase === 'PLAYING' || gamePhase === 'MULLIGAN')) {
            socket.emit('game_action', { room: roomId, action: 'UPDATE_LIFE', data: { life } });
        }
    }, [life, gamePhase, roomId, isLocal]);

    // Sync Stats to Mobile
    useEffect(() => {
        if (gamePhase === 'PLAYING' || gamePhase === 'MULLIGAN') {
            const myId = playersList[mySeatIndex]?.id;
            if (myId) {
                let poison = 0;
                let cmdDmg = {};

                if (isLocal && localPlayerStates.current[myId]) {
                    const s = localPlayerStates.current[myId];
                    if (s) {
                        poison = s.counters['poison'] || 0;
                        cmdDmg = s.commanderDamage || {};
                    }
                }

                socket.emit('send_stats_update', { roomId, targetId: myId, life, poison, commanderDamage: cmdDmg });
            }
        }
    }, [life, gamePhase, roomId, playersList, mySeatIndex, isLocal]);

    // Emit Count Changes
    useEffect(() => {
        if (!isLocal && (gamePhase === 'PLAYING' || gamePhase === 'MULLIGAN')) {
            const counts = {
                library: library.length,
                graveyard: graveyard.length,
                exile: exile.length,
                hand: hand.filter(c => !c.isToken).length,
                command: commandZone.length,
                commanders: commandZone
            };
            socket.emit('game_action', {
                room: roomId,
                action: 'UPDATE_COUNTS',
                data: counts
            });
        }
    }, [library.length, graveyard.length, exile.length, hand.length, commandZone.length, commandZone, gamePhase, roomId, playersList.length]);

    // --- State Backup & Restore on Reconnect ---
    useEffect(() => {
        if (!isLocal && (gamePhase === 'PLAYING' || gamePhase === 'MULLIGAN')) {
            const userId = localStorage.getItem(`planeswalker_user_id_${roomId}`);
            const state = {
                hand,
                library,
                graveyard,
                exile,
                commandZone,
                life,
                boardObjects: boardObjectsRef.current,
                commanderDamage: commanderDamageRef.current,
                turn: turnRef.current,
                round: roundRef.current,
                turnOrder: turnOrderRef.current,
                currentTurnPlayerId: currentTurnPlayerIdRef.current,
                gamePhase,
                mySeatIndex,
                opponentsLife,
                opponentsCounts,
                opponentsCommanders,
                manaRules: manaRulesState // Use local state for backup
            };
            // Backup state to the current seat index, include userId for matching on reconnect
            socket.emit('backup_state', { room: roomId, seatIndex: mySeatIndex, state, userId });
        }
    }, [hand, library, graveyard, exile, commandZone, life, mySeatIndex, gamePhase, roomId, isLocal, opponentsLife, opponentsCounts, opponentsCommanders]);

    useEffect(() => {
        if (!isLocal && mySeatIndex !== -1 && (gamePhase === 'PLAYING' || gamePhase === 'MULLIGAN')) {
            // If we have a valid seat index and the game is running, request our state
            socket.emit('request_state', { room: roomId, seatIndex: mySeatIndex });
        }
    }, [mySeatIndex, gamePhase, isLocal, roomId]);

    // Stats Helper
    const getMyId = () => isLocal ? playersList[mySeatIndex].id : socket.id;

    const updateMyStats = (updates: Partial<PlayerStats>) => {
        setGameStats(prev => {
            const myId = getMyId();
            const current = prev[myId] || emptyStats;
            const newStats = { ...current, ...updates };

            if (updates.damageDealt) newStats.damageDealt = { ...current.damageDealt, ...updates.damageDealt };
            if (updates.tappedCounts) newStats.tappedCounts = { ...current.tappedCounts, ...updates.tappedCounts };

            if (!isLocal) socket.emit('game_action', { room: roomId, action: 'UPDATE_STATS', data: { playerId: myId, stats: newStats } });
            return { ...prev, [myId]: newStats };
        });
    };

    // Helper to create initial state
    const createInitialState = (id: string, deck: CardData[], tokens: CardData[]): LocalPlayerState => {
        const commanders = deck.filter(c => c.isCommander);
        const library = deck.filter(c => !c.isCommander).sort(() => Math.random() - 0.5);
        return {
            id,
            hand: tokens, // Initially just tokens, draw 7 later
            library,
            graveyard: [],
            exile: [],
            commandZone: commanders,
            life: 40,
            counters: {},
            commanderDamage: {},
            mulliganCount: 0,
            hasKeptHand: false
        };
    };

    const getModalStyle = (playerId?: string) => {
        if (!playerId) return { inset: 0 };
        const seatIdx = playersList.findIndex(p => p.id === playerId);
        if (seatIdx === -1) return { inset: 0 };

        const layout = getLayout(playersList.length, (playersList.length === 2 || (isLocal && localOpponents.length === 1)) ? 210 : 625); // Need layout here if not using hook
        const rotation = layout[seatIdx]?.rot || 0;

        if (rotation === 0) return { inset: 0 };

        return {
            position: 'fixed' as 'fixed',
            top: '50%',
            left: '50%',
            width: rotation % 180 !== 0 ? '100vh' : '100vw',
            height: rotation % 180 !== 0 ? '100vw' : '100vh',
            transform: `translate(-50%, -50%) rotate(${rotation}deg)`,
            transformOrigin: 'center center'
        };
    };

    // --- Helper Logic ---
    const emitAction = (action: string, data: any) => {
        if (isLocal) {
            // In local mode, we bypass the socket and handle logic directly if needed, 
            // but mostly we just update state directly in the calling functions.
            return;
        }
        let payload = data;
        if (action === 'ADD_OBJECT' && data.controllerId === 'local-player') {
            payload = { ...data, controllerId: socket.id };
        } else if (action === 'UPDATE_OBJECT' && data.updates && data.updates.controllerId === 'local-player') {
            payload = { ...data, updates: { ...data.updates, controllerId: socket.id } };
        }
        socket.emit('game_action', { room: roomId, action, data: payload });
        socket.emit('game_action', { room: roomId, action, data: payload });
    };

    const sendHandUpdate = (targetId: string, hand: CardData[], phase: string = gamePhase, mCount: number = mulliganCount) => {
        if (!isLocalTableHost || !targetId || targetId.startsWith('player-') || targetId.startsWith('ai-') || targetId === 'local-player') return;
        socket.emit('send_hand_update', { roomId, targetId, hand, phase, mulliganCount: mCount });
    };

    const addLog = (message: string, type: 'ACTION' | 'SYSTEM' = 'ACTION', overrideName?: string) => {
        console.log(`Adding log: ${message} (${type})`); // Debug
        const actingPlayerName = overrideName || (isLocal ? playersList[mySeatIndex].name : playerName);
        const entry: LogEntry = {
            id: crypto.randomUUID(),
            timestamp: Date.now(),
            playerId: overrideName ? 'remote' : 'local',
            playerName: actingPlayerName,
            message,
            type
        };
        setLogs(prev => [entry, ...prev]);
        const displayMsg = type === 'SYSTEM' ? message : `${actingPlayerName} ${message.toLowerCase()}`;
        setStatusMessage(displayMsg);
        setTimeout(() => setStatusMessage(""), 3000);

        if (!overrideName) {
            emitAction('LOG', { message });
        }
    };

    const handleLifeChange = (amount: number) => {
        setLife(prev => prev + amount);
        if (amount < 0) {
            damageTakenThisTurn.current += Math.abs(amount);
            addLog(`lost ${Math.abs(amount)} life`);
        } else {
            healingReceivedThisTurn.current += amount;
            addLog(`gained ${amount} life`);
        }
    };

    const checkDamageTracking = () => {
        if (trackDamageRef.current) {
            const dmg = damageTakenThisTurn.current;
            const heal = healingReceivedThisTurn.current;
            if (dmg > 0 || heal > 0) {
                setDamageReportData({ damage: dmg, healing: heal });
                setShowDamageReportModal(true);
            }
        }
    };

    const sortPlayers = (players: Player[], order: string[]) => {
        if (!order || order.length === 0) return players;
        const orderMap = new Map(order.map((id, i) => [id, i]));
        return [...players].sort((a, b) => {
            const idxA = orderMap.has(a.id) ? orderMap.get(a.id)! : 999;
            const idxB = orderMap.has(b.id) ? orderMap.get(b.id)! : 999;
            return idxA - idxB;
        });
    };

    // --- Socket Logic ---
    useEffect(() => {
        if (isLocal) return;
        const handleRoomUpdate = (data: Player[] | { players: Player[], hostId: string | null }) => {
            const roomPlayers = Array.isArray(data) ? data : data.players;
            const hostId = !Array.isArray(data) ? data.hostId : null;

            console.log("Room Update Received:", roomPlayers);

            // Detect left players — only consider truly gone players (not just disconnected)
            const prevPlayers = playersListRef.current;
            const leftPlayers = prevPlayers.filter(p =>
                !roomPlayers.find(rp => rp.id === p.id || rp.userId === p.userId) &&
                p.id !== 'local-player' &&
                p.id !== 'player-0'
            );

            // Determine if I am the host
            let amIHost = hostId ? socket.id === hostId : false;
            if (hostId) setIsHost(amIHost);

            // Only remove board objects for players who have truly left (not just disconnected)
            // Disconnected players keep their objects so they can reconnect
            if (leftPlayers.length > 0 && amIHost && gamePhaseRef.current !== 'SETUP') {
                // Check if the "left" player is actually just disconnected (still in room list)
                const trulyLeftIds = new Set(
                    leftPlayers
                        .filter(p => !roomPlayers.find(rp => rp.disconnected && rp.userId === p.userId))
                        .map(p => p.id)
                );

                if (trulyLeftIds.size > 0) {
                    const objectsToRemove = boardObjectsRef.current.filter(o => trulyLeftIds.has(o.controllerId));
                    if (objectsToRemove.length > 0) {
                        setBoardObjects(prev => prev.filter(o => !trulyLeftIds.has(o.controllerId)));
                        objectsToRemove.forEach(o => {
                            socket.emit('game_action', { room: roomId, action: 'REMOVE_OBJECT', data: { id: o.id } });
                        });
                    }
                }
            }

            // Merge lists: Server Players + Ghosts + Leaver (if handling)
            let combinedPlayers = [...roomPlayers];


            // Detect new players and Sync Game State if Host
            const newPlayers = roomPlayers.filter(rp => !prevPlayers.find(p => p.id === rp.id));
            if (newPlayers.length > 0 && amIHost && gamePhaseRef.current !== 'SETUP') {
                console.log("New/reconnected player joined game in progress, syncing state...");

                let currentTurnOrder = [...turnOrderRef.current];
                const reconMap = { ...reconnectedPlayerMap.current };

                // Robustly detect reconnections via userId matching
                newPlayers.forEach(np => {
                    // Check if this user was already in the game with a different ID
                    const oldP = prevPlayers.find(p => p.userId && np.userId && p.userId === np.userId && p.id !== np.id);
                    if (oldP) {
                        reconMap[oldP.id] = np.id;
                        console.log(`Host inferred reconnection: ${oldP.id} -> ${np.id} (User: ${np.name})`);
                    }
                });

                // Update Ref for consistency
                Object.assign(reconnectedPlayerMap.current, reconMap);

                // For reconnected players, remap their old socket IDs in turn order
                // For truly new players, add them to the end
                for (const np of newPlayers) {
                    const oldId = Object.keys(reconMap).find(k => reconMap[k] === np.id);
                    if (oldId) {
                        // Reconnected player: replace old ID in turn order
                        currentTurnOrder = currentTurnOrder.map(id => id === oldId ? np.id : id);
                    } else if (!currentTurnOrder.includes(np.id)) {
                        // Truly new player: add to end of turn order
                        currentTurnOrder.push(np.id);
                    }
                }
                setTurnOrder(currentTurnOrder);

                // Remap board object controller IDs for reconnected players
                let safeBoardObjects = boardObjectsRef.current.map(obj => {
                    let controllerId = obj.controllerId;

                    // Normalize 'local-player' to Host ID if it slipped in, though usually it shouldn't for remote objects 
                    // But here we are Host processing our own state too? 
                    // No, boardObjectsRef contains the canonical state. 
                    // If Host was 'local-player' locally, it should be socket.id in shared state.
                    if (controllerId === 'local-player') controllerId = socket.id;

                    // Check if the controller was a reconnected player
                    // Logic: If the object was controlled by OldID, it is now NewID
                    // We check if the KEY of reconMap matches the current controllerId
                    if (reconMap[controllerId]) {
                        controllerId = reconMap[controllerId];
                    }
                    return { ...obj, controllerId };
                });
                setBoardObjects(safeBoardObjects);

                // Remap currentTurnPlayerId if needed
                let syncCurrentTurnPlayerId = currentTurnPlayerIdRef.current;
                if (reconMap[syncCurrentTurnPlayerId]) {
                    syncCurrentTurnPlayerId = reconMap[syncCurrentTurnPlayerId];
                    setCurrentTurnPlayerId(syncCurrentTurnPlayerId);
                }

                // Remap commander damage keys
                let syncCommanderDamage = { ...commanderDamageRef.current };
                for (const [oldId, newId] of Object.entries(reconMap)) {
                    // Remap Source keys
                    if (syncCommanderDamage[oldId]) {
                        syncCommanderDamage[newId] = syncCommanderDamage[oldId];
                        delete syncCommanderDamage[oldId];
                    }
                    // Remap Victim keys (inner objects)
                    for (const key of Object.keys(syncCommanderDamage)) {
                        const inner = syncCommanderDamage[key];
                        if (inner && typeof inner === 'object' && inner[oldId] !== undefined) {
                            inner[newId] = inner[oldId];
                            delete inner[oldId];
                        }
                    }
                }
                setCommanderDamage(syncCommanderDamage);

                const fullPublicState = {
                    phase: gamePhaseRef.current,
                    boardObjects: safeBoardObjects,
                    turn: turnRef.current,
                    round: roundRef.current,
                    currentTurnPlayerId: syncCurrentTurnPlayerId,
                    turnStartTime: turnStartTimeRef.current,
                    commanderDamage: syncCommanderDamage,
                    turnOrder: currentTurnOrder,
                    logs: logsRef.current.slice(0, 50),
                    allPlayerLife: { ...opponentsLife, [socket.id]: lifeRef.current },
                    allPlayerCounts: { ...opponentsCounts, [socket.id]: { library: libraryRef.current.length, graveyard: graveyard.length, exile: exile.length, hand: hand.filter(c => !c.isToken).length, command: commandZone.length } },
                    allPlayerCommanders: { ...opponentsCommanders, [socket.id]: commandZone }
                };
                socket.emit('game_action', { room: roomId, action: 'GAME_STATE_SYNC', data: fullPublicState });

                // Clear the reconnected map entries we've processed
                for (const np of newPlayers) {
                    const oldId = Object.keys(reconMap).find(k => reconMap[k] === np.id);
                    if (oldId) delete reconnectedPlayerMap.current[oldId];
                }
            }

            let sortedPlayers = sortPlayers(combinedPlayers, turnOrderRef.current);
            let myIndex = sortedPlayers.findIndex(p => p.id === socket.id);

            if (myIndex >= 6) {
                alert("The room is full (Max 6 players).");
                handleExit();
                return;
            }

            setPlayersList(sortedPlayers);
            if (myIndex !== -1) {
                setMySeatIndex(myIndex);
            }
        };

        const handleHostApprovalRequest = (data: any) => {
            setIncomingJoinRequest(data);
        };

        const handleLoadState = (state: any) => {
            if (state) {
                console.log("Loading private state from server", state);
                if (state.hand) setHand(state.hand);
                if (state.library) setLibrary(state.library);
                if (state.graveyard) setGraveyard(state.graveyard);
                if (state.exile) setExile(state.exile);
                if (state.commandZone) setCommandZone(state.commandZone);
                if (state.life !== undefined) setLife(state.life);

                // Restore board objects if available (remap controllerId to new socket.id)
                if (state.boardObjects && Array.isArray(state.boardObjects)) {
                    const myNewId = socket.id;
                    const restoredObjects = state.boardObjects.map((obj: BoardObject) => ({
                        ...obj,
                        controllerId: obj.controllerId === state.userId ? myNewId : obj.controllerId
                    }));
                    setBoardObjects(restoredObjects);
                }

                // Restore game phase and turn info
                if (state.gamePhase && state.gamePhase !== 'SETUP') setGamePhase(state.gamePhase);
                if (state.commanderDamage) setCommanderDamage(state.commanderDamage);
                if (state.turn !== undefined) setTurn(state.turn);
                if (state.round !== undefined) setRound(state.round);
                if (state.turnOrder) {
                    setTurnOrder(state.turnOrder);
                    setPlayersList(prev => sortPlayers(prev, state.turnOrder));
                }
                if (state.currentTurnPlayerId) setCurrentTurnPlayerId(state.currentTurnPlayerId);
                if (state.mySeatIndex !== undefined) setMySeatIndex(state.mySeatIndex);
                if (state.opponentsLife) setOpponentsLife(state.opponentsLife);
                if (state.opponentsCounts) setOpponentsCounts(state.opponentsCounts);
                if (state.opponentsCommanders) setOpponentsCommanders(state.opponentsCommanders);

                hasLoadedState.current = true;
                addLog("Game data restored from server", "SYSTEM");
            }
        };

        const handlePlayerReconnected = ({ newSocketId, userId, name }: { newSocketId: string, userId: string, name: string }) => {
            console.log(`Player ${name} reconnected with new socket ID ${newSocketId} (userId: ${userId})`);

            // Find their old socket ID in our current player list or turn order
            const prevPlayers = playersListRef.current;
            const oldPlayer = prevPlayers.find(p => p.userId === userId && p.id !== newSocketId);

            if (oldPlayer) {
                // Map old ID to new ID so we can remap board objects, turn order, etc.
                reconnectedPlayerMap.current[oldPlayer.id] = newSocketId;
                console.log(`Mapping old ID ${oldPlayer.id} -> new ID ${newSocketId}`);
            }

            addLog(`${name} reconnected`, "SYSTEM");
        };

        const handleAction = ({ action, data, playerId }: { action: string, data: { [key: string]: any }, playerId: string }) => {
            console.log(`Game Action Received: ${action} from ${playerId}`, data);
            const currentPlayers = playersListRef.current;
            const sender = currentPlayers.find(p => p.id === playerId);

            if (gamePhaseRef.current === 'SETUP' && !startingGameRef.current &&
                ['ADD_OBJECT', 'UPDATE_LIFE', 'PASS_TURN', 'UPDATE_COUNTS', 'UPDATE_COMMANDER_DAMAGE'].includes(action)) {
                // Check if we have a saved phase first to avoid skipping Mulligan
                const savedPhase = localStorage.getItem(`game_phase_${roomId}`);
                if (!savedPhase) {
                    setGamePhase('PLAYING');
                    addLog("Reconnected to game in progress", 'SYSTEM');
                }
            }

            if (action === 'START_GAME') {
                startingGameRef.current = true;
                if (data.playerOrder) {
                    setTurnOrder(data.playerOrder);
                    setPlayersList(prev => sortPlayers(prev, data.playerOrder));
                }
                handleStartGameLogic({ mulligansAllowed: data.mulligansAllowed, trackDamage: data.trackDamage });
                if (data.firstPlayerId) {
                    setCurrentTurnPlayerId(data.firstPlayerId);
                }
            }
            else if (action === 'UPDATE_PLAYER_ORDER') {
                setPlayersList(data.players);
                setTurnOrder(data.players.map((p: any) => p.id));
            }
            else if (action === 'UPDATE_SETTINGS') {
                if (data.mulligansAllowed !== undefined) setMulligansAllowed(data.mulligansAllowed);
                if (data.freeMulligan !== undefined) setFreeMulligan(data.freeMulligan);
                if (data.trackDamage !== undefined) setTrackDamage(data.trackDamage);
            }
            else if (action === 'PASS_TURN') {
                if (data.nextPlayerSocketId) {
                    setCurrentTurnPlayerId(data.nextPlayerSocketId);
                    setTurn(data.turnNumber);
                    const prevDuration = data.prevDuration;
                    if (prevDuration && sender) {
                        addLog(`${sender.name} ended their turn (Duration: ${prevDuration})`, 'SYSTEM');
                    }
                    const nextPlayer = currentPlayers.find(p => p.id === data.nextPlayerSocketId);
                    if (nextPlayer) {
                        addLog(`It is now ${nextPlayer.name}'s turn`, 'SYSTEM');
                    }
                    setTurnStartTime(Date.now());
                    checkDamageTracking();
                }
            }
            else if (action === 'UPDATE_LIFE') {
                if (sender && sender.id !== socket.id) {
                    setOpponentsLife(prev => ({ ...prev, [sender.id]: data.life }));
                }
            }
            else if (action === 'UPDATE_COUNTS') {
                if (sender && sender.id !== socket.id) {
                    setOpponentsCounts(prev => ({
                        ...prev,
                        [sender.id]: {
                            library: data.library,
                            graveyard: data.graveyard,
                            exile: data.exile,
                            hand: data.hand,
                            command: data.command,
                        }
                    }));
                    if (data.commanders) {
                        setOpponentsCommanders(prev => ({ ...prev, [sender.id]: data.commanders }));
                    }
                }
            }
            else if (action === 'REQUEST_VIEW') {
                if (data.targetPlayerId === socket.id) {
                    const requester = currentPlayers.find(p => p.id === data.requesterId);
                    setIncomingViewRequest({
                        requesterId: data.requesterId,
                        requesterName: requester ? requester.name : 'Unknown',
                        zone: data.zone
                    });
                }
            }
            else if (action === 'ALLOW_VIEW') {
                if (data.requesterId === socket.id) {
                    const cards: CardData[] = data.cards;
                    const items = cards.map(c => ({ card: c, isRevealed: true }));
                    setSearchModal({ isOpen: true, source: data.zone, items, tray: [], isReadOnly: true });
                }
            }
            else if (action === 'UPDATE_COMMANDER_DAMAGE') {
                if (data.ownerId && data.victimId) {
                    const cmdId = `cmd-${data.ownerId}`;
                    setCommanderDamage(prev => {
                        const cmdrRecord = prev[cmdId] || {};
                        return { ...prev, [cmdId]: { ...cmdrRecord, [data.victimId]: data.damage } };
                    });
                }
            }
            else if (action === 'UPDATE_STATS') {
                if (data.playerId && data.stats) {
                    setGameStats(prev => ({ ...prev, [data.playerId]: data.stats }));
                }
            }
            else if (action === 'TRACK_DAMAGE_DEALT') {
                if (data.sourceId === socket.id) {
                    setGameStats(prev => {
                        const current = prev[socket.id] || emptyStats;
                        const oldVal = current.damageDealt[data.targetId] || 0;
                        const newStats = { ...current, damageDealt: { ...current.damageDealt, [data.targetId]: oldVal + data.amount } };
                        socket.emit('game_action', { room: roomId, action: 'UPDATE_STATS', data: { playerId: socket.id, stats: newStats } });
                        return { ...prev, [socket.id]: newStats };
                    });
                }
            }
            else if (action === 'TRACK_HEALING_GIVEN') {
                if (data.sourceId === socket.id) {
                    // We use updateMyStats helper logic pattern here manually to avoid closure staleness issues if we used the helper directly inside the socket callback
                    // But actually, we can just update local state and emit.
                    updateMyStats({ healingGiven: (gameStats[getMyId()]?.healingGiven || 0) + data.amount });
                }
            }
            else if (action === 'ADD_OBJECT') {
                setBoardObjects(prev => {
                    if (prev.some(o => o.id === data.id)) return prev;
                    return [...prev, data as BoardObject];
                });
            } else if (action === 'UPDATE_OBJECT') {
                setBoardObjects(prev => prev.map(o => {
                    if (o.id === data.id) {
                        return { ...o, ...data.updates };
                    }
                    return o;
                }));
            } else if (action === 'REMOVE_OBJECT') {
                setBoardObjects(prev => prev.filter(o => o.id !== data.id));
            } else if (action === 'LOG') {
                addLog(data.message, 'ACTION', sender ? sender.name : 'Unknown');
            } else if (action === 'TRANSFER_OBJECTS') {
                setBoardObjects(prev => prev.map(o => {
                    if (o.controllerId === data.fromId) {
                        return { ...o, controllerId: data.toId };
                    }
                    return o;
                }));
            }
            else if (action === 'RESTART_GAME') {
                setGamePhase('SETUP');
                setBoardObjects([]);
                setHand(initialTokens);
                setGraveyard([]);
                setExile([]);
                setLife(40);
                setTurn(1);
                setRound(1);
                setGameStats({});

                const commanders = initialDeck.filter(c => c.isCommander);
                const deck = initialDeck.filter(c => !c.isCommander);
                const shuffled = [...deck].sort(() => Math.random() - 0.5);
                setLibrary(shuffled);
                setCommandZone(commanders);

                addLog("The host has restarted the game", "SYSTEM");
            }
            else if (action === 'REVEAL_CARDS') {
                if (sender && sender.id !== socket.id) {
                    setRevealedCards(data.cards);
                }
            }
            else if (action === 'GAME_STATE_SYNC') {
                setGamePhase(data.phase);
                setBoardObjects(data.boardObjects);
                setTurn(data.turn);
                setRound(data.round);
                setCurrentTurnPlayerId(data.currentTurnPlayerId);
                setTurnStartTime(data.turnStartTime);
                if (data.commanderDamage) setCommanderDamage(data.commanderDamage);
                if (data.manaRules) setManaRulesState(data.manaRules);
                if (data.turnOrder) {
                    setTurnOrder(data.turnOrder);
                    setPlayersList(prev => sortPlayers(prev, data.turnOrder));
                }
                if (data.logs) setLogs(data.logs);

                const myId = socket.id;
                if (data.allPlayerLife) {
                    const newOpponentLife = { ...data.allPlayerLife };
                    if (myId in newOpponentLife) {
                        setLife(newOpponentLife[myId]);
                        delete newOpponentLife[myId];
                    }
                    setOpponentsLife(newOpponentLife);
                }
                if (data.allPlayerCounts) {
                    const newOpponentCounts = { ...data.allPlayerCounts };
                    if (myId in newOpponentCounts) {
                        // We trust our local counts more than the sync for our own state
                        delete newOpponentCounts[myId];
                    }
                    setOpponentsCounts(newOpponentCounts);
                }
                if (data.allPlayerCommanders) {
                    const newOpponentCommanders = { ...data.allPlayerCommanders };
                    if (myId in newOpponentCommanders) {
                        setCommandZone(newOpponentCommanders[myId]);
                        delete newOpponentCommanders[myId];
                    }
                    setOpponentsCommanders(newOpponentCommanders);
                }

                addLog("Synced game state from Host", "SYSTEM");
                hasLoadedState.current = true;
            }
            else if (action === 'ROLL_DICE') {
                setActiveDice(prev => [...prev, data as DieRoll]);
                const roller = currentPlayers.find(p => p.id === data.playerId);
                addLog(`rolled a ${data.value} on a D${data.sides}`, 'ACTION', roller?.name);
                setTimeout(() => {
                    setActiveDice(prev => prev.filter(d => d.id !== data.id));
                }, 3000);
            }
        };

        socket.on('room_players_update', handleRoomUpdate);
        socket.on('game_action', handleAction);
        socket.on('host_approval_request', handleHostApprovalRequest);
        socket.on('load_state', handleLoadState);
        socket.on('player_reconnected', handlePlayerReconnected);
        socket.on('notification', (data) => addLog(data.message, "SYSTEM"));
        socket.on('player_kicked', () => { alert("You have been kicked from the game."); handleExit(); });

        socket.emit('get_players', { room: roomId });

        return () => {
            socket.off('room_players_update', handleRoomUpdate);
            socket.off('game_action', handleAction);
            socket.off('host_approval_request', handleHostApprovalRequest);
            socket.off('load_state', handleLoadState);
            socket.off('player_reconnected', handlePlayerReconnected);
            socket.off('notification');
            socket.off('player_kicked');
        };
    }, []);

    // --- Initialization ---
    useEffect(() => {
        if (!isLocal && !initialGameStarted) {
            const commanders = initialDeck.filter(c => c.isCommander);
            const deck = initialDeck.filter(c => !c.isCommander);
            const shuffled = [...deck].sort(() => Math.random() - 0.5);

            setLibrary(shuffled);
            setCommandZone(commanders);
            setHand(initialTokens);
            setGraveyard([]);
            setExile([]);
        }

        // On reconnect, try to restore from local backup before server state arrives
        if (!isLocal && initialGameStarted) {
            const backup = localStorage.getItem(`planeswalker_backup_${roomId}`);
            if (backup) {
                try {
                    const data = JSON.parse(backup);
                    if (Date.now() - data.timestamp < 30 * 60 * 1000 && data.gamePhase !== 'SETUP') {
                        console.log("Reconnecting: restoring from local backup...");
                        setHand(data.hand || []);
                        setLibrary(data.library || []);
                        setGraveyard(data.graveyard || []);
                        setExile(data.exile || []);
                        setCommandZone(data.commandZone || []);
                        setLife(data.life || 40);
                        if (data.logs) setLogs(data.logs);
                        if (data.gamePhase) setGamePhase(data.gamePhase);
                        if (data.commanderDamage) setCommanderDamage(data.commanderDamage);
                        if (data.turn) setTurn(data.turn);
                        if (data.round) setRound(data.round);
                        if (data.currentTurnPlayerId) setCurrentTurnPlayerId(data.currentTurnPlayerId);
                        if (data.opponentsLife) setOpponentsLife(data.opponentsLife);
                        if (data.opponentsCounts) setOpponentsCounts(data.opponentsCounts);
                        if (data.opponentsCommanders) setOpponentsCommanders(data.opponentsCommanders);
                        if (data.manaRules) {
                            console.log("Restoring custom mana rules from backup...");
                            setManaRulesState(data.manaRules);
                        }
                        // Restoring mana rules is usually handled by App.tsx initialization, 
                        // but if we are in a sub-view (Reconnect), we should ensure they are here.
                        // However, manaRules is a prop in Tabletop. So we can't 'set' it.
                        // The parent (App.tsx) needs to provide it.
                        // So the fix is primarily ensuring they ARE in the backup so App.tsx can find them.

                        // Remap board objects: old socket id for us -> new socket id
                        const myNewId = socket.id;
                        const myOldPlayer = data.playersList?.find((p: any) => p.name === playerName);
                        const myOldId = myOldPlayer?.id;
                        const restoredObjects = (data.boardObjects || []).map((obj: BoardObject) => {
                            if (myOldId && obj.controllerId === myOldId) {
                                return { ...obj, controllerId: myNewId };
                            }
                            return obj;
                        });
                        setBoardObjects(restoredObjects);

                        hasLoadedState.current = true;
                        addLog("Reconnected: Game state restored", "SYSTEM");
                    }
                } catch (e) {
                    console.error("Failed to restore from backup on reconnect", e);
                }
            }
        }

        const validLayout = getLayout(Math.max(playersList.length, 6), 625);
        const matCenterY = validLayout[0].y + MAT_H / 2;
        const isMobile = window.innerWidth < 768;
        const startScale = isMobile ? 0.5 : 0.8;
        setView({
            x: window.innerWidth / 2,
            y: window.innerHeight / 2 - (matCenterY * startScale),
            scale: startScale
        });
    }, [initialDeck, initialGameStarted]);

    // Auto-center opponent view
    useEffect(() => {
        if (isOpponentViewOpen) {
            const opponents = playersList.filter(p => p.id !== socket.id);
            if (opponents.length === 0) return;

            const targetPlayer = opponents[selectedOpponentIndex % opponents.length];
            const targetSeatIndex = playersList.findIndex(p => p.id === targetPlayer.id);
            const targetPos = layout[targetSeatIndex];
            if (!targetPos) return;
            const targetRot = targetPos.rot;

            const targetX = targetPos.x + MAT_W / 2;
            const targetY = targetPos.y + MAT_H / 2;

            const paneW = window.innerWidth / 2;
            const paneH = window.innerHeight;

            // We want to view this opponent upright.
            // The world is rotated by cameraRotation for the main view.
            // For opponent view, we want a different rotation: -targetRot.
            // But renderWorld takes a rotation prop.
            // We will pass -targetRot to renderWorld for opponent view.
            // And we need to set opponentView x/y such that targetX/Y is centered.

            const rot = -targetRot;
            const rad = rot * Math.PI / 180;

            const rx = targetX * Math.cos(rad) - targetY * Math.sin(rad);
            const ry = targetX * Math.sin(rad) + targetY * Math.cos(rad);

            const s = 0.6;
            const vx = (paneW / 2) - s * rx;
            const vy = (paneH / 2) - s * ry;

            setOpponentView({ x: vx, y: vy, scale: s });
        }
    }, [isOpponentViewOpen, selectedOpponentIndex, playersList]);

    // Timer
    useEffect(() => {
        if (gamePhase === 'SETUP') return;
        const interval = setInterval(() => {
            setElapsedTime(Date.now() - turnStartTime);
        }, 1000);
        return () => clearInterval(interval);
    }, [turnStartTime, gamePhase]);

    // Sync Hand to Mobile & Ref
    useEffect(() => {
        if (!isLocal || !hasLoadedState.current) return;
        const currentId = playersList[mySeatIndex]?.id;
        if (!currentId) return;

        // Update Ref to ensure it matches visual state
        if (localPlayerStates.current[currentId]) {
            localPlayerStates.current[currentId].hand = hand;
        }

        // Send update to mobile
        sendHandUpdate(currentId, hand, gamePhase, mulliganCount);
    }, [hand, gamePhase, mulliganCount, isLocal, mySeatIndex, playersList]);

    // --- Game Flow Methods ---
    const handleStartGameLogic = (options?: { mulligansAllowed: boolean, trackDamage?: boolean }) => {
        const shouldUseMulligans = options?.mulligansAllowed ?? true;
        setMulligansAllowed(shouldUseMulligans);
        if (options?.trackDamage !== undefined) setTrackDamage(options.trackDamage);

        if (isLocal) {
            // Re-initialize states to ensure fresh deck data
            const states: Record<string, LocalPlayerState> = {};
            playersList.forEach((p, idx) => {
                if (p.id === 'player-0' || p.id === 'local-player') {
                    states[p.id] = createInitialState(p.id, initialDeck, initialTokens);
                } else {
                    // Try to find by ID, fallback to index matching (skipping player 0)
                    let opp = localOpponents.find(o => o.id === p.id);
                    if (!opp && idx > 0 && localOpponents[idx - 1]) {
                        opp = localOpponents[idx - 1];
                    }

                    if (opp) {
                        states[p.id] = createInitialState(p.id, opp.deck, opp.tokens);
                    } else {
                        states[p.id] = createInitialState(p.id, [], []);
                    }
                }
            });
            localPlayerStates.current = states;

            // Draw 7 for everyone
            Object.values(localPlayerStates.current).forEach((state: LocalPlayerState) => {
                if (state.library.length >= 7) {
                    const initialHand = state.library.slice(0, 7);
                    state.library = state.library.slice(7);
                    // Keep tokens if any
                    const tokens = state.hand.filter(c => c.isToken);
                    state.hand = [...initialHand, ...tokens];
                }
                // Send update to mobile if applicable
                sendHandUpdate(state.id, state.hand, 'MULLIGAN', state.mulliganCount);
            });

            // Ensure P1 state exists before loading
            if (!localPlayerStates.current[playersList[0].id]) {
                localPlayerStates.current[playersList[0].id] = createInitialState(playersList[0].id, initialDeck, initialTokens);
            }
            // Load P1 state
            loadLocalPlayerState(playersList[0].id);
        } else {
            const lib = libraryRef.current.length > 0 ? libraryRef.current : initialDeck;
            if (lib.length >= 7) {
                const initialHand = lib.slice(0, 7);
                const remaining = lib.slice(7);
                setHand([...initialHand, ...initialTokens]);
                setLibrary(remaining);
            }
        }

        setTurnStartTime(Date.now());
        damageTakenThisTurn.current = 0;
        healingReceivedThisTurn.current = 0;
        hasLoadedState.current = true;

        if (isLocal) {
            // In local mode, set turn order based on players list
            setTurnOrder(playersList.map(p => p.id));
            setCurrentTurnPlayerId(playersList[0].id);
        }

        addLog("Game Started", "SYSTEM", "Host");

        if (shouldUseMulligans) {
            setGamePhase('MULLIGAN');
        } else {
            setGamePhase('PLAYING');
        }
    };

    const startGame = () => {
        if (!isHost) return;
        const orderedIds = playersList.map(p => p.id);
        const startingPlayer = playersList[Math.floor(Math.random() * playersList.length)];
        emitAction('START_GAME', { mulligansAllowed, trackDamage, firstPlayerId: startingPlayer.id, playerOrder: orderedIds });
        handleStartGameLogic({ mulligansAllowed });
        setCurrentTurnPlayerId(startingPlayer.id);

        if (isLocal) {
            const idx = playersList.findIndex(p => p.id === startingPlayer.id);
            if (idx !== -1) {
                setMySeatIndex(idx);
                loadLocalPlayerState(startingPlayer.id);
            }
        }
    };

    const handleRestartGame = () => {
        emitAction('RESTART_GAME', {});
        setShowEndGameModal(false);
        setGamePhase('SETUP');
        setBoardObjects([]);
        setHand(initialTokens);
        setGraveyard([]);
        setExile([]);
        setLife(40);
        setTurn(1);
        setRound(1);
        setTurnOrder([]);
        setGameStats({});

        const commanders = initialDeck.filter(c => c.isCommander);
        const deck = initialDeck.filter(c => !c.isCommander);
        const shuffled = [...deck].sort(() => Math.random() - 0.5);
        setLibrary(shuffled);
        setCommandZone(commanders);

        addLog("The host has restarted the game", "SYSTEM");
        damageTakenThisTurn.current = 0;
        healingReceivedThisTurn.current = 0;
    };

    const handleKickPlayer = (targetId: string) => {
        if (confirm("Are you sure you want to kick this player?")) {
            socket.emit('kick_player', { room: roomId, targetId });
        }
    };

    const handleReorderPlayers = (fromIdx: number, toIdx: number) => {
        const newPlayers = [...playersList];
        const [moved] = newPlayers.splice(fromIdx, 1);
        newPlayers.splice(toIdx, 0, moved);

        // Update local state immediately to prevent revert on sync
        setPlayersList(newPlayers);
        setTurnOrder(newPlayers.map(p => p.id));

        emitAction('UPDATE_PLAYER_ORDER', { players: newPlayers });
        // Also update server source of truth if possible, but 'UPDATE_PLAYER_ORDER' syncs clients
        socket.emit('update_player_order', { room: roomId, players: newPlayers });
    };

    const handleShufflePlayers = () => {
        if (!isHost) return;
        const shuffled = [...playersList].sort(() => Math.random() - 0.5);
        setPlayersList(shuffled);
        setTurnOrder(shuffled.map(p => p.id));
        emitAction('UPDATE_PLAYER_ORDER', { players: shuffled });
        socket.emit('update_player_order', { room: roomId, players: shuffled });
    };

    const handleAssignState = (targetId: string, seatIdx: number) => {
        if (confirm(`Overwrite ${playersList.find(p => p.id === targetId)?.name}'s game data with saved data from Seat ${seatIdx + 1}?`)) {
            socket.emit('admin_assign_state', { room: roomId, targetId, seatIndex: seatIdx });
        }
    };

    const saveLocalPlayerState = (playerId: string) => {
        if (!localPlayerStates.current[playerId]) return;
        localPlayerStates.current[playerId] = {
            ...localPlayerStates.current[playerId],
            hand,
            library,
            graveyard,
            exile,
            commandZone,
            life,
            mulliganCount
        };
    };

    const loadLocalPlayerState = (playerId: string) => {
        const state = localPlayerStates.current[playerId];
        if (!state) return;
        setHand(state.hand);
        setLibrary(state.library);
        setGraveyard(state.graveyard);
        setExile(state.exile);
        setCommandZone(state.commandZone);
        setLife(state.life);
        setMulliganCount(state.mulliganCount);
    };

    const getControllerId = () => {
        return isLocal ? playersList[mySeatIndex].id : (socket.id || playersList[mySeatIndex]?.id || 'local-player');
    };

    const handleMulliganChoice = (keep: boolean) => {
        if (keep) {
            let toBottomCount = mulliganCount;
            if (freeMulligan && mulliganCount > 0) {
                toBottomCount = mulliganCount - 1;
            }

            if (toBottomCount > 0) {
                setMulliganSelectionMode(true);
                setCardsToBottom([]);
            } else {
                if (isLocal) {
                    const currentPlayer = playersList[mySeatIndex];
                    localPlayerStates.current[currentPlayer.id].hasKeptHand = true;
                    addLog(`${currentPlayer.name} kept hand`);

                    // Check if all kept
                    const allKept = playersList.every(p => localPlayerStates.current[p.id]?.hasKeptHand);
                    if (allKept) {
                        setGamePhase('PLAYING');
                        // Switch back to P1 view if needed, or stay. Usually P1 starts.
                    } else {
                        nextTurn(); // Switch to next player for mulligan
                    }
                } else {
                    setGamePhase('PLAYING');
                    addLog(`kept hand with ${mulliganCount} mulligans`);
                }
            }
        } else {
            const currentDeckCardsInHand = hand.filter(c => !c.isToken);
            const currentTokensInHand = hand.filter(c => c.isToken);

            const cardsToShuffle = [...currentDeckCardsInHand, ...library].sort(() => Math.random() - 0.5);
            const newHandCards = cardsToShuffle.slice(0, 7);
            const newLib = cardsToShuffle.slice(7);
            setHand([...newHandCards, ...currentTokensInHand]);
            setLibrary(newLib);
            setMulliganCount(prev => prev + 1);
            addLog("took a mulligan");
        }
    };

    const toggleBottomCard = (card: CardData) => {
        const requiredCount = freeMulligan ? Math.max(0, mulliganCount - 1) : mulliganCount;
        if (cardsToBottom.find(c => c.id === card.id)) {
            setCardsToBottom(prev => prev.filter(c => c.id !== card.id));
        } else {
            if (cardsToBottom.length < requiredCount) {
                setCardsToBottom(prev => [...prev, card]);
            }
        }
    };

    // --- Mobile Event Handlers ---
    const handleMobilePlayCard = ({ playerId, cardId }: { playerId: string, cardId: string }) => {
        if (!isLocal) return;

        // Find player state
        const state = localPlayerStates.current[playerId];
        if (!state) return;

        const card = state.hand.find(c => c.id === cardId);
        if (!card) return;

        // Remove from hand
        state.hand = state.hand.filter(c => c.id !== cardId);
        sendHandUpdate(playerId, state.hand, gamePhase, state.mulliganCount);

        // Add to board
        // Need to calculate spawn position based on seat.
        const playerIdx = playersList.findIndex(p => p.id === playerId);
        if (playerIdx === -1) return;

        const myPos = layout[playerIdx];
        if (!myPos) return;

        const defaultX = myPos.x + MAT_W / 2 - CARD_WIDTH / 2;
        const defaultY = myPos.y + MAT_H / 2 - CARD_HEIGHT / 2;

        const newObject: BoardObject = {
            id: crypto.randomUUID(), type: 'CARD', cardData: card,
            x: defaultX + (Math.random() * 40 - 20),
            y: defaultY + (Math.random() * 40 - 20),
            z: maxZ + 1,
            rotation: myPos.rot,
            isFaceDown: false, isTransformed: false,
            counters: {}, commanderDamage: {}, controllerId: playerId,
            quantity: 1, tappedQuantity: 0
        };
        setMaxZ(prev => prev + 1);
        setBoardObjects(prev => [...prev, newObject]);
        emitAction('ADD_OBJECT', newObject);

        addLog(`played ${card.name} from mobile`, 'ACTION', playersList[playerIdx].name);

        // If this player is currently directly viewed/controlled, update component state too
        if (playersList[mySeatIndex]?.id === playerId) {
            setHand(state.hand);
        }
    };

    const handleMobileMulligan = ({ playerId, keep }: { playerId: string, keep: boolean }) => {
        if (!isLocal) return;

        const state = localPlayerStates.current[playerId];
        if (!state) return;

        if (keep) {
            state.hasKeptHand = true;
            addLog(`kept hand (Mobile)`, 'ACTION', playersList.find(p => p.id === playerId)?.name);
            sendHandUpdate(playerId, state.hand, 'PLAYING', state.mulliganCount); // Optimistic update of phase?

            // Check if everyone has kept
            const allKept = playersList.every(p => localPlayerStates.current[p.id]?.hasKeptHand);
            if (allKept) {
                setGamePhase('PLAYING');
                addLog("All players have kept their hands. Game Start!", 'SYSTEM');
            }
        } else {
            // Mulligan Logic
            const currentHand = state.hand.filter(c => !c.isToken);
            const currentTokens = state.hand.filter(c => c.isToken);

            const cardsToShuffle = [...currentHand, ...state.library].sort(() => Math.random() - 0.5);
            const newHandCards = cardsToShuffle.slice(0, 7);
            const newLib = cardsToShuffle.slice(7);

            state.hand = [...newHandCards, ...currentTokens];
            state.library = newLib;
            state.mulliganCount += 1;

            sendHandUpdate(playerId, state.hand, 'MULLIGAN', state.mulliganCount);
            addLog(`took a mulligan`, 'ACTION', playersList.find(p => p.id === playerId)?.name);
        }

        // If viewed, sync component state
        if (playersList[mySeatIndex]?.id === playerId) {
            loadLocalPlayerState(playerId);
        }
    };

    const handleMobileUpdateLife = ({ playerId, amount }: { playerId: string, amount: number }) => {
        if (!isLocal) return;
        const state = localPlayerStates.current[playerId];
        if (!state) return;

        state.life += amount;
        addLog(`Life ${amount > 0 ? '+' : ''}${amount} (${state.life}) (Mobile)`, 'ACTION', playersList.find(p => p.id === playerId)?.name);

        if (playersList[mySeatIndex]?.id === playerId) {
            setLife(state.life);
        }
        // Send stats update back to mobile to confirm
        sendHandUpdate(playerId, state.hand, gamePhase, state.mulliganCount);
        // Note: Life update is separate, handled by useEffect on [life] change, 
        // BUT need to ensure it fires. 
        // Since we called setLife(state.life), the useEffect [life] WILL fire.
        // Correct.
    };

    const handleMobileUpdateCounter = ({ playerId, type, amount, targetId }: { playerId: string, type: string, amount: number, targetId?: string }) => {
        if (!isLocal) return;
        const state = localPlayerStates.current[playerId];
        if (!state) return;

        if (type === 'poison') {
            state.counters['poison'] = (state.counters['poison'] || 0) + amount;
            addLog(`Poison ${amount > 0 ? '+' : ''}${amount} (${state.counters['poison']})`, 'ACTION', playersList.find(p => p.id === playerId)?.name);
        } else if (type === 'commander') {
            if (targetId) {
                // Commander Damage logic: targetId is the SOURCE (commander owner)
                state.commanderDamage[targetId] = (state.commanderDamage[targetId] || 0) + amount;

                if (playersList[mySeatIndex]?.id === playerId) {
                    // Update UI state for Commander Modal
                    setCommanderDamage(prev => {
                        // Structure: { [sourceId]: { [victimId]: amount } } (based on HealthModal interpretation)
                        // Wait, HealthModal: `currentDmg = (commanderDamage[oppCommanderId] || {})[socket.id] || 0;`
                        // It assumes `commanderDamage` state is { [CommanderId]: { [VictimId]: Damage } }
                        // Here `state` is `LocalPlayerState` for `playerId` (Victim).
                        // `state.commanderDamage` I defined as `Record<string, number>` (SourceId -> Damage).
                        // This matches usage context.

                        // Now update Top Level State `commanderDamage`?
                        // `setCommanderDamage` expects `Record<string, Record<string, number>>`.
                        // So we need to update the entry for `targetId` (Source) and `playerId` (Victim).
                        const sourceKey = `cmd-${targetId}`; // Assuming valid source ID construction?
                        // Actually HealthModal constructs `oppCommanderId = cmd-${p.id}`.
                        // So we should match that.

                        return {
                            ...prev,
                            [sourceKey]: {
                                ...(prev[sourceKey] || {}),
                                [playerId]: (prev[sourceKey]?.[playerId] || 0) + amount
                            }
                        };
                    });
                }
            }
        } else {
            state.counters[type] = (state.counters[type] || 0) + amount;
        }
    };

    useEffect(() => {
        if (!isLocal) return;
        socket.on('mobile_play_card', handleMobilePlayCard);
        socket.on('mobile_mulligan', handleMobileMulligan);
        socket.on('mobile_update_life', handleMobileUpdateLife);
        socket.on('mobile_update_counter', handleMobileUpdateCounter);

        return () => {
            socket.off('mobile_play_card', handleMobilePlayCard);
            socket.off('mobile_mulligan', handleMobileMulligan);
            socket.off('mobile_update_life', handleMobileUpdateLife);
            socket.off('mobile_update_counter', handleMobileUpdateCounter);
        };
    }, [isLocal, playersList, mySeatIndex, maxZ, gamePhase]);


    const confirmKeepHand = () => {
        const requiredCount = freeMulligan ? Math.max(0, mulliganCount - 1) : mulliganCount;
        if (cardsToBottom.length !== requiredCount) return;
        const newHand = hand.filter(h => !cardsToBottom.find(b => b.id === h.id));
        setHand(newHand);
        setLibrary(prev => [...prev, ...cardsToBottom]);

        if (isLocal) {
            const currentPlayer = playersList[mySeatIndex];
            localPlayerStates.current[currentPlayer.id].hasKeptHand = true;
            addLog(`${currentPlayer.name} kept hand`);
            const allKept = playersList.every(p => localPlayerStates.current[p.id]?.hasKeptHand);
            if (allKept) setGamePhase('PLAYING');
            else nextTurn();
        } else {
            setGamePhase('PLAYING');
            addLog(`kept hand and put ${requiredCount} cards on bottom`);
        }

        setMulliganSelectionMode(false);
    };

    const handleLocalViewSwitch = (index: number) => {
        if (!isLocal || index === mySeatIndex) return;

        // Save state of currently viewed player
        const currentPlayerId = playersList[mySeatIndex].id;
        saveLocalPlayerState(currentPlayerId);

        // Switch view
        setMySeatIndex(index);

        // Load state of new player
        const newPlayerId = playersList[index].id;
        loadLocalPlayerState(newPlayerId);

        addLog(`switched view to ${playersList[index].name}`, 'SYSTEM');
    };

    const updateMulliganSetting = (val: boolean) => {
        if (!isHost) return;
        setMulligansAllowed(val);
        emitAction('UPDATE_SETTINGS', { mulligansAllowed: val });
    };

    const updateFreeMulliganSetting = (val: boolean) => {
        if (!isHost) return;
        setFreeMulligan(val);
        emitAction('UPDATE_SETTINGS', { freeMulligan: val });
    };

    const updateTrackDamageSetting = (val: boolean) => {
        if (!isHost) return;
        setTrackDamage(val);
        emitAction('UPDATE_SETTINGS', { trackDamage: val });
    };

    const nextTurn = () => {
        if (isLocal) {
            checkDamageTracking();
            damageTakenThisTurn.current = 0;
            healingReceivedThisTurn.current = 0;

            // Save currently viewed player's state
            const viewedPlayerId = playersList[mySeatIndex].id;
            saveLocalPlayerState(viewedPlayerId);

            const currentIndex = playersList.findIndex(p => p.id === currentTurnPlayerId);
            const nextIndex = (currentIndex + 1) % playersList.length;
            const nextPlayer = playersList[nextIndex];

            setCurrentTurnPlayerId(nextPlayer.id);
            if (gamePhase === 'PLAYING') setTurn(turn + 1);
            setTurnStartTime(Date.now());

            // Switch View to Next Player
            setMySeatIndex(nextIndex);
            loadLocalPlayerState(nextPlayer.id);
            return;
        }

        if (playersList.length <= 1) return;
        const myIndex = playersList.findIndex(p => p.id === socket.id);
        const nextPlayer = playersList[(myIndex + 1) % playersList.length];
        const nextTurnNum = turn + 1;
        const duration = formatTime(Date.now() - turnStartTime);
        const durationMs = Date.now() - turnStartTime;

        emitAction('PASS_TURN', {
            nextPlayerSocketId: nextPlayer.id,
            turnNumber: nextTurnNum,
            prevDuration: duration
        });

        if (currentTurnPlayerId === socket.id) {
            setGameStats(prev => {
                const current = prev[socket.id] || emptyStats;
                return { ...prev, [socket.id]: { ...current, totalTurnTime: current.totalTurnTime + durationMs } };
            });
            updateMyStats({ totalTurnTime: (gameStats[socket.id]?.totalTurnTime || 0) + durationMs });
        }

        // Optimistic update
        setCurrentTurnPlayerId(nextPlayer.id);
        setTurn(nextTurnNum);
        setTurnStartTime(Date.now());

        checkDamageTracking();
        damageTakenThisTurn.current = 0;
        healingReceivedThisTurn.current = 0;
    };

    const formatTime = (ms: number) => {
        const totalSeconds = Math.floor(ms / 1000);
        const minutes = Math.floor(totalSeconds / 60);
        const seconds = totalSeconds % 60;
        return `${minutes}:${seconds.toString().padStart(2, '0')}`;
    };

    const untapAll = () => {
        const myDefaultRotation = layout[mySeatIndex]?.rot || 0;
        const myId = isLocal ? playersList[mySeatIndex].id : (socket.id || 'local-player');

        const myCards = boardObjects.filter(o => o.controllerId === myId && (o.tappedQuantity > 0 || o.rotation !== myDefaultRotation));
        if (myCards.length === 0) return;

        // Record undo state
        pushUndo({
            type: 'UNTAP_ALL',
            objects: myCards.map(o => ({ id: o.id, previousRotation: o.rotation, previousTappedQuantity: o.tappedQuantity }))
        });

        setBoardObjects(prev => prev.map(o => {
            if (o.controllerId === myId && (o.tappedQuantity > 0 || o.rotation !== myDefaultRotation)) {
                return { ...o, rotation: myDefaultRotation, tappedQuantity: 0 };
            }
            return o;
        }));

        if (!isLocal) {
            myCards.forEach(obj => {
                socket.emit('game_action', { room: roomId, action: 'UPDATE_OBJECT', data: { id: obj.id, updates: { rotation: myDefaultRotation, tappedQuantity: 0 } } });
            });
        }

        // Clear floating mana on untap all
        setFloatingMana({ ...EMPTY_POOL });
        addLog("untapped all permanents");
    };

    const unstackCards = (id: string) => {
        const obj = boardObjects.find(o => o.id === id);
        if (!obj || obj.quantity <= 1) return;
        const newObjects: BoardObject[] = [];
        for (let i = 1; i < obj.quantity; i++) {
            newObjects.push({
                ...obj, id: crypto.randomUUID(), quantity: 1, tappedQuantity: 0,
                x: obj.x + (i * 20), y: obj.y + (i * 20), z: maxZ + i
            });
        }
        setMaxZ(prev => prev + obj.quantity);
        setBoardObjects(prev => [
            ...prev.map(o => o.id === id ? { ...o, quantity: 1, tappedQuantity: 0 } : o),
            ...newObjects
        ]);
        emitAction('UPDATE_OBJECT', { id, updates: { quantity: 1, tappedQuantity: 0 } });
        newObjects.forEach(newObj => emitAction('ADD_OBJECT', newObj));
        addLog(`unstacked ${obj.cardData.name}`);
    };

    const removeCardFromStack = (id: string) => {
        const obj = boardObjects.find(o => o.id === id);
        if (!obj || obj.quantity <= 1) return;

        const newQuantity = obj.quantity - 1;
        const newTapped = Math.min(obj.tappedQuantity, newQuantity);
        updateBoardObject(id, { quantity: newQuantity, tappedQuantity: newTapped });

        const newObject: BoardObject = {
            ...obj,
            id: crypto.randomUUID(),
            quantity: 1,
            tappedQuantity: 0,
            x: obj.x + 20,
            y: obj.y + 20,
            z: maxZ + 1
        };
        setMaxZ(prev => prev + 1);
        setBoardObjects(prev => [...prev, newObject]);
        emitAction('ADD_OBJECT', newObject);
        addLog(`split 1 ${obj.cardData.name} from stack`);
    };

    const produceMana = (source: ManaSource, skipRotation: boolean = false) => {
        if (!showManaCalculator) return;

        // Check if this source has an activation cost and we need to pay it
        if (source.activationCost && showManaCalculator) {
            const cost = parseManaCost(source.activationCost);
            const poolRes = subtractFromPool(floatingMana, cost, (manaInfoRef.current || manaInfo).cmdColors);

            if (!poolRes) {
                // Not enough mana in pool - show payment sidebar for the cost
                const virtualCard = {
                    id: 'virtual-cost-' + source.objectId,
                    name: `Activate ${source.cardName}`,
                    manaCost: source.activationCost,
                    imageUrl: boardObjects.find(o => o.id === source.objectId)?.cardData.imageUrl,
                    type: 'Ability',
                    producedMana: []
                } as any;
                setPendingPaymentCard(virtualCard);
                return;
            } else {
                // Auto-paid from pool
                setFloatingMana(poolRes);
                addLog(`paid {${source.activationCost}} for ${source.cardName} ability`);
            }
        }

        const produced = source.producedMana;
        const flexible = produced.length > 1 && !produced.every(c => c === produced[0]);

        // Check if this source has an alternative rule - show modal to pick
        if (source.alternativeRule && !choosingRuleForId) {
            setChoosingRuleForId(source.objectId);
            return;
        }

        // Check if this source requires a color choice (flexible mana)
        const hasWUBRG = produced.includes('WUBRG');
        const actualColorOptions = produced.filter(c => c !== 'WUBRG' && c !== 'CMD');
        const needsColorChoice = hasWUBRG || (flexible && actualColorOptions.length > 1);

        if (!needsColorChoice && produced.length > 0) {
            // Fixed mana production - add directly to pool
            setFloatingMana(prev => {
                const next = { ...prev };
                produced.forEach(c => {
                    next[c] = (next[c] || 0) + 1;
                });
                return next;
            });

            if (produced.length > 0) {
                const displayStr = produced.map(c => `{${c}}`).join('');
                addLog(`added ${displayStr} to mana pool (via ${source.cardName})`);
            }

            if (!skipRotation && source.abilityType === 'tap') {
                const obj = boardObjects.find(o => o.id === source.objectId);
                if (obj) {
                    const controllerIdx = playersList.findIndex(p => p.id === obj.controllerId);
                    const defaultRotation = (controllerIdx !== -1 && layout[controllerIdx]) ? layout[controllerIdx].rot : 0;

                    if (obj.quantity > 1) {
                        const newTapped = Math.min(obj.quantity, obj.tappedQuantity + 1);
                        updateBoardObject(obj.id, { tappedQuantity: newTapped }, true, true);
                    } else {
                        const isTapped = obj.rotation !== defaultRotation;
                        if (!isTapped) {
                            const newRotation = (defaultRotation + 90) % 360;
                            updateBoardObject(obj.id, { rotation: newRotation }, true, true);
                        }
                    }
                }
            }
        } else if (needsColorChoice) {
            // Flexible mana - show color picker
            setChoosingColorForId(source.objectId);
        }
    };

    const handleManaButtonClick = (source: ManaSource) => {
        produceMana(source, false);
    };



    const updateBoardObject = (id: string, updates: Partial<BoardObject>, silent: boolean = false, skipMana: boolean = false) => {
        setBoardObjects(prev => {
            const movingObj = prev.find(o => o.id === id);
            if (!movingObj) return prev;

            let nextState = prev;
            const changes: { id: string, updates: Partial<BoardObject> }[] = [];

            if (movingObj.type === 'CARD' && updates.x !== undefined && updates.y !== undefined) {
                const dx = updates.x - movingObj.x;
                const dy = updates.y - movingObj.y;
                if (dx !== 0 || dy !== 0) {
                    nextState = prev.map(obj => {
                        if (obj.id === id) {
                            changes.push({ id, updates });
                            return { ...obj, ...updates };
                        }
                        if (obj.type === 'COUNTER') {
                            const counterCenterX = obj.x + 20;
                            const counterCenterY = obj.y + 20;
                            if (counterCenterX >= movingObj.x && counterCenterX <= movingObj.x + CARD_WIDTH &&
                                counterCenterY >= movingObj.y && counterCenterY <= movingObj.y + CARD_HEIGHT) {
                                const newPos = { x: obj.x + dx, y: obj.y + dy, z: obj.z + 10 };
                                changes.push({ id: obj.id, updates: newPos });
                                return { ...obj, ...newPos };
                            }
                        }
                        return obj;
                    });
                }
            } else {
                changes.push({ id, updates });
                nextState = prev.map(obj => obj.id === id ? { ...obj, ...updates } : obj);

                // --- Tap-to-Mana Detection ---
                // Check if this is a tap action (rotation or tappedQuantity change)
                const myControllerIdx = playersList.findIndex(p => p.id === movingObj.controllerId);
                const defaultRot = (myControllerIdx !== -1 && layout[myControllerIdx]) ? layout[myControllerIdx].rot : 0;

                const wasTapped = movingObj.rotation !== defaultRot || movingObj.tappedQuantity === movingObj.quantity;
                const isNowTapped = (updates.rotation !== undefined ? updates.rotation !== defaultRot : wasTapped) ||
                    (updates.tappedQuantity !== undefined ? updates.tappedQuantity === movingObj.quantity : wasTapped);

                // Trigger mana production when tapping (regardless of isLocal)
                // STOP MANA PRODUCTION DURING DRAG/MOVE OR IF skipMana IS TRUE
                if (!wasTapped && isNowTapped && !isDraggingRef.current && !skipMana) {
                    // Use manaInfoRef to get the latest calculated info
                    const currentManaInfo = manaInfoRef.current || manaInfo;

                    // Find the mana source for this object
                    const source = currentManaInfo?.sources?.find((s: any) => s.objectId === id);

                    if (source) {
                        // Check if we should auto-produce
                        // 1. It is a land (always auto-produce if tap ability)
                        // 2. Or it is a rock/dork with 'tap' ability and NOT hideManaButton (unless user explicitly hid it, but usually we want to auto-prod if they tap it physically)
                        // Actually, if they tap it physically, they probably want mana.
                        // Exception: Attacking with a creature that produces mana? 
                        // But usually you tap to attack in combat phase.
                        // For now, let's auto-produce if it has a 'tap' ability.

                        // Trigger mana production only if it doesn't have a button (like Lands)
                        // This prevents double triggering and respects user's wish to tap for other reasons (e.g. attacking)
                        if (source.abilityType === 'tap' && source.hideManaButton) {
                            console.log(`[Tap Detection] Triggering mana production for ${source.cardName}`);
                            // Use setTimeout to ensure state update happens first so visual tap is clear
                            setTimeout(() => produceMana(source, true), 50);
                        }
                    }
                }
            }

            if (!silent) {
                changes.forEach(change => {
                    emitAction('UPDATE_OBJECT', change);
                });
            }

            return nextState;
        });
    };

    const updateCommanderDamage = (commanderId: string, victimId: string, delta: number) => {
        let ownerSocketId: string | undefined;
        if (commanderId.startsWith('cmd-')) {
            const internalId = commanderId.replace('cmd-', '');
            const owner = playersList.find(p => p.id === internalId);
            ownerSocketId = owner?.id;
        }

        const victim = playersList.find(p => p.id === victimId);
        const victimSocketId = victim?.id;

        setCommanderDamage(prev => {
            const cmdrRecord = prev[commanderId] || {};
            const currentVal = cmdrRecord[victimId] || 0;
            const newVal = Math.max(0, currentVal + delta);

            if (ownerSocketId && victimSocketId) {
                emitAction('UPDATE_COMMANDER_DAMAGE', {
                    ownerId: ownerSocketId,
                    victimId: victimSocketId,
                    damage: newVal
                });
            }

            return { ...prev, [commanderId]: { ...cmdrRecord, [victimId]: newVal } };
        });
    };

    const playCardFromHand = (card: CardData, spawnX?: number, spawnY?: number) => {
        const myPos = layout[mySeatIndex];
        if (!myPos) return;
        const defaultX = myPos.x + MAT_W / 2 - CARD_WIDTH / 2;
        const defaultY = myPos.y + MAT_H / 2 - CARD_HEIGHT / 2;
        const newObject: BoardObject = {
            id: crypto.randomUUID(), type: 'CARD', cardData: card,
            x: spawnX ?? (defaultX + (Math.random() * 40 - 20)),
            y: spawnY ?? (defaultY + (Math.random() * 40 - 20)),
            z: maxZ + 1, rotation: myPos.rot, isFaceDown: false, isTransformed: false,
            counters: {}, commanderDamage: {}, controllerId: getControllerId(),
            quantity: 1, tappedQuantity: 0
        };

        // Apply enters tapped rule
        if (manaRulesState[card.scryfallId]?.entersTapped) {
            newObject.rotation = (newObject.rotation + 90) % 360;
        }
        setMaxZ(prev => prev + 1);
        setBoardObjects(prev => [...prev, newObject]);
        emitAction('ADD_OBJECT', newObject);
        updateMyStats({ cardsPlayed: (gameStats[getMyId()]?.cardsPlayed || 0) + 1 });
        if (!card.isToken) setHand(prev => prev.filter(c => c.id !== card.id));

        // Track last played card for auto-tap
        setLastPlayedCard(card);

        // Record undo
        pushUndo({ type: 'PLAY_CARD', objectId: newObject.id, card, fromZone: 'HAND' });

        addLog(`played ${card.name} ${card.isToken ? '(Token)' : ''}`);

        // Show mana payment sidebar if it has a cost and calculator is ENABLED
        if (showManaCalculator && !card.isToken && !card.isLand) {
            const cost = parseManaCost(card.manaCost || "");
            if (cost.cmc > 0) {
                setAllocatedMana(EMPTY_POOL);
                setPendingPaymentCard(card);
            }
        }
    };

    const payManaForCard = useCallback((card: CardData, xValue: number = 0): boolean => {
        const cost = parseManaCost(card.manaCost || "{0}");
        // Simplistic payment check - could be improved for specific colors
        const requiredTotal = cost.cmc + xValue;
        const availableInPool = Object.values(floatingMana).reduce((a, b) => a + b, 0);

        if (availableInPool >= requiredTotal) {
            // Subtract mana from pool (simplistic generic first)
            setFloatingMana(prev => {
                const next = { ...prev };
                let remaining = requiredTotal;

                // Try to subtract from colorless first, then others
                const colors: (keyof ManaPool)[] = ['C', 'W', 'U', 'B', 'R', 'G'];
                for (const color of colors) {
                    if (remaining <= 0) break;
                    const took = Math.min(next[color] || 0, remaining);
                    next[color] = (next[color] || 0) - took;
                    remaining -= took;
                }
                return next;
            });
            return true;
        }
        return false;
    }, [floatingMana]);

    // --- Mana Calculator Functions ---
    const myDefaultRotation = useMemo(() => layout[mySeatIndex]?.rot || 0, [layout, mySeatIndex]);

    // Compute available mana from untapped sources
    const manaInfo = useMemo(() => {
        const myId = isLocal ? playersList[mySeatIndex]?.id || 'player-0' : (socket.id || 'local-player');

        // Determine commander colors for Command Tower logic
        // Look for commander in command zone or on board
        const myPlayer = playersList.find(p => p.id === myId);
        let commander: CardData | undefined;
        // Check if I am the controller
        const amIController = (isLocal && myId === (playersList[mySeatIndex]?.id || 'player-0')) || (!isLocal && myId === (socket.id || 'local-player'));

        if (amIController) {
            // Use local state
            commander = commandZone.find(c => c.isCommander);
        } else {
            // Check opponents commanders
            const oppCmds = opponentsCommanders[myId];
            if (oppCmds) {
                commander = oppCmds.find(c => c.isCommander);
            }
        }

        // Fallback to board search
        if (!commander) {
            commander = boardObjects.find(o => o.controllerId === myId && o.cardData.isCommander)?.cardData;
        }

        let cmdColors: ManaColor[] | undefined;
        if (commander) {
            // Estimate colors from mana cost
            // This is a simplification; ideally we parse mana cost symbols
            // For now, let's use producedMana if available, or just infer from cost string
            const cost = commander.manaCost || "";
            cmdColors = [];
            if (cost.includes('W')) cmdColors.push('W');
            if (cost.includes('U')) cmdColors.push('U');
            if (cost.includes('B')) cmdColors.push('B');
            if (cost.includes('R')) cmdColors.push('R');
            if (cost.includes('G')) cmdColors.push('G');
            if (cost.includes('C')) cmdColors.push('C'); // Colorless commander?
            // Handle W/U etc.
        }
        const info = calculateAvailableMana(boardObjects, myId, myDefaultRotation, cmdColors, manaRulesState);
        manaInfoRef.current = info;
        return info;
    }, [boardObjects, isLocal, playersList, mySeatIndex, myDefaultRotation, manaRulesState]);

    // Reset floating mana on turn change
    useEffect(() => {
        setFloatingMana({ ...EMPTY_POOL });
    }, [turn, currentTurnPlayerId]);

    const handleAddMana = (type: keyof ManaPool) => {
        if (!showManaCalculator) return;
        setFloatingMana(prev => ({
            ...prev,
            [type]: (prev[type] || 0) + 1
        }));
    };

    const handleRemoveMana = (type: keyof ManaPool) => {
        setFloatingMana(prev => ({
            ...prev,
            [type]: Math.max(0, (prev[type] || 0) - 1)
        }));
    };

    // Handle auto-tap when Tab is pressed
    const handleAutoTap = useCallback((card: CardData, xValue: number = 0) => {
        if (!showManaCalculator || !autoTapEnabled) return; // Only run if setting is active and tracker shown
        if (!card.manaCost || card.isLand) return; // Don't auto-tap for lands

        const myId = isLocal ? playersList[mySeatIndex]?.id || 'player-0' : (socket.id || 'local-player');

        const cost = parseManaCost(card.manaCost);
        if (cost.symbols.length === 0) return;

        // 1. Try to pay with Floating Mana first
        const untappedSources = [...manaInfo.availableSources, ...manaInfo.potentialSources];
        const result = autoTapForCost(cost, untappedSources, floatingMana, xValue, manaInfo.cmdColors);

        if (!result.success) {
            addLog(`Not enough mana to pay for ${card.name} (${card.manaCost})`);
            return;
        }

        // Save previous states for undo
        const previousStates = result.tappedIds.map(id => {
            const obj = boardObjects.find(o => o.id === id);
            return { id, rotation: obj?.rotation || 0, tappedQuantity: obj?.tappedQuantity || 0 };
        });

        // Tap each source
        // Tap sources (handling stacks)
        const tappedRotation = (myDefaultRotation + 90) % 360;
        const tapCounts: Record<string, number> = {};
        result.tappedIds.forEach(id => {
            tapCounts[id] = (tapCounts[id] || 0) + 1;
        });

        setBoardObjects(prev => {
            const next = [...prev];
            Object.entries(tapCounts).forEach(([id, count]) => {
                const idx = next.findIndex(o => o.id === id);
                if (idx !== -1) {
                    const obj = next[idx];
                    const updates: Partial<BoardObject> = {};
                    if (obj.quantity > 1) {
                        updates.tappedQuantity = Math.min(obj.quantity, (obj.tappedQuantity || 0) + count);
                    } else {
                        updates.rotation = tappedRotation;
                    }
                    next[idx] = { ...obj, ...updates };
                    emitAction('UPDATE_OBJECT', { id, ...updates });
                }
            });
            return next;
        });

        // Update floating mana — subtract what was spent and add any excess produced
        setFloatingMana(result.floatingManaRemaining);

        // Track mana stats
        const addProduced: Record<string, number> = {};
        const addUsed: Record<string, number> = {};
        MANA_COLORS.forEach(c => {
            // Mana produced from tapping
            if (result.manaProducedFromTap[c] > 0) {
                addProduced[c] = (gameStats[myId]?.manaProduced?.[c] || 0) + result.manaProducedFromTap[c];
            }
            // Mana used from floating or tapping
            if (result.manaUsed[c] > 0) {
                addUsed[c] = (gameStats[myId]?.manaUsed?.[c] || 0) + result.manaUsed[c];
            }
        });
        updateMyStats({
            manaProduced: { ...gameStats[myId]?.manaProduced, ...addProduced },
            manaUsed: { ...gameStats[myId]?.manaUsed, ...addUsed },
        });

        // Record undo
        pushUndo({
            type: 'AUTO_TAP',
            tappedIds: result.tappedIds,
            previousStates,
            previousFloatingMana: { ...floatingMana }, // Save copy of previous floating mana
        });

        // Visual flash feedback
        setAutoTappedIds(result.tappedIds);
        if (autoTapFlashTimer.current) clearTimeout(autoTapFlashTimer.current);
        autoTapFlashTimer.current = setTimeout(() => setAutoTappedIds([]), 1500);

        const tappedNames = result.tappedIds.map(id => boardObjects.find(o => o.id === id)?.cardData.name).filter(Boolean);
        addLog(`auto-tapped for ${card.name}: ${tappedNames.join(', ')}`);
        setLastPlayedCard(null);
    }, [boardObjects, manaInfo.sources, myDefaultRotation, pushUndo, floatingMana, isLocal, playersList, mySeatIndex, gameStats, updateMyStats, autoTapEnabled]);

    // Handle UI auto-tap for a specific color (from ManaDisplay)
    const handleAutoTapColor = useCallback((color: string) => {
        if (!showManaCalculator || !autoTapEnabled) return; // Only run if setting is active and tracker shown
        // Find an untapped source that produces this color and is in 'availableSources'
        // We prefer sources that produce ONLY this color if possible, to save flexible sources
        const source = manaInfo.availableSources.find(s =>
            s.producedMana.includes(color as ManaColor) &&
            !s.isFlexible // Prefer simple sources first
        ) || manaInfo.availableSources.find(s =>
            s.producedMana.includes(color as ManaColor)
        );

        if (source) {
            produceMana(source, true); // true = isTapped (trigger tap animation/update)
            // Note: produceMana handles the actual state update and logging
        } else {
            addLog(`No available ${color} source to auto-tap`);
        }
    }, [manaInfo.availableSources, produceMana, autoTapEnabled]);

    // Handle undo (Ctrl+Z)
    const handleUndo = useCallback(() => {
        if (undoHistory.length === 0) return;

        const action = undoHistory[undoHistory.length - 1];
        setUndoHistory(prev => prev.slice(0, -1));

        switch (action.type) {
            case 'TAP_CARD': {
                updateBoardObject(action.objectId, {
                    rotation: action.previousRotation,
                    tappedQuantity: action.previousTappedQuantity
                });
                addLog('undid tap');
                break;
            }
            case 'UNTAP_ALL': {
                setBoardObjects(prev => prev.map(o => {
                    const saved = action.objects.find(s => s.id === o.id);
                    if (saved) return { ...o, rotation: saved.previousRotation, tappedQuantity: saved.previousTappedQuantity };
                    return o;
                }));
                action.objects.forEach(saved => {
                    emitAction('UPDATE_OBJECT', { id: saved.id, updates: { rotation: saved.previousRotation, tappedQuantity: saved.previousTappedQuantity } });
                });
                addLog('undid untap all');
                break;
            }
            case 'PLAY_CARD': {
                // Return card to hand and remove from board
                const obj = boardObjects.find(o => o.id === action.objectId);
                if (obj) {
                    setBoardObjects(prev => prev.filter(o => o.id !== action.objectId));
                    emitAction('REMOVE_OBJECT', { id: action.objectId });
                    if (action.fromZone === 'HAND' && !action.card.isToken) {
                        setHand(prev => [...prev, action.card]);
                    } else if (action.fromZone === 'COMMAND') {
                        setCommandZone(prev => [...prev, action.card]);
                    }
                }
                addLog(`undid playing ${action.card.name}`);
                break;
            }
            case 'AUTO_TAP': {
                // Restore all tapped cards to their previous state in a single update
                setBoardObjects(prev => {
                    const next = [...prev];
                    action.previousStates.forEach(state => {
                        const idx = next.findIndex(o => o.id === state.id);
                        if (idx !== -1) {
                            const updates = {
                                rotation: state.rotation,
                                tappedQuantity: state.tappedQuantity
                            };
                            next[idx] = { ...next[idx], ...updates };
                            emitAction('UPDATE_OBJECT', { id: state.id, updates });
                        }
                    });
                    return next;
                });

                if (action.previousFloatingMana) {
                    setFloatingMana(action.previousFloatingMana);
                }
                setAutoTappedIds([]);
                addLog('undid auto-tap');
                break;
            }
        }
    }, [undoHistory, boardObjects, floatingMana]);

    const spawnCounter = () => {
        const myPos = layout[mySeatIndex];
        if (!myPos) return;
        const defaultX = myPos.x + MAT_W / 2 - 20;
        const defaultY = myPos.y + MAT_H / 2 - 20;
        const newObject: BoardObject = {
            id: crypto.randomUUID(), type: 'COUNTER',
            cardData: { ...initialTokens[0] || initialDeck[0], name: "Counter", id: "counter" },
            x: defaultX + (Math.random() * 40 - 20),
            y: defaultY + (Math.random() * 40 - 20),
            z: maxZ + 1, rotation: 0, isFaceDown: false, isTransformed: false,
            counters: {}, commanderDamage: {}, controllerId: getControllerId(),
            quantity: 1, tappedQuantity: 0
        };

        setMaxZ(prev => prev + 1);
        setBoardObjects(prev => [...prev, newObject]);
        emitAction('ADD_OBJECT', newObject);
        updateMyStats({ cardsPlayed: (gameStats[getMyId()]?.cardsPlayed || 0) + 1 });
        addLog("added a counter");
    };

    const shuffleLibrary = () => {
        setLibrary(prev => {
            const newLib = [...prev];
            for (let i = newLib.length - 1; i > 0; i--) {
                const j = Math.floor(Math.random() * (i + 1));
                [newLib[i], newLib[j]] = [newLib[j], newLib[i]];
            }
            return newLib;
        });
        setIsShuffling(true);
        setTimeout(() => setIsShuffling(false), 500);
        addLog("shuffled library");
    };

    const drawCard = (count: number = 1) => {
        if (library.length < count) {
            addLog(`tried to draw ${count} but only ${library.length} in library`);
            return;
        }
        setLibrary(prev => {
            const drawn = prev.slice(0, count);
            setHand(h => [...h, ...drawn]);
            return prev.slice(count);
        });
        updateMyStats({ cardsDrawn: (gameStats[getMyId()]?.cardsDrawn || 0) + count });
        addLog(`drew ${count} card${count > 1 ? 's' : ''}`);
    };

    const playCommander = (card: CardData) => {
        setCommandZone(prev => prev.filter(c => c.id !== card.id));
        const myPos = layout[mySeatIndex];
        if (!myPos) return;
        const defaultX = myPos.x + MAT_W / 2 - CARD_WIDTH / 2;
        const defaultY = myPos.y + MAT_H / 2 - CARD_HEIGHT / 2;
        const newObject: BoardObject = {
            id: crypto.randomUUID(), type: 'CARD', cardData: card,
            x: defaultX, y: defaultY, z: maxZ + 1, rotation: myPos.rot, isFaceDown: false, isTransformed: false,
            counters: {}, commanderDamage: {}, controllerId: getControllerId(),
            quantity: 1, tappedQuantity: 0
        };

        // Apply enters tapped rule
        if (manaRulesState[card.scryfallId]?.entersTapped) {
            newObject.rotation = (newObject.rotation + 90) % 360;
        }
        setMaxZ(prev => prev + 1);
        setBoardObjects(prev => [...prev, newObject]);
        emitAction('ADD_OBJECT', newObject);
        updateMyStats({ cardsPlayed: (gameStats[getMyId()]?.cardsPlayed || 0) + 1 });
        addLog(`cast commander ${card.name}`);
        handleAutoTap(card);
    };

    const handleDamageReport = (damageReport: Record<string, number>, healingReport: Record<string, number>) => {
        const myId = socket.id;

        // Process Damage
        let totalDamageReceived = 0;
        Object.entries(damageReport).forEach(([sourceId, amount]) => {
            if (amount > 0) {
                totalDamageReceived += amount;
                emitAction('TRACK_DAMAGE_DEALT', { sourceId, targetId: myId, amount });
                addLog(`reported taking ${amount} damage from ${playersList.find(p => p.id === sourceId)?.name}`, 'ACTION');
            }
        });
        if (totalDamageReceived > 0) {
            updateMyStats({ damageReceived: (gameStats[getMyId()]?.damageReceived || 0) + totalDamageReceived });
        }

        // Process Healing
        let totalHealingReceived = 0;
        let totalSelfHealing = 0;
        Object.entries(healingReport).forEach(([sourceId, amount]) => {
            if (amount > 0) {
                totalHealingReceived += amount;
                if (sourceId === myId) totalSelfHealing += amount;
                emitAction('TRACK_HEALING_GIVEN', { sourceId, amount });
                addLog(`reported receiving ${amount} healing from ${playersList.find(p => p.id === sourceId)?.name}`, 'ACTION');
            }
        });
        if (totalHealingReceived > 0) {
            updateMyStats({
                healingReceived: (gameStats[getMyId()]?.healingReceived || 0) + totalHealingReceived,
                selfHealing: (gameStats[getMyId()]?.selfHealing || 0) + totalSelfHealing
            });
        }
    };

    const playTopLibrary = () => {
        if (library.length === 0) return;
        const card = library[0];
        setLibrary(prev => prev.slice(1));
        const myPos = layout[mySeatIndex];
        if (!myPos) return;
        const spawnX = myPos.x + MAT_W / 2 - CARD_WIDTH / 2;
        const spawnY = myPos.y + MAT_H / 2 - CARD_HEIGHT / 2;
        const newObject: BoardObject = {
            id: crypto.randomUUID(), type: 'CARD', cardData: card,
            x: spawnX, y: spawnY, z: maxZ + 1, rotation: myPos.rot, isFaceDown: false, isTransformed: false,
            counters: {}, commanderDamage: {}, controllerId: getControllerId(),
            quantity: 1, tappedQuantity: 0
        };

        // Apply enters tapped rule
        if (manaRulesState[card.scryfallId]?.entersTapped) {
            newObject.rotation = (newObject.rotation + 90) % 360;
        }
        setMaxZ(prev => prev + 1);
        setBoardObjects(prev => [...prev, newObject]);
        emitAction('ADD_OBJECT', newObject);
        updateMyStats({ cardsPlayed: (gameStats[getMyId()]?.cardsPlayed || 0) + 1 });
        addLog(`played top card of library`);

        const cost = parseManaCost(card.manaCost || "");
        if (cost.hasX && showManaCalculator) {
            setPendingPaymentCard(card); setAllocatedMana(EMPTY_POOL);
        } else if (autoTapEnabled && showManaCalculator) {
            handleAutoTap(card);
        } else if (showManaCalculator) {
            setPendingPaymentCard(card);
        }
    };

    const playTopGraveyard = () => {
        if (graveyard.length === 0) return;
        const card = graveyard[0];
        setGraveyard(prev => prev.slice(1));
        const myPos = layout[mySeatIndex];
        if (!myPos) return;
        const spawnX = myPos.x + MAT_W / 2 - CARD_WIDTH / 2;
        const spawnY = myPos.y + MAT_H / 2 - CARD_HEIGHT / 2;
        const newObject: BoardObject = {
            id: crypto.randomUUID(), type: 'CARD', cardData: card,
            x: spawnX, y: spawnY, z: maxZ + 1, rotation: myPos.rot, isFaceDown: false, isTransformed: false,
            counters: {}, commanderDamage: {}, controllerId: getControllerId(),
            quantity: 1, tappedQuantity: 0
        };

        // Apply enters tapped rule
        if (manaRulesState[card.scryfallId]?.entersTapped) {
            newObject.rotation = (newObject.rotation + 90) % 360;
        }
        setMaxZ(prev => prev + 1);
        setBoardObjects(prev => [...prev, newObject]);
        emitAction('ADD_OBJECT', newObject);
        updateMyStats({ cardsPlayed: (gameStats[getMyId()]?.cardsPlayed || 0) + 1 });
        addLog(`returned ${card.name} from graveyard to battlefield`);

        const cost = parseManaCost(card.manaCost || "");
        if (cost.hasX && showManaCalculator) {
            setPendingPaymentCard(card); setAllocatedMana(EMPTY_POOL);
        } else if (autoTapEnabled && showManaCalculator) {
            handleAutoTap(card);
        } else if (showManaCalculator) {
            setPendingPaymentCard(card);
        }
    };

    const returnToHand = (id: string) => {
        const obj = boardObjects.find(o => o.id === id);
        if (!obj) return;
        if (obj.type === 'COUNTER') {
            setBoardObjects(prev => prev.filter(o => o.id !== id));
            emitAction('REMOVE_OBJECT', { id });
            return;
        }
        if (obj.quantity > 1) {
            const newQty = obj.quantity - 1;
            const newTapped = Math.min(obj.tappedQuantity, newQty);
            updateBoardObject(id, { quantity: newQty, tappedQuantity: newTapped });
            setHand(prev => [...prev, { ...obj.cardData, id: crypto.randomUUID() }]);
            addLog(`returned a ${obj.cardData.name} from stack to hand`);
        } else {
            setBoardObjects(prev => prev.filter(o => o.id !== id));
            emitAction('REMOVE_OBJECT', { id });
            if (obj.cardData.isToken) {
                addLog(`returned token ${obj.cardData.name} to hand (it vanished)`);
            } else {
                setHand(prev => [...prev, obj.cardData]);
                addLog(`returned ${obj.cardData.name} to hand`);
            }
        }
    };

    const rollDice = (sides: number = 6) => {
        const rollerId = isLocal ? playersList[mySeatIndex].id : socket.id;
        const rollerIdx = playersList.findIndex(p => p.id === rollerId);
        if (rollerIdx === -1) return;

        const pos = layout[rollerIdx];
        if (!pos) return;
        const x = pos.x + MAT_W / 2;
        const y = pos.y + MAT_H / 2;

        const result = Math.floor(Math.random() * sides) + 1;
        const rollData: DieRoll = {
            id: crypto.randomUUID(),
            value: result,
            sides,
            playerId: rollerId,
            x, y
        };

        setActiveDice(prev => [...prev, rollData]);
        addLog(`rolled a ${result} on a D${sides}`, 'ACTION', playersList[rollerIdx].name);
        emitAction('ROLL_DICE', rollData);
        setTimeout(() => setActiveDice(prev => prev.filter(d => d.id !== rollData.id)), 3000);
    };

    const sendToZone = (card: CardData, zone: 'GRAVEYARD' | 'EXILE') => {
        if (zone === 'GRAVEYARD') {
            setGraveyard(prev => [card, ...prev]);
            addLog(`moved ${card.name} to graveyard`);
        } else {
            setExile(prev => [card, ...prev]);
            addLog(`exiled ${card.name}`);
        }
        if (!card.isToken) setHand(prev => prev.filter(c => c.id !== card.id));
    };

    const checkZoneCollision = (cardX: number, cardY: number, playerIndex: number, zoneType: 'LIBRARY' | 'GRAVEYARD' | 'EXILE' | 'COMMAND' | 'MAT') => {
        const matPos = layout[playerIndex];
        if (!matPos) return false;
        const rotation = matPos.rot;
        const matW = MAT_W;
        const matH = MAT_H;
        const matCenterX = matPos.x + matW / 2;
        const matCenterY = matPos.y + matH / 2;

        const cx = cardX + CARD_WIDTH / 2;
        const cy = cardY + CARD_HEIGHT / 2;

        const rad = -rotation * (Math.PI / 180);
        const dx = cx - matCenterX;
        const dy = cy - matCenterY;
        const localX = dx * Math.cos(rad) - dy * Math.sin(rad) + matCenterX;
        const localY = dx * Math.sin(rad) + dy * Math.cos(rad) + matCenterY;

        if (zoneType === 'MAT') {
            return localX >= matPos.x && localX <= matPos.x + matW &&
                localY >= matPos.y && localY <= matPos.y + matH;
        }

        let zoneOffset = { x: 0, y: 0 };
        if (zoneType === 'LIBRARY') zoneOffset = ZONE_LIBRARY_OFFSET;
        else if (zoneType === 'GRAVEYARD') zoneOffset = ZONE_GRAVEYARD_OFFSET;
        else if (zoneType === 'EXILE') zoneOffset = ZONE_EXILE_OFFSET;
        else if (zoneType === 'COMMAND') zoneOffset = ZONE_COMMAND_OFFSET;

        const zx = matPos.x + zoneOffset.x;
        const zy = matPos.y + zoneOffset.y;

        return localX >= zx && localX <= zx + CARD_WIDTH &&
            localY >= zy && localY <= zy + CARD_HEIGHT;
    };

    const handleCardRelease = (id: string, x: number, y: number) => {
        const obj = boardObjects.find(o => o.id === id);
        if (!obj) return;
        if (obj.type === 'COUNTER') return;

        // Check My Zones
        if (checkZoneCollision(x, y, mySeatIndex, 'LIBRARY')) { setLibraryAction({ isOpen: true, cardId: id }); return; }
        if (checkZoneCollision(x, y, mySeatIndex, 'GRAVEYARD')) {
            setGraveyard(prev => [obj.cardData, ...prev]);
            setBoardObjects(prev => prev.filter(o => o.id !== id));
            emitAction('REMOVE_OBJECT', { id });
            addLog(`moved ${obj.cardData.name} from battlefield to graveyard`);
            return;
        }
        if (checkZoneCollision(x, y, mySeatIndex, 'EXILE')) {
            setExile(prev => [obj.cardData, ...prev]);
            setBoardObjects(prev => prev.filter(o => o.id !== id));
            emitAction('REMOVE_OBJECT', { id });
            addLog(`exiled ${obj.cardData.name} from battlefield`);
            return;
        }
        if (checkZoneCollision(x, y, mySeatIndex, 'COMMAND') && obj.cardData.isCommander) {
            setCommandZone(prev => [obj.cardData, ...prev]);
            setBoardObjects(prev => prev.filter(o => o.id !== id));
            emitAction('REMOVE_OBJECT', { id });
            addLog(`returned commander ${obj.cardData.name} to command zone`);
            return;
        }

        // Check Opponent Mats for giving control
        for (let i = 0; i < playersList.length; i++) {
            if (i === mySeatIndex && !isLocal) continue;
            if (checkZoneCollision(x, y, i, 'MAT')) {
                const targetPlayer = playersList[i];

                if (obj.controllerId !== targetPlayer.id) {
                    updateBoardObject(id, { controllerId: targetPlayer.id, rotation: layout[i]?.rot || 0 });
                    addLog(`gave control of ${obj.cardData.name} to ${targetPlayer.name}`);
                }
                return;
            }
        }

        // Check My Mat for regaining control
        if (checkZoneCollision(x, y, mySeatIndex, 'MAT')) {
            if (!isLocal && obj.controllerId !== socket.id && obj.controllerId !== 'local-player') {
                updateBoardObject(id, { controllerId: socket.id || 'local-player', rotation: layout[mySeatIndex]?.rot || 0 });
                addLog(`regained control of ${obj.cardData.name}`);
                return;
            }

            // Stacking Logic
            const collision = boardObjects.find(target =>
                target.id !== id &&
                target.type === 'CARD' &&
                target.controllerId === obj.controllerId &&
                target.cardData.name === obj.cardData.name &&
                x < target.x + CARD_WIDTH && x + CARD_WIDTH > target.x &&
                y < target.y + CARD_HEIGHT && y + CARD_HEIGHT > target.y
            );

            if (collision) {
                const newQuantity = collision.quantity + obj.quantity;
                const newTapped = collision.tappedQuantity + obj.tappedQuantity;
                updateBoardObject(collision.id, { quantity: newQuantity, tappedQuantity: newTapped });
                setBoardObjects(prev => prev.filter(o => o.id !== id));
                emitAction('REMOVE_OBJECT', { id });
                addLog(`stacked ${obj.cardData.name}`);
                return;
            }
        }
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (['INPUT', 'TEXTAREA'].includes((e.target as HTMLElement).tagName)) return;

        switch (e.key.toLowerCase()) {
            case ' ':
                if (!isSpacePressed.current) {
                    isSpacePressed.current = true;
                    setView(v => ({ ...v })); // Force re-render for cursor update
                }
                break;
            case 'd': drawCard(1); break;
            case 'u': untapAll(); break;
            case 's': shuffleLibrary(); break;
            case 'l': setIsLogOpen(prev => !prev); break;
            case '?': setShowShortcuts(prev => !prev); break;
            case 'c':
                if (commandZone.length > 0) {
                    playCommander(commandZone[0]);
                } else {
                    const myId = isLocal ? currentTurnPlayerId : socket.id;
                    const myCmd = boardObjects.find(o => o.controllerId === myId && o.cardData.isCommander);
                    if (myCmd) {
                        setCommandZone(prev => [myCmd.cardData, ...prev]);
                        setBoardObjects(prev => prev.filter(o => o.id !== myCmd.id));
                        emitAction('REMOVE_OBJECT', { id: myCmd.id });
                        addLog(`returned commander ${myCmd.cardData.name} to command zone`);
                    }
                }
                break;
            case 'x': openSearch('LIBRARY'); break;
            case 'e': openSearch('EXILE'); break;
            case 'g': openSearch('GRAVEYARD'); break;
            case 't': openSearch('TOKENS'); break;
            case 'alt':
                if (e.location === 1) { // Left Alt
                    e.preventDefault();
                    setAreTokensExpanded(prev => !prev);
                }
                break;
            case 'r': rollDice(6); break;
            case 'f': spawnCounter(); break;
            case 'enter': nextTurn(); break;
            case 'arrowup': handleLifeChange(1); break;
            case 'arrowdown': handleLifeChange(-1); break;
            case 'q': setShowStatsModal(prev => !prev); break;
            case 'w': setShowCmdrDamage(prev => !prev); break;
            case 'm':
                setShowManaCalculator(prev => {
                    const next = !prev;
                    if (!next) {
                        setFloatingMana({ ...EMPTY_POOL });
                        setPendingPaymentCard(null);
                        setAllocatedMana({ ...EMPTY_POOL });
                    }
                    return next;
                });
                break;
            case 'tab':
                break;
            case 'z': {
                if (e.ctrlKey || e.metaKey) {
                    e.preventDefault();
                    handleUndo();
                }
                break;
            }
            case 'v': setIsOpponentViewOpen(prev => !prev); break;
            case 'arrowleft': if (isOpponentViewOpen) setSelectedOpponentIndex(prev => (prev - 1 + (playersList.length - 1)) % (playersList.length - 1)); break;
            case 'arrowright': if (isOpponentViewOpen) setSelectedOpponentIndex(prev => (prev + 1) % (playersList.length - 1)); break;
            default:
                const num = parseInt(e.key);
                if (!isNaN(num)) {
                    const idx = num === 0 ? 9 : num - 1;
                    const cards = hand.filter(c => !c.isToken);
                    if (cards[idx]) playCardFromHand(cards[idx]);
                }
                break;
        }
    };

    const handleKeyUp = (e: React.KeyboardEvent) => {
        if (e.key === ' ') {
            isSpacePressed.current = false;
            setView(v => ({ ...v })); // Force re-render for cursor update
        }
    };

    const requestViewZone = (zone: string, targetPlayerId: string) => {
        const target = playersList.find(p => p.id === targetPlayerId);
        if (target) {
            emitAction('REQUEST_VIEW', { zone, targetPlayerId, requesterId: socket.id });
            addLog(`requested to view ${target.name}'s ${zone.toLowerCase()}`);
        }
    };

    const resolveViewRequest = (accepted: boolean) => {
        if (!incomingViewRequest) return;

        if (accepted) {
            let cards: CardData[] = [];
            if (incomingViewRequest.zone === 'LIBRARY') cards = library;
            else if (incomingViewRequest.zone === 'GRAVEYARD') cards = graveyard;
            else if (incomingViewRequest.zone === 'EXILE') cards = exile;
            else if (incomingViewRequest.zone === 'HAND') cards = hand;

            emitAction('ALLOW_VIEW', {
                requesterId: incomingViewRequest.requesterId,
                zone: incomingViewRequest.zone,
                cards: cards
            });
            addLog(`allowed ${incomingViewRequest.requesterName} to view ${incomingViewRequest.zone.toLowerCase()}`);
        } else {
            addLog(`denied request from ${incomingViewRequest.requesterName}`);
        }
        setIncomingViewRequest(null);
    };

    const resolveJoinRequest = (approved: boolean) => {
        if (!incomingJoinRequest) return;
        socket.emit('resolve_join_request', {
            room: roomId,
            applicantId: incomingJoinRequest.applicantId,
            approved
        });
        setIncomingJoinRequest(null);
    };

    // --- Search / Tray / Library Action Helpers ---
    const openSearch = (source: SearchState['source'], targetPlayerId?: string) => {
        let items: any[] = [];
        let targetLibrary = library;
        let targetGraveyard = graveyard;
        let targetExile = exile;
        let targetHand = hand;

        if (isLocal && targetPlayerId && targetPlayerId !== currentTurnPlayerId) {
            // Access other player's state from ref
            const state = localPlayerStates.current[targetPlayerId];
            targetLibrary = state?.library || [];
            targetGraveyard = state?.graveyard || [];
            targetExile = state?.exile || [];
            targetHand = state?.hand || [];
        }

        if (source === 'LIBRARY') items = targetLibrary.map(c => ({ card: c, isRevealed: false }));
        else if (source === 'GRAVEYARD') items = targetGraveyard.map(c => ({ card: c, isRevealed: true }));
        else if (source === 'EXILE') items = targetExile.map(c => ({ card: c, isRevealed: true }));
        else if (source === 'HAND') items = targetHand.map(c => ({ card: c, isRevealed: true }));
        setSearchModal({ isOpen: true, source, items, tray: [], playerId: targetPlayerId });
    };
    const searchTokens = async () => {
        if (!tokenSearchTerm) return;
        const results = await searchCards(tokenSearchTerm);
        setSearchModal(prev => ({ ...prev, items: results.map(c => ({ card: { ...c, isToken: true, id: crypto.randomUUID() }, isRevealed: true })) }));
    };
    const revealAll = () => setSearchModal(prev => ({ ...prev, items: prev.items.map(i => ({ ...i, isRevealed: true })) }));
    const shuffleAndClose = () => { if (searchModal.source === 'LIBRARY') shuffleLibrary(); setSearchModal(prev => ({ ...prev, isOpen: false })); };
    const addToTray = (id: string) => {
        const item = searchModal.items.find(i => i.card.id === id);
        if (item) setSearchModal(prev => ({ ...prev, items: prev.items.filter(i => i.card.id !== id), tray: [...prev.tray, item.card] }));
    };
    const removeFromTray = (id: string) => {
        const card = searchModal.tray.find(c => c.id === id);
        if (card) setSearchModal(prev => ({ ...prev, tray: prev.tray.filter(c => c.id !== id), items: [...prev.items, { card, isRevealed: true }] }));
    };
    const onTrayReorder = (index: number, direction: 'LEFT' | 'RIGHT') => {
        setSearchModal(prev => {
            const newTray = [...prev.tray];
            const swapIndex = direction === 'LEFT' ? index - 1 : index + 1;
            if (swapIndex >= 0 && swapIndex < newTray.length) {
                [newTray[index], newTray[swapIndex]] = [newTray[swapIndex], newTray[index]];
                return { ...prev, tray: newTray };
            }
            return prev;
        });
    };

    type TrayAction = 'HAND' | 'HAND_REVEAL' | 'TOP' | 'BOTTOM' | 'GRAVEYARD' | 'EXILE' | 'SHUFFLE';

    const handleTrayAction = (action: TrayAction) => {
        const trayCards = searchModal.tray;
        const trayIds = new Set(trayCards.map(c => c.id));
        if (trayCards.length === 0) return;
        let sourceList = searchModal.source === 'LIBRARY' ? library : searchModal.source === 'GRAVEYARD' ? graveyard : exile;
        const rest = sourceList.filter(c => !trayIds.has(c.id));

        let newLib = [...library], newGrave = [...graveyard], newExile = [...exile], newHand = [...hand];
        if (searchModal.source === 'LIBRARY') newLib = rest;
        else if (searchModal.source === 'GRAVEYARD') newGrave = rest;
        else if (searchModal.source === 'EXILE') newExile = rest;

        if (action === 'HAND') { newHand = [...newHand, ...trayCards]; addLog(`added ${trayCards.length} cards from tray to hand`); }
        else if (action === 'HAND_REVEAL') {
            newHand = [...newHand, ...trayCards];
            addLog(`revealed and added to hand: ${trayCards.map(c => c.name).join(', ')}`);
            emitAction('REVEAL_CARDS', { cards: trayCards });
        }
        else if (action === 'TOP') { newLib = [...trayCards, ...newLib]; addLog(`put ${trayCards.length} cards from tray on top of library`); }
        else if (action === 'BOTTOM') { newLib = [...newLib, ...trayCards]; addLog(`put ${trayCards.length} cards from tray on bottom of library`); }
        else if (action === 'GRAVEYARD') { newGrave = [...trayCards, ...newGrave]; addLog(`put ${trayCards.length} cards from tray into graveyard`); }
        else if (action === 'EXILE') { newExile = [...trayCards, ...newExile]; addLog(`exiled ${trayCards.length} cards from tray`); }
        else if (action === 'SHUFFLE') { newLib = [...newLib, ...trayCards].sort(() => Math.random() - 0.5); addLog(`shuffled ${trayCards.length} cards from tray into library`); }

        setLibrary(newLib); setGraveyard(newGrave); setExile(newExile); setHand(newHand);
        if (searchModal.source === 'LIBRARY') openSearch('LIBRARY');
        else setSearchModal(prev => ({ ...prev, tray: [] }));
    };
    const toggleRevealItem = (index: number) => {
        setSearchModal(prev => {
            const newItems = [...prev.items];
            if (newItems[index]) {
                const wasRevealed = newItems[index].isRevealed;
                if (!wasRevealed) addLog(`revealed card at position ${index + 1} of ${searchModal.source.toLowerCase()}`);
                newItems[index] = { ...newItems[index], isRevealed: !wasRevealed };
            }
            return { ...prev, items: newItems };
        });
    };
    const handleSearchAction = (id: string, action: 'HAND') => {
        const item = searchModal.items.find(i => i.card.id === id);
        if (!item) return;
        const newCard = { ...item.card, id: crypto.randomUUID() };
        if (action === 'HAND') { setHand(prev => [...prev, newCard]); addLog(`added ${newCard.name} to hand`); }
    };
    const resolveLibraryAction = (action: 'TOP' | 'BOTTOM' | 'SHUFFLE') => {
        const id = libraryAction.cardId;
        const obj = boardObjects.find(o => o.id === id);
        if (!obj) { setLibraryAction({ isOpen: false, cardId: '' }); return; }
        setBoardObjects(prev => prev.filter(o => o.id !== id));
        emitAction('REMOVE_OBJECT', { id });
        const card = obj.cardData;
        if (action === 'TOP') setLibrary(prev => [card, ...prev]);
        else if (action === 'BOTTOM') setLibrary(prev => [...prev, card]);
        else if (action === 'SHUFFLE') { setLibrary(prev => [...prev, card]); shuffleLibrary(); }
        setLibraryAction({ isOpen: false, cardId: '' });
    };

    const toggleFullScreen = () => {
        if (!document.fullscreenElement) {
            document.documentElement.requestFullscreen().catch(e => console.log(e));
        } else {
            document.exitFullscreen();
        }
    };

    // --- Rendering Helpers ---

    const handleContainerPointerDown = (e: React.PointerEvent) => {
        if (mobileActionCardId) setMobileActionCardId(null);
        (e.target as HTMLElement).setPointerCapture(e.pointerId);
        activePointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });

        if (activePointers.current.size === 2) {
            const points = Array.from(activePointers.current.values()) as { x: number; y: number }[];
            initialPinchDist.current = Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y);
            initialScale.current = view.scale;
            initialView.current = { x: view.x, y: view.y };
            initialPinchCenter.current = {
                x: (points[0].x + points[1].x) / 2,
                y: (points[0].y + points[1].y) / 2
            };
            isDraggingView.current = false;
        } else if (activePointers.current.size === 1) {
            const isMouse = e.pointerType === 'mouse';
            if (e.button === 1 || (e.button === 0 && (isMobile || !isMouse || isSpacePressed.current))) {
                isDraggingView.current = true;
                lastMousePos.current = { x: e.clientX, y: e.clientY };
                e.preventDefault();
            }
        }
    };

    const handleContainerPointerMove = (e: React.PointerEvent) => {
        activePointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });

        if (isDraggingView.current && activePointers.current.size === 1) {
            const dx = e.clientX - lastMousePos.current.x;
            const dy = e.clientY - lastMousePos.current.y;
            setView(prev => ({ ...prev, x: prev.x + dx, y: prev.y + dy }));
            lastMousePos.current = { x: e.clientX, y: e.clientY };
        } else if (activePointers.current.size === 2 && initialPinchDist.current && initialPinchCenter.current) {
            const points = Array.from(activePointers.current.values()) as { x: number; y: number }[];
            const dist = Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y);
            const scaleChange = dist / initialPinchDist.current;
            const newScale = Math.min(Math.max(0.1, initialScale.current * scaleChange), 5);

            const currentCenter = {
                x: (points[0].x + points[1].x) / 2,
                y: (points[0].y + points[1].y) / 2
            };

            const worldPointX = (initialPinchCenter.current.x - initialView.current.x) / initialScale.current;
            const worldPointY = (initialPinchCenter.current.y - initialView.current.y) / initialScale.current;

            const newX = currentCenter.x - worldPointX * newScale;
            const newY = currentCenter.y - worldPointY * newScale;

            setView({ x: newX, y: newY, scale: newScale });
        }
    };

    const handleEdgePan = (dx: number, dy: number) => {
        setView(prev => ({ ...prev, x: prev.x + dx, y: prev.y + dy }));
    };

    const handleContainerPointerUp = (e: React.PointerEvent) => {
        (e.target as HTMLElement).releasePointerCapture(e.pointerId);
        activePointers.current.delete(e.pointerId);

        if (activePointers.current.size < 2) {
            initialPinchDist.current = null;
            initialPinchCenter.current = null;
        }

        if (activePointers.current.size === 0) {
            isDraggingView.current = false;
        }
    };

    const handleWheel = (e: React.WheelEvent) => {
        if (isDraggingView.current) return;
        const rect = e.currentTarget.getBoundingClientRect();
        const mx = e.clientX - rect.left;
        const my = e.clientY - rect.top;
        const delta = -e.deltaY * 0.001;

        setView(prev => {
            const newScale = Math.min(Math.max(0.1, prev.scale + delta), 5);
            const scaleRatio = newScale / prev.scale;
            const newX = mx - (mx - prev.x) * scaleRatio;
            const newY = my - (my - prev.y) * scaleRatio;
            return { ...prev, x: newX, y: newY, scale: newScale };
        });
    };

    const handleOpponentPointerDown = (e: React.PointerEvent) => {
        const isMouse = e.pointerType === 'mouse';
        if (e.button === 1 || (e.button === 0 && (!isMouse || isSpacePressed.current))) {
            isDraggingOpponentView.current = true;
            lastOpponentMousePos.current = { x: e.clientX, y: e.clientY };
            (e.target as HTMLElement).setPointerCapture(e.pointerId);
            e.preventDefault();
        }
    };

    const handleOpponentPointerMove = (e: React.PointerEvent) => {
        if (isDraggingOpponentView.current) {
            const dx = e.clientX - lastOpponentMousePos.current.x;
            const dy = e.clientY - lastOpponentMousePos.current.y;
            setOpponentView(prev => ({ ...prev, x: prev.x + dx, y: prev.y + dy }));
            lastOpponentMousePos.current = { x: e.clientX, y: e.clientY };
        }
    };

    const handleOpponentPointerUp = (e: React.PointerEvent) => {
        if (isDraggingOpponentView.current) {
            isDraggingOpponentView.current = false;
            (e.target as HTMLElement).releasePointerCapture(e.pointerId);
        }
    };

    const handleOpponentWheel = (e: React.WheelEvent) => {
        const rect = e.currentTarget.getBoundingClientRect();
        const mx = e.clientX - rect.left;
        const my = e.clientY - rect.top;
        const delta = -e.deltaY * 0.001;

        setOpponentView(prev => {
            const newScale = Math.min(Math.max(0.1, prev.scale + delta), 5);
            const scaleRatio = newScale / prev.scale;
            const newX = mx - (mx - prev.x) * scaleRatio;
            const newY = my - (my - prev.y) * scaleRatio;
            return { ...prev, x: newX, y: newY, scale: newScale };
        });
    };

    const handleHandWheel = (e: React.WheelEvent) => {
        if (handContainerRef.current) {
            handContainerRef.current.scrollLeft += e.deltaY;
        }
    };

    const handleHandTouchStart = (e: React.TouchEvent) => {
        touchStartRef.current = e.touches[0].clientY;
    };

    const handleHandTouchEnd = (e: React.TouchEvent) => {
        if (touchStartRef.current === null) return;
        const touchEnd = e.changedTouches[0].clientY;
        const diff = touchEnd - touchStartRef.current;

        if (diff > 50) setIsHandVisible(false); // Swipe Down
        if (diff < -50) setIsHandVisible(true); // Swipe Up
        touchStartRef.current = null;
    };

    const renderWorld = (viewState: ViewState, containerRefToUse: React.RefObject<HTMLDivElement>, handlers: any, rotation: number = 0, isOpponent: boolean = false) => (
        <div
            ref={containerRefToUse}
            className="w-full h-full touch-none relative overflow-hidden bg-[#1a1410]"
            style={{ cursor: isSpacePressed.current ? 'grab' : 'default' }}
            onPointerDown={handlers.onDown}
            onPointerMove={handlers.onMove}
            onPointerUp={handlers.onUp}
            onWheel={handlers.onWheel}
        >
            <div
                className="absolute inset-0 opacity-100 pointer-events-none"
                style={{
                    backgroundImage: `url("/table_texture.png")`,
                    backgroundRepeat: 'repeat',
                    backgroundSize: `${512 * viewState.scale}px`,
                    backgroundPosition: `${viewState.x}px ${viewState.y}px`
                }}
            />
            <div
                className="absolute inset-0 opacity-20 pointer-events-none mix-blend-overlay"
                style={{
                    backgroundImage: `url("data:image/svg+xml,%3Csvg width='200' height='200' viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noiseFilter'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.65' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noiseFilter)'/%3E%3C/svg%3E")`
                }}
            />
            <div
                className="absolute inset-0 opacity-10 pointer-events-none bg-[radial-gradient(#ffffff33_1px,transparent_1px)]"
                style={{
                    backgroundSize: `${20 * viewState.scale}px ${20 * viewState.scale}px`,
                    backgroundPosition: `${viewState.x}px ${viewState.y}px`
                }}
            />

            <div
                style={{
                    transform: `translate(${viewState.x}px, ${viewState.y}px) scale(${viewState.scale}) rotate(${rotation}deg)`,
                    transformOrigin: '0 0',
                    width: '0px', height: '0px',
                }}
            >
                {playersList.map((p, idx) => {
                    const pos = layout[idx];
                    if (!pos) return null;
                    const rot = pos.rot;
                    const isMe = isLocal ? (idx === mySeatIndex) : p.id === socket.id;

                    // In local mode, get counts from localPlayerStates for non-active players
                    let localCounts = null;
                    if (isLocal && !isMe) {
                        const s = localPlayerStates.current[p.id];
                        if (s) localCounts = { library: s.library.length, graveyard: s.graveyard.length, exile: s.exile.length, hand: s.hand.filter(c => !c.isToken).length, command: s.commandZone.length };
                    }

                    const counts = (isMe || localCounts)
                        ? (localCounts || { library: library.length, graveyard: graveyard.length, exile: exile.length, hand: hand.filter(c => !c.isToken).length, command: commandZone.length })
                        : opponentsCounts[p.id] || { library: 0, graveyard: 0, exile: 0, hand: 0, command: 0 };

                    return (
                        <React.Fragment key={p.id}>
                            <Playmat
                                x={pos.x} y={pos.y} width={MAT_W} height={MAT_H}
                                playerName={p.name} rotation={rot}
                                zones={{ library: ZONE_LIBRARY_OFFSET, graveyard: ZONE_GRAVEYARD_OFFSET, exile: ZONE_EXILE_OFFSET, command: ZONE_COMMAND_OFFSET }}
                                counts={counts}
                                sleeveColor={p.color}
                                topGraveyardCard={isMe ? graveyard[0] : undefined}
                                isShuffling={isMe ? isShuffling : false}
                                isControlled={isMe}
                                commanders={isMe ? commandZone : (isLocal ? (localPlayerStates.current[p.id]?.commandZone || []) : (opponentsCommanders[p.id] || []))}
                                onDraw={isMe ? () => drawCard(1) : (isLocal ? () => { } : () => requestViewZone('LIBRARY', p.id))}
                                onShuffle={isMe ? shuffleLibrary : () => { }}
                                onOpenSearch={isMe ? openSearch : (source) => isLocal ? openSearch(source, p.id) : requestViewZone(source, p.id)}
                                onPlayCommander={isMe ? playCommander : (isLocal ? () => { } : () => { })}
                                onPlayTopLibrary={isMe ? playTopLibrary : () => { }}
                                onPlayTopGraveyard={isMe ? playTopGraveyard : () => { }}
                                onInspectCommander={setInspectCard}
                                onViewHand={isMe ? undefined : () => requestViewZone('HAND', p.id)}
                                isMobile={isMobile}
                                onMobileZoneAction={setMobileZoneMenu}
                                onDoubleClickZone={(zone) => openSearch(zone)}
                            />
                            {!isMe && (
                                <div
                                    className="absolute text-white font-bold text-lg bg-black/50 px-2 rounded pointer-events-none flex flex-col items-center"
                                    style={{
                                        left: pos.x + MAT_W / 2,
                                        top: pos.y + MAT_H / 2,
                                        transform: `translate(-50%, -50%) rotate(${rot}deg) translateY(${MAT_H / 2 + 20}px)`
                                    }}
                                >
                                    <span>{opponentsLife[p.id] ?? 40} HP</span>
                                    <span className="text-xs text-gray-300 font-normal flex items-center gap-1">
                                        <Hand size={12} /> {counts.hand ?? 0}
                                    </span>
                                </div>
                            )}
                        </React.Fragment>
                    );
                })}

                {activeDice.map(die => {
                    const ownerIdx = playersList.findIndex(p => p.id === die.playerId);
                    const pos = layout[ownerIdx];
                    if (!pos) return null;
                    const dieRotation = pos.rot;
                    const x = pos.x + MAT_W / 2;
                    const y = pos.y + MAT_H / 2;

                    return (
                        <Die
                            key={die.id}
                            value={die.value} sides={die.sides} x={isLocal ? x : die.x} y={isLocal ? y : die.y}
                            color={playersList[ownerIdx]?.color || '#fff'}
                            rotation={dieRotation}
                        />
                    );
                })}

                {boardObjects.map(obj => {
                    const isOwnerInGame = playersList.some(p => p.id === obj.controllerId);
                    const isControlled = isLocal || obj.controllerId === socket.id || obj.controllerId === 'local-player' || !isOwnerInGame;

                    const controllerIdx = (!isLocal && obj.controllerId === 'local-player')
                        ? mySeatIndex
                        : playersList.findIndex(p => p.id === obj.controllerId);
                    const defaultRotation = (controllerIdx !== -1 && layout[controllerIdx]) ? layout[controllerIdx].rot : 0;
                    const controller = playersList.find(p => p.id === obj.controllerId);
                    const objSleeveColor = controller ? controller.color : sleeveColor;
                    const isSelected = mobileActionCardId === obj.id;

                    return (
                        <div key={obj.id} className="pointer-events-auto">
                            <Card
                                object={obj}
                                sleeveColor={objSleeveColor}
                                isControlledByMe={isControlled}
                                players={playersList}
                                onUpdate={updateBoardObject}
                                onBringToFront={(id) => { setMaxZ(p => p + 1); updateBoardObject(id, { z: maxZ + 1 }); }}
                                onRelease={handleCardRelease}
                                onInspect={(card) => setInspectCard(card)}
                                onReturnToHand={returnToHand}
                                onUnstack={unstackCards}
                                onRemoveOne={removeCardFromStack}
                                onLog={addLog}
                                viewScale={viewState.scale}
                                viewRotation={rotation}
                                viewX={viewState.x}
                                viewY={viewState.y}
                                onPan={isOpponent ? undefined : handleEdgePan}
                                onLongPress={isMobile ? setMobileActionCardId : undefined}
                                isMobile={isMobile}
                                isSelected={isSelected}
                                isAnySelected={!!mobileActionCardId}
                                onSelect={() => setMobileActionCardId(obj.id)}
                                defaultRotation={defaultRotation}
                                isHandVisible={isHandVisible}
                                onHover={(id) => setHoveredCardId(id)}
                                manaSource={(manaInfo.sources.find(s => s.objectId === obj.id && s.abilityType !== 'passive') || manaInfo.potentialSources.find(s => s.objectId === obj.id)) as ManaSource}
                                manaRule={manaRulesState[obj.cardData.scryfallId]}
                                onManaClick={() => {
                                    const source = manaInfo.sources.find(s => s.objectId === obj.id) || manaInfo.potentialSources.find(s => s.objectId === obj.id);
                                    if (source && source.abilityType !== 'passive') handleManaButtonClick(source);
                                }}
                                onDragChange={(dragging) => { isDraggingRef.current = dragging; }}
                                showManaCalculator={showManaCalculator}
                            />
                        </div>
                    );
                })}
            </div>
        </div>
    );

    const cardsInHand = hand.filter(c => !c.isToken);
    const tokensInHand = hand.filter(c => c.isToken);
    const cardsInHandWithShortcuts = cardsInHand.map((c, i) => ({ ...c, shortcutKey: i < 9 ? `${i + 1}` : i === 9 ? '0' : undefined }));



    return (
        <div
            ref={rootRef}
            onKeyUp={handleKeyUp}
            className="relative w-full h-full overflow-hidden select-none bg-[#1a1410] flex flex-col outline-none"
        >

            {/* --- Lobby / Waiting Room Overlay --- */}
            {gamePhase === 'SETUP' && (
                <div className="absolute inset-0 z-[100] bg-gray-900/95 backdrop-blur-md flex items-center justify-center animate-in fade-in p-2 md:p-4">
                    <div className="max-w-2xl w-full bg-gray-800 rounded-2xl shadow-2xl border border-gray-700 p-8 max-h-full overflow-y-auto">
                        <div className="text-center mb-8">
                            <h2 className="text-3xl font-extrabold text-white mb-2">Waiting for Players</h2>
                            <p className="text-gray-400">Share the room code below to invite friends.</p>
                        </div>

                        <div className="flex justify-center mb-8">
                            <div className="bg-black/50 rounded-xl px-8 py-4 border border-gray-600 flex flex-col items-center gap-2">
                                <span className="text-xs uppercase font-bold text-gray-500 tracking-widest">Room Code</span>
                                <div className="text-5xl font-mono font-bold text-blue-400 tracking-widest select-all cursor-pointer" onClick={() => navigator.clipboard.writeText(roomId)}>
                                    {roomId}
                                </div>
                                <span className="text-[10px] text-gray-500">(Click to Copy)</span>
                            </div>
                        </div>

                        <div className="mb-8">
                            <h3 className="text-sm font-bold text-gray-400 uppercase tracking-wide mb-4 flex justify-between items-center">
                                <span>Connected Players ({playersList.length})</span>
                                {isHost && (
                                    <button onClick={handleShufflePlayers} className="text-xs bg-gray-700 hover:bg-gray-600 px-2 py-1 rounded text-white flex items-center gap-1 transition-colors">
                                        <Shuffle size={12} /> Shuffle Order
                                    </button>
                                )}
                            </h3>
                            <div className="space-y-2">
                                {playersList.map((player) => (
                                    <div key={player.id} className="flex items-center gap-4 bg-gray-700/50 p-3 rounded-lg border border-gray-600">
                                        <div
                                            className={`w-10 h-10 rounded-full border-2 border-white/20 shadow-lg flex items-center justify-center font-bold text-white text-lg ${player.id === socket.id ? 'cursor-pointer hover:scale-110 transition-transform' : ''}`}
                                            style={{ backgroundColor: player.color }}
                                            onClick={() => {
                                                if (player.id === socket.id) {
                                                    const currentIdx = PLAYER_COLORS.indexOf(player.color);
                                                    const nextColor = PLAYER_COLORS[(currentIdx + 1) % PLAYER_COLORS.length];
                                                    socket.emit('update_player_color', { room: roomId, color: nextColor });
                                                }
                                            }}
                                            title={player.id === socket.id ? "Click to change color" : ""}
                                        >
                                            {player.name.charAt(0).toUpperCase()}
                                        </div>
                                        <div className="flex-1">
                                            <div className="font-bold text-white text-lg">{player.name}</div>
                                            <div className="text-xs text-gray-400">{player.id === socket.id ? '(You)' : 'Opponent'}</div>
                                        </div>
                                        {(isLocal || player.id === socket.id) && (
                                            <div className="text-green-400 text-xs font-bold uppercase flex items-center gap-1">
                                                <CheckCircle size={14} /> Ready
                                            </div>
                                        )}
                                    </div>
                                ))}
                            </div>
                        </div>

                        <div className="mb-8">
                            <h3 className="text-sm font-bold text-gray-400 uppercase tracking-wide mb-4">Game Rules</h3>
                            <div className="flex flex-col md:flex-row gap-4">
                                <label className="flex-1 flex items-center gap-3 bg-gray-700/50 p-3 rounded-lg cursor-pointer border border-gray-600 hover:bg-gray-700 transition">
                                    <div className={`w-5 h-5 rounded border flex items-center justify-center ${mulligansAllowed ? 'bg-blue-600 border-blue-500' : 'border-gray-500'}`}>
                                        {mulligansAllowed && <CheckCircle size={14} className="text-white" />}
                                    </div>
                                    <input type="checkbox" className="hidden" checked={mulligansAllowed} onChange={() => updateMulliganSetting(!mulligansAllowed)} disabled={!isHost} />
                                    <div>
                                        <div className="font-bold text-white text-sm">Enable Mulligans</div>
                                    </div>
                                </label>

                                <label className={`flex-1 flex items-center gap-3 bg-gray-700/50 p-3 rounded-lg cursor-pointer border border-gray-600 hover:bg-gray-700 transition ${!mulligansAllowed ? 'opacity-50 pointer-events-none' : ''}`}>
                                    <div className={`w-5 h-5 rounded border flex items-center justify-center ${freeMulligan ? 'bg-green-600 border-green-500' : 'border-gray-500'}`}>
                                        {freeMulligan && <CheckCircle size={14} className="text-white" />}
                                    </div>
                                    <input type="checkbox" className="hidden" checked={freeMulligan} onChange={() => updateFreeMulliganSetting(!freeMulligan)} disabled={!isHost || !mulligansAllowed} />
                                    <div>
                                        <div className="font-bold text-white text-sm">Free 1st Mulligan</div>
                                    </div>
                                </label>

                                <label className="flex-1 flex items-center gap-3 bg-gray-700/50 p-3 rounded-lg cursor-pointer border border-gray-600 hover:bg-gray-700 transition">
                                    <div className={`w-5 h-5 rounded border flex items-center justify-center ${trackDamage ? 'bg-blue-600 border-blue-500' : 'border-gray-500'}`}>
                                        {trackDamage && <CheckCircle size={14} className="text-white" />}
                                    </div>
                                    <input type="checkbox" className="hidden" checked={trackDamage} onChange={() => updateTrackDamageSetting(!trackDamage)} disabled={!isHost} />
                                    <div>
                                        <div className="font-bold text-white text-sm">Track Damage</div>
                                    </div>
                                </label>
                            </div>
                            {!isHost && <p className="text-xs text-gray-500 mt-2 text-center italic">Only the host can change these settings.</p>}
                        </div>

                        <div className="flex gap-4 flex-col sm:flex-row">
                            <button
                                onClick={handleExit}
                                className="flex-1 bg-red-900/50 hover:bg-red-900/80 border border-red-800 text-red-200 font-bold py-4 rounded-xl text-lg shadow-lg transition-transform active:scale-95 flex items-center justify-center gap-2"
                            >
                                <LogOut size={20} /> Leave
                            </button>

                            {isHost ? (
                                <button
                                    onClick={startGame}
                                    className="flex-[2] bg-green-600 hover:bg-green-500 text-white font-bold py-4 rounded-xl text-xl shadow-lg transition-transform active:scale-95 flex items-center justify-center gap-3"
                                >
                                    <Play size={24} fill="currentColor" /> Start Game
                                </button>
                            ) : (
                                <div className="flex-[2] bg-gray-700/50 text-gray-400 font-bold py-4 rounded-xl text-lg flex items-center justify-center gap-2 border border-gray-600 border-dashed">
                                    <Loader className="animate-spin" /> Waiting for Host...
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            )}

            {/* --- MULLIGAN OVERLAY --- */}
            {gamePhase === 'MULLIGAN' && (
                <div className="fixed inset-0 z-[9000] bg-black/95 backdrop-blur-sm flex flex-col items-center justify-center p-4 animate-in fade-in overflow-y-auto">
                    <h2 className="text-3xl font-bold text-white mb-2">
                        {mulliganSelectionMode ? 'Select Cards to Bottom' : 'Opening Hand'}
                    </h2>
                    <p className="text-gray-400 mb-8 text-center max-w-lg flex flex-col gap-1">
                        {isLocal && <span className="text-blue-400 font-bold uppercase tracking-widest">{playersList[mySeatIndex].name}</span>}
                        {mulliganSelectionMode
                            ? `Select ${freeMulligan ? Math.max(0, mulliganCount - 1) : mulliganCount} cards to put on the bottom of your library.`
                            : `You have drawn 7 cards. ${mulliganCount > 0 ? `(Mulligan #${mulliganCount}${freeMulligan && mulliganCount === 1 ? ' - Free' : ''})` : ''}`
                        }
                    </p>

                    {!mulliganSelectionMode ? (
                        <>
                            {/* Larger Card Grid for visibility */}
                            <div className={`flex ${isMobile ? 'overflow-x-auto snap-x snap-mandatory w-full px-[10vw] pb-8 gap-4 items-center' : 'justify-center gap-6 flex-wrap max-w-[90vw]'} mb-12`}>
                                {hand.filter(c => !c.isToken).map((card, idx) => (
                                    <div
                                        key={idx}
                                        className={`${isMobile ? 'w-[70vw] snap-center flex-shrink-0' : 'w-32 md:w-48'} aspect-[2.5/3.5] rounded-xl overflow-hidden shadow-2xl transform hover:-translate-y-4 transition-transform cursor-pointer group relative`}
                                        onClick={() => setInspectCard(card)}
                                    >
                                        <img src={card.imageUrl} className="w-full h-full object-cover" />
                                        <div className={`absolute inset-0 bg-black/40 opacity-0 ${!isMobile ? 'group-hover:opacity-100' : ''} flex items-center justify-center`}>
                                            <span className="bg-black/80 px-2 py-1 rounded text-xs text-white">Click to Inspect</span>
                                        </div>
                                    </div>
                                ))}
                            </div>

                            <div className="flex flex-col md:flex-row gap-6">
                                <button
                                    onClick={() => handleMulliganChoice(false)}
                                    className="flex items-center gap-2 px-8 py-3 bg-red-600 hover:bg-red-500 text-white font-bold rounded-full shadow-lg"
                                >
                                    <RefreshCw size={20} /> Mulligan
                                </button>
                                <button
                                    onClick={() => handleMulliganChoice(true)}
                                    className="flex items-center gap-2 px-8 py-3 bg-green-600 hover:bg-green-500 text-white font-bold rounded-full shadow-lg"
                                >
                                    <CheckCircle size={20} /> Keep Hand
                                </button>
                            </div>
                        </>
                    ) : (
                        <div className="flex flex-col items-center w-full max-w-6xl h-full">
                            {/* Selection Area */}
                            <div className="flex flex-col md:flex-row gap-8 w-full mb-8 min-h-[400px]">

                                {/* Current Hand */}
                                <div className="flex-1 bg-gray-800/50 rounded-xl p-6 border border-gray-700 overflow-y-auto">
                                    <h3 className="text-gray-300 font-bold mb-4 uppercase text-xs tracking-wider">Hand</h3>
                                    <div className="flex flex-wrap gap-4">
                                        {hand.filter(c => !c.isToken).map((card) => {
                                            const isSelected = cardsToBottom.find(c => c.id === card.id);
                                            if (isSelected) return null; // Don't show if moved
                                            return (
                                                <div
                                                    key={card.id}
                                                    onClick={() => toggleBottomCard(card)}
                                                    className="w-32 aspect-[2.5/3.5] rounded cursor-pointer hover:scale-105 transition-transform relative group"
                                                >
                                                    <img src={card.imageUrl} className="w-full h-full object-cover rounded shadow-lg" />
                                                    <div className="absolute inset-0 bg-blue-500/20 opacity-0 group-hover:opacity-100 transition-opacity rounded flex items-center justify-center">
                                                        <ArrowRight size={24} className="text-white drop-shadow-md" />
                                                    </div>
                                                </div>
                                            )
                                        })}
                                    </div>
                                </div>

                                {/* To Bottom Area */}
                                <div className="w-full md:w-80 bg-gray-800/50 rounded-xl p-6 border border-gray-700 flex flex-col">
                                    <h3 className="text-gray-300 font-bold mb-4 uppercase text-xs tracking-wider flex justify-between">
                                        <span>Bottom of Library</span>
                                        <span className={cardsToBottom.length === (freeMulligan ? Math.max(0, mulliganCount - 1) : mulliganCount) ? 'text-green-400' : 'text-yellow-400'}>
                                            {cardsToBottom.length} / {freeMulligan ? Math.max(0, mulliganCount - 1) : mulliganCount}
                                        </span>
                                    </h3>
                                    <div className="flex-1 flex flex-col gap-2 overflow-y-auto">
                                        {cardsToBottom.map((card, idx) => (
                                            <div
                                                key={card.id}
                                                onClick={() => toggleBottomCard(card)}
                                                className="flex items-center gap-2 bg-gray-700 p-2 rounded cursor-pointer hover:bg-red-900/50 group"
                                            >
                                                <span className="text-gray-500 font-mono w-4">{idx + 1}.</span>
                                                <img src={card.imageUrl} className="w-8 h-11 rounded object-cover" />
                                                <span className="text-sm font-medium truncate">{card.name}</span>
                                                <X size={16} className="ml-auto opacity-0 group-hover:opacity-100 text-red-400" />
                                            </div>
                                        ))}
                                        {cardsToBottom.length === 0 && (
                                            <div className="text-gray-600 text-sm italic text-center mt-10">Select cards from your hand to place here.</div>
                                        )}
                                    </div>
                                </div>
                            </div>

                            <button
                                onClick={confirmKeepHand}
                                disabled={cardsToBottom.length !== (freeMulligan ? Math.max(0, mulliganCount - 1) : mulliganCount)}
                                className="px-10 py-3 bg-blue-600 hover:bg-blue-500 disabled:bg-gray-700 disabled:text-gray-500 text-white font-bold rounded-full shadow-lg transition-all"
                            >
                                Confirm & {isLocal ? 'Next' : 'Start Game'}
                            </button>
                        </div>
                    )}
                </div>
            )}

            {/* Color Choice Modal (Runtime) */}
            {choosingColorForId && (
                <div className="absolute inset-0 z-[100] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in">
                    <div className="bg-gray-800 rounded-2xl shadow-2xl border border-gray-700 p-6 flex flex-col items-center gap-6">
                        <h3 className="text-xl font-bold text-white">Choose Color</h3>
                        <div className="flex gap-4">
                            {(() => {
                                const source = manaInfo.sources.find(s => s.objectId === choosingColorForId) || manaInfo.potentialSources.find(s => s.objectId === choosingColorForId);
                                if (!source) return null;

                                const colors = new Set<ManaColor>();
                                source.producedMana.forEach(c => {
                                    if (c === "CMD") {
                                        colors.add("CMD" as ManaColor);
                                    } else if (c === "WUBRG") {
                                        colors.add("WUBRG" as ManaColor);
                                    } else {
                                        colors.add(c);
                                    }
                                });

                                return Array.from(colors).map(color => (
                                    <button
                                        key={color}
                                        onClick={() => {
                                            setFloatingMana(prev => {
                                                const next = { ...prev };
                                                const amount = source.manaCount || 1;
                                                next[color] = (next[color] || 0) + amount;
                                                return next;
                                            });
                                            const amount = source.manaCount || 1;
                                            addLog(`added ${amount > 1 ? `${amount}x {${color}}` : `{${color}}`} to mana pool`);

                                            if (source && source.abilityType === 'tap' && choosingColorForId) {
                                                const obj = boardObjects.find(o => o.id === choosingColorForId);
                                                if (obj) {
                                                    const controllerIdx = (!isLocal && obj.controllerId === 'local-player')
                                                        ? mySeatIndex
                                                        : playersList.findIndex(p => p.id === obj.controllerId);
                                                    const defaultRotation = (controllerIdx !== -1 && layout[controllerIdx]) ? layout[controllerIdx].rot : 0;

                                                    if (obj.quantity > 1) {
                                                        const newTapped = Math.min(obj.quantity, obj.tappedQuantity + 1);
                                                        updateBoardObject(obj.id, { tappedQuantity: newTapped }, true, true);
                                                    } else {
                                                        const isTapped = obj.rotation !== defaultRotation;
                                                        if (!isTapped) {
                                                            const newRotation = (defaultRotation + 90) % 360;
                                                            updateBoardObject(obj.id, { rotation: newRotation }, true, true); // silent = true, skipMana = true
                                                        }
                                                    }
                                                }
                                            }
                                            setChoosingColorForId(null);
                                        }}
                                        className="w-12 h-12 rounded-full hover:scale-110 active:scale-95 transition-transform shadow-lg relative group"
                                    >
                                        <img src={getIconPath(color)} className="w-full h-full object-contain" />
                                        <div className="absolute -bottom-6 left-1/2 -translate-x-1/2 opacity-0 group-hover:opacity-100 text-[10px] font-bold uppercase tracking-wider bg-black/80 px-1.5 rounded transition-opacity pointer-events-none">
                                            {color}
                                        </div>
                                    </button>
                                ));
                            })()}
                        </div>
                        <button
                            onClick={() => setChoosingColorForId(null)}
                            className="text-sm text-gray-400 hover:text-white underline mt-2"
                        >
                            Cancel
                        </button>
                    </div>
                </div>
            )}

            {/* Rule Choice Modal (Alternative Rule Picker) */}
            {choosingRuleForId && (
                <div className="absolute inset-0 z-[100] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in">
                    <div className="bg-gray-800 rounded-2xl shadow-2xl border border-gray-700 p-6 flex flex-col items-center gap-6 max-w-sm">
                        <h3 className="text-xl font-bold text-white">Choose Mana Ability</h3>
                        {(() => {
                            const source = (manaInfo.sources.find(s => s.objectId === choosingRuleForId) || manaInfo.potentialSources.find(s => s.objectId === choosingRuleForId)) as ManaSource;
                            if (!source) return null;

                            return (
                                <div className="flex flex-col gap-3 w-full">
                                    <button
                                        onClick={() => {
                                            const primarySource = { ...source, alternativeRule: undefined };
                                            setChoosingRuleForId(null);
                                            produceMana(primarySource, false);
                                        }}
                                        className="flex flex-col items-center gap-2 p-4 bg-gray-700 hover:bg-gray-600 rounded-xl border border-gray-600 hover:border-blue-500 transition-all group"
                                    >
                                        <span className="text-sm font-bold text-white">Primary Option</span>
                                        <div className="flex gap-1">
                                            {source.producedMana.map((c, i) => (
                                                <img key={i} src={getIconPath(c)} className="w-6 h-6 object-contain" />
                                            ))}
                                        </div>
                                    </button>

                                    <div className="flex items-center justify-center">
                                        <div className="w-1/3 h-px bg-gray-700" />
                                        <span className="px-3 text-gray-500 text-xs font-bold">OR</span>
                                        <div className="w-1/3 h-px bg-gray-700" />
                                    </div>

                                    <button
                                        onClick={() => {
                                            if (source.alternativeRule) {
                                                const altSource = {
                                                    ...source,
                                                    producedMana: ruleToColors(source.alternativeRule),
                                                    activationCost: ruleToActivationString(source.alternativeRule),
                                                    alternativeRule: undefined
                                                };
                                                setChoosingRuleForId(null);
                                                produceMana(altSource, false);
                                            }
                                        }}
                                        className="flex flex-col items-center gap-2 p-4 bg-gray-700/50 hover:bg-gray-700 rounded-xl border border-amber-800/30 hover:border-amber-500 transition-all group"
                                    >
                                        <span className="text-sm font-bold text-amber-400">Alternative Option</span>
                                        <div className="flex gap-1">
                                            {source.alternativeRule ? ruleToColors(source.alternativeRule).map((c, i) => (
                                                <img key={i} src={getIconPath(c)} className="w-6 h-6 object-contain" />
                                            )) : <span className="text-xs text-gray-500 italic">Special Rule</span>}
                                        </div>
                                    </button>
                                </div>
                            );
                        })()}
                        <button
                            onClick={() => setChoosingRuleForId(null)}
                            className="text-sm text-gray-400 hover:text-white underline"
                        >
                            Cancel
                        </button>
                    </div>
                </div>
            )}


            {/* --- UI: Top Bar --- */}
            <div className="flex-none h-11 md:h-16 bg-gray-900/90 border-b border-gray-700 flex items-center justify-between px-2 md:px-6 z-50 backdrop-blur-md relative">
                {/* Left Side: Player Info (Always Visible) */}
                <div className="flex items-center gap-2 md:gap-6 overflow-hidden flex-1">
                    {/* Players List (Hidden on Mobile) */}
                    <div className="hidden md:flex items-center gap-4 overflow-x-auto max-w-[60vw] md:max-w-none custom-scrollbar pb-1">
                        {playersList.map((p, idx) => {
                            const isMe = isLocal ? idx === mySeatIndex : p.id === socket.id;
                            const pLife = isMe ? life : (opponentsLife[p.id] ?? 40);
                            const isTurn = currentTurnPlayerId === p.id;

                            const takenDamage = playersList
                                .filter(attacker => attacker.id !== p.id)
                                .map(attacker => {
                                    const dmg = (commanderDamage[`cmd-${attacker.id}`] || {})[p.id] || 0;
                                    return { ...attacker, dmg };
                                })
                                .filter(d => d.dmg > 0);

                            return (
                                <div key={p.id}
                                    onClick={() => isLocal && handleLocalViewSwitch(idx)}
                                    className={`flex items-center gap-2 bg-gray-800/50 rounded-full pr-3 pl-1 py-1 border ${isTurn ? 'border-yellow-500 shadow-[0_0_10px_rgba(234,179,8,0.3)]' : (isMe ? 'border-blue-500 shadow-[0_0_10px_rgba(59,130,246,0.3)]' : 'border-gray-700')} ${isLocal ? 'cursor-pointer hover:bg-gray-700 transition-colors' : ''}`}>
                                    <div
                                        className="w-8 h-8 rounded-full flex items-center justify-center font-bold text-xs border border-white/20 shadow-lg shrink-0"
                                        style={{ backgroundColor: p.color }}
                                    >
                                        {p.name.charAt(0).toUpperCase()}
                                    </div>
                                    <div className="flex flex-col leading-none justify-center">
                                        <span className={`text-xs font-bold ${isTurn ? 'text-yellow-400' : 'text-gray-300'} max-w-[80px] truncate`}>{p.name}</span>
                                        <span className="text-white font-mono text-[10px]">{pLife} HP</span>
                                    </div>
                                    {takenDamage.length > 0 && (
                                        <div className="flex flex-col gap-0.5 ml-1">
                                            {takenDamage.map(td => (
                                                <div key={td.id} className="flex items-center gap-1 bg-black/40 px-1 rounded h-3" title={`Damage from ${td.name}'s Commander`}>
                                                    <div className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: td.color }}></div>
                                                    <span className={`font-bold text-[9px] leading-none ${td.dmg >= 21 ? 'text-red-500' : 'text-gray-300'}`}>{td.dmg}</span>
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            );
                        })}
                    </div>

                    {/* Mobile Health Button */}
                    <button onClick={() => setShowHealthModal(true)} className="md:hidden p-2 bg-gray-800 rounded-full text-red-500 border border-gray-700">
                        <Heart size={20} fill="currentColor" />
                    </button>

                    {/* Life Controls (Local) */}
                    <div className="flex items-center gap-1 bg-gray-800 rounded-lg p-1 border border-gray-600 shadow-inner">
                        <button onClick={() => handleLifeChange(-1)} className="text-red-400 hover:text-red-300 font-bold text-lg px-2 active:scale-90 transition">-</button>
                        <button onClick={() => handleLifeChange(1)} className="text-green-400 hover:text-green-300 font-bold text-lg px-2 active:scale-90 transition">+</button>
                    </div>

                    <div className="flex items-center gap-2 bg-gray-800 rounded-lg p-1 border border-gray-600 mx-1 md:mx-2">
                        <div className="flex items-center gap-1 md:gap-2 px-2 border-r border-gray-600">
                            <Clock size={16} className="text-gray-400 hidden md:block" />
                            <span className="text-xs md:text-sm font-bold text-white">{isMobile ? `#${turn}` : `Turn ${turn}`}</span>
                        </div>
                        <div className="px-2 text-xs md:text-sm text-blue-400 font-bold max-w-[80px] md:max-w-[100px] truncate">
                            {isMobile ? (playersList.find(p => p.id === currentTurnPlayerId)?.name || '...') : (playersList.find(p => p.id === currentTurnPlayerId)?.name || '...')}
                        </div>
                        <button
                            onClick={nextTurn}
                            disabled={!isLocal && currentTurnPlayerId !== socket.id}
                            className="p-1 hover:bg-gray-700 rounded text-green-400 disabled:text-gray-600 disabled:hover:bg-transparent disabled:cursor-not-allowed"
                            title="Pass Turn"
                        >
                            <ChevronRight size={16} />
                        </button>
                    </div>

                    {isLocal && isMobile && (
                        <>
                            <button onClick={() => handleLocalViewSwitch((mySeatIndex - 1 + playersList.length) % playersList.length)} className="absolute top-16 left-2 z-40 p-2 bg-gray-800/80 rounded-full border border-gray-600 text-white shadow-lg"><ChevronLeft size={24} /></button>
                            <button onClick={() => handleLocalViewSwitch((mySeatIndex + 1) % playersList.length)} className="absolute top-16 right-2 z-40 p-2 bg-gray-800/80 rounded-full border border-gray-600 text-white shadow-lg"><ChevronRight size={24} /></button>
                        </>
                    )}

                    <button
                        onClick={() => setShowCmdrDamage(true)}
                        className="hidden md:flex items-center gap-2 px-3 py-1 bg-gray-800 border border-gray-600 rounded hover:bg-gray-700 text-red-400"
                        title="Commander Damage"
                    >
                        <Swords size={20} />
                    </button>

                    <div className="hidden md:block w-px h-6 bg-gray-700 mx-2" />

                    <button onClick={() => rollDice(6)} className="hidden md:flex items-center gap-2 px-3 py-1 bg-gray-800 border border-gray-600 rounded hover:bg-gray-700 text-yellow-500" title="Roll D6">
                        <Dices size={20} />
                    </button>

                    <button onClick={spawnCounter} className="hidden md:flex items-center gap-2 px-3 py-1 bg-gray-800 border border-gray-600 rounded hover:bg-gray-700 text-cyan-400" title="Add Counter">
                        <Disc size={20} />
                    </button>
                </div>

                {/* Right Side: Desktop Controls */}
                <div className="hidden md:flex items-center gap-3">
                    {!isLocal && (
                        <div className="flex flex-col items-end mr-2">
                            <span className="text-[10px] text-gray-500 uppercase font-bold tracking-wider">Room Code</span>
                            <span className="text-sm font-mono font-bold text-gray-300 select-all">{roomId}</span>
                        </div>
                    )}

                    {!isLocal && (
                        <button
                            onClick={() => setIsOpponentViewOpen(!isOpponentViewOpen)}
                            className={`p-2 rounded-lg transition-colors ${isOpponentViewOpen ? 'bg-blue-600 text-white' : 'hover:bg-gray-800 text-gray-400'}`}
                            title="Toggle Opponent View"
                        >
                            <Users size={20} />
                        </button>
                    )}

                    <div className="w-px h-6 bg-gray-700 mx-2" />
                    <button
                        onClick={handleUndo}
                        disabled={undoHistory.length === 0}
                        className={`p-2 rounded-lg transition-colors relative ${undoHistory.length > 0 ? 'hover:bg-gray-800 text-amber-400 hover:text-amber-300' : 'text-gray-600 cursor-not-allowed'}`}
                        title={`Undo (Ctrl+Z) — ${undoHistory.length} actions`}
                    >
                        <Undo2 size={20} />
                        {undoHistory.length > 0 && (
                            <span className="absolute -top-1 -right-1 bg-amber-500 text-black text-[10px] font-bold rounded-full w-4 h-4 flex items-center justify-center">
                                {undoHistory.length}
                            </span>
                        )}
                    </button>
                    <button
                        onClick={() => !isMobile && setShowSettingsModal(true)}
                        className="p-2 rounded-lg hover:bg-gray-800 text-gray-400 hover:text-white"
                        title="Settings"
                    >
                        <Settings size={20} />
                    </button>
                    <button
                        onClick={() => setIsLogOpen(!isLogOpen)}
                        className={`p-2 rounded-lg transition-colors ${isLogOpen ? 'bg-blue-600 text-white' : 'hover:bg-gray-800 text-gray-400'}`}
                        title="Game Log"
                    >
                        <History size={20} />
                    </button>
                    <button
                        onClick={() => setShowStatsModal(true)}
                        className={`p-2 rounded-lg transition-colors ${showStatsModal ? 'bg-blue-600 text-white' : 'hover:bg-gray-800 text-gray-400'}`}
                        title="Game Stats"
                    >
                        <BarChart3 size={20} />
                    </button>
                    {isHost && (
                        <button onClick={() => setShowEndGameModal(true)} className="p-2 rounded-lg hover:bg-gray-800 text-red-400 hover:text-red-300" title="End Game">
                            <RotateCcw size={20} />
                        </button>
                    )}
                    {isHost && (
                        <button onClick={() => setShowPlayerManager(true)} className="p-2 rounded-lg hover:bg-gray-800 text-blue-400 hover:text-blue-300" title="Host Controls">
                            <Shield size={20} />
                        </button>
                    )}
                    <button onClick={handleExit} className="flex items-center gap-2 px-4 py-2 bg-red-900/50 hover:bg-red-900/80 border border-red-800 text-red-200 rounded-lg transition-colors" title="Leave Game">
                        <LogOut size={16} />
                    </button>
                </div>

                {/* Mobile Right Side Controls */}
                <div className="md:hidden flex items-center gap-2">
                    {isMobile && isLandscape && isFullScreen && (
                        <button onClick={() => setShowHealthModal(true)} className="p-2 bg-gray-800 rounded-full text-red-500 border border-gray-700">
                            <Heart size={20} fill="currentColor" />
                        </button>
                    )}
                    {isMobile && isLandscape && isFullScreen ? (
                        <button onClick={toggleFullScreen} className="p-2 text-gray-300 hover:text-white" title="Exit Full Screen">
                            <Minimize size={24} />
                        </button>
                    ) : (
                        <button className="p-2 text-gray-300 hover:text-white" onClick={() => setMobileMenuOpen(true)}>
                            <Menu size={24} />
                        </button>
                    )}
                </div>
            </div>

            {/* Mobile Menu Overlay */}
            {mobileMenuOpen && (
                <div className="fixed inset-0 z-[10000] bg-gray-900/95 backdrop-blur-xl flex flex-col p-6 animate-in slide-in-from-right overflow-y-auto">
                    <div className="flex justify-between items-center mb-8">
                        <h2 className="text-2xl font-bold text-white">Menu</h2>
                        <button onClick={() => setMobileMenuOpen(false)} className="p-2 bg-gray-800 rounded-full text-white"><X size={24} /></button>
                    </div>

                    <div className="grid grid-cols-2 gap-4 mb-8">
                        <div className="flex items-center justify-between bg-gray-800 p-4 rounded-xl border border-gray-700 col-span-2">
                            <span className="text-gray-400 font-bold">Life</span>
                            <div className="flex items-center gap-4">
                                <button onClick={() => handleLifeChange(-1)} className="w-10 h-10 bg-red-900/50 text-red-400 rounded-full flex items-center justify-center font-bold text-xl border border-red-800">-</button>
                                <span className="text-2xl font-bold text-white w-8 text-center">{life}</span>
                                <button onClick={() => handleLifeChange(1)} className="w-10 h-10 bg-green-900/50 text-green-400 rounded-full flex items-center justify-center font-bold text-xl border border-green-800">+</button>
                            </div>
                        </div>

                        <button onClick={nextTurn} disabled={!isLocal && currentTurnPlayerId !== socket.id} className="bg-gray-800 p-4 rounded-xl border border-gray-700 flex flex-col items-center gap-2 disabled:opacity-50">
                            <ChevronRight size={24} className="text-green-400" />
                            <span className="text-white font-bold">Pass Turn</span>
                        </button>
                        <button onClick={toggleFullScreen} className="bg-gray-800 p-4 rounded-xl border border-gray-700 flex flex-col items-center gap-2">
                            <Maximize size={24} className="text-blue-400" />
                            <span className="text-white font-bold">Full Screen</span>
                        </button>
                        <button onClick={() => { setShowCmdrDamage(true); setMobileMenuOpen(false); }} className="bg-gray-800 p-4 rounded-xl border border-gray-700 flex flex-col items-center gap-2">
                            <Swords size={24} className="text-red-400" />
                            <span className="text-white font-bold">Cmdr Dmg</span>
                        </button>
                        <button onClick={() => { rollDice(6); setMobileMenuOpen(false); }} className="bg-gray-800 p-4 rounded-xl border border-gray-700 flex flex-col items-center gap-2">
                            <Dices size={24} className="text-yellow-500" />
                            <span className="text-white font-bold">Roll D6</span>
                        </button>
                        <button onClick={() => { spawnCounter(); setMobileMenuOpen(false); }} className="bg-gray-800 p-4 rounded-xl border border-gray-700 flex flex-col items-center gap-2">
                            <Disc size={24} className="text-cyan-400" />
                            <span className="text-white font-bold">Counter</span>
                        </button>
                        {!isLocal && (
                            <button onClick={() => { setIsOpponentViewOpen(!isOpponentViewOpen); setMobileMenuOpen(false); }} className="bg-gray-800 p-4 rounded-xl border border-gray-700 flex flex-col items-center gap-2">
                                <Users size={24} className="text-purple-400" />
                                <span className="text-white font-bold">Opponents</span>
                            </button>
                        )}
                    </div>

                    <div className="mt-auto space-y-3">
                        {!isLandscape && (
                            <button onClick={() => { setShowSettingsModal(true); setMobileMenuOpen(false); }} className="w-full py-3 bg-gray-800 rounded-xl text-white font-bold flex items-center justify-center gap-2"><Settings /> Settings</button>
                        )}
                        <button onClick={() => { setIsLogOpen(true); setMobileMenuOpen(false); }} className="w-full py-3 bg-gray-800 rounded-xl text-white font-bold flex items-center justify-center gap-2"><History /> Game Log</button>
                        <button onClick={() => { setShowStatsModal(true); setMobileMenuOpen(false); }} className="w-full py-3 bg-gray-800 rounded-xl text-white font-bold flex items-center justify-center gap-2"><BarChart3 /> Stats</button>
                        {isHost && <button onClick={() => { setShowPlayerManager(true); setMobileMenuOpen(false); }} className="w-full py-3 bg-blue-900/50 text-blue-200 rounded-xl font-bold flex items-center justify-center gap-2"><Shield /> Host Controls</button>}
                        <button onClick={handleExit} className="w-full py-3 bg-red-900/50 text-red-200 rounded-xl font-bold flex items-center justify-center gap-2"><LogOut /> Leave Game</button>
                    </div>
                </div>
            )}

            {/* --- Main Content Area --- */}
            <div className={`flex-1 flex flex-col md:flex-row overflow-hidden relative ${gamePhase !== 'SETUP' && isMobile && !isFullScreen && !isLandscape ? 'pb-16' : ''}`}>

                {/* Left / Main Pane */}
                <div className={`${isOpponentViewOpen ? (isMobile ? 'hidden' : 'h-1/2 w-full md:w-1/2 md:h-full border-b md:border-b-0 md:border-r border-gray-700') : 'w-full h-full'} relative transition-all duration-300`}>
                    {renderWorld(view, containerRef, {
                        onDown: handleContainerPointerDown,
                        onMove: handleContainerPointerMove,
                        onUp: handleContainerPointerUp,
                        onWheel: handleWheel
                    }, -(layout[mySeatIndex]?.rot || 0), false)}

                    {/* Controls Overlay (Zoom) */}
                    <div className="absolute top-4 right-4 flex flex-col gap-2 z-10 hidden md:flex">
                        <button onClick={() => setView(v => ({ ...v, scale: Math.min(v.scale + 0.1, 3) }))} className="p-2 bg-gray-800/80 border border-gray-600 hover:bg-gray-700 rounded text-gray-300"><ZoomIn size={18} /></button>
                        <button onClick={() => setView(v => ({ ...v, scale: Math.max(v.scale - 0.1, 0.1) }))} className="p-2 bg-gray-800/80 border border-gray-600 hover:bg-gray-700 rounded text-gray-300"><ZoomOut size={18} /></button>
                    </div>

                    {/* Hand UI (Only visible in Setup/Playing) */}
                    {gamePhase !== 'SETUP' && !mobileControllers.has(playersList[mySeatIndex]?.id) && (
                        <>
                            <div
                                className={`absolute z-50 flex items-center pointer-events-auto transition-transform duration-300 ${isMobile && isLandscape
                                    ? `top-0 right-0 bottom-0 flex-row ${isHandVisible ? 'translate-x-0' : 'translate-x-full'}`
                                    : `bottom-0 left-0 right-0 flex-col ${isHandVisible ? 'translate-y-0' : 'translate-y-full'}`
                                    }`}
                                onTouchStart={handleHandTouchStart}
                                onTouchEnd={handleHandTouchEnd}
                            >
                                {/* Swipe Handle / Tab for Mobile */}
                                {isMobile && (
                                    <div
                                        className={`pointer-events-auto transition-transform ${isLandscape
                                            ? `h-full w-8 flex items-center justify-center ${!isHandVisible ? '-translate-x-12' : '-ml-6'}`
                                            : `w-full h-8 flex items-center justify-center ${!isHandVisible ? '-translate-y-12' : '-mt-6'}`
                                            }`}
                                        onClick={() => setIsHandVisible(!isHandVisible)}
                                    >
                                        <div className={`bg-gray-800 border border-gray-600 shadow-lg flex items-center justify-center ${isLandscape
                                            ? `px-1 py-6 rounded-l-xl ${!isHandVisible ? 'rounded-r-xl border-r' : ''}`
                                            : `px-6 py-1 rounded-t-xl ${!isHandVisible ? 'rounded-b-xl border-b' : ''}`
                                            }`}>
                                            <div className={`bg-gray-500 rounded-full ${isLandscape ? 'w-1.5 h-12' : 'w-12 h-1.5'}`} />
                                        </div>
                                    </div>
                                )}

                                <div className={`absolute pointer-events-none ${isMobile && isLandscape
                                    ? 'h-full w-56 right-0 bg-gradient-to-l from-black via-black/80 to-transparent'
                                    : `w-full h-56 bottom-0 ${isMobile ? '' : 'bg-gradient-to-t from-black via-black/80 to-transparent'}`
                                    }`} />

                                {/* Hand Scroll Container */}
                                <div
                                    ref={handContainerRef}
                                    onWheel={handleHandWheel}
                                    className={`relative pointer-events-auto ${isMobile && isLandscape
                                        ? 'h-full overflow-y-auto overflow-x-hidden touch-pan-y pr-4'
                                        : 'w-full overflow-x-auto overflow-y-hidden touch-pan-x pb-4 md:pb-8'
                                        }`}
                                    style={{
                                        scrollbarWidth: 'none',
                                        msOverflowStyle: 'none',
                                    }}
                                >
                                    <style>{`div::-webkit-scrollbar { display: none; }`}</style>
                                    <div
                                        className={`flex gap-2 h-max w-max ${isMobile && isLandscape ? 'flex-col items-start' : 'items-end'}`}
                                        style={isMobile && isLandscape
                                            ? { paddingTop: `calc(50vh - ${112 * handScale}px)`, paddingBottom: `calc(50vh - ${112 * handScale}px)` }
                                            : { paddingLeft: `calc(50vw - ${80 * handScale}px)`, paddingRight: `calc(50vw - ${80 * handScale}px)` }
                                        }
                                    >
                                        {cardsInHandWithShortcuts.map((card, idx) => (
                                            <HandCard
                                                key={card.id}
                                                card={card}
                                                scale={handScale}
                                                onInspect={setInspectCard}
                                                onPlay={playCardFromHand}
                                                onSendToZone={sendToZone}
                                                isMobile={isMobile}
                                                onMobileAction={() => setMobileActionCardId(card.id)}
                                                onDoubleClick={() => setInspectCard(card)}
                                                shortcutKey={card.shortcutKey}
                                            />
                                        ))}

                                        {/* Tokens Pile / Add Button */}
                                        <div className={`flex items-center justify-center h-full ${isMobile && isLandscape ? 'flex-row pl-1' : 'flex-col pb-1'}`}>
                                            {!areTokensExpanded ? (
                                                <div
                                                    className={`relative flex-shrink-0 bg-gray-800 border-2 ${tokensInHand.length > 0 ? 'border-yellow-500' : 'border-gray-600 border-dashed'} rounded-xl flex flex-col items-center justify-center cursor-pointer hover:scale-105 transition-transform shadow-lg`}
                                                    style={{ width: 140 * handScale, height: 196 * handScale }}
                                                    onClick={() => tokensInHand.length > 0 ? setAreTokensExpanded(true) : openSearch('TOKENS')}
                                                    title={tokensInHand.length > 0 ? "Expand Tokens" : "Add Tokens"}
                                                >
                                                    <Layers className={tokensInHand.length > 0 ? "text-yellow-500 mb-2" : "text-gray-500 mb-2"} size={24} />
                                                    <span className={`font-bold text-xs ${tokensInHand.length > 0 ? "text-white" : "text-gray-500"}`}>{tokensInHand.length > 0 ? `Tokens (${tokensInHand.length})` : "Add Tokens"}</span>
                                                </div>
                                            ) : (
                                                <div className={`flex gap-2 animate-in items-end ${isMobile && isLandscape ? 'flex-col slide-in-from-right-10' : 'slide-in-from-bottom-10'}`}>
                                                    {tokensInHand.map((card) => (
                                                        <HandCard
                                                            key={card.id}
                                                            card={card}
                                                            scale={handScale}
                                                            onInspect={setInspectCard}
                                                            onPlay={playCardFromHand}
                                                            onSendToZone={sendToZone}
                                                            isMobile={isMobile}
                                                            onMobileAction={() => setMobileActionCardId(card.id)}
                                                            onDoubleClick={() => setInspectCard(card)}
                                                        />
                                                    ))}
                                                    <div className={`flex gap-2 ${isMobile && isLandscape ? 'flex-row pl-10' : 'flex-col pb-10'}`}>
                                                        <button
                                                            onClick={() => openSearch('TOKENS')}
                                                            className="w-8 h-8 bg-blue-600 hover:bg-blue-500 text-white rounded-full flex items-center justify-center shadow-lg"
                                                            title="Add Token"
                                                        >
                                                            <Plus size={16} />
                                                        </button>
                                                        <button
                                                            onClick={() => setAreTokensExpanded(false)}
                                                            className="w-8 h-8 bg-gray-700 hover:bg-gray-600 text-gray-300 rounded-full flex items-center justify-center shadow-lg border border-gray-600"
                                                            title="Collapse"
                                                        >
                                                            <X size={16} />
                                                        </button>
                                                    </div>
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                </div>
                                {hand.length === 0 && <div className="absolute bottom-10 text-gray-500 italic z-10">Hand is empty</div>}
                            </div>

                            <div className={`absolute ${isMobile ? 'bottom-20 right-1 scale-75 origin-bottom-right' : 'bottom-6 right-6'} z-[60] flex flex-col items-center bg-gray-800/80 backdrop-blur rounded-lg p-2 border border-gray-600 transition-opacity ${isHandVisible ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}>
                                {!isMobile && <Settings size={16} className="text-gray-400 mb-2" />}
                                <input
                                    type="range"
                                    min="0.5"
                                    max="1.5"
                                    step="0.1"
                                    value={handScale}
                                    onChange={(e) => setHandScale(parseFloat(e.target.value))}
                                    className={`h-24 w-1 bg-gray-600 rounded-lg appearance-none cursor-pointer vertical-range ${isMobile ? 'h-16' : ''}`}
                                    style={{ writingMode: 'vertical-lr', direction: 'rtl' }}
                                />
                            </div>
                        </>
                    )}
                </div>

                {/* Mana Display */}
                {(gamePhase === 'PLAYING' && showManaCalculator) && (
                    <ManaDisplay
                        manaInfo={manaInfo}
                        floatingMana={floatingMana}
                        onAddMana={handleAddMana}
                        onRemoveMana={handleRemoveMana}
                        onAutoTapColor={handleAutoTapColor}
                    />
                )}

                {/* New Mana Payment Sidebar */}
                {(pendingPaymentCard && showManaCalculator) && (
                    <ManaPaymentSidebar
                        card={pendingPaymentCard}
                        floatingMana={floatingMana}
                        allocatedMana={allocatedMana}
                        availableMana={manaInfo.available}
                        onAllocate={(type) => {
                            if (floatingMana[type] > 0) {
                                handleRemoveMana(type);
                                setAllocatedMana(prev => ({ ...prev, [type]: (prev[type] || 0) + 1 }));
                            }
                        }}
                        onUnallocate={(type) => {
                            if (allocatedMana[type] > 0) {
                                handleAddMana(type);
                                setAllocatedMana(prev => ({ ...prev, [type]: (prev[type] || 0) - 1 }));
                            }
                        }}
                        onXValueChange={(xVal) => {
                            setPendingPaymentCard(prev => prev ? { ...prev, userXValue: xVal } as any : null);
                        }}
                        onDismiss={() => {
                            // Return allocated mana to pool
                            BASE_COLORS.forEach(c => {
                                const amount = allocatedMana[c] || 0;
                                if (amount > 0) {
                                    for (let i = 0; i < amount; i++) handleAddMana(c);
                                }
                            });
                            setAllocatedMana(EMPTY_POOL);
                            setPendingPaymentCard(null);
                        }}
                        onConfirm={() => {
                            setAllocatedMana(EMPTY_POOL);
                            setPendingPaymentCard(null);
                            addLog(`paid mana for ${pendingPaymentCard.name}`);
                        }}
                    />
                )}

                {/* Auto-Tap Flash Overlay — highlights tapped cards */}
                {autoTappedIds.length > 0 && (
                    <style>{`
                        ${autoTappedIds.map(id => `[data-object-id="${id}"]`).join(', ')} {
                            box-shadow: 0 0 20px 6px rgba(250, 204, 21, 0.5) !important;
                            transition: box-shadow 0.3s ease !important;
                        }
                    `}</style>
                )}

                {/* Right / Opponent Pane */}
                {isOpponentViewOpen && (
                    <div className={`${isMobile ? 'fixed inset-0 z-[60]' : 'w-full h-1/2 md:w-1/2 md:h-full relative'} bg-gray-900 md:border-l border-gray-700 flex flex-col`}>
                        <div className="h-12 bg-gray-800 border-b border-gray-700 flex items-center justify-between px-4 z-20 shadow-md">
                            <div className="flex items-center gap-3">
                                <button
                                    onClick={() => setSelectedOpponentIndex(prev => (prev - 1 + (playersList.length - 1)) % (playersList.length - 1))}
                                    className="p-1 hover:bg-gray-700 rounded text-gray-300"
                                >
                                    <ChevronLeft size={20} />
                                </button>
                                <div className="font-bold text-white flex items-center gap-2">
                                    <div className="w-3 h-3 rounded-full bg-blue-500" />
                                    {(() => {
                                        const opponents = playersList.filter(p => p.id !== socket.id);
                                        return opponents[selectedOpponentIndex % opponents.length]?.name || 'Unknown';
                                    })()}
                                </div>
                                <button
                                    onClick={() => setSelectedOpponentIndex(prev => (prev + 1) % (playersList.length - 1))}
                                    className="p-1 hover:bg-gray-700 rounded text-gray-300"
                                >
                                    <ChevronRight size={20} />
                                </button>
                            </div>
                            {isMobile && (
                                <button onClick={() => setIsOpponentViewOpen(false)} className="p-1 bg-red-900/50 text-red-200 rounded"><X size={16} /></button>
                            )}
                            <div className="flex items-center gap-2">
                                <button onClick={() => setOpponentView(v => ({ ...v, scale: Math.min(v.scale + 0.1, 3) }))} className="p-1.5 hover:bg-gray-700 rounded text-gray-300"><ZoomIn size={16} /></button>
                                <button onClick={() => setOpponentView(v => ({ ...v, scale: Math.max(v.scale - 0.1, 0.1) }))} className="p-1.5 hover:bg-gray-700 rounded text-gray-300"><ZoomOut size={16} /></button>
                            </div>
                        </div>

                        {/* Opponent Viewport */}
                        <div className="flex-1 relative overflow-hidden">
                            {(() => {
                                const opponents = playersList.filter(p => p.id !== socket.id);
                                if (opponents.length === 0) return null;
                                const targetPlayer = opponents[selectedOpponentIndex % opponents.length];
                                const targetIndex = playersList.findIndex(p => p.id === targetPlayer.id);
                                const targetRot = layout[targetIndex]?.rot || 0;

                                return renderWorld(opponentView, opponentContainerRef, {
                                    onDown: handleOpponentPointerDown,
                                    onMove: handleOpponentPointerMove,
                                    onUp: handleOpponentPointerUp,
                                    onWheel: handleOpponentWheel
                                }, -targetRot, true);
                            })()}
                        </div>
                    </div>
                )}
            </div>

            {/* Status Message */}
            {statusMessage && (
                <div className="absolute top-20 left-1/2 -translate-x-1/2 z-[9000] pointer-events-none animate-in fade-in slide-in-from-top-4">
                    <div className="bg-black/70 backdrop-blur text-white px-4 py-1 rounded-full text-sm font-medium border border-white/10 shadow-xl">
                        {statusMessage}
                    </div>
                </div>
            )}

            {/* Modals */}
            {showEndGameModal && (
                <div className="fixed inset-0 z-[10000] bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in">
                    <div className="bg-gray-800 border border-gray-600 rounded-xl p-8 shadow-2xl max-w-md w-full text-center">
                        <h3 className="text-2xl font-bold text-white mb-4">End Game?</h3>
                        <p className="text-gray-300 mb-8">Do you want to restart the lobby with current players or return to the main menu?</p>
                        <div className="flex flex-col gap-3">
                            <button onClick={handleRestartGame} className="w-full py-3 bg-blue-600 hover:bg-blue-500 text-white rounded-lg font-bold flex items-center justify-center gap-2"><RotateCcw size={18} /> Restart Lobby</button>
                            <button onClick={() => setShowStatsModal(true)} className="w-full py-3 bg-gray-700 hover:bg-gray-600 text-white rounded-lg font-bold flex items-center justify-center gap-2"><BarChart3 size={18} /> View Stats</button>
                            <button onClick={handleExit} className="w-full py-3 bg-red-600 hover:bg-red-500 text-white rounded-lg font-bold flex items-center justify-center gap-2"><LogOut size={18} /> Return to Menu</button>
                            <button onClick={() => setShowEndGameModal(false)} className="w-full py-2 text-gray-400 hover:text-white mt-2">Cancel</button>
                        </div>
                    </div>
                </div>
            )}

            {/* Mobile Zone Menu */}
            {mobileZoneMenu && (
                <div className="fixed inset-0 z-[12000] bg-black/80 backdrop-blur-sm flex items-end justify-center animate-in slide-in-from-bottom-10" onClick={() => setMobileZoneMenu(null)}>
                    <div className="bg-gray-900 w-full rounded-t-2xl border-t border-gray-700 p-6 pb-10" onClick={e => e.stopPropagation()}>
                        <h3 className="text-xl font-bold text-white mb-4 capitalize">{mobileZoneMenu.toLowerCase()} Actions</h3>
                        <div className="grid grid-cols-3 gap-3">
                            {mobileZoneMenu === 'LIBRARY' && (
                                <>
                                    <button onClick={() => { drawCard(1); setMobileZoneMenu(null); }} className="flex flex-col items-center gap-2 p-4 bg-gray-800 rounded-xl active:bg-blue-600"><Hand size={24} className="text-green-400" /><span className="text-sm text-white">Draw</span></button>
                                    <button onClick={() => { playTopLibrary(); setMobileZoneMenu(null); }} className="flex flex-col items-center gap-2 p-4 bg-gray-800 rounded-xl active:bg-blue-600"><Play size={24} className="text-blue-400" /><span className="text-sm text-white">Play Top</span></button>
                                    <button onClick={() => { openSearch('LIBRARY'); setMobileZoneMenu(null); }} className="flex flex-col items-center gap-2 p-4 bg-gray-800 rounded-xl active:bg-blue-600"><Search size={24} className="text-white" /><span className="text-sm text-white">Search</span></button>
                                    <button onClick={() => { shuffleLibrary(); setMobileZoneMenu(null); }} className="flex flex-col items-center gap-2 p-4 bg-gray-800 rounded-xl active:bg-blue-600"><Shuffle size={24} className="text-purple-400" /><span className="text-sm text-white">Shuffle</span></button>
                                </>
                            )}
                            {mobileZoneMenu === 'GRAVEYARD' && (
                                <>
                                    <button onClick={() => { openSearch('GRAVEYARD'); setMobileZoneMenu(null); }} className="flex flex-col items-center gap-2 p-4 bg-gray-800 rounded-xl active:bg-blue-600"><Search size={24} className="text-white" /><span className="text-sm text-white">View All</span></button>
                                    <button onClick={() => { playTopGraveyard(); setMobileZoneMenu(null); }} className="flex flex-col items-center gap-2 p-4 bg-gray-800 rounded-xl active:bg-blue-600"><Play size={24} className="text-blue-400" /><span className="text-sm text-white">Play Top</span></button>
                                </>
                            )}
                            {mobileZoneMenu === 'EXILE' && (
                                <button onClick={() => { openSearch('EXILE'); setMobileZoneMenu(null); }} className="flex flex-col items-center gap-2 p-4 bg-gray-800 rounded-xl active:bg-blue-600"><Search size={24} className="text-white" /><span className="text-sm text-white">View All</span></button>
                            )}
                            <button onClick={() => setMobileZoneMenu(null)} className="flex flex-col items-center gap-2 p-4 bg-gray-800 rounded-xl active:bg-red-600 col-span-3 mt-2">
                                <X size={24} className="text-white" />
                                <span className="text-sm text-white">Cancel</span>
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Mobile Card Actions Modal */}
            {mobileActionCardId && (
                <div className="fixed left-0 top-0 bottom-0 z-[9000] flex flex-col justify-center pointer-events-none animate-in slide-in-from-left duration-200">
                    <div className="bg-black/60 backdrop-blur-sm border-r border-y border-gray-700/50 rounded-r-2xl p-2 shadow-2xl pointer-events-auto flex flex-col gap-2 max-h-[90vh] overflow-y-auto custom-scrollbar w-20 md:w-auto">
                        {(() => {
                            const obj = boardObjects.find(o => o.id === mobileActionCardId);
                            const handCard = hand.find(c => c.id === mobileActionCardId);
                            const cardData = obj?.cardData || handCard;
                            if (!cardData) return null;

                            return (
                                <>
                                    <div className="flex flex-col items-center gap-1 mb-1">
                                        <img src={cardData.imageUrl} className="w-12 h-16 md:w-16 md:h-24 rounded object-cover border border-gray-600 shadow-lg" />
                                        <div className="text-[8px] md:text-[10px] text-gray-300 font-bold text-center max-w-[60px] leading-tight line-clamp-2">{cardData.name}</div>
                                    </div>

                                    <div className="flex flex-col gap-2">
                                        <button onClick={() => { setInspectCard(cardData); setMobileActionCardId(null); }} className="flex flex-col items-center gap-1 p-2 bg-gray-800/80 rounded-xl active:bg-blue-600">
                                            <ZoomIn size={24} className="text-white" />
                                            <span className="text-[10px] text-gray-300">Inspect</span>
                                        </button>

                                        {obj && (
                                            <>
                                                <button onClick={() => { updateBoardObject(obj.id, { rotation: obj.rotation === 0 ? 90 : 0 }); }} className="flex flex-col items-center gap-1 p-2 bg-gray-800/80 rounded-xl active:bg-blue-600">
                                                    <RefreshCw size={24} className="text-white" />
                                                    <span className="text-[10px] text-gray-300">Tap</span>
                                                </button>

                                                <div className="flex flex-col items-center gap-1 p-1 bg-gray-800/80 rounded-xl border border-gray-700/50">
                                                    <span className="text-[8px] text-gray-400 font-bold uppercase">Count</span>
                                                    <div className="flex flex-col items-center gap-1">
                                                        <button onClick={() => { updateBoardObject(obj.id, { counters: { ...obj.counters, "+1/+1": (obj.counters["+1/+1"] || 0) + 1 } }); }} className="p-1 bg-green-900/50 rounded text-green-200 active:bg-green-700"><Plus size={14} /></button>
                                                        <span className="text-white font-bold text-xs">{obj.counters["+1/+1"] || 0}</span>
                                                        <button onClick={() => { updateBoardObject(obj.id, { counters: { ...obj.counters, "+1/+1": (obj.counters["+1/+1"] || 0) - 1 } }); }} className="p-1 bg-red-900/50 rounded text-red-200 active:bg-red-700"><Minus size={14} /></button>
                                                    </div>
                                                </div>

                                                <button onClick={() => { returnToHand(obj.id); setMobileActionCardId(null); }} className="flex flex-col items-center gap-1 p-2 bg-gray-800/80 rounded-xl active:bg-blue-600">
                                                    <Hand size={24} className="text-blue-300" />
                                                    <span className="text-[10px] text-gray-300">Hand</span>
                                                </button>
                                                <button onClick={() => { updateBoardObject(obj.id, { isFaceDown: !obj.isFaceDown }); setMobileActionCardId(null); }} className="flex flex-col items-center gap-1 p-2 bg-gray-800/80 rounded-xl active:bg-blue-600">
                                                    <Eye size={24} className="text-purple-300" />
                                                    <span className="text-[10px] text-gray-300">Flip</span>
                                                </button>
                                                {obj.quantity > 1 && <button onClick={() => { unstackCards(obj.id); setMobileActionCardId(null); }} className="flex flex-col items-center gap-1 p-2 bg-gray-800/80 rounded-xl active:bg-blue-600"><Layers size={24} className="text-white" /><span className="text-[10px] text-gray-300">Unstack</span></button>}
                                                <button onClick={() => { sendToZone(cardData, 'GRAVEYARD'); emitAction('REMOVE_OBJECT', { id: obj.id }); setBoardObjects(prev => prev.filter(o => o.id !== obj.id)); setMobileActionCardId(null); }} className="flex flex-col items-center gap-1 p-2 bg-gray-800/80 rounded-xl active:bg-red-900/50">
                                                    <Archive size={24} className="text-red-400" />
                                                    <span className="text-[10px] text-gray-300">Grave</span>
                                                </button>
                                                <button onClick={() => { sendToZone(cardData, 'EXILE'); emitAction('REMOVE_OBJECT', { id: obj.id }); setBoardObjects(prev => prev.filter(o => o.id !== obj.id)); setMobileActionCardId(null); }} className="flex flex-col items-center gap-1 p-2 bg-gray-800/80 rounded-xl active:bg-red-900/50">
                                                    <X size={24} className="text-red-400" />
                                                    <span className="text-[10px] text-gray-300">Exile</span>
                                                </button>
                                            </>
                                        )}

                                        {handCard && (
                                            <>
                                                <button onClick={() => { playCardFromHand(handCard); setMobileActionCardId(null); }} className="flex flex-col items-center gap-1 p-2 bg-gray-800/80 rounded-xl active:bg-blue-600">
                                                    <Play size={24} className="text-green-400" />
                                                    <span className="text-[10px] text-gray-300">Play</span>
                                                </button>
                                                <button onClick={() => { sendToZone(handCard, 'GRAVEYARD'); setMobileActionCardId(null); }} className="flex flex-col items-center gap-1 p-2 bg-gray-800/80 rounded-xl active:bg-red-900/50">
                                                    <Archive size={24} className="text-red-400" />
                                                    <span className="text-[10px] text-gray-300">Discard</span>
                                                </button>
                                                <button onClick={() => { sendToZone(handCard, 'EXILE'); setMobileActionCardId(null); }} className="flex flex-col items-center gap-1 p-2 bg-gray-800/80 rounded-xl active:bg-red-900/50">
                                                    <X size={24} className="text-red-400" />
                                                    <span className="text-[10px] text-gray-300">Exile</span>
                                                </button>
                                            </>
                                        )}
                                    </div>
                                </>
                            );
                        })()}
                    </div>
                </div>
            )}

            <GameStatsModal
                isOpen={showStatsModal}
                onClose={() => setShowStatsModal(false)}
                stats={gameStats}
                players={playersList}
            />

            <PlayerManagerModal
                isOpen={showPlayerManager}
                onClose={() => setShowPlayerManager(false)}
                players={playersList}
                onKick={handleKickPlayer}
                onReorder={handleReorderPlayers}
                onAssignState={handleAssignState}
                onResetGame={handleRestartGame}
                onRestoreBackup={restoreGameFromBackup}
            />


            <DamageReportModal
                isOpen={showDamageReportModal}
                onClose={() => setShowDamageReportModal(false)}
                players={playersList.filter(p => p.id !== socket.id)}
                damage={damageReportData.damage}
                healing={damageReportData.healing}
                onConfirm={handleDamageReport}
            />

            {revealedCards.length > 0 && (
                <div className="fixed inset-0 z-[11000] bg-black/80 backdrop-blur-sm flex items-center justify-center p-8 animate-in fade-in">
                    <div className="bg-gray-800 border border-gray-600 rounded-xl p-6 shadow-2xl max-w-5xl w-full flex flex-col items-center max-h-[90vh]">
                        <h3 className="text-2xl font-bold text-white mb-6">Revealed Cards</h3>
                        <div className="flex flex-wrap gap-6 justify-center overflow-y-auto p-2 w-full custom-scrollbar">
                            {revealedCards.map((card, idx) => (
                                <div key={idx} className="w-48 aspect-[2.5/3.5] relative flex-shrink-0">
                                    <img src={card.imageUrl} className="w-full h-full object-cover rounded-xl shadow-lg border border-gray-700" alt={card.name} />
                                    <div className="text-center mt-2 text-sm font-bold text-gray-300">{card.name}</div>
                                </div>
                            ))}
                        </div>
                        <button onClick={() => setRevealedCards([])} className="mt-6 px-8 py-3 bg-blue-600 hover:bg-blue-500 text-white rounded-lg font-bold shadow-lg transition-transform active:scale-95">
                            Close
                        </button>
                    </div>
                </div>
            )}

            {showCmdrDamage && (
                <div className="fixed inset-0 z-[10000] bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
                    <div className="bg-gray-900 border border-red-900/50 rounded-xl w-full max-w-lg shadow-2xl overflow-hidden animate-in zoom-in-95">
                        <div className="bg-red-900/20 p-4 border-b border-red-900/30 flex justify-between items-center">
                            <h3 className="font-bold text-red-100 flex items-center gap-2"><Swords className="text-red-500" /> Incoming Commander Damage</h3>
                            <button onClick={() => setShowCmdrDamage(false)} className="hover:text-white text-gray-400"><X /></button>
                        </div>
                        <div className="p-6 grid gap-4 max-h-[60vh] overflow-y-auto">
                            <p className="text-gray-400 text-xs italic text-center mb-2">Track damage YOU have taken from Opponent Commanders.</p>
                            {playersList.filter(p => p.id !== socket.id).map(p => {
                                const oppCommanderId = `cmd-${p.id}`;
                                const currentDmg = (commanderDamage[oppCommanderId] || {})[socket.id] || 0;
                                return (
                                    <div key={p.id} className="flex items-center justify-between bg-gray-800 p-3 rounded border border-gray-700">
                                        <div className="flex items-center gap-3">
                                            <div className="w-8 h-8 rounded-full border-2 border-white/20" style={{ backgroundColor: p.color }} />
                                            <div>
                                                <div className="font-bold text-gray-300">{p.name}</div>
                                                <div className="text-[10px] text-gray-500 uppercase">Damage Source</div>
                                            </div>
                                        </div>
                                        <div className="flex items-center gap-3">
                                            <button onClick={() => updateCommanderDamage(oppCommanderId, socket.id, -1)} className="w-8 h-8 rounded bg-gray-700 hover:bg-gray-600 flex items-center justify-center text-red-400"><Minus size={16} /></button>
                                            <span className={`text-xl font-bold w-8 text-center ${currentDmg >= 21 ? 'text-red-500' : 'text-white'}`}>{currentDmg}</span>
                                            <button onClick={() => updateCommanderDamage(oppCommanderId, socket.id, 1)} className="w-8 h-8 rounded bg-gray-700 hover:bg-gray-600 flex items-center justify-center text-green-400"><Plus size={16} /></button>
                                        </div>
                                    </div>
                                )
                            })}
                            {playersList.filter(p => p.id !== socket.id).length === 0 && <div className="text-center text-gray-500">No opponents found.</div>}
                        </div>
                    </div>
                </div>
            )}

            {showShortcuts && (
                <div className="fixed inset-0 z-[11000] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4" onClick={() => setShowShortcuts(false)}>
                    <div className="bg-gray-800 border border-gray-600 rounded-xl p-6 shadow-2xl max-w-md w-full animate-in zoom-in-95" onClick={e => e.stopPropagation()}>
                        <div className="flex justify-between items-center mb-6">
                            <h3 className="text-xl font-bold text-white flex items-center gap-2">
                                <Keyboard className="text-blue-400" /> Keyboard Shortcuts
                            </h3>
                            <button onClick={() => setShowShortcuts(false)} className="text-gray-400 hover:text-white"><X size={20} /></button>
                        </div>
                        <div className="grid grid-cols-2 gap-4 text-sm">
                            <div className="flex justify-between items-center p-2 bg-gray-700/50 rounded"><span className="text-gray-300">Draw Card</span><kbd className="bg-black/50 px-2 py-1 rounded text-white font-mono border border-gray-600">D</kbd></div>
                            <div className="flex justify-between items-center p-2 bg-gray-700/50 rounded"><span className="text-gray-300">Untap All</span><kbd className="bg-black/50 px-2 py-1 rounded text-white font-mono border border-gray-600">U</kbd></div>
                            <div className="flex justify-between items-center p-2 bg-gray-700/50 rounded"><span className="text-gray-300">Shuffle Library</span><kbd className="bg-black/50 px-2 py-1 rounded text-white font-mono border border-gray-600">S</kbd></div>
                            <div className="flex justify-between items-center p-2 bg-gray-700/50 rounded"><span className="text-gray-300">Toggle Log</span><kbd className="bg-black/50 px-2 py-1 rounded text-white font-mono border border-gray-600">L</kbd></div>
                            <div className="flex justify-between items-center p-2 bg-gray-700/50 rounded"><span className="text-gray-300">Help / Shortcuts</span><kbd className="bg-black/50 px-2 py-1 rounded text-white font-mono border border-gray-600">?</kbd></div>
                            <div className="flex justify-between items-center p-2 bg-gray-700/50 rounded col-span-2"><span className="text-gray-300">Pan Camera</span><kbd className="bg-black/50 px-2 py-1 rounded text-white font-mono border border-gray-600">Space (Hold) + Drag</kbd></div>
                            <div className="flex justify-between items-center p-2 bg-gray-700/50 rounded col-span-2"><span className="text-gray-300">Zoom Camera</span><kbd className="bg-black/50 px-2 py-1 rounded text-white font-mono border border-gray-600">Mouse Wheel</kbd></div>

                            <div className="flex justify-between items-center p-2 bg-gray-700/50 rounded"><span className="text-gray-300">Play Commander</span><kbd className="bg-black/50 px-2 py-1 rounded text-white font-mono border border-gray-600">C</kbd></div>
                            <div className="flex justify-between items-center p-2 bg-gray-700/50 rounded"><span className="text-gray-300">Open Library</span><kbd className="bg-black/50 px-2 py-1 rounded text-white font-mono border border-gray-600">X</kbd></div>
                            <div className="flex justify-between items-center p-2 bg-gray-700/50 rounded"><span className="text-gray-300">Open Graveyard</span><kbd className="bg-black/50 px-2 py-1 rounded text-white font-mono border border-gray-600">G</kbd></div>
                            <div className="flex justify-between items-center p-2 bg-gray-700/50 rounded"><span className="text-gray-300">Open Exile</span><kbd className="bg-black/50 px-2 py-1 rounded text-white font-mono border border-gray-600">E</kbd></div>
                            <div className="flex justify-between items-center p-2 bg-gray-700/50 rounded"><span className="text-gray-300">Token Search</span><kbd className="bg-black/50 px-2 py-1 rounded text-white font-mono border border-gray-600">T</kbd></div>
                            <div className="flex justify-between items-center p-2 bg-gray-700/50 rounded"><span className="text-gray-300">Toggle Tokens</span><kbd className="bg-black/50 px-2 py-1 rounded text-white font-mono border border-gray-600">L-Alt</kbd></div>
                            <div className="flex justify-between items-center p-2 bg-gray-700/50 rounded"><span className="text-gray-300">Roll Die</span><kbd className="bg-black/50 px-2 py-1 rounded text-white font-mono border border-gray-600">R</kbd></div>
                            <div className="flex justify-between items-center p-2 bg-gray-700/50 rounded"><span className="text-gray-300">Create Counter</span><kbd className="bg-black/50 px-2 py-1 rounded text-white font-mono border border-gray-600">F</kbd></div>
                            <div className="flex justify-between items-center p-2 bg-gray-700/50 rounded"><span className="text-gray-300">Pass Turn</span><kbd className="bg-black/50 px-2 py-1 rounded text-white font-mono border border-gray-600">Enter</kbd></div>
                            <div className="flex justify-between items-center p-2 bg-gray-700/50 rounded"><span className="text-gray-300">Life +/-</span><kbd className="bg-black/50 px-2 py-1 rounded text-white font-mono border border-gray-600">↑ / ↓</kbd></div>
                            <div className="flex justify-between items-center p-2 bg-gray-700/50 rounded"><span className="text-gray-300">Stats</span><kbd className="bg-black/50 px-2 py-1 rounded text-white font-mono border border-gray-600">Q</kbd></div>
                            <div className="flex justify-between items-center p-2 bg-gray-700/50 rounded"><span className="text-gray-300">Cmdr Damage</span><kbd className="bg-black/50 px-2 py-1 rounded text-white font-mono border border-gray-600">W</kbd></div>
                            <div className="flex justify-between items-center p-2 bg-gray-700/50 rounded"><span className="text-gray-300">Opponent View</span><kbd className="bg-black/50 px-2 py-1 rounded text-white font-mono border border-gray-600">V</kbd></div>
                            <div className="flex justify-between items-center p-2 bg-gray-700/50 rounded"><span className="text-gray-300">Switch Opponent</span><kbd className="bg-black/50 px-2 py-1 rounded text-white font-mono border border-gray-600">← / →</kbd></div>
                            <div className="flex justify-between items-center p-2 bg-gray-700/50 rounded col-span-2"><span className="text-gray-300">Play Hand Card</span><kbd className="bg-black/50 px-2 py-1 rounded text-white font-mono border border-gray-600">1 - 0</kbd></div>
                            <div className="col-span-2 pt-2 border-t border-gray-700 mt-1 text-xs text-gray-500 font-bold uppercase">Mana & Undo</div>
                            <div className="flex justify-between items-center p-2 bg-blue-900/30 rounded border border-blue-800/30"><span className="text-gray-300">Mana Panel</span><kbd className="bg-black/50 px-2 py-1 rounded text-white font-mono border border-gray-600">M</kbd></div>
                            <div className="flex justify-between items-center p-2 bg-yellow-900/30 rounded border border-yellow-800/30"><span className="text-gray-300">Auto-Tap</span><kbd className="bg-black/50 px-2 py-1 rounded text-white font-mono border border-gray-600">Tab</kbd></div>
                            <div className="flex justify-between items-center p-2 bg-amber-900/30 rounded border border-amber-800/30 col-span-2"><span className="text-gray-300">Undo Last Action</span><kbd className="bg-black/50 px-2 py-1 rounded text-white font-mono border border-gray-600">Ctrl+Z</kbd></div>
                        </div>
                    </div>
                </div>
            )}

            {/* View Request Modal */}
            {incomingViewRequest && (
                <div className="fixed inset-0 z-[10000] bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in">
                    <div className="bg-gray-800 border border-gray-600 rounded-xl p-6 shadow-2xl max-w-md w-full text-center">
                        <h3 className="text-xl font-bold text-white mb-2">View Request</h3>
                        <p className="text-gray-300 mb-6"><span className="font-bold text-blue-400">{incomingViewRequest.requesterName}</span> wants to look through your <span className="font-bold text-yellow-400">{incomingViewRequest.zone}</span>.</p>
                        <div className="flex gap-4 justify-center">
                            <button onClick={() => resolveViewRequest(false)} className="px-6 py-2 bg-red-600 hover:bg-red-500 text-white rounded-lg font-bold">Deny</button>
                            <button onClick={() => resolveViewRequest(true)} className="px-6 py-2 bg-green-600 hover:bg-green-500 text-white rounded-lg font-bold">Allow</button>
                        </div>
                    </div>
                </div>
            )}

            {/* Join Request Modal */}
            {incomingJoinRequest && (
                <div className="fixed inset-0 z-[10000] bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in">
                    <div className="bg-gray-800 border border-gray-600 rounded-xl p-6 shadow-2xl max-w-md w-full text-center">
                        <h3 className="text-xl font-bold text-white mb-2">Player Joining</h3>
                        <p className="text-gray-300 mb-6">
                            <span className="font-bold text-blue-400">{incomingJoinRequest.name}</span> wants to join the game.
                            <br /><span className="text-xs text-gray-500">Color: {incomingJoinRequest.color}</span>
                        </p>
                        <div className="flex gap-4 justify-center">
                            <button onClick={() => resolveJoinRequest(false)} className="px-6 py-2 bg-red-600 hover:bg-red-500 text-white rounded-lg font-bold">Deny</button>
                            <button onClick={() => resolveJoinRequest(true)} className="px-6 py-2 bg-green-600 hover:bg-green-500 text-white rounded-lg font-bold">Allow</button>
                        </div>
                    </div>
                </div>
            )}

            {libraryAction.isOpen && (
                <div className="fixed inset-0 z-[10000] bg-black/50 backdrop-blur-sm flex items-center justify-center">
                    <div className="bg-gray-800 border border-gray-600 rounded-xl p-6 shadow-2xl max-w-sm w-full">
                        <h3 className="text-xl font-bold text-white mb-4">Move to Library</h3>
                        <p className="text-gray-400 mb-6">Where should this card go?</p>
                        <div className="flex flex-col gap-3">
                            <button onClick={() => resolveLibraryAction('TOP')} className="flex items-center gap-3 bg-blue-600 hover:bg-blue-700 text-white p-3 rounded-lg"><ArrowUp /> Top of Library</button>
                            <button onClick={() => resolveLibraryAction('BOTTOM')} className="flex items-center gap-3 bg-gray-700 hover:bg-gray-600 text-white p-3 rounded-lg"><ArrowDown /> Bottom of Library</button>
                            <button onClick={() => resolveLibraryAction('SHUFFLE')} className="flex items-center gap-3 bg-purple-600 hover:bg-purple-700 text-white p-3 rounded-lg"><Shuffle /> Shuffle In</button>
                        </div>
                        <button onClick={() => setLibraryAction({ isOpen: false, cardId: '' })} className="mt-4 w-full text-center text-gray-500 hover:text-white">Cancel</button>
                    </div>
                </div>
            )}

            {inspectCard && (
                <div
                    className="fixed inset-0 z-[14000] flex items-center justify-center bg-black/80 backdrop-blur-sm p-8 animate-in fade-in duration-200"
                    onClick={() => setInspectCard(null)}
                >
                    <div className="relative flex flex-col items-center">
                        <img
                            src={inspectCard.imageUrl || "https://i.imgur.com/32R3w2i.png"}
                            className="max-h-[80vh] rounded-xl shadow-2xl"
                            alt="Preview"
                        />
                        <button className="mt-4 bg-red-600 text-white px-6 py-2 rounded-full font-semibold hover:bg-red-500" onClick={() => setInspectCard(null)}>Close</button>
                    </div>
                </div>
            )}

            {searchModal.isOpen && (
                <div
                    className={`fixed z-[13000] bg-gray-900/95 backdrop-blur-xl flex flex-col animate-in fade-in ${isMobile ? 'p-0' : 'p-8'}`}
                    style={getModalStyle(searchModal.playerId)}
                >
                    {(() => {
                        const activeId = isLocal ? playersList[mySeatIndex]?.id : socket.id;
                        const searchTargetId = searchModal.playerId || activeId;
                        const searchTargetPlayer = playersList.find(p => p.id === searchTargetId);
                        const displaySleeveColor = searchTargetPlayer ? searchTargetPlayer.color : sleeveColor;
                        const isLandscapeMobile = isMobile && window.innerWidth > window.innerHeight;

                        const Header = (
                            <div className={`flex justify-between items-center border-b border-gray-700 bg-gray-900/95 z-10 shrink-0 ${isMobile ? 'p-2' : 'mb-6 pb-4'}`}>
                                <div className="flex items-center gap-4">
                                    {!isMobile && <Search className="text-blue-400" size={32} />}
                                    <div className="flex-1 min-w-0">
                                        <h2 className={`${isMobile ? 'text-xl' : 'text-3xl'} font-bold text-white capitalize flex items-center gap-3`}>
                                            {searchModal.source === 'TOKENS' ? 'Search Tokens' : searchModal.source.toLowerCase()}
                                            {searchModal.source !== 'TOKENS' && <span className="text-gray-500 text-lg">({searchModal.items.length} cards)</span>}
                                        </h2>
                                        {searchModal.source === 'TOKENS' && (
                                            <div className="flex gap-2 mt-2">
                                                <input
                                                    className="bg-gray-800 border border-gray-600 rounded px-3 py-1 text-white w-full"
                                                    placeholder="e.g. Goblin, Treasure"
                                                    value={tokenSearchTerm}
                                                    onChange={(e) => setTokenSearchTerm(e.target.value)}
                                                    onKeyDown={(e) => e.key === 'Enter' && searchTokens()}
                                                />
                                                <button onClick={searchTokens} className="bg-blue-600 px-3 py-1 rounded text-white whitespace-nowrap">Search</button>
                                            </div>
                                        )}
                                    </div>
                                </div>

                                <div className="flex items-center gap-4">
                                    {searchModal.source === 'LIBRARY' && (
                                        <>
                                            <button onClick={revealAll} className={`flex items-center gap-2 ${isMobile ? 'p-2' : 'px-4 py-2'} bg-gray-700 hover:bg-gray-600 rounded-lg text-white transition`}>
                                                <Eye size={16} /> {!isMobile && 'Reveal All'}
                                            </button>
                                            <button onClick={shuffleAndClose} className={`flex items-center gap-2 ${isMobile ? 'p-2' : 'px-4 py-2'} bg-purple-600 hover:bg-purple-500 rounded-lg text-white transition shadow-lg shadow-purple-900/50`}>
                                                <Shuffle size={16} /> {!isMobile && 'Shuffle & Close'}
                                            </button>
                                        </>
                                    )}
                                    <button onClick={() => setSearchModal({ ...searchModal, isOpen: false })} className="p-2 hover:bg-gray-800 rounded-full text-gray-400 hover:text-white"><X size={32} /></button>
                                </div>
                            </div>
                        );

                        const Grid = (
                            <div className={`flex-1 overflow-y-auto custom-scrollbar ${isMobile ? 'p-2' : 'pr-2 pb-60'}`}>
                                <div className={`grid ${isMobile ? 'grid-cols-4 gap-2' : 'grid-cols-2 md:grid-cols-4 lg:grid-cols-6 xl:grid-cols-8 gap-4'}`}>
                                    {searchModal.items.map((item, idx) => (
                                        <div key={item.card.id} className="relative group aspect-[2.5/3.5] bg-gray-800 rounded-lg">
                                            {searchModal.source !== 'TOKENS' && (
                                                <div className="absolute top-2 left-2 z-10 bg-black/70 text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full border border-white/20">
                                                    #{idx + 1}
                                                </div>
                                            )}

                                            {item.isRevealed ? (
                                                <img src={item.card.imageUrl} className="w-full h-full object-cover rounded-lg border border-gray-700 group-hover:border-blue-500 transition-colors" alt={item.card.name} />
                                            ) : (
                                                <div
                                                    className="w-full h-full rounded-lg border-2 border-white/10 flex items-center justify-center cursor-pointer hover:border-blue-400 transition"
                                                    style={{ backgroundColor: displaySleeveColor }}
                                                    onClick={() => isMobile ? toggleRevealItem(idx) : toggleRevealItem(idx)}
                                                >
                                                    <div className="w-10 h-10 rounded-full bg-black/20" />
                                                </div>
                                            )}

                                            {/* Mobile Interaction Layer */}
                                            {isMobile ? (
                                                <div
                                                    className="absolute inset-0 z-20"
                                                    onClick={() => {
                                                        if (!item.isRevealed) toggleRevealItem(idx);
                                                        else setInspectCard(item.card);
                                                    }}
                                                    onContextMenu={(e) => {
                                                        e.preventDefault();
                                                        if (!searchModal.isReadOnly && searchModal.source !== 'TOKENS') addToTray(item.card.id);
                                                    }}
                                                />
                                            ) : (
                                                <div className={`absolute inset-0 bg-black/80 opacity-0 group-hover:opacity-100 transition-opacity flex flex-col justify-center items-center gap-2 p-2 rounded-lg ${!item.isRevealed && 'pointer-events-none'}`}>
                                                    {item.isRevealed ? (
                                                        <>
                                                            <div className="text-xs text-gray-300 font-semibold mb-1 text-center line-clamp-1">{item.card.name}</div>
                                                            {!searchModal.isReadOnly && (
                                                                searchModal.source === 'TOKENS' ? (
                                                                    <button onClick={() => handleSearchAction(item.card.id, 'HAND')} className="w-full text-xs flex items-center gap-2 bg-blue-700 hover:bg-blue-600 px-2 py-1.5 rounded"><Hand size={12} /> Add to Hand</button>
                                                                ) : (
                                                                    <button onClick={() => addToTray(item.card.id)} className="w-full text-xs flex items-center gap-2 bg-green-700 hover:bg-green-600 px-2 py-1.5 rounded"><ArrowDown size={12} /> Add to Tray</button>
                                                                )
                                                            )}
                                                        </>
                                                    ) : (
                                                        <div className="text-white text-xs font-bold pointer-events-auto">Click to Reveal</div>
                                                    )}
                                                </div>
                                            )}
                                        </div>
                                    ))}
                                </div>
                            </div>
                        );

                        const Tray = searchModal.source !== 'TOKENS' && !searchModal.isReadOnly ? (
                            <div className={`${isLandscapeMobile ? 'w-1/2 border-l h-full' : 'border-t w-full'} bg-gray-900 border-gray-700 ${isMobile ? (isLandscapeMobile ? 'p-2' : 'p-2 h-72') : 'absolute bottom-0 left-0 right-0 p-4 h-80'} flex flex-col shadow-2xl z-20 shrink-0`}>
                                <div className="flex flex-col md:flex-row justify-between items-center mb-2 gap-2">
                                    <h3 className="text-sm font-bold text-gray-300 uppercase tracking-wide flex items-center gap-2">
                                        <Layers size={14} /> Selected Cards Tray ({searchModal.tray.length})
                                    </h3>
                                    <div className="flex gap-2 flex-wrap justify-center">
                                        <button onClick={() => handleTrayAction('HAND')} disabled={searchModal.tray.length === 0} className="px-3 py-1 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 rounded text-xs text-white font-bold flex items-center gap-1"><Hand size={12} /> Hand</button>
                                        <button onClick={() => handleTrayAction('HAND_REVEAL')} disabled={searchModal.tray.length === 0} className="px-3 py-1 bg-cyan-600 hover:bg-cyan-500 disabled:opacity-50 rounded text-xs text-white font-bold flex items-center gap-1"><Eye size={12} /> Hand & Reveal</button>
                                        <button onClick={() => handleTrayAction('GRAVEYARD')} disabled={searchModal.tray.length === 0} className="px-3 py-1 bg-gray-700 hover:bg-gray-600 disabled:opacity-50 rounded text-xs text-white font-bold flex items-center gap-1"><Archive size={12} /> Grave</button>
                                        {!isMobile && <button onClick={() => handleTrayAction('EXILE')} disabled={searchModal.tray.length === 0} className="px-3 py-1 bg-gray-700 hover:bg-gray-600 disabled:opacity-50 rounded text-xs text-white font-bold flex items-center gap-1"><X size={12} /> Exile</button>}
                                        <div className="w-px h-6 bg-gray-700 mx-2" />
                                        <button onClick={() => handleTrayAction('TOP')} disabled={searchModal.tray.length === 0} className="px-3 py-1 bg-purple-600 hover:bg-purple-500 disabled:opacity-50 rounded text-xs text-white font-bold flex items-center gap-1"><ArrowUp size={12} /> Top Lib</button>
                                        <button onClick={() => handleTrayAction('BOTTOM')} disabled={searchModal.tray.length === 0} className="px-3 py-1 bg-purple-600 hover:bg-purple-500 disabled:opacity-50 rounded text-xs text-white font-bold flex items-center gap-1"><ArrowDown size={12} /> Bot Lib</button>
                                        <button onClick={() => handleTrayAction('SHUFFLE')} disabled={searchModal.tray.length === 0} className="px-3 py-1 bg-green-600 hover:bg-green-500 disabled:opacity-50 rounded text-xs text-white font-bold flex items-center gap-1"><Shuffle size={12} /> Shuffle In</button>
                                        {isMobile && <button onClick={() => setSearchModal({ ...searchModal, isOpen: false })} className="px-3 py-1 bg-red-900/50 text-red-200 rounded text-xs font-bold">Close</button>}
                                    </div>
                                </div>

                                <div className={`flex-1 bg-gray-800/50 rounded-lg border-2 border-dashed border-gray-700 flex items-center px-4 overflow-x-auto gap-4 ${isLandscapeMobile ? 'flex-wrap content-start overflow-y-auto p-2' : ''}`}>
                                    {searchModal.tray.length === 0 ? (
                                        <div className="text-gray-500 text-sm italic w-full text-center">Add cards from above to perform actions on them. Left is Top, Right is Bottom.</div>
                                    ) : (
                                        searchModal.tray.map((card, idx) => (
                                            <div
                                                key={card.id}
                                                className="relative flex-shrink-0 group w-24 aspect-[2.5/3.5] bg-gray-800 rounded"
                                                onDoubleClick={() => isMobile && removeFromTray(card.id)}
                                            >
                                                <img src={card.imageUrl} className="w-full h-full object-cover rounded" />
                                                <div className={`absolute inset-0 bg-black/60 opacity-0 ${!isMobile ? 'group-hover:opacity-100' : ''} flex flex-col justify-between p-1 transition-opacity`}>
                                                    <div className="flex justify-end">
                                                        <button onClick={() => removeFromTray(card.id)} className="bg-red-500 hover:bg-red-400 p-1 rounded-full text-white"><X size={10} /></button>
                                                    </div>
                                                    <div className="flex justify-between mt-auto">
                                                        <button onClick={() => onTrayReorder(idx, 'LEFT')} disabled={idx === 0} className="bg-gray-700 hover:bg-gray-600 disabled:opacity-30 p-1 rounded text-white"><ChevronLeft size={12} /></button>
                                                        <button onClick={() => onTrayReorder(idx, 'RIGHT')} disabled={idx === searchModal.tray.length - 1} className="bg-gray-700 hover:bg-gray-600 disabled:opacity-30 p-1 rounded text-white"><ChevronRight size={12} /></button>
                                                    </div>
                                                </div>
                                                <div className="absolute -top-2 -left-2 bg-blue-600 text-white text-[10px] font-bold w-5 h-5 flex items-center justify-center rounded-full border border-gray-900 z-10">
                                                    {idx + 1}
                                                </div>
                                            </div>
                                        ))
                                    )}
                                </div>
                            </div>
                        ) : null;

                        if (isLandscapeMobile) {
                            return (
                                <div className="flex flex-row h-full">
                                    <div className="flex flex-col w-1/2 h-full">
                                        {Header}
                                        {Grid}
                                    </div>
                                    {Tray}
                                </div>
                            );
                        }

                        return (
                            <div className="flex flex-col h-full">
                                {Header}
                                <div className="flex-1 flex flex-col overflow-hidden">
                                    {Grid}
                                </div>
                                {Tray}
                            </div>
                        );
                    })()}
                </div>
            )}
            {isLogOpen && (
                <div className="fixed top-16 right-0 bottom-0 w-80 bg-gray-900/95 backdrop-blur border-l border-gray-700 z-[8000] flex flex-col">
                    <div className="p-4 border-b border-gray-700 flex justify-between items-center">
                        <h3 className="font-bold text-gray-200">Game Log</h3>
                        <button onClick={() => setIsLogOpen(false)} className="text-gray-400 hover:text-white"><X size={16} /></button>
                    </div>
                    <div className="flex-1 overflow-y-auto p-4 space-y-2">
                        {logs.map(log => (
                            <div key={log.id} className="text-sm text-gray-300">
                                <span className="font-bold text-blue-400">{log.playerName}</span> {log.message}
                                <div className="text-[10px] text-gray-600">{new Date(log.timestamp).toLocaleTimeString()}</div>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            <HealthModal
                isOpen={showHealthModal}
                onClose={() => setShowHealthModal(false)}
                players={playersList}
                life={isLocal ?
                    playersList.reduce((acc, p, i) => ({ ...acc, [p.id]: i === mySeatIndex ? life : (localPlayerStates.current[p.id]?.life || 40) }), {})
                    : { ...opponentsLife, [socket.id]: life }}
                commanderDamage={commanderDamage}
            />

            {isMobile && isFullScreen && window.innerWidth > window.innerHeight && (
                <button
                    onClick={toggleFullScreen}
                    className="fixed bottom-4 right-4 z-[10000] p-3 bg-red-600 text-white rounded-full shadow-lg animate-in fade-in"
                    title="Exit Full Screen"
                >
                    <Minimize size={24} />
                </button>
            )}

            {showSettingsModal && (
                <div className="fixed inset-0 z-[12000] bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in">
                    <div className="bg-gray-800 border border-gray-600 rounded-xl p-6 shadow-2xl max-w-md w-full">
                        <div className="flex justify-between items-center mb-6">
                            <h3 className="text-xl font-bold text-white flex items-center gap-2">
                                <Settings className="text-blue-400" /> Settings
                            </h3>
                            <button onClick={() => setShowSettingsModal(false)} className="text-gray-400 hover:text-white"><X size={20} /></button>
                        </div>
                        <div className="space-y-4">
                            <div className="bg-gray-700/50 p-4 rounded-lg border border-gray-600">
                                <label className="flex justify-between items-center cursor-pointer">
                                    <div>
                                        <h4 className="font-bold text-white">Force Mobile Controls</h4>
                                        <p className="text-xs text-gray-400">Enable touch-friendly controls on desktop. May require refresh.</p>
                                    </div>
                                    <div
                                        onClick={() => setControlMode(prev => prev === 'auto' ? 'mobile' : 'auto')}
                                        className={`w-14 h-8 rounded-full p-1 flex items-center transition-colors ${controlMode === 'mobile' ? 'bg-blue-600 justify-end' : 'bg-gray-600 justify-start'}`}
                                    >
                                        <div className="w-6 h-6 bg-white rounded-full shadow-md transform transition-transform" />
                                    </div>
                                </label>
                            </div>

                            <div className="bg-gray-700/50 p-4 rounded-lg border border-gray-600">
                                <label className="flex justify-between items-center cursor-pointer">
                                    <div>
                                        <h4 className="font-bold text-white flex items-center gap-2"><Zap size={16} className="text-yellow-400" /> Auto-Tap Mana</h4>
                                        <p className="text-xs text-gray-400">Press Tab after playing a card to auto-tap lands/mana sources. Basics first.</p>
                                    </div>
                                    <div
                                        onClick={() => setAutoTapEnabled(prev => !prev)}
                                        className={`w-14 h-8 rounded-full p-1 flex items-center transition-colors ${autoTapEnabled ? 'bg-yellow-500 justify-end' : 'bg-gray-600 justify-start'}`}
                                    >
                                        <div className="w-6 h-6 bg-white rounded-full shadow-md transform transition-transform" />
                                    </div>
                                </label>
                            </div>

                            <button
                                onClick={() => { setShowShortcuts(true); setShowSettingsModal(false); }}
                                className="w-full bg-gray-700/50 hover:bg-gray-700 p-4 rounded-lg border border-gray-600 flex justify-between items-center transition-colors group"
                            >
                                <div className="flex flex-col items-start">
                                    <h4 className="font-bold text-white flex items-center gap-2"><Keyboard size={16} className="text-blue-400" /> Keyboard Shortcuts</h4>
                                    <p className="text-xs text-gray-400 group-hover:text-gray-300">View all available hotkeys</p>
                                </div>
                                <ChevronRight className="text-gray-500 group-hover:text-white" size={20} />
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {isMobile && isFullScreen && window.innerWidth > window.innerHeight && (
                <button
                    onClick={toggleFullScreen}
                    className="fixed bottom-4 right-4 z-[10000] p-3 bg-red-600 text-white rounded-full shadow-lg animate-in fade-in"
                    title="Exit Full Screen"
                >
                    <Minimize size={24} />
                </button>
            )}
        </div>
    );
};
