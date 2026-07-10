import React, { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { CardData, BoardObject, LogEntry, PlayerStats } from '../types';
import { Card } from './Card';
import { GameStatsModal } from './GameStatsModal';
import { searchCards, fetchPrints } from '../services/scryfall';
import { socket } from '../services/socket';
import { CARD_WIDTH, CARD_HEIGHT } from '../constants';
import { PLAYER_COLORS } from '../constants';
export type UndoableAction =
    | { type: 'TAP_CARD'; objectId: string; previousRotation: number; previousTappedQuantity: number }
    | { type: 'UNTAP_ALL'; objects: { id: string; previousRotation: number; previousTappedQuantity: number }[] }
    | { type: 'PLAY_CARD'; objectId: string; card: CardData; fromZone: 'HAND' | 'COMMAND' };
export const MAX_UNDO_HISTORY = 10;
import { aiStatus, requestTurn, continueTurn, requestMulligan } from '../services/ai';
import { buildGameStateView, deckToSummaryCards, deckStrategySummary } from '../services/aiState';
import { getVoiceBackend, voiceInputSupported, requestVoiceReply } from '../services/voice';
import { playSound, isSoundMuted, setSoundMuted } from '../services/sounds';
import { RealtimeVoiceSession, requestConsult } from '../services/voiceRealtime';
import type { AiToolCall, AiToolResult, AiPersonaId, AiDifficulty, AiProviderId, VoiceChatTurn, VoiceBackendId } from '../services/aiTypes';
import {
    LogOut, Search, ZoomIn, ZoomOut, History, ArrowUp, ArrowDown, GripVertical, Palette, Menu, Maximize, Minimize,
    Archive, X, Eye, Shuffle, Crown, Dices, Layers, ChevronRight, Hand, Play, Settings, Swords, Shield,
    Clock, Users, CheckCircle, Ban, ArrowRight, Disc, ChevronLeft, Trash2, ArrowLeft, Minus, Plus, Keyboard, RefreshCw, Loader, RotateCcw, BarChart3, ChevronUp, ChevronDown, Heart, Undo2, Droplets, Zap, Mic, MessageSquare, Volume2, Upload, Copy
} from 'lucide-react';

// Cards that start in the command-zone area rather than the library: commanders
// and companions. Keeping companions in the same commandZone array means every
// existing sync path (backup/restore, snapshots, opponent visibility) carries
// them for free; the render splits them into a separate labeled slot.
const isCmdZoneCard = (c: CardData) => !!c.isCommander || !!c.isCompanion;

// --- Rebindable keyboard actions ---
// Shared definitions live in ../keybindings.ts so LobbySettingsModal can import
// them without creating a circular dependency back to this file.
export { KEY_ACTIONS, KEYBINDINGS_STORAGE, defaultKeyBindings, keyLabel, loadKeyBindings } from '../keybindings';
export type { KeyActionDef } from '../keybindings';
import { KEY_ACTIONS, KEYBINDINGS_STORAGE, defaultKeyBindings, keyLabel, loadKeyBindings } from '../keybindings';

// --- Turn sub-phases ---
// The active player steps through these with Enter (or by tapping the phase
// strip); advancing past END passes the turn. Phase is display/UX only — the app
// is honor-system and does not enforce what you may do in each phase.
export const TURN_PHASES = ['UNTAP', 'UPKEEP', 'DRAW', 'MAIN1', 'COMBAT', 'MAIN2', 'END'] as const;
export type TurnPhase = typeof TURN_PHASES[number];
export const PHASE_LABELS: Record<TurnPhase, string> = {
    UNTAP: 'Untap', UPKEEP: 'Upkeep', DRAW: 'Draw', MAIN1: 'Main 1',
    COMBAT: 'Combat', MAIN2: 'Main 2', END: 'End',
};

// --- Combat ---
// The shared combat state, synced to every client via a COMBAT_UPDATE action.
// Assignments reference board-object ids; the turn player (attackerSeatId) owns
// step transitions, the attacker owns attacker assignments, and each defender
// owns their own blocks.
export type CombatStep = 'attackers' | 'blockers' | 'resolve';
export interface CombatState {
    active: boolean;
    step: CombatStep;
    attackerSeatId: string;
    attackers: { objectId: string; defenderSeatId: string }[];
    blocks: { attackerObjectId: string; blockerObjectId: string }[];
}
const COMBAT_STEP_LABEL: Record<CombatStep, string> = {
    attackers: 'Declare Attackers', blockers: 'Declare Blockers', resolve: 'Resolve',
};
const parsePower = (p?: string): number => { const n = parseInt(p || '0', 10); return isNaN(n) ? 0 : n; };

// --- Table appearance (custom mat / sleeve) ---
export interface ImgTransform { x: number; y: number; scale: number; }
export const DEFAULT_TRANSFORM: ImgTransform = { x: 50, y: 50, scale: 100 };
// Turn an ImgTransform into CSS background props so mats/sleeves position the same
// way everywhere they render.
export const transformToBg = (t?: ImgTransform) => ({
    backgroundPosition: `${t?.x ?? 50}% ${t?.y ?? 50}%`,
    backgroundSize: `${t?.scale ?? 100}%`,
    backgroundRepeat: 'no-repeat' as const,
});

// Downscale an uploaded image to a data URL that stays well under the server's
// per-player state budget (target ≤ ~200KB). Big art should be linked by URL
// instead; this keeps casual uploads (screenshots, photos) from bloating sync.
export const downscaleImage = (file: File, maxDim = 900, targetBytes = 200_000): Promise<string> =>
    new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onerror = () => reject(new Error('Could not read file'));
        reader.onload = () => {
            const img = new Image();
            img.onerror = () => reject(new Error('Could not decode image'));
            img.onload = () => {
                let { width, height } = img;
                const scale = Math.min(1, maxDim / Math.max(width, height));
                width = Math.round(width * scale); height = Math.round(height * scale);
                const canvas = document.createElement('canvas');
                canvas.width = width; canvas.height = height;
                const ctx = canvas.getContext('2d');
                if (!ctx) return reject(new Error('Canvas unsupported'));
                ctx.drawImage(img, 0, 0, width, height);
                // Step JPEG quality down until under the byte budget.
                let quality = 0.85;
                let out = canvas.toDataURL('image/jpeg', quality);
                while (out.length * 0.75 > targetBytes && quality > 0.35) {
                    quality -= 0.1;
                    out = canvas.toDataURL('image/jpeg', quality);
                }
                resolve(out);
            };
            img.src = reader.result as string;
        };
        reader.readAsDataURL(file);
    });

// YIQ luminance test — pick black or white text for legibility on a given hex
// background (used for player-name contrast on custom mats / sleeves).
export const contrastText = (hex: string): string => {
    const h = hex.replace('#', '');
    if (h.length < 6) return '#ffffff';
    const r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16);
    return (r * 299 + g * 587 + b * 114) / 1000 >= 140 ? '#000000' : '#ffffff';
};

interface TabletopProps {
    initialDeck: CardData[];
    initialTokens: CardData[];
    initialSideboard?: CardData[];
    playerName: string;
    sleeveColor?: string;
    roomId: string;
    initialGameStarted?: boolean;
    isLocal?: boolean;
    isLocalTableHost?: boolean;
    localOpponents?: { id?: string, name: string, deck: CardData[], tokens: CardData[], color: string, type?: 'ai' | 'human_local' | 'open_slot', persona?: AiPersonaId, difficulty?: AiDifficulty, provider?: AiProviderId, model?: string }[];
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
    source: 'LIBRARY' | 'GRAVEYARD' | 'EXILE' | 'TOKENS' | 'HAND' | 'SIDEBOARD';
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

const Die: React.FC<{ value: number, sides: number, color: string }> = ({ value, sides, color }) => {
    return (
        <div
            className="flex items-center justify-center w-24 h-24 bg-gray-900 border-[6px] rounded-2xl shadow-[0_0_40px_rgba(0,0,0,0.8)] relative overflow-hidden animate-in zoom-in spin-in duration-500 ease-out"
            style={{ borderColor: color, boxShadow: `0 0 30px ${color}80` }}
        >
            <div className="absolute inset-0 bg-white/10" />
            <span className="text-5xl font-bold text-white drop-shadow-md">{value}</span>
            <span className="absolute bottom-1.5 text-xs text-gray-400 font-bold tracking-widest">D{sides}</span>
        </div>
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
    matUrl?: string;
    sleeveUrl?: string;
    matTransform?: ImgTransform;
    sleeveTransform?: ImgTransform;
    combatTargetId?: string;
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
    matUrl, sleeveUrl, matTransform, sleeveTransform, combatTargetId,
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
            data-combat-target={combatTargetId}
            className={`absolute bg-gray-900/40 rounded-3xl border transition-all duration-500 overflow-visible ${disconnected ? 'opacity-50' : ''}`}
            style={{
                left: x, top: y, width, height,
                borderColor: sleeveColor,
                boxShadow: `0 0 15px ${sleeveColor}20`,
                transform: `rotate(${rotation}deg)`
            }}
        >
            {/* Custom playmat image (behind everything) */}
            <div className="absolute inset-0 pointer-events-none rounded-3xl overflow-hidden z-0">
                {matUrl && (
                    <div
                        className="absolute inset-0"
                        style={{ backgroundImage: `url("${matUrl}")`, ...transformToBg(matTransform) }}
                    />
                )}
            </div>

            <div
                className="absolute bottom-4 left-6 font-bold text-xl uppercase tracking-widest pointer-events-none z-10"
                style={{ color: matUrl ? '#ffffff' : contrastText(sleeveColor), textShadow: matUrl ? '0 1px 4px rgba(0,0,0,0.9)' : 'none', opacity: matUrl ? 0.85 : 0.3 }}
            >
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
                    style={sleeveUrl
                        ? { backgroundImage: `url("${sleeveUrl}")`, ...transformToBg(sleeveTransform), backgroundColor: sleeveColor }
                        : { backgroundColor: sleeveColor }}
                >
                    <div className="text-white font-bold text-2xl z-10 pointer-events-none" style={{ textShadow: '0 1px 3px rgba(0,0,0,0.9)' }}>{counts.library}</div>
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

            {/* Command Zone (commanders) + Companion Zone. commanders[] carries both;
                split by isCompanion so each slot only shows when the player has it.
                Multiple commanders (partner/background) stack vertically. */}
            {(() => {
                const cmdrs = commanders.filter(c => !c.isCompanion);
                const comps = commanders.filter(c => c.isCompanion);
                const slot = (cmd: CardData, kind: 'commander' | 'companion') => (
                    <div
                        key={cmd.id}
                        className={`relative bg-gray-800 border cursor-pointer hover:scale-105 transition-transform ${kind === 'companion' ? 'border-indigo-400/40' : 'border-amber-500/30'}`}
                        style={{ width: CARD_WIDTH, height: CARD_HEIGHT }}
                        onClick={(e) => isMobile ? handleCommanderTouch(cmd, e as any) : (isControlled ? onPlayCommander(cmd) : onInspectCommander(cmd))}
                        title={isControlled ? (kind === 'companion' ? 'Click to play your Companion' : 'Click to Cast Commander') : 'Click to Inspect'}
                    >
                        <img src={cmd.imageUrl} className="w-full h-full object-cover rounded opacity-90" alt={cmd.name} />
                        {isControlled && !isMobile && <div className="absolute bottom-1 right-1 bg-black/70 text-white text-[10px] font-bold px-1.5 rounded border border-white/20 pointer-events-none z-20 shadow-sm">C</div>}
                        <div className={`absolute -top-2 -right-2 p-1 rounded-full shadow-lg ${kind === 'companion' ? 'bg-indigo-500 text-white' : 'bg-amber-600 text-black'}`}>
                            {kind === 'companion' ? <Shield size={16} /> : <Crown size={16} />}
                        </div>
                    </div>
                );
                // Lay commanders + companion out horizontally, extending RIGHT from
                // the command slot. Stacking them vertically covered the graveyard/
                // exile zones directly below the command zone.
                if (cmdrs.length === 0 && comps.length === 0) return null;
                return (
                    <div className="absolute flex flex-row gap-2" style={{ left: zones.command.x, top: zones.command.y }}>
                        {cmdrs.map(c => slot(c, 'commander'))}
                        {comps.map(c => (
                            <div key={c.id} className="relative">
                                {slot(c, 'companion')}
                                <div className="absolute -bottom-5 w-full text-center text-[9px] text-indigo-300 font-bold uppercase tracking-wide pointer-events-none">Companion</div>
                            </div>
                        ))}
                    </div>
                );
            })()}

            {/* Hand Visualization */}
            {counts.hand > 0 && !isControlled && (
                <div
                    className="absolute flex items-center justify-center cursor-help group"
                    style={{
                        left: '50%',
                        bottom: -90,
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

// Picker for one custom image (mat or sleeve): URL or upload, with a draggable /
// scroll-zoomable preview that edits the stored transform. Touch works too (drag
// to pan, pinch handled by the browser's default on the preview is not needed —
// scroll/drag covers desktop; on touch, drag repositions).
export const AppearancePicker: React.FC<{
    label: string;
    url: string;
    transform: ImgTransform;
    aspect: string;
    onUrl: (u: string) => void;
    onTransform: (t: ImgTransform) => void;
}> = ({ label, url, transform, aspect, onUrl, onTransform }) => {
    const [busy, setBusy] = useState(false);
    const [err, setErr] = useState('');
    const dragRef = useRef<{ x: number; y: number } | null>(null);

    const handleFile = async (f?: File | null) => {
        if (!f) return;
        setBusy(true); setErr('');
        try { onUrl(await downscaleImage(f)); onTransform({ ...DEFAULT_TRANSFORM }); }
        catch (e: any) { setErr(e?.message || 'Upload failed'); }
        finally { setBusy(false); }
    };

    const onWheel = (e: React.WheelEvent) => {
        const scale = Math.min(400, Math.max(30, transform.scale + (e.deltaY < 0 ? 8 : -8)));
        onTransform({ ...transform, scale });
    };
    const onPointerDown = (e: React.PointerEvent) => {
        dragRef.current = { x: e.clientX, y: e.clientY };
        (e.target as HTMLElement).setPointerCapture(e.pointerId);
    };
    const onPointerMove = (e: React.PointerEvent) => {
        if (!dragRef.current) return;
        const dx = e.clientX - dragRef.current.x, dy = e.clientY - dragRef.current.y;
        dragRef.current = { x: e.clientX, y: e.clientY };
        onTransform({
            ...transform,
            x: Math.min(100, Math.max(0, transform.x - dx * 0.25)),
            y: Math.min(100, Math.max(0, transform.y - dy * 0.25)),
        });
    };
    const onPointerUp = () => { dragRef.current = null; };

    return (
        <div className="bg-gray-900/50 rounded-lg border border-gray-700 p-3 space-y-2">
            <div className="flex items-center justify-between">
                <h4 className="font-bold text-white text-sm">{label}</h4>
                {url && <button onClick={() => { onUrl(''); onTransform({ ...DEFAULT_TRANSFORM }); }} className="text-xs text-red-400 hover:text-red-300 flex items-center gap-1"><Trash2 size={12} /> Remove</button>}
            </div>
            {url ? (
                <div
                    className="w-full rounded-lg overflow-hidden border border-gray-600 cursor-move touch-none select-none bg-gray-800"
                    style={{ aspectRatio: aspect, backgroundImage: `url("${url}")`, ...transformToBg(transform) }}
                    onWheel={onWheel}
                    onPointerDown={onPointerDown}
                    onPointerMove={onPointerMove}
                    onPointerUp={onPointerUp}
                    title="Drag to position, scroll to zoom"
                />
            ) : (
                <div className="w-full rounded-lg border border-dashed border-gray-600 flex items-center justify-center text-gray-500 text-xs" style={{ aspectRatio: aspect }}>No image</div>
            )}
            <div className="flex gap-2">
                <input
                    value={url.startsWith('data:') ? '' : url}
                    onChange={e => onUrl(e.target.value)}
                    placeholder="Paste image URL"
                    className="flex-1 bg-gray-800 border border-gray-600 rounded px-2 py-1.5 text-xs text-white focus:ring-1 focus:ring-blue-500 outline-none"
                />
                <label className="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 rounded text-xs font-bold text-white cursor-pointer flex items-center gap-1 shrink-0">
                    {busy ? <Loader size={12} className="animate-spin" /> : <Upload size={12} />} Upload
                    <input type="file" accept="image/*" className="hidden" onChange={e => handleFile(e.target.files?.[0])} />
                </label>
            </div>
            {url && <p className="text-[10px] text-gray-500">Drag the preview to reposition, scroll to zoom. Uploads are downscaled; link a URL for large art.</p>}
            {err && <p className="text-[10px] text-red-400">{err}</p>}
        </div>
    );
};

const emptyStats: PlayerStats = {
    damageDealt: {}, damageReceived: 0, healingGiven: 0, healingReceived: 0, selfHealing: 0,
    tappedCounts: {},
    totalTurnTime: 0, cardsPlayed: 0, cardsSentToGraveyard: 0,
    cardsExiled: 0, cardsDrawn: 0
};

export const Tabletop: React.FC<TabletopProps> = ({ initialDeck, initialTokens, initialSideboard = [], playerName, sleeveColor = '#ef4444', roomId, initialGameStarted, isLocal = false, isLocalTableHost = false, localOpponents = [], onExit }) => {
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
    const [turnPhase, setTurnPhase] = useState<TurnPhase>('MAIN1');
    const turnPhaseRef = useRef<TurnPhase>('MAIN1');
    useEffect(() => { turnPhaseRef.current = turnPhase; }, [turnPhase]);
    // Guards the turn-start effect so it only fires once per turn transition.
    const lastTurnKeyRef = useRef('');

    // --- Combat ---
    const [combat, setCombat] = useState<CombatState | null>(null);
    const combatRef = useRef<CombatState | null>(null);
    useEffect(() => { combatRef.current = combat; }, [combat]);
    // Active combat drag: the board-object id a line is being dragged from, plus
    // the current pointer position (for the transient assignment line).
    const [combatDragFrom, setCombatDragFrom] = useState<string | null>(null);
    const [combatDragPos, setCombatDragPos] = useState<{ x: number; y: number } | null>(null);
    const [combatTrayGeom, setCombatTrayGeom] = useState(() => lsGetJSON('planeswalker_combat_tray', { x: -1, y: -1, w: -1, h: -1, scale: 1 }));
    const combatTrayDrag = useRef<{ startX: number, startY: number, initialGeom: any, mode: 'drag' | 'resize' } | null>(null);

    useEffect(() => { localStorage.setItem('planeswalker_combat_tray', JSON.stringify(combatTrayGeom)); }, [combatTrayGeom]);

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
    const [sideboard, setSideboard] = useState<CardData[]>(initialSideboard);
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

    // --- Undo System ---
    const [undoHistory, setUndoHistory] = useState<UndoableAction[]>([]);
    const pushUndo = useCallback((action: UndoableAction) => {
        setUndoHistory(prev => [...prev.slice(-(MAX_UNDO_HISTORY - 1)), action]);
    }, []);

    // --- Keybindings ---
    const [keyBindings, setKeyBindings] = useState<Record<string, string>>(loadKeyBindings);
    // Action id currently waiting to capture a new key in the Controls editor.
    const [rebindingActionId, setRebindingActionId] = useState<string | null>(null);
    useEffect(() => {
        localStorage.setItem(KEYBINDINGS_STORAGE, JSON.stringify(keyBindings));
    }, [keyBindings]);
    // Reverse map (key -> actionId) for O(1) dispatch in the key handler.
    const keyToAction = useMemo(() => {
        const m: Record<string, string> = {};
        Object.entries(keyBindings).forEach(([id, key]) => { if (key) m[key] = id; });
        return m;
    }, [keyBindings]);

    // Bind a key to an action, clearing that key from any other action so a key
    // maps to at most one action (conflict resolution: last write wins).
    const assignKeyBinding = (actionId: string, key: string) => {
        setKeyBindings(prev => {
            const next = { ...prev };
            for (const id of Object.keys(next)) {
                if (next[id] === key) next[id] = ''; // unbind the previous owner
            }
            next[actionId] = key;
            return next;
        });
        setRebindingActionId(null);
    };

    const resetKeyBindings = () => setKeyBindings(defaultKeyBindings());

    // Local Table Host Logic
    useEffect(() => {
        if (isLocalTableHost && roomId && roomId !== 'LOCAL') {
            const s = socket;
            if (!s.connected) s.connect();

            // Host joins the room as a specific "table" entity or just as a player?
            // For now, let's join as the "Host" player.
            s.emit('join_room', { room: roomId, name: playerName, color: sleeveColor, userId: 'host-table-' + Date.now(), isTable: true });

            // Build the seat list a mobile controller sees. A slot is "taken" when it
            // is not an open_slot to begin with, or once a phone has claimed it.
            const buildSlots = () => localOpponents.map(opp => {
                const taken = opp.type !== 'open_slot' || !!claimedSlots.current[opp.id];
                return {
                    id: opp.id,
                    name: taken ? `${opp.name} (Taken)` : opp.name,
                    isTaken: taken,
                };
            });

            // Allow mobile players to join Open Slots. The server relays get_slots
            // with the requesting phone's socket id so we can answer it directly.
            s.on('get_slots', ({ requesterId }: { requesterId: string }) => {
                s.emit('slots_update', { room: roomId, targetId: requesterId, slots: buildSlots() });
            });

            s.on('slot_claim_request', ({ applicantId, slotId, deck, tokens, playerName }) => {
                // Reject if the slot is already taken by another phone.
                if (claimedSlots.current[slotId]) {
                    s.emit('confirm_slot_claim', { room: roomId, applicantId, slotId, approved: false });
                    return;
                }

                // Emit success to the mobile client
                s.emit('confirm_slot_claim', { room: roomId, applicantId, slotId, approved: true });
                claimedSlots.current[slotId] = applicantId;

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
                        library: deck.filter(c => !isCmdZoneCard(c)).length,
                        graveyard: 0,
                        exile: 0,
                        hand: 0, // Hand is hidden on table, but we track count
                        command: deck.filter(isCmdZoneCard).length
                    }
                }));

                setOpponentsCommanders(prev => ({
                    ...prev,
                    [applicantId]: deck.filter(isCmdZoneCard)
                }));

                setOpponentsLife(prev => ({
                    ...prev,
                    [applicantId]: 40
                }));

                // PlayersList (updated above) is the source of truth for rendering the board.
                // Store the seat's full private state, keyed by the phone's socket id.
                localPlayerStates.current[applicantId] = {
                    id: applicantId,
                    hand: [], // Hand is on mobile
                    library: deck.filter(c => !isCmdZoneCard(c)),
                    graveyard: [],
                    exile: [],
                    commandZone: deck.filter(isCmdZoneCard),
                    life: 40,
                    counters: {},
                    commanderDamage: {},
                    mulliganCount: 0,
                    hasKeptHand: false
                };

                // Mark the seat (by its new socket id) as remote-controlled so the host
                // hides local hand controls for it.
                setMobileControllers(prev => {
                    const next = new Set(prev);
                    next.add(applicantId);
                    return next;
                });

                // Re-broadcast the seat list so other phones see this slot is now taken,
                // and push the seat's starting stats to the phone that just claimed it.
                s.emit('slots_update', { room: roomId, slots: buildSlots() });
                sendStatsToSeat(applicantId);
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
                    library: opp.deck ? opp.deck.filter(c => !isCmdZoneCard(c)).length : 0,
                    hand: 7, // Assume starting hand
                    graveyard: 0,
                    exile: 0,
                    command: opp.deck ? opp.deck.filter(isCmdZoneCard).length : 0
                };
                newLife[id] = 40;
                newCommanders[id] = opp.deck ? opp.deck.filter(isCmdZoneCard) : [];

                // Initialize ref state
                localPlayerStates.current[id] = {
                    id: id,
                    hand: [], // We don't know their hand yet if they are remote
                    library: opp.deck ? opp.deck.filter(c => !isCmdZoneCard(c)) : [],
                    graveyard: [],
                    exile: [],
                    commandZone: opp.deck ? opp.deck.filter(isCmdZoneCard) : [],
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
    const [showDiceMenu, setShowDiceMenu] = useState(false);
    const [showSettingsModal, setShowSettingsModal] = useState(false);
    const [soundMuted, setSoundMutedState] = useState(isSoundMuted());
    const toggleSound = () => { const next = !soundMuted; setSoundMuted(next); setSoundMutedState(next); if (!next) playSound('draw'); };

    // --- Change card art (Scryfall version picker) ---
    const [changeArtFor, setChangeArtFor] = useState<BoardObject | null>(null);
    const [artPrints, setArtPrints] = useState<CardData[]>([]);
    const [artLoading, setArtLoading] = useState(false);

    // --- Table appearance (custom playmat / sleeve) ---
    const [showCustomizeModal, setShowCustomizeModal] = useState(false);
    const lsGet = (k: string, d = '') => { try { return localStorage.getItem(k) ?? d; } catch { return d; } };
    const lsGetJSON = <T,>(k: string, d: T): T => { try { return JSON.parse(localStorage.getItem(k) || 'null') ?? d; } catch { return d; } };
    const [customMatUrl, setCustomMatUrl] = useState<string>(() => lsGet('planeswalker_mat_url'));
    const [customSleeveUrl, setCustomSleeveUrl] = useState<string>(() => lsGet('planeswalker_sleeve_url'));
    const [matTransform, setMatTransform] = useState<ImgTransform>(() => lsGetJSON('planeswalker_mat_tf', DEFAULT_TRANSFORM));
    const [sleeveTransform, setSleeveTransform] = useState<ImgTransform>(() => lsGetJSON('planeswalker_sleeve_tf', DEFAULT_TRANSFORM));
    // Opponents' appearance, keyed by seat/socket id, learned from the server.
    const [opponentAppearance, setOpponentAppearance] = useState<Record<string, { matUrl?: string; sleeveUrl?: string; matTransform?: ImgTransform; sleeveTransform?: ImgTransform }>>({});

    // Persist my appearance and broadcast it so opponents can render it.
    useEffect(() => {
        try {
            localStorage.setItem('planeswalker_mat_url', customMatUrl);
            localStorage.setItem('planeswalker_sleeve_url', customSleeveUrl);
            localStorage.setItem('planeswalker_mat_tf', JSON.stringify(matTransform));
            localStorage.setItem('planeswalker_sleeve_tf', JSON.stringify(sleeveTransform));
        } catch { /* ignore */ }
        if (!isLocal && socket.connected) {
            socket.emit('update_player_appearance', { room: roomId, matUrl: customMatUrl, sleeveUrl: customSleeveUrl, matTransform, sleeveTransform });
        }
    }, [customMatUrl, customSleeveUrl, matTransform, sleeveTransform]);

    // Appearance for a given seat id: my own live state for me, else what that
    // opponent last broadcast.
    const appearanceFor = (seatId: string) => {
        const myId = isLocal ? playersList[mySeatIndex]?.id : (socket.id || 'local-player');
        if (seatId === myId) return { matUrl: customMatUrl, sleeveUrl: customSleeveUrl, matTransform, sleeveTransform };
        return opponentAppearance[seatId] || {};
    };

    // Local Game State Storage
    const localPlayerStates = useRef<Record<string, LocalPlayerState>>({});

    // Local Table: maps an original open-slot id -> the mobile socket id that claimed it,
    // so the host can report seat availability and route stats to the right phone.
    const claimedSlots = useRef<Record<string, string>>({});

    // Push a mobile-controlled seat's life/poison/commander-damage down to its phone.
    const sendStatsToSeat = (seatId: string) => {
        if (!isLocalTableHost) return;
        const state = localPlayerStates.current[seatId];
        if (!state) return;
        socket.emit('send_stats_update', {
            roomId,
            targetId: seatId,
            life: state.life,
            poison: state.counters['poison'] || 0,
            commanderDamage: state.commanderDamage || {},
        });
    };

    // --- AI Opponent State ---
    // Whether the server has an ANTHROPIC_API_KEY (AI seats fall back to hot-seat if not).
    const [aiAvailable, setAiAvailable] = useState(false);
    // The seat id currently being driven by the AI (drives the "thinking" badge).
    const [aiThinkingSeat, setAiThinkingSeat] = useState<string | null>(null);
    const aiTurnActive = useRef(false);                       // re-entry guard for the turn loop
    const aiLandsPlayed = useRef<Record<string, number>>({}); // seatId -> lands played this turn
    const aiCommanderCasts = useRef<Record<string, number>>({}); // commander cardId -> times cast (tax)
    const aiTokenCounter = useRef(0);
    const aiMulliganRunning = useRef(false);
    const aiUsageTotals = useRef({ input: 0, cacheRead: 0, output: 0 });
    // Binding deals the player has struck with each AI seat (fed into the brain's turns).
    const aiDeals = useRef<Record<string, string[]>>({});

    // --- Voice / negotiation UI state ---
    const [voiceOpen, setVoiceOpen] = useState(false);
    const [voiceTargetSeat, setVoiceTargetSeat] = useState<string | null>(null);
    const [voiceHistory, setVoiceHistory] = useState<Record<string, VoiceChatTurn[]>>({});
    const [voiceListening, setVoiceListening] = useState(false);
    const [voiceBusy, setVoiceBusy] = useState(false);
    const [voiceSpeaking, setVoiceSpeaking] = useState(false);
    const [voicePartial, setVoicePartial] = useState('');
    const [voiceTextInput, setVoiceTextInput] = useState('');
    const [voiceBackendId, setVoiceBackendId] = useState<VoiceBackendId>('web-speech');
    const [voiceRealtimeAvailable, setVoiceRealtimeAvailable] = useState(false);
    const [rtConnecting, setRtConnecting] = useState(false);
    const rtSession = useRef<RealtimeVoiceSession | null>(null);

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
    const opponentsLifeRef = useRef(opponentsLife);
    const opponentsCountsRef = useRef(opponentsCounts);
    const opponentsCommandersRef = useRef(opponentsCommanders);

    // --- Sequenced sync (Phase 0) ---
    // lastSeq: highest server sequence number we've applied. resyncing: true while
    // we're recovering a gap (incoming actions are buffered by seq until the gap
    // is filled). pendingActions: out-of-order actions held during a gap/resync.
    const lastSeqRef = useRef(0);
    const resyncingRef = useRef(false);
    const pendingActions = useRef<Map<number, { action: string; data: any; playerId: string | null }>>(new Map());

    const [isMobile, setIsMobile] = useState(false);
    const [mobileActionCardId, setMobileActionCardId] = useState<string | null>(null);
    const [isHandVisible, setIsHandVisible] = useState(true);
    const hasCenteredHand = useRef(false);
    const touchStartRef = useRef<number | null>(null);

    const currentRadius = (playersList.length === 2 || (isLocal && localOpponents.length === 1)) ? 210 : 625;
    const layout = getLayout(playersList.length, currentRadius);

    useEffect(() => { libraryRef.current = library; }, [library]);
    useEffect(() => { playersListRef.current = playersList; }, [playersList]);

    // Ensure mySeatIndex correctly tracks our socket ID when playing online
    useEffect(() => {
        if (isLocal || !socket.id) return;
        const myIdx = playersList.findIndex(p => p.id === socket.id);
        if (myIdx !== -1 && myIdx !== mySeatIndex) {
            setMySeatIndex(myIdx);
        }
    }, [playersList, socket.id, isLocal, mySeatIndex]);
    useEffect(() => { turnStartTimeRef.current = turnStartTime; }, [turnStartTime]);
    useEffect(() => { gamePhaseRef.current = gamePhase; }, [gamePhase]);

    useEffect(() => { boardObjectsRef.current = boardObjects; }, [boardObjects]);
    useEffect(() => { turnRef.current = turn; }, [turn]);
    useEffect(() => { roundRef.current = round; }, [round]);
    useEffect(() => { currentTurnPlayerIdRef.current = currentTurnPlayerId; }, [currentTurnPlayerId]);
    useEffect(() => { commanderDamageRef.current = commanderDamage; }, [commanderDamage]);
    useEffect(() => { turnOrderRef.current = turnOrder; }, [turnOrder]);
    useEffect(() => { lifeRef.current = life; }, [life]);
    useEffect(() => { logsRef.current = logs; }, [logs]);
    useEffect(() => { trackDamageRef.current = trackDamage; }, [trackDamage]);
    useEffect(() => { opponentsLifeRef.current = opponentsLife; }, [opponentsLife]);
    useEffect(() => { opponentsCountsRef.current = opponentsCounts; }, [opponentsCounts]);
    useEffect(() => { opponentsCommandersRef.current = opponentsCommanders; }, [opponentsCommanders]);

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
            currentTurnPlayerId
        };
        try {
            localStorage.setItem(`planeswalker_backup_${roomId}`, JSON.stringify(backupData));
        } catch (e) {
            try {
                const strippedBackup = { ...backupData, logs: [] };
                localStorage.setItem(`planeswalker_backup_${roomId}`, JSON.stringify(strippedBackup));
            } catch (e2) {
                // Silently fail if still too big to avoid console spam during rapid updates (e.g., dragging)
            }
        }
    }, [hand, library, graveyard, exile, commandZone, life, boardObjects, gamePhase, turn, round, commanderDamage, turnOrder, playersList, mySeatIndex, isLocal, roomId, logs, opponentsLife, opponentsCounts, opponentsCommanders, currentTurnPlayerId]);

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

            // Map backup player ids -> currently-connected socket ids. Match each
            // backup player to a present player by userId (preferred) or name, so a
            // restore keeps the full multiplayer roster/turn order instead of
            // collapsing everyone into the restoring client.
            const myNewId = socket.id;
            const backupPlayers: any[] = data.playersList || [];
            const currentPlayers = playersListRef.current;
            const myOldPlayer = backupPlayers.find((p: any) => p.name === playerName);
            const myOldId = myOldPlayer?.id;

            const idRemap: Record<string, string> = {};
            for (const bp of backupPlayers) {
                const match = currentPlayers.find(cp =>
                    (bp.userId && cp.userId && cp.userId === bp.userId) || cp.name === bp.name
                );
                if (match) idRemap[bp.id] = match.id;
            }
            if (myOldId && myNewId) idRemap[myOldId] = myNewId;
            const remapId = (id: string) => idRemap[id] || id;

            const restoredObjects = (data.boardObjects || []).map((obj: BoardObject) => ({
                ...obj,
                controllerId: remapId(obj.controllerId),
            }));

            // Single-player backups collapse to just this client; multiplayer backups
            // preserve the (remapped) turn order and active player.
            const isSinglePlayer = backupPlayers.length <= 1;
            const restoredTurnOrder = isSinglePlayer
                ? [myNewId]
                : (Array.isArray(data.turnOrder) && data.turnOrder.length
                    ? data.turnOrder.map(remapId)
                    : currentPlayers.map(p => p.id));
            const restoredCurrentTurn = isSinglePlayer
                ? myNewId
                : remapId(data.currentTurnPlayerId || myOldId || myNewId);

            setBoardObjects(restoredObjects);
            setGamePhase(data.gamePhase);
            setTurn(data.turn || 1);
            setRound(data.round || 1);
            setTurnStartTime(data.turnStartTime || Date.now());
            setCommanderDamage(data.commanderDamage || {});
            setTurnOrder(restoredTurnOrder);
            setCurrentTurnPlayerId(restoredCurrentTurn);
            setPlayersList(prev => sortPlayers(prev, restoredTurnOrder));

            // Sync to Server (broadcast to the other clients, who apply it via GAME_STATE_SYNC)
            socket.emit('game_action', {
                room: roomId, action: 'GAME_STATE_SYNC', data: {
                    phase: data.gamePhase,
                    boardObjects: restoredObjects,
                    turn: data.turn,
                    round: data.round,
                    currentTurnPlayerId: restoredCurrentTurn,
                    turnStartTime: data.turnStartTime,
                    commanderDamage: data.commanderDamage,
                    turnOrder: restoredTurnOrder,
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
        return () => window.removeEventListener('resize', checkMobile);
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

        // Push my saved custom appearance to the room (read from storage so it works
        // regardless of this effect's closure). Called after every (re)join.
        const emitAppearance = () => {
            try {
                socket.emit('update_player_appearance', {
                    room: roomId,
                    matUrl: localStorage.getItem('planeswalker_mat_url') || '',
                    sleeveUrl: localStorage.getItem('planeswalker_sleeve_url') || '',
                    matTransform: JSON.parse(localStorage.getItem('planeswalker_mat_tf') || 'null') || undefined,
                    sleeveTransform: JSON.parse(localStorage.getItem('planeswalker_sleeve_tf') || 'null') || undefined,
                });
            } catch { /* ignore */ }
        };

        // Handle socket reconnection
        const handleReconnection = () => {
            console.log("Socket reconnected, re-joining room...");
            const userId = getUserIdForRoom(roomId);
            socket.emit('join_room', { room: roomId, name: playerName, color: sleeveColor, userId });
            emitAppearance();
            // Pull anything we missed while offline: the server replays buffered actions
            // after our last applied sequence, or falls back to a full snapshot if the
            // gap is too old.
            socket.emit('request_meta', { room: roomId });
            socket.emit('request_sync', { room: roomId, sinceSeq: lastSeqRef.current });
        };

        socket.on('connect', handleReconnection);

        // Initial join
        const userId = getUserIdForRoom(roomId);
        socket.emit('join_room', { room: roomId, name: playerName, color: sleeveColor, userId });
        emitAppearance();


        return () => {
            socket.off('connect', handleReconnection);
        };
    }, [roomId, playerName, sleeveColor, isLocal]);

    const handleExit = () => {
        socket.emit('leave_room', { room: roomId });
        localStorage.removeItem(`game_phase_${roomId}`);
        localStorage.removeItem(`planeswalker_backup_${roomId}`);
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

    // Sync stats to mobile controllers. Pushes each remote-controlled seat's current
    // life/poison/commander-damage to its phone whenever host-side state that could
    // affect those values changes. Mobile-originated changes also push imperatively
    // from their handlers (which mutate the localPlayerStates ref without a re-render).
    useEffect(() => {
        if (!isLocalTableHost) return;
        if (gamePhase !== 'PLAYING' && gamePhase !== 'MULLIGAN') return;
        mobileControllers.forEach(seatId => sendStatsToSeat(seatId));
    }, [isLocalTableHost, gamePhase, mobileControllers, life, commanderDamage, opponentsLife]);

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
                opponentsCommanders
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
    const getMyId = () => isLocal ? (playersList[mySeatIndex]?.id ?? playersList[0]?.id ?? 'player-0') : (socket.id ?? 'local-player');

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
        const commanders = deck.filter(isCmdZoneCard);
        const library = deck.filter(c => !isCmdZoneCard(c)).sort(() => Math.random() - 0.5);
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
    };

    const sendHandUpdate = (targetId: string, hand: CardData[], phase: string = gamePhase, mCount: number = mulliganCount) => {
        if (!isLocalTableHost || !targetId || targetId.startsWith('player-') || targetId.startsWith('ai-') || targetId === 'local-player') return;
        socket.emit('send_hand_update', { roomId, targetId, hand, phase, mulliganCount: mCount });
    };

    const addLog = (message: string, type: 'ACTION' | 'SYSTEM' = 'ACTION', overrideName?: string) => {
        console.log(`Adding log: ${message} (${type})`); // Debug
        const actingPlayerName = overrideName || (isLocal ? (playersList[mySeatIndex]?.name ?? playerName) : playerName);
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
            playSound('damage');
        } else {
            healingReceivedThisTurn.current += amount;
            addLog(`gained ${amount} life`);
            playSound('heal');
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
            const idxA = orderMap.has(a.id) ? orderMap.get(a.id)! : (a.userId && orderMap.has(a.userId) ? orderMap.get(a.userId)! : 999);
            const idxB = orderMap.has(b.id) ? orderMap.get(b.id)! : (b.userId && orderMap.has(b.userId) ? orderMap.get(b.userId)! : 999);
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

            // Learn each player's custom mat/sleeve from the roster so we can render
            // opponents' tables the way they set them.
            setOpponentAppearance(prev => {
                const next = { ...prev };
                for (const p of roomPlayers as any[]) {
                    if (p.id === socket.id) continue;
                    next[p.id] = {
                        matUrl: p.customMatUrl, sleeveUrl: p.customSleeveUrl,
                        matTransform: p.matTransform, sleeveTransform: p.sleeveTransform,
                    };
                }
                return next;
            });

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
                    allPlayerCommanders: { ...opponentsCommanders, [socket.id]: commandZone },
                    turnPhase: turnPhaseRef.current,
                    combat: combatRef.current
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

        const applyAction = ({ action, data, playerId }: { action: string, data: { [key: string]: any }, playerId: string | null }) => {
            console.log(`Game Action Applied: ${action} from ${playerId}`, data);
            const currentPlayers = playersListRef.current;
            const sender = playerId ? currentPlayers.find(p => p.id === playerId) : undefined;

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
                    // PASS_TURN is a server action (no sender), so the ending player's
                    // name comes from the payload — not from `sender`, which would be
                    // undefined here and previously showed the wrong name.
                    const prevName = data.prevPlayerName;
                    if (prevName) {
                        addLog(prevDuration ? `${prevName} ended their turn (Duration: ${prevDuration})` : `${prevName} ended their turn`, 'SYSTEM');
                    }
                    const nextPlayer = currentPlayers.find(p => p.id === data.nextPlayerSocketId);
                    if (nextPlayer) {
                        addLog(`It is now ${nextPlayer.name}'s turn`, 'SYSTEM');
                    }
                    setTurnStartTime(Date.now());
                    checkDamageTracking();
                }
            }
            else if (action === 'PHASE_CHANGE') {
                // The active player broadcasts intra-turn phase advances so every
                // client's phase strip agrees. Turn-start (reset to UNTAP) is driven
                // reactively off the synced turn pointer, not this action.
                if (data.phase && (TURN_PHASES as readonly string[]).includes(data.phase)) {
                    setTurnPhase(data.phase as TurnPhase);
                }
            }
            else if (action === 'COMBAT_UPDATE') {
                // Mirror the shared combat state (tracking only — no damage applied).
                const incoming = (data.combat ?? null) as CombatState | null;
                setCombat(incoming);
                combatRef.current = incoming;
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
                    // Compute the increment inside the functional updater so we never
                    // read the stale `gameStats` captured by this socket effect.
                    setGameStats(prev => {
                        const current = prev[socket.id] || emptyStats;
                        const newStats = { ...current, healingGiven: current.healingGiven + data.amount };
                        socket.emit('game_action', { room: roomId, action: 'UPDATE_STATS', data: { playerId: socket.id, stats: newStats } });
                        return { ...prev, [socket.id]: newStats };
                    });
                }
            }
            else if (action === 'ADD_OBJECT') {
                setBoardObjects(prev => {
                    if (prev.some(o => o.id === data.id)) return prev;
                    return [...prev, data as BoardObject];
                });
            } else if (action === 'STEAL_FROM_ZONE') {
                if (data.targetPlayerId === socket.id) {
                    const cardId = data.cardId;
                    const zone = data.zone;
                    if (zone === 'LIBRARY') setLibrary(prev => prev.filter(c => c.id !== cardId));
                    else if (zone === 'GRAVEYARD') setGraveyard(prev => prev.filter(c => c.id !== cardId));
                    else if (zone === 'EXILE') setExile(prev => prev.filter(c => c.id !== cardId));
                }
            } else if (action === 'RETURN_TO_OWNER_ZONE') {
                if (data.ownerId === socket.id) {
                    if (data.zone === 'GRAVEYARD') setGraveyard(prev => [data.card, ...prev]);
                    else if (data.zone === 'EXILE') setExile(prev => [data.card, ...prev]);
                    addLog(`your ${data.card.name} was returned to your ${data.zone.toLowerCase()}`);
                }
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
            } else if (action === 'REMOVE_PLAYER_OBJECTS') {
                // A player left/was kicked: drop everything they controlled so the
                // board stays consistent for everyone (server-authoritative cleanup).
                setBoardObjects(prev => prev.filter(o => o.controllerId !== data.playerId));
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

                const commanders = initialDeck.filter(isCmdZoneCard);
                const deck = initialDeck.filter(c => !isCmdZoneCard(c));
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
                if (data.phase === 'PLAYING' && gamePhaseRef.current === 'MULLIGAN') {
                    // Keep local player in MULLIGAN phase until they keep their hand
                } else {
                    setGamePhase(data.phase);
                }
                setBoardObjects(data.boardObjects);
                setTurn(data.turn);
                setRound(data.round);
                setCurrentTurnPlayerId(data.currentTurnPlayerId);
                setTurnStartTime(data.turnStartTime);
                if (data.commanderDamage) setCommanderDamage(data.commanderDamage);
                if (data.turnOrder) {
                    turnOrderRef.current = data.turnOrder;
                    setTurnOrder(data.turnOrder);
                    setPlayersList(prev => sortPlayers(prev, data.turnOrder));
                }
                if (data.logs) setLogs(data.logs);
                if (data.turnPhase) {
                    setTurnPhase(data.turnPhase);
                    turnPhaseRef.current = data.turnPhase;
                }
                if (data.combat !== undefined) {
                    setCombat(data.combat);
                    combatRef.current = data.combat;
                }

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

        // --- Sequenced dispatch (Phase 0) ---
        // Dispatch a single message: our own echoed actions were already applied
        // optimistically, so skip re-applying them (server actions have playerId=null
        // and are always applied).
        const dispatch = (msg: { action: string; data: any; playerId: string | null }) => {
            if (msg.playerId && socket.id && msg.playerId === socket.id) return;
            applyAction(msg);
        };

        // Ask the server to replay everything after our last applied sequence number.
        const requestSync = () => {
            if (resyncingRef.current) return;
            resyncingRef.current = true;
            console.log(`[SYNC] gap detected, requesting replay since seq ${lastSeqRef.current}`);
            socket.emit('request_sync', { room: roomId, sinceSeq: lastSeqRef.current });
        };

        // Apply any buffered actions that are now contiguous with lastSeq.
        const drainPending = () => {
            let next = pendingActions.current.get(lastSeqRef.current + 1);
            while (next) {
                pendingActions.current.delete(lastSeqRef.current + 1);
                lastSeqRef.current += 1;
                dispatch(next);
                next = pendingActions.current.get(lastSeqRef.current + 1);
            }
            if (pendingActions.current.size === 0) resyncingRef.current = false;
        };

        // Seq-aware entry point for live actions.
        const handleAction = (msg: { seq?: number; action: string; data: any; playerId: string | null }) => {
            if (typeof msg.seq !== 'number') { dispatch(msg); return; } // legacy/unsequenced
            const seq = msg.seq;
            if (seq <= lastSeqRef.current) return;                       // duplicate/old
            if (seq === lastSeqRef.current + 1) {
                lastSeqRef.current = seq;
                dispatch(msg);
                drainPending();
                return;
            }
            // Gap: hold this action and pull the missing ones.
            pendingActions.current.set(seq, msg);
            requestSync();
        };

        // Server replayed the actions we missed (contiguous, oldest first).
        const handleSyncReplay = ({ actions, upToSeq }: { actions: any[]; upToSeq: number }) => {
            for (const a of actions || []) {
                if (typeof a.seq !== 'number') continue;
                if (a.seq <= lastSeqRef.current) continue;
                if (a.seq === lastSeqRef.current + 1) {
                    lastSeqRef.current = a.seq;
                    dispatch(a);
                } else {
                    pendingActions.current.set(a.seq, a);
                }
            }
            drainPending();
            if (typeof upToSeq === 'number' && upToSeq > lastSeqRef.current && pendingActions.current.size === 0) {
                // Still behind and nothing buffered to bridge it — escalate to a snapshot.
                resyncingRef.current = false;
                requestSync();
            }
        };

        // Full snapshot from the host (used when the gap is older than the buffer, or
        // on a fresh rejoin). Replaces public state wholesale and resets our seq.
        const handleFullSync = ({ state, seq, meta }: { state: any; seq: number; meta: any }) => {
            if (state) applyAction({ action: 'GAME_STATE_SYNC', data: state, playerId: null });
            if (meta) handleGameMeta(meta);
            if (typeof seq === 'number') lastSeqRef.current = seq;
            // Drop stale buffered actions, then apply anything newer than the snapshot.
            for (const key of Array.from(pendingActions.current.keys())) {
                if (key <= lastSeqRef.current) pendingActions.current.delete(key);
            }
            drainPending();
            resyncingRef.current = false;
        };

        // Host answers a snapshot request with the full public board state.
        const handleProvideSnapshot = ({ requesterId }: { requesterId: string }) => {
            if (!playersListRef.current.some(p => p.id === socket.id)) return;
            const snapshot = {
                phase: gamePhaseRef.current,
                boardObjects: boardObjectsRef.current,
                turn: turnRef.current,
                round: roundRef.current,
                currentTurnPlayerId: currentTurnPlayerIdRef.current,
                turnStartTime: turnStartTimeRef.current,
                commanderDamage: commanderDamageRef.current,
                turnOrder: turnOrderRef.current,
                logs: logsRef.current.slice(0, 50),
                allPlayerLife: { ...opponentsLifeRef.current, [socket.id!]: lifeRef.current },
                allPlayerCounts: { ...opponentsCountsRef.current },
                allPlayerCommanders: { ...opponentsCommandersRef.current },
            };
            socket.emit('submit_snapshot', { room: roomId, requesterId, state: snapshot });
        };

        // Authoritative turn POINTER only (whose turn it is + the turn number).
        // We deliberately do NOT reorder the roster here: seat order is owned by
        // room_players_update / UPDATE_PLAYER_ORDER / GAME_STATE_SYNC, which also
        // keep mySeatIndex correct. Re-sorting the roster on every meta broadcast
        // (which fires on connect, disconnect, and every pass) fought those updates
        // and caused the reconnect flicker + "opponent's mat in front" bug. The
        // server still uses meta.turnOrder internally to pick the next seat.
        const handleGameMeta = (meta: { turnNumber?: number; currentTurnPlayerId?: string; turnOrder?: string[] }) => {
            if (typeof meta.turnNumber === 'number') setTurn(meta.turnNumber);
            if (meta.currentTurnPlayerId) setCurrentTurnPlayerId(meta.currentTurnPlayerId);
            if (meta.turnOrder) {
                turnOrderRef.current = meta.turnOrder;
                setTurnOrder(meta.turnOrder);
                setPlayersList(prev => sortPlayers(prev, meta.turnOrder));
            }
        };

        socket.on('room_players_update', handleRoomUpdate);
        socket.on('game_action', handleAction);
        socket.on('game_meta', handleGameMeta);
        socket.on('sync_replay', handleSyncReplay);
        socket.on('full_sync', handleFullSync);
        socket.on('provide_snapshot', handleProvideSnapshot);
        socket.on('host_approval_request', handleHostApprovalRequest);
        socket.on('load_state', handleLoadState);
        socket.on('player_reconnected', handlePlayerReconnected);
        socket.on('notification', (data) => addLog(data.message, "SYSTEM"));
        socket.on('player_kicked', () => { alert("You have been kicked from the game."); handleExit(); });

        socket.emit('get_players', { room: roomId });
        socket.emit('request_meta', { room: roomId });
        // Pull a snapshot/replay in case we're joining a game already in progress.
        socket.emit('request_sync', { room: roomId, sinceSeq: lastSeqRef.current });

        return () => {
            socket.off('room_players_update', handleRoomUpdate);
            socket.off('game_action', handleAction);
            socket.off('game_meta', handleGameMeta);
            socket.off('sync_replay', handleSyncReplay);
            socket.off('full_sync', handleFullSync);
            socket.off('provide_snapshot', handleProvideSnapshot);
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
            const commanders = initialDeck.filter(isCmdZoneCard);
            const deck = initialDeck.filter(c => !isCmdZoneCard(c));
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
    const handleStartGameLogic = (options?: { mulligansAllowed: boolean, trackDamage?: boolean, firstPlayerId?: string }) => {
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
            let lib = libraryRef.current.length > 0 ? libraryRef.current : initialDeck;
            if (lib === initialDeck || (lib.length === initialDeck.length && commandZone.length === 0)) {
                const commanders = initialDeck.filter(isCmdZoneCard);
                const deck = initialDeck.filter(c => !isCmdZoneCard(c));
                lib = [...deck].sort(() => Math.random() - 0.5);
                setCommandZone(commanders);
            }

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
            setCurrentTurnPlayerId(options?.firstPlayerId || playersList[0].id);
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
        handleStartGameLogic({ mulligansAllowed, firstPlayerId: startingPlayer.id });
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

        const commanders = initialDeck.filter(isCmdZoneCard);
        const deck = initialDeck.filter(c => !isCmdZoneCard(c));
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
        return isLocal ? (playersList[mySeatIndex]?.id ?? playersList[0]?.id ?? 'local-player') : (socket.id || playersList[mySeatIndex]?.id || 'local-player');
    };

    // A seat still owes a mulligan decision only if it is actually being played —
    // i.e. it has a real (non-token) hand to keep. Unclaimed open slots (and any
    // seat with no deck) start with an empty hand and are treated as auto-kept, so
    // the game can leave the MULLIGAN phase without every empty seat being cycled.
    const allSeatsKept = () => playersList.every(p => {
        const state = localPlayerStates.current[p.id];
        if (!state) return true;
        if (state.hasKeptHand) return true;
        return state.hand.filter(c => !c.isToken).length === 0;
    });

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
                    const allKept = allSeatsKept();
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
            playSound('mulligan');
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
            const allKept = allSeatsKept();
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
        // Confirm the updated stats back to the phone.
        sendStatsToSeat(playerId);
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
        // Confirm the updated stats back to the phone.
        sendStatsToSeat(playerId);
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


    // ============================================================================
    // AI Opponent Driver (local games). The host browser drives AI seats: it
    // serializes the seat's game state, asks the server (Claude API proxy) for a
    // turn as a sequence of tool calls, validates and applies each one through the
    // same board/emit path as human actions, and passes the turn when done. AI
    // hidden information stays on the host; opponents only get public info.
    // ============================================================================
    const delay = (ms: number) => new Promise(res => setTimeout(res, ms));
    const accumulateUsage = (u?: { inputTokens: number; cacheReadTokens: number; outputTokens: number }) => {
        if (!u) return;
        aiUsageTotals.current.input += u.inputTokens || 0;
        aiUsageTotals.current.cacheRead += u.cacheReadTokens || 0;
        aiUsageTotals.current.output += u.outputTokens || 0;
    };

    const aiSeatIndex = (seatId: string) => playersList.findIndex(p => p.id === seatId);
    const aiSeatRotation = (seatId: string) => layout[aiSeatIndex(seatId)]?.rot ?? 0;
    const aiSeatName = (seatId: string) => playersList.find(p => p.id === seatId)?.name || 'AI';

    const aiSpawnCard = (seatId: string, card: CardData) => {
        const idx = aiSeatIndex(seatId);
        const pos = layout[idx] || { x: 0, y: 0, rot: 0 };
        const z = maxZ + (++aiTokenCounter.current);
        const obj: BoardObject = {
            id: crypto.randomUUID(), type: 'CARD', cardData: card,
            x: pos.x + MAT_W / 2 - CARD_WIDTH / 2 + (Math.random() * 40 - 20),
            y: pos.y + MAT_H / 2 - CARD_HEIGHT / 2 + (Math.random() * 40 - 20),
            z, rotation: pos.rot, isFaceDown: false, isTransformed: false,
            counters: {}, commanderDamage: {}, controllerId: seatId, quantity: 1, tappedQuantity: 0,
        };
        setMaxZ(prev => Math.max(prev, z) + 1);
        setBoardObjects(prev => [...prev, obj]);
        emitAction('ADD_OBJECT', obj);
        return obj;
    };

    const aiTapSources = (seatId: string, tappedIds: string[]) => {
        const rot = aiSeatRotation(seatId);
        const tappedRot = (rot + 90) % 360;
        const counts: Record<string, number> = {};
        tappedIds.forEach(id => { counts[id] = (counts[id] || 0) + 1; });
        Object.entries(counts).forEach(([id, count]) => {
            const o = boardObjectsRef.current.find(x => x.id === id);
            if (!o) return;
            if (o.quantity > 1) updateBoardObject(id, { tappedQuantity: Math.min(o.quantity, (o.tappedQuantity || 0) + count) });
            else updateBoardObject(id, { rotation: tappedRot });
        });
    };


    // Applies one AI tool call to the AI seat's state. Returns a result the model
    // can react to (so an illegal move produces a correction rather than a crash).
    const aiApplyToolCall = (seatId: string, call: AiToolCall): AiToolResult => {
        const ok = (detail?: string): AiToolResult => ({ id: call.id, ok: true, detail });
        const fail = (error: string): AiToolResult => ({ id: call.id, ok: false, error });
        const state = localPlayerStates.current[seatId];
        if (!state) return fail('Seat state missing.');
        const name = aiSeatName(seatId);
        const input = call.input || {};
        try {
            switch (call.name) {
                case 'play_land': {
                    const card = state.hand.find(c => c.id === input.cardId && c.isLand);
                    if (!card) return fail('That land is not in your hand.');
                    if ((aiLandsPlayed.current[seatId] || 0) >= 1) return fail('You have already played a land this turn.');
                    state.hand = state.hand.filter(c => c.id !== card.id);
                    aiSpawnCard(seatId, card);
                    aiLandsPlayed.current[seatId] = (aiLandsPlayed.current[seatId] || 0) + 1;
                    addLog(`played ${card.name}`, 'ACTION', name);
                    return ok(`Played ${card.name}.`);
                }
                case 'cast_spell': {
                    const card = state.hand.find(c => c.id === input.cardId);
                    if (!card) return fail('That card is not in your hand.');
                    if (card.isLand) return fail('Use play_land for lands.');
                    const type = (card.typeLine || '').toLowerCase();
                    const isPermanent = /creature|artifact|enchantment|planeswalker|battle/.test(type) && !/instant|sorcery/.test(type);
                    if (isPermanent) aiSpawnCard(seatId, card);
                    else state.graveyard = [...state.graveyard, card];
                    const tgt = input.targetsDescription ? ` (${input.targetsDescription})` : '';
                    addLog(`cast ${card.name}${tgt}`, 'ACTION', name);
                    return ok(`Cast ${card.name}.`);
                }
                case 'cast_commander': {
                    const card = state.commandZone.find(c => c.id === input.cardId);
                    if (!card) return fail('That commander is not in your command zone.');
                    const prevCasts = aiCommanderCasts.current[card.id] || 0;
                    state.commandZone = state.commandZone.filter(c => c.id !== card.id);
                    aiSpawnCard(seatId, card);
                    aiCommanderCasts.current[card.id] = prevCasts + 1;
                    addLog(`cast commander ${card.name}${prevCasts ? ` (tax ${prevCasts * 2})` : ''}`, 'ACTION', name);
                    return ok(`Cast commander ${card.name}.`);
                }
                case 'activate_mana':
                case 'tap_permanent': {
                    const obj = boardObjectsRef.current.find(o => o.id === input.objectId && o.controllerId === seatId);
                    if (!obj) return fail('You do not control that permanent.');
                    const rot = aiSeatRotation(seatId);
                    if (obj.quantity > 1) updateBoardObject(obj.id, { tappedQuantity: Math.min(obj.quantity, (obj.tappedQuantity || 0) + 1) });
                    else updateBoardObject(obj.id, { rotation: (rot + 90) % 360 });
                    addLog(`tapped ${obj.cardData.name}`, 'ACTION', name);
                    return ok();
                }
                case 'untap_permanent': {
                    const obj = boardObjectsRef.current.find(o => o.id === input.objectId && o.controllerId === seatId);
                    if (!obj) return fail('You do not control that permanent.');
                    const rot = aiSeatRotation(seatId);
                    if (obj.quantity > 1) updateBoardObject(obj.id, { tappedQuantity: 0 });
                    else updateBoardObject(obj.id, { rotation: rot });
                    addLog(`untapped ${obj.cardData.name}`, 'ACTION', name);
                    return ok();
                }
                case 'create_token': {
                    const opp = localOpponents.find(o => (o.id || '') === seatId);
                    const tokens = opp?.tokens || [];
                    const q = String(input.name || '').toLowerCase();
                    const tmpl = tokens.find(t => t.name.toLowerCase() === q) || tokens.find(t => t.name.toLowerCase().includes(q));
                    if (!tmpl) return fail(`No token named "${input.name}" in your token list.`);
                    const qty = Math.max(1, Math.min(20, Number(input.quantity) || 1));
                    for (let i = 0; i < qty; i++) aiSpawnCard(seatId, { ...tmpl, id: crypto.randomUUID(), isToken: true });
                    addLog(`created ${qty} ${tmpl.name} token${qty > 1 ? 's' : ''}`, 'ACTION', name);
                    return ok();
                }
                case 'add_counter': {
                    const obj = boardObjectsRef.current.find(o => o.id === input.objectId && o.controllerId === seatId);
                    if (!obj) return fail('You do not control that permanent.');
                    const cur = obj.counters?.[input.counterType] || 0;
                    const next = Math.max(0, cur + (Number(input.delta) || 0));
                    const counters = { ...obj.counters, [input.counterType]: next };
                    if (next === 0) delete counters[input.counterType];
                    updateBoardObject(obj.id, { counters });
                    addLog(`${(Number(input.delta) || 0) >= 0 ? 'added' : 'removed'} ${Math.abs(Number(input.delta) || 0)} ${input.counterType} on ${obj.cardData.name}`, 'ACTION', name);
                    return ok();
                }
                case 'move_card': {
                    const from = input.from, to = input.to;
                    let card: CardData | undefined;
                    if (from === 'battlefield') {
                        const obj = boardObjectsRef.current.find(o => o.id === input.cardId && o.controllerId === seatId);
                        if (!obj) return fail('That permanent is not on your battlefield.');
                        card = obj.cardData;
                        setBoardObjects(prev => prev.filter(o => o.id !== obj.id));
                        emitAction('REMOVE_OBJECT', { id: obj.id });
                    } else {
                        const zone = (from === 'graveyard' ? state.graveyard : from === 'exile' ? state.exile : from === 'hand' ? state.hand : from === 'library' ? state.library : null);
                        if (!zone) return fail('Unknown source zone.');
                        const idx = zone.findIndex(c => c.id === input.cardId);
                        if (idx < 0) return fail(`That card is not in your ${from}.`);
                        card = zone[idx];
                        const filtered = zone.filter(c => c.id !== card!.id);
                        if (from === 'graveyard') state.graveyard = filtered;
                        else if (from === 'exile') state.exile = filtered;
                        else if (from === 'hand') state.hand = filtered;
                        else state.library = filtered;
                    }
                    if (!card) return fail('Card not found.');
                    if (to === 'battlefield') aiSpawnCard(seatId, card);
                    else if (to === 'graveyard') state.graveyard = [...state.graveyard, card];
                    else if (to === 'exile') state.exile = [...state.exile, card];
                    else if (to === 'hand') state.hand = [...state.hand, card];
                    else if (to === 'library-top') state.library = [card, ...state.library];
                    else if (to === 'library-bottom') state.library = [...state.library, card];
                    else return fail('Unknown destination zone.');
                    addLog(`moved ${card.name} to ${String(to).replace('-', ' ')}`, 'ACTION', name);
                    return ok();
                }
                case 'declare_attackers': {
                    const attacks = Array.isArray(input.attacks) ? input.attacks : [];
                    if (!attacks.length) return fail('No attackers specified.');
                    const rot = aiSeatRotation(seatId);
                    const names: string[] = [];
                    for (const a of attacks) {
                        const obj = boardObjectsRef.current.find(o => o.id === a.objectId && o.controllerId === seatId);
                        if (!obj) continue;
                        if (obj.quantity > 1) updateBoardObject(obj.id, { tappedQuantity: Math.min(obj.quantity, (obj.tappedQuantity || 0) + 1) });
                        else updateBoardObject(obj.id, { rotation: (rot + 90) % 360 });
                        const defName = playersList.find(p => p.id === a.defenderSeatId)?.name || 'a player';
                        names.push(`${obj.cardData.name} → ${defName}`);
                    }
                    if (!names.length) return fail('None of those creatures are on your battlefield.');
                    addLog(`attacks with ${names.join(', ')}`, 'ACTION', name);
                    return ok(`Declared ${names.length} attacker(s). Defenders should assign blocks and take damage.`);
                }
                case 'adjust_life': {
                    const target = input.seatId || seatId;
                    const d = Number(input.delta) || 0;
                    const ts = localPlayerStates.current[target];
                    if (ts) ts.life = (ts.life || 40) + d;
                    if (playersList[mySeatIndex]?.id === target) setLife(prev => prev + d);
                    else setOpponentsLife(prev => ({ ...prev, [target]: ts ? ts.life : (prev[target] ?? 40) + d }));
                    const tName = playersList.find(p => p.id === target)?.name || 'a player';
                    const reason = input.reason ? ` (${input.reason})` : '';
                    addLog(`${d >= 0 ? 'gained' : 'lost'} ${Math.abs(d)} life for ${tName}${reason}`, 'ACTION', name);
                    return ok();
                }
                case 'announce': {
                    if (!input.message) return fail('No message provided.');
                    addLog(String(input.message), 'ACTION', name);
                    return ok();
                }
                case 'end_turn': {
                    return ok('Turn ended.');
                }
                default:
                    return fail(`Unknown tool: ${call.name}`);
            }
        } catch (e: any) {
            return fail(`Error applying ${call.name}: ${e?.message || e}`);
        }
    };

    const buildAiView = (seatId: string) => {
        const state = localPlayerStates.current[seatId];
        const rot = aiSeatRotation(seatId);
        const opponents = playersList.filter(p => p.id !== seatId).map(p => {
            const s = localPlayerStates.current[p.id];
            return {
                seatId: p.id,
                name: p.name,
                life: s?.life ?? opponentsLife[p.id] ?? 40,
                poison: s?.counters?.['poison'] ?? 0,
                commanders: (s?.commandZone ?? []).map(c => c.name),
                handCount: (s?.hand ?? []).filter(c => !c.isToken).length,
                commanderDamageTakenFromAi: 0,
            };
        });
        const defaultRotations: Record<string, number> = {};
        playersList.forEach((p, i) => { defaultRotations[p.id] = layout[i]?.rot ?? 0; });
        // Prepend any binding deals this seat agreed to, so the brain honors them.
        const deals = (aiDeals.current[seatId] || []).map(d => `[DEAL you agreed to] ${d}`);
        const recentLog = [...deals, ...logsRef.current.slice(0, 15).reverse().map(l => `${l.playerName}: ${l.message}`)];
        return buildGameStateView({
            turn: turnRef.current,
            aiSeatId: seatId,
            aiSeatName: aiSeatName(seatId),
            hand: state.hand,
            libraryCount: state.library.length,
            graveyard: state.graveyard,
            exileCount: state.exile.length,
            commandZone: state.commandZone,
            life: state.life,
            commanderTax: (aiCommanderCasts.current[state.commandZone[0]?.id] || 0) * 2,
            landsPlayedThisTurn: aiLandsPlayed.current[seatId] || 0,
            boardObjects: boardObjectsRef.current,
            opponents,
            defaultRotations,
            recentLog,
        });
    };

    const aiUntapAndDraw = (seatId: string) => {
        const state = localPlayerStates.current[seatId];
        if (!state) return;
        aiLandsPlayed.current[seatId] = 0;
        const rot = aiSeatRotation(seatId);
        boardObjectsRef.current
            .filter(o => o.controllerId === seatId && (o.rotation !== rot || o.tappedQuantity > 0))
            .forEach(o => updateBoardObject(o.id, { rotation: rot, tappedQuantity: 0 }));
        if (state.library.length > 0) {
            const drawn = state.library[0];
            state.library = state.library.slice(1);
            state.hand = [...state.hand, drawn];
            addLog('draws for the turn', 'ACTION', aiSeatName(seatId));
        }
    };

    const runAiTurn = async (seatId: string, opp: { name: string; deck: CardData[]; persona?: AiPersonaId; difficulty?: AiDifficulty; provider?: AiProviderId; model?: string }) => {
        const state = localPlayerStates.current[seatId];
        if (!state) { nextTurn(); return; }
        const name = opp.name;
        setAiThinkingSeat(seatId);
        try {
            // Watch from the primary seat so the AI's hand stays hidden from the human.
            if (mySeatIndex !== 0 && playersList[0]) {
                const viewed = playersList[mySeatIndex]?.id;
                if (viewed) saveLocalPlayerState(viewed);
                setMySeatIndex(0);
                loadLocalPlayerState(playersList[0].id);
            }

            aiUntapAndDraw(seatId);
            await delay(600);

            const persona = (opp.persona || 'balanced') as AiPersonaId;
            const difficulty = (opp.difficulty || 'casual') as AiDifficulty;
            const deck = deckToSummaryCards(opp.deck || []);

            let resp;
            try {
                resp = await requestTurn({ seatName: name, persona, difficulty, deck, stateView: buildAiView(seatId), provider: opp.provider, model: opp.model });
            } catch (e: any) {
                addLog(`could not take its turn (${e?.message || 'AI error'}); passing`, 'SYSTEM', name);
                nextTurn();
                return;
            }
            accumulateUsage(resp.usage);
            if (resp.text) addLog(resp.text, 'ACTION', name);

            let rounds = 0;
            while (true) {
                let ended = false;
                const results: AiToolResult[] = [];
                for (const call of resp.toolCalls) {
                    if (call.name === 'end_turn') {
                        if (call.input?.summary) addLog(`ends turn — ${call.input.summary}`, 'SYSTEM', name);
                        else addLog('ends its turn', 'SYSTEM', name);
                        ended = true;
                        results.push({ id: call.id, ok: true });
                        continue;
                    }
                    results.push(aiApplyToolCall(seatId, call));
                    await delay(750);
                }
                if (ended || resp.done) break;
                if (++rounds > 14) { addLog('turn ran long; ending', 'SYSTEM', name); break; }
                try {
                    resp = await continueTurn(resp.conversationId, results);
                } catch (e: any) {
                    addLog(`turn interrupted (${e?.message || 'AI error'})`, 'SYSTEM', name);
                    break;
                }
                accumulateUsage(resp.usage);
                if (resp.text) addLog(resp.text, 'ACTION', name);
            }

            await delay(500);
            nextTurn();
        } finally {
            setAiThinkingSeat(null);
        }
    };

    const runAiMulligan = async (opp: { id?: string; name: string; deck: CardData[]; persona?: AiPersonaId; difficulty?: AiDifficulty; provider?: AiProviderId; model?: string }) => {
        const seatId = opp.id;
        if (!seatId) return;
        const state = localPlayerStates.current[seatId];
        if (!state) return;
        setAiThinkingSeat(seatId);
        try {
            const persona = (opp.persona || 'balanced') as AiPersonaId;
            const difficulty = (opp.difficulty || 'casual') as AiDifficulty;
            const deckSummary = deckStrategySummary(opp.deck || []);
            for (let attempt = 0; attempt < 4 && !state.hasKeptHand; attempt++) {
                const hand = state.hand.filter(c => !c.isToken).map(c => ({ id: c.id, name: c.name, manaCost: c.manaCost, typeLine: c.typeLine }));
                let dec;
                try {
                    dec = await requestMulligan({ seatName: opp.name, persona, difficulty, deckSummary, hand, provider: opp.provider, model: opp.model });
                } catch {
                    state.hasKeptHand = true;
                    addLog('keeps its hand', 'ACTION', opp.name);
                    break;
                }
                accumulateUsage(dec.usage);
                if (dec.keep) {
                    if (Array.isArray(dec.bottomCards) && dec.bottomCards.length) {
                        const toBottom: CardData[] = [];
                        for (const cardName of dec.bottomCards) {
                            const found = state.hand.find(c => !c.isToken && c.name.toLowerCase() === String(cardName).toLowerCase() && !toBottom.includes(c));
                            if (found) toBottom.push(found);
                        }
                        if (toBottom.length) {
                            state.hand = state.hand.filter(c => !toBottom.includes(c));
                            state.library = [...state.library, ...toBottom];
                        }
                    }
                    state.hasKeptHand = true;
                    addLog(`keeps its hand${dec.comment ? ` — "${dec.comment}"` : ''}`, 'ACTION', opp.name);
                } else {
                    const nonToken = state.hand.filter(c => !c.isToken);
                    const tokens = state.hand.filter(c => c.isToken);
                    const shuffled = [...nonToken, ...state.library].sort(() => Math.random() - 0.5);
                    state.hand = [...shuffled.slice(0, 7), ...tokens];
                    state.library = shuffled.slice(7);
                    state.mulliganCount = (state.mulliganCount || 0) + 1;
                    addLog(`mulligans${dec.comment ? ` — "${dec.comment}"` : ''}`, 'ACTION', opp.name);
                }
            }
            if (!state.hasKeptHand) state.hasKeptHand = true; // safety after cap
        } finally {
            setAiThinkingSeat(null);
        }
    };

    // Detect whether the server has AI enabled (falls back to hot-seat otherwise).
    useEffect(() => {
        if (!isLocal) return;
        let mounted = true;
        aiStatus().then(s => { if (mounted) { setAiAvailable(!!s.enabled); setVoiceRealtimeAvailable(!!s.realtimeVoice); } }).catch(() => { });
        return () => { mounted = false; };
    }, [isLocal]);

    // Drive AI seats' turns.
    useEffect(() => {
        if (!isLocal || !aiAvailable) return;
        if (gamePhase !== 'PLAYING') return;
        const seatId = currentTurnPlayerId;
        if (!seatId) return;
        const opp = localOpponents.find(o => (o.id || '') === seatId);
        if (!opp || opp.type !== 'ai') return;
        if (aiTurnActive.current) return;
        aiTurnActive.current = true;
        runAiTurn(seatId, opp)
            .catch(e => { console.error('AI turn failed', e); nextTurn(); })
            .finally(() => { aiTurnActive.current = false; });
    }, [currentTurnPlayerId, gamePhase, isLocal, aiAvailable]);

    // Resolve AI seats' mulligan decisions during the MULLIGAN phase.
    useEffect(() => {
        if (!isLocal || !aiAvailable) return;
        if (gamePhase !== 'MULLIGAN') return;
        if (aiMulliganRunning.current) return;
        const pending = localOpponents.filter(o => o.type === 'ai' && o.id && localPlayerStates.current[o.id] && !localPlayerStates.current[o.id].hasKeptHand);
        if (!pending.length) return;
        aiMulliganRunning.current = true;
        (async () => {
            for (const opp of pending) await runAiMulligan(opp);
            aiMulliganRunning.current = false;
            if (allSeatsKept()) setGamePhase('PLAYING');
        })();
    }, [gamePhase, isLocal, aiAvailable, localOpponents]);

    // --- Voice / negotiation handlers ---
    // The AI seats the player can talk to.
    const voiceAiSeats = () => playersList.filter(p => localOpponents.some(o => (o.id || '') === p.id && o.type === 'ai'));

    const handleVoiceSend = async (seatId: string, userText: string) => {
        const text = userText.trim();
        if (!text) return;
        const opp = localOpponents.find(o => (o.id || '') === seatId);
        if (!opp || !localPlayerStates.current[seatId]) return;
        const history = voiceHistory[seatId] || [];
        setVoiceHistory(prev => ({ ...prev, [seatId]: [...(prev[seatId] || []), { role: 'user', text }] }));
        setVoiceBusy(true);
        try {
            const view = buildAiView(seatId);
            const reply = await requestVoiceReply({
                seatName: opp.name,
                persona: (opp.persona || 'balanced') as AiPersonaId,
                provider: opp.provider,
                view,
                dealLog: aiDeals.current[seatId] || [],
                history,
                userText: text,
                model: opp.model,
            });
            accumulateUsage(reply.usage);
            const spoken = reply.speak && reply.text ? reply.text : '(stays quiet)';
            setVoiceHistory(prev => ({ ...prev, [seatId]: [...(prev[seatId] || []), { role: 'assistant', text: spoken }] }));
            if (reply.deal) {
                aiDeals.current[seatId] = [...(aiDeals.current[seatId] || []), reply.deal];
                addLog(`agreed with you: ${reply.deal}`, 'SYSTEM', opp.name);
            }
            if (reply.speak && reply.text) {
                setVoiceSpeaking(true);
                try { await getVoiceBackend(voiceBackendId).speak(reply.text); } finally { setVoiceSpeaking(false); }
            }
        } catch (e: any) {
            setVoiceHistory(prev => ({ ...prev, [seatId]: [...(prev[seatId] || []), { role: 'assistant', text: `(voice error: ${e?.message || 'failed'})` }] }));
        } finally {
            setVoiceBusy(false);
        }
    };

    // Establish (or tear down) an OpenAI Realtime session for the target AI seat.
    const connectRealtime = async (seatId: string) => {
        const opp = localOpponents.find(o => (o.id || '') === seatId);
        if (!opp || !localPlayerStates.current[seatId]) return;
        rtSession.current?.disconnect();
        rtSession.current = null;
        setRtConnecting(true);
        const persona = (opp.persona || 'balanced') as AiPersonaId;
        const session = new RealtimeVoiceSession({
            onUserTranscript: (t) => setVoiceHistory(prev => ({ ...prev, [seatId]: [...(prev[seatId] || []), { role: 'user', text: t }] })),
            onAiTranscript: (t) => setVoiceHistory(prev => ({ ...prev, [seatId]: [...(prev[seatId] || []), { role: 'assistant', text: t }] })),
            onDeal: (summary) => {
                if (!summary) return;
                aiDeals.current[seatId] = [...(aiDeals.current[seatId] || []), summary];
                addLog(`agreed with you: ${summary}`, 'SYSTEM', opp.name);
            },
            onState: (s) => {
                if (s.listening !== undefined) setVoiceListening(s.listening);
                if (s.speaking !== undefined) setVoiceSpeaking(s.speaking);
            },
            onError: (m) => addLog(`voice error: ${m}`, 'SYSTEM', opp.name),
            consult: (question) => requestConsult({
                question, seatName: opp.name, persona, provider: opp.provider,
                view: buildAiView(seatId), dealLog: aiDeals.current[seatId] || [],
            }),
        });
        try {
            await session.connect({ seatName: opp.name, persona, provider: opp.provider, model: opp.model, view: buildAiView(seatId), dealLog: aiDeals.current[seatId] || [] });
            rtSession.current = session;
        } catch (e: any) {
            addLog(`could not start realtime voice: ${e?.message || 'error'}. Falling back to browser voice.`, 'SYSTEM', opp.name);
            session.disconnect();
            setVoiceBackendId('web-speech');
        } finally {
            setRtConnecting(false);
        }
    };

    // Connect/disconnect the realtime session as the backend/target/panel changes.
    useEffect(() => {
        const useRt = voiceOpen && voiceBackendId === 'openai-realtime' && !!voiceTargetSeat;
        if (useRt) {
            connectRealtime(voiceTargetSeat!);
        } else if (rtSession.current) {
            rtSession.current.disconnect();
            rtSession.current = null;
        }
        return () => { rtSession.current?.disconnect(); rtSession.current = null; };
    }, [voiceOpen, voiceBackendId, voiceTargetSeat]);

    const startTalk = () => {
        if (voiceBackendId === 'openai-realtime') {
            rtSession.current?.startTalk();
            return;
        }
        if (!voiceTargetSeat || voiceBusy) return;
        getVoiceBackend(voiceBackendId).cancelSpeech();
        setVoicePartial('');
        setVoiceListening(true);
        getVoiceBackend(voiceBackendId).startListening(setVoicePartial);
    };
    const endTalk = async () => {
        if (voiceBackendId === 'openai-realtime') {
            rtSession.current?.endTalk();
            return;
        }
        if (!voiceListening) return;
        setVoiceListening(false);
        const said = await getVoiceBackend(voiceBackendId).stopListening();
        setVoicePartial('');
        if (said && voiceTargetSeat) handleVoiceSend(voiceTargetSeat, said);
    };
    const sendTypedVoice = () => {
        const t = voiceTextInput.trim();
        if (!t || !voiceTargetSeat) return;
        setVoiceTextInput('');
        if (voiceBackendId === 'openai-realtime') {
            setVoiceHistory(prev => ({ ...prev, [voiceTargetSeat]: [...(prev[voiceTargetSeat] || []), { role: 'user', text: t }] }));
            rtSession.current?.sendText(t);
            return;
        }
        handleVoiceSend(voiceTargetSeat, t);
    };

    // Default the talk target to the first AI seat when the panel opens.
    useEffect(() => {
        if (voiceOpen && !voiceTargetSeat) {
            const first = voiceAiSeats()[0];
            if (first) setVoiceTargetSeat(first.id);
        }
    }, [voiceOpen]);


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
            const allKept = allSeatsKept();
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
        const currentPlayerId = playersList[mySeatIndex]?.id;
        if (!currentPlayerId) return;
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
            const viewedPlayerId = playersList[mySeatIndex]?.id;
            if (viewedPlayerId) saveLocalPlayerState(viewedPlayerId);

            const currentIndex = playersList.findIndex(p => p.id === currentTurnPlayerId);
            const nextIndex = (currentIndex + 1) % playersList.length;
            const nextPlayer = playersList[nextIndex];
            if (!nextPlayer) return;

            setCurrentTurnPlayerId(nextPlayer.id);
            if (gamePhase === 'PLAYING' && nextIndex <= currentIndex) setTurn(turn + 1);
            setTurnStartTime(Date.now());

            // Switch View to Next Player
            setMySeatIndex(nextIndex);
            loadLocalPlayerState(nextPlayer.id);
            return;
        }

        if (playersList.length <= 1) return;
        const duration = formatTime(Date.now() - turnStartTime);
        const durationMs = Date.now() - turnStartTime;

        // Ask the server to advance the turn. It authoritatively picks the next
        // CONNECTED seat (skipping disconnected players) and broadcasts a sequenced
        // PASS_TURN to everyone — including us — so all clients converge. We do NOT
        // optimistically move the pointer here; the authoritative echo drives it.
        emitAction('PASS_TURN', { prevDuration: duration });

        if (currentTurnPlayerId === socket.id) {
            // Record our turn duration once and broadcast the updated stats.
            setGameStats(prev => {
                const current = prev[socket.id] || emptyStats;
                const newStats = { ...current, totalTurnTime: current.totalTurnTime + durationMs };
                socket.emit('game_action', { room: roomId, action: 'UPDATE_STATS', data: { playerId: socket.id, stats: newStats } });
                return { ...prev, [socket.id]: newStats };
            });
        }

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

    // True when this client controls the active turn. In local hotseat/AI games
    // the human is parked at a seat, so only allow phase control when the seat
    // being viewed is the active one (prevents driving an AI seat's phases).
    const isMyTurn = () => {
        if (isLocal) {
            if (!currentTurnPlayerId) return true; // pre-assignment (game start)
            return playersList[mySeatIndex]?.id === currentTurnPlayerId;
        }
        return currentTurnPlayerId === (socket.id || 'local-player');
    };

    const mySeatId = () => isLocal ? (playersList[mySeatIndex]?.id ?? 'player-0') : (socket.id || 'local-player');

    // --- Combat state + sync ---
    const updateCombat = (next: CombatState | null) => {
        setCombat(next);
        combatRef.current = next;
        if (!isLocal) emitAction('COMBAT_UPDATE', { combat: next });
    };

    const addAttacker = (objectId: string, defenderSeatId: string) => {
        const c = combatRef.current;
        if (!c || c.step !== 'attackers') return;
        const obj = boardObjectsRef.current.find(o => o.id === objectId);
        const existing = c.attackers.find(a => a.objectId === objectId);
        if (existing) {
            updateCombat({ ...c, attackers: c.attackers.map(a => a.objectId === objectId ? { ...a, defenderSeatId } : a) });
        } else {
            updateCombat({ ...c, attackers: [...c.attackers, { objectId, defenderSeatId }] });
        }
        const defName = playersList.find(p => p.id === defenderSeatId)?.name || 'a player';
        addLog(`${obj?.cardData.name || 'a creature'} attacks ${defName}`);
    };
    const removeAttacker = (objectId: string) => {
        const c = combatRef.current;
        if (!c) return;
        updateCombat({ ...c, attackers: c.attackers.filter(a => a.objectId !== objectId), blocks: c.blocks.filter(b => b.attackerObjectId !== objectId) });
    };
    const addBlock = (attackerObjectId: string, blockerObjectId: string) => {
        const c = combatRef.current;
        if (!c || c.step !== 'blockers') return;
        // A blocker blocks at most one attacker; multiple blockers per attacker is fine.
        const blocks = c.blocks.filter(b => b.blockerObjectId !== blockerObjectId);
        updateCombat({ ...c, blocks: [...blocks, { attackerObjectId, blockerObjectId }] });
        const bl = boardObjectsRef.current.find(o => o.id === blockerObjectId);
        const at = boardObjectsRef.current.find(o => o.id === attackerObjectId);
        addLog(`${bl?.cardData.name || 'a creature'} blocks ${at?.cardData.name || 'an attacker'}`);
    };
    const removeBlock = (blockerObjectId: string) => {
        const c = combatRef.current;
        if (!c) return;
        updateCombat({ ...c, blocks: c.blocks.filter(b => b.blockerObjectId !== blockerObjectId) });
    };

    // Advance one turn sub-phase. Combat expands into declare-attackers ->
    // declare-blockers -> resolve before continuing to Main 2. The combat panel is
    // a tracking aid only — it does not attribute damage or tap anything; players
    // apply results by hand. Past END passes the turn. Only the active player may
    // advance.
    const advancePhase = () => {
        if (gamePhase !== 'PLAYING') { nextTurn(); return; }
        if (!isMyTurn()) return;

        // Step through the combat sub-phases while in COMBAT.
        const c = combatRef.current;
        if (turnPhaseRef.current === 'COMBAT' && c?.active) {
            if (c.step === 'attackers') { 
                if (c.attackers.length === 0) {
                    updateCombat({ ...c, active: false });
                    setTurnPhase('MAIN2'); turnPhaseRef.current = 'MAIN2';
                    if (!isLocal) emitAction('PHASE_CHANGE', { phase: 'MAIN2' });
                    return;
                }
                updateCombat({ ...c, step: 'blockers' }); return; 
            }
            if (c.step === 'blockers') { updateCombat({ ...c, step: 'resolve' }); return; }
            if (c.step === 'resolve') {
                updateCombat({ ...c, active: false });
                setTurnPhase('MAIN2'); turnPhaseRef.current = 'MAIN2';
                if (!isLocal) emitAction('PHASE_CHANGE', { phase: 'MAIN2' });
                return;
            }
        }

        const idx = TURN_PHASES.indexOf(turnPhaseRef.current);
        if (idx < 0 || idx >= TURN_PHASES.length - 1) {
            nextTurn();
            return;
        }
        const next = TURN_PHASES[idx + 1];
        setTurnPhase(next);
        turnPhaseRef.current = next;
        if (!isLocal) emitAction('PHASE_CHANGE', { phase: next });
        if (next === 'DRAW' && turn > 1) drawCard(1);
        if (next === 'COMBAT') {
            updateCombat({ active: true, step: 'attackers', attackerSeatId: mySeatId(), attackers: [], blocks: [] });
        }
    };

    // Begin a combat drag from a creature (called by the Card on pointer-down when
    // it is an eligible attacker/blocker this step).
    const onCombatStart = (objectId: string, x: number, y: number) => {
        setCombatDragFrom(objectId);
        setCombatDragPos({ x, y });
    };

    // Track the combat drag with window listeners; resolve the target on release.
    useEffect(() => {
        if (!combatDragFrom) return;
        const move = (e: PointerEvent) => setCombatDragPos({ x: e.clientX, y: e.clientY });
        const up = (e: PointerEvent) => {
            const el = document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null;
            const c = combatRef.current;
            if (el && c) {
                if (c.step === 'attackers') {
                    // Drop on an opponent's mat, or on any permanent they control.
                    const mat = el.closest('[data-combat-target]') as HTMLElement | null;
                    let defId = mat?.getAttribute('data-combat-target') || undefined;
                    if (!defId) {
                        const oid = (el.closest('[data-combat-obj]') as HTMLElement | null)?.getAttribute('data-combat-obj');
                        const o = oid ? boardObjectsRef.current.find(x => x.id === oid) : undefined;
                        if (o && o.controllerId !== c.attackerSeatId) defId = o.controllerId;
                    }
                    if (defId && defId !== c.attackerSeatId) addAttacker(combatDragFrom, defId);
                } else if (c.step === 'blockers') {
                    const target = el.closest('[data-combat-obj]') as HTMLElement | null;
                    const atkId = target?.getAttribute('data-combat-obj');
                    if (atkId && c.attackers.some(a => a.objectId === atkId)) addBlock(atkId, combatDragFrom);
                }
            }
            setCombatDragFrom(null);
            setCombatDragPos(null);
        };
        // Capture phase so card/container pointer handlers (which stopPropagation)
        // can't swallow the release before we resolve the combat target.
        window.addEventListener('pointermove', move, true);
        window.addEventListener('pointerup', up, true);
        return () => { window.removeEventListener('pointermove', move, true); window.removeEventListener('pointerup', up, true); };
    }, [combatDragFrom]);

    // Advance forward to a specific phase (clicking ahead on the phase strip),
    // firing each phase's auto-behavior along the way. Never steps backward and
    // never passes the turn (stops at the target).
    const goToPhase = (target: TurnPhase) => {
        if (gamePhase !== 'PLAYING' || !isMyTurn()) return;
        setTurnPhase(target);
        turnPhaseRef.current = target;
        if (!isLocal) emitAction('PHASE_CHANGE', { phase: target });
        
        if (target === 'COMBAT') {
            updateCombat({ active: true, step: 'attackers', attackerSeatId: mySeatId(), attackers: [], blocks: [] });
        } else if (combatRef.current?.active) {
            updateCombat({ ...combatRef.current, active: false });
        }
    };

    // Turn-start: when the synced turn pointer advances to a new turn, reset the
    // phase strip to UNTAP on every client, and auto-untap the active player's
    // permanents. Driven off the already-synced turn number + current player, so
    // it needs no extra broadcast. The key-guard makes the body run once per turn.
    useEffect(() => {
        if (gamePhase !== 'PLAYING') return;
        const key = `${turn}:${currentTurnPlayerId}`;
        if (key === lastTurnKeyRef.current) return;
        lastTurnKeyRef.current = key;
        setTurnPhase('UNTAP');
        if (combatRef.current) { setCombat(null); combatRef.current = null; } // combat never carries across turns
        playSound('turnStart');
        if (!isMyTurn()) return;
        const myId = isLocal ? playersList[mySeatIndex]?.id : (socket.id || 'local-player');
        const myRot = layout[mySeatIndex]?.rot || 0;
        const mine = boardObjectsRef.current.filter(o => o.controllerId === myId && (o.tappedQuantity > 0 || o.rotation !== myRot));
        if (mine.length === 0) return;
        setBoardObjects(prev => prev.map(o =>
            (o.controllerId === myId && (o.tappedQuantity > 0 || o.rotation !== myRot))
                ? { ...o, rotation: myRot, tappedQuantity: 0 } : o));
        if (!isLocal) mine.forEach(o => emitAction('UPDATE_OBJECT', { id: o.id, updates: { rotation: myRot, tappedQuantity: 0 } }));
        addLog('untapped for turn');
    }, [turn, currentTurnPlayerId, gamePhase]);

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


        addLog("untapped all permanents");
    };

    // Make a token copy of a permanent (white border, removable like a token).
    const copyBoardObject = (id: string) => {
        const obj = boardObjects.find(o => o.id === id);
        if (!obj) return;
        const newId = crypto.randomUUID();
        const copy: BoardObject = {
            ...obj, id: newId, quantity: 1, tappedQuantity: 0, counters: {},
            x: obj.x + 30, y: obj.y + 30, z: maxZ + 1,
            cardData: { ...obj.cardData, id: newId, isToken: true, isCopy: true },
        };
        setMaxZ(prev => prev + 1);
        setBoardObjects(prev => [...prev, copy]);
        emitAction('ADD_OBJECT', copy);
        addLog(`copied ${obj.cardData.name}`);
        playSound('cardPlay');
    };

    // Take control of an opponent's permanent (changes its controller to me).
    const stealBoardObject = (id: string) => {
        const obj = boardObjects.find(o => o.id === id);
        if (!obj) return;
        const myId = getMyId();
        if (obj.controllerId === myId) return;
        const myRot = layout[mySeatIndex]?.rot ?? 0;
        updateBoardObject(id, { controllerId: myId, rotation: myRot, ownerId: obj.ownerId || obj.controllerId });
        addLog(`took control of ${obj.cardData.name}`);
    };

    // Open the change-art picker for a board object and load its printings.
    const openChangeArt = async (id: string) => {
        const obj = boardObjects.find(o => o.id === id);
        if (!obj) return;
        setChangeArtFor(obj);
        setArtPrints([]);
        setArtLoading(true);
        try {
            const prints = await fetchPrints(obj.cardData.name);
            setArtPrints(prints);
        } finally {
            setArtLoading(false);
        }
    };

    // Swap the chosen printing's art onto the selected board object (synced).
    const applyArt = (print: CardData) => {
        if (!changeArtFor) return;
        const newCard = { ...changeArtFor.cardData, imageUrl: print.imageUrl, backImageUrl: print.backImageUrl, scryfallId: print.scryfallId };
        updateBoardObject(changeArtFor.id, { cardData: newCard });
        addLog(`changed art of ${changeArtFor.cardData.name}`);
        setChangeArtFor(null);
        setArtPrints([]);
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

    const updateBoardObject = (id: string, updates: Partial<BoardObject>) => {
        setBoardObjects(prev => {
            const movingObj = prev.find(o => o.id === id);
            let nextState = prev;
            const changes: { id: string, updates: Partial<BoardObject> }[] = [];

            if (movingObj && movingObj.type === 'CARD' && updates.x !== undefined && updates.y !== undefined) {
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
                } else {
                    changes.push({ id, updates });
                    nextState = prev.map(obj => obj.id === id ? { ...obj, ...updates } : obj);
                }
            } else {
                // Check for Tapping
                const myId = isLocal ? playersList[mySeatIndex].id : socket.id;
                if (movingObj && movingObj.controllerId === myId) {
                    const isTap = (updates.rotation === 90 && movingObj.rotation === 0) ||
                        (updates.tappedQuantity !== undefined && updates.tappedQuantity > movingObj.tappedQuantity);
                    if (isTap) {
                        const cardName = movingObj.cardData.name;
                        updateMyStats({
                            tappedCounts: {
                                ...gameStats[myId]?.tappedCounts,
                                [cardName]: (gameStats[myId]?.tappedCounts?.[cardName] || 0) + 1
                            }
                        });

                        // Record undo for tap
                        pushUndo({
                            type: 'TAP_CARD',
                            objectId: id,
                            previousRotation: movingObj.rotation,
                            previousTappedQuantity: movingObj.tappedQuantity
                        });

                    }
                }
                changes.push({ id, updates });
                nextState = prev.map(obj => obj.id === id ? { ...obj, ...updates } : obj);
            }

            changes.forEach(change => {
                emitAction('UPDATE_OBJECT', change);
            });
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
        setMaxZ(prev => prev + 1);
        setBoardObjects(prev => [...prev, newObject]);
        emitAction('ADD_OBJECT', newObject);
        updateMyStats({ cardsPlayed: (gameStats[getMyId()]?.cardsPlayed || 0) + 1 });
        if (!card.isToken) setHand(prev => prev.filter(c => c.id !== card.id));

        // Record undo
        pushUndo({ type: 'PLAY_CARD', objectId: newObject.id, card, fromZone: 'HAND' });

        addLog(`played ${card.name} ${card.isToken ? '(Token)' : ''}`);
        playSound('cardPlay');
    };



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
        }
    }, [undoHistory, boardObjects]);

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
        playSound('draw');
    };

    const playCommander = (card: CardData) => {
        setCommandZone(prev => prev.filter(c => c.id !== card.id));
        if (card.isCompanion) {
            setHand(prev => [...prev, card]);
            addLog(`put companion ${card.name} into hand`);
            playSound('draw');
            return;
        }
        
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
        setMaxZ(prev => prev + 1);
        setBoardObjects(prev => [...prev, newObject]);
        emitAction('ADD_OBJECT', newObject);
        updateMyStats({ cardsPlayed: (gameStats[getMyId()]?.cardsPlayed || 0) + 1 });
        addLog(`cast commander ${card.name}`);
        playSound('cardPlay');
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
        setMaxZ(prev => prev + 1);
        setBoardObjects(prev => [...prev, newObject]);
        emitAction('ADD_OBJECT', newObject);
        updateMyStats({ cardsPlayed: (gameStats[getMyId()]?.cardsPlayed || 0) + 1 });
        addLog(`played top card of library`);
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
        setMaxZ(prev => prev + 1);
        setBoardObjects(prev => [...prev, newObject]);
        emitAction('ADD_OBJECT', newObject);
        updateMyStats({ cardsPlayed: (gameStats[getMyId()]?.cardsPlayed || 0) + 1 });
        addLog(`returned ${card.name} from graveyard to battlefield`);
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

    const sendToZone = (card: CardData, zone: 'GRAVEYARD' | 'EXILE', objOwnerId?: string) => {
        if (card.isToken || card.isCopy) {
            addLog(`token ${card.name} vanished into ${zone.toLowerCase()}`);
            if (!card.isToken) setHand(prev => prev.filter(c => c.id !== card.id));
            return;
        }

        if (objOwnerId && objOwnerId !== getMyId()) {
            emitAction('RETURN_TO_OWNER_ZONE', { card, ownerId: objOwnerId, zone });
            addLog(`returned ${card.name} to owner's ${zone.toLowerCase()}`);
            if (!card.isToken) setHand(prev => prev.filter(c => c.id !== card.id));
            return;
        }

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
            if (!obj.cardData.isToken && !obj.cardData.isCopy) {
                const actualOwner = obj.ownerId || obj.controllerId;
                if (actualOwner && actualOwner !== getMyId()) {
                    emitAction('RETURN_TO_OWNER_ZONE', { card: obj.cardData, ownerId: actualOwner, zone: 'GRAVEYARD' });
                    addLog(`returned ${obj.cardData.name} to owner's graveyard`);
                } else {
                    setGraveyard(prev => [obj.cardData, ...prev]);
                    addLog(`moved ${obj.cardData.name} from battlefield to graveyard`);
                }
            } else {
                addLog(`token ${obj.cardData.name} vanished upon entering graveyard`);
            }
            setBoardObjects(prev => prev.filter(o => o.id !== id));
            emitAction('REMOVE_OBJECT', { id });
            return;
        }
        if (checkZoneCollision(x, y, mySeatIndex, 'EXILE')) {
            if (!obj.cardData.isToken && !obj.cardData.isCopy) {
                const actualOwner = obj.ownerId || obj.controllerId;
                if (actualOwner && actualOwner !== getMyId()) {
                    emitAction('RETURN_TO_OWNER_ZONE', { card: obj.cardData, ownerId: actualOwner, zone: 'EXILE' });
                    addLog(`returned ${obj.cardData.name} to owner's exile`);
                } else {
                    setExile(prev => [obj.cardData, ...prev]);
                    addLog(`exiled ${obj.cardData.name} from battlefield`);
                }
            } else {
                addLog(`token ${obj.cardData.name} vanished into exile`);
            }
            setBoardObjects(prev => prev.filter(o => o.id !== id));
            emitAction('REMOVE_OBJECT', { id });
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

    // Tap/untap the card currently under the pointer (bound to 'T' by default).
    // Only affects permanents you control, mirroring the card's own tap toggle.
    const tapHoveredCard = () => {
        if (!hoveredCardId) return;
        const obj = boardObjects.find(o => o.id === hoveredCardId);
        if (!obj) return;
        const myId = isLocal ? playersList[mySeatIndex]?.id : (socket.id || 'local-player');
        if (obj.controllerId !== myId) return;
        const defaultRot = layout[mySeatIndex]?.rot || 0;
        if (obj.quantity > 1) {
            const allTapped = obj.tappedQuantity >= obj.quantity;
            updateBoardObject(obj.id, { tappedQuantity: allTapped ? 0 : obj.quantity });
            addLog(`${allTapped ? 'untapped' : 'tapped'} stack of ${obj.quantity} ${obj.cardData.name}s`);
        } else {
            const isTapped = obj.rotation !== defaultRot;
            updateBoardObject(obj.id, { rotation: isTapped ? defaultRot : (defaultRot + 90) % 360 });
            addLog(`${isTapped ? 'untapped' : 'tapped'} ${obj.cardData.name}`);
        }
    };

    // Run a rebindable action by its registry id.
    const dispatchAction = (id: string) => {
        switch (id) {
            case 'tapHovered': tapHoveredCard(); break;
            case 'untapAll': untapAll(); break;
            case 'draw': drawCard(1); break;
            case 'shuffle': shuffleLibrary(); break;
            case 'playCommander':
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
            case 'rollDice': rollDice(6); break;
            case 'spawnCounter': spawnCounter(); break;
            case 'nextTurn': advancePhase(); break;
            case 'lifeUp': handleLifeChange(1); break;
            case 'lifeDown': handleLifeChange(-1); break;
            case 'searchLibrary': openSearch('LIBRARY'); break;
            case 'searchExile': openSearch('EXILE'); break;
            case 'searchGraveyard': openSearch('GRAVEYARD'); break;
            case 'searchTokens': openSearch('TOKENS'); break;
            case 'toggleLog': setIsLogOpen(prev => !prev); break;
            case 'toggleStats': setShowStatsModal(prev => !prev); break;
            case 'toggleCmdrDamage': setShowCmdrDamage(prev => !prev); break;
            case 'toggleOpponentView': setIsOpponentViewOpen(prev => !prev); break;
            case 'toggleShortcuts': setShowShortcuts(prev => !prev); break;
        }
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
        // Capturing a rebind takes priority over every other key.
        if (rebindingActionId) {
            e.preventDefault();
            const k = e.key === ' ' ? ' ' : e.key.toLowerCase();
            if (k === 'escape') { setRebindingActionId(null); return; }
            if (['shift', 'control', 'alt', 'meta'].includes(k)) return; // wait for a real key
            if (k === ' ' || k === 'tab') return; // reserved for pan / focus
            assignKeyBinding(rebindingActionId, k);
            return;
        }

        if (['INPUT', 'TEXTAREA'].includes((e.target as HTMLElement).tagName)) return;

        const key = e.key.toLowerCase();

        // Fixed, non-rebindable keys.
        if (key === ' ') {
            if (!isSpacePressed.current) {
                isSpacePressed.current = true;
                setView(v => ({ ...v })); // Force re-render for cursor update
            }
            return;
        }
        if (key === 'alt') {
            if (e.location === 1) { // Left Alt
                e.preventDefault();
                setAreTokensExpanded(prev => !prev);
            }
            return;
        }
        if (key === 'tab') { e.preventDefault(); advancePhase(); return; }
        if (key === 'z' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); handleUndo(); return; }
        if (key === 'arrowleft') {
            if (isOpponentViewOpen) setSelectedOpponentIndex(prev => (prev - 1 + (playersList.length - 1)) % (playersList.length - 1));
            return;
        }
        if (key === 'arrowright') {
            if (isOpponentViewOpen) setSelectedOpponentIndex(prev => (prev + 1) % (playersList.length - 1));
            return;
        }

        // Number keys 1-0 play the Nth non-token hand card (fixed).
        const num = parseInt(e.key);
        if (!isNaN(num) && e.key.length === 1) {
            const idx = num === 0 ? 9 : num - 1;
            const cards = hand.filter(c => !c.isToken);
            if (cards[idx]) playCardFromHand(cards[idx]);
            return;
        }

        // Rebindable actions dispatch through the user's keybinding map.
        const actionId = keyToAction[key];
        if (actionId) {
            if (key === 'arrowup' || key === 'arrowdown') e.preventDefault();
            dispatchAction(actionId);
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
        else if (source === 'SIDEBOARD') items = sideboard.map(c => ({ card: c, isRevealed: true }));
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
        let sourceList = searchModal.source === 'LIBRARY' ? library : searchModal.source === 'GRAVEYARD' ? graveyard : searchModal.source === 'SIDEBOARD' ? sideboard : exile;
        const rest = sourceList.filter(c => !trayIds.has(c.id));

        let newLib = [...library], newGrave = [...graveyard], newExile = [...exile], newHand = [...hand];
        if (searchModal.source === 'LIBRARY') newLib = rest;
        else if (searchModal.source === 'GRAVEYARD') newGrave = rest;
        else if (searchModal.source === 'EXILE') newExile = rest;
        else if (searchModal.source === 'SIDEBOARD') setSideboard(rest);

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
    const handleSearchAction = (id: string, action: 'HAND' | 'STEAL' | 'CLONE') => {
        const item = searchModal.items.find(i => i.card.id === id);
        if (!item) return;
        
        if (action === 'HAND') {
            const newCard = { ...item.card, id: crypto.randomUUID() };
            setHand(prev => [...prev, newCard]); 
            addLog(`added ${newCard.name} to hand`); 
        } else if (action === 'STEAL' || action === 'CLONE') {
            const newObjId = crypto.randomUUID();
            const obj: BoardObject = {
                id: newObjId,
                type: 'CARD',
                cardData: action === 'CLONE' ? { ...item.card, id: crypto.randomUUID(), isToken: true, isCopy: true } : item.card,
                x: 0, y: 0, z: maxZ + 1,
                rotation: 0,
                isFaceDown: false,
                isTransformed: false,
                counters: {},
                commanderDamage: {},
                controllerId: socket.id,
                ownerId: action === 'STEAL' ? searchModal.playerId : socket.id,
                quantity: 1, tappedQuantity: 0
            };
            setMaxZ(p => p + 1);
            setBoardObjects(prev => [...prev, obj]);
            emitAction('ADD_OBJECT', { object: obj });
            
            const targetName = playersList.find(p => p.id === searchModal.playerId)?.name || 'opponent';
            addLog(`${action === 'STEAL' ? 'stole' : 'cloned'} ${item.card.name} from ${targetName}'s ${searchModal.source.toLowerCase()}`);
            
            if (action === 'STEAL' && searchModal.playerId) {
                emitAction('STEAL_FROM_ZONE', { 
                    targetPlayerId: searchModal.playerId, 
                    zone: searchModal.source, 
                    cardId: item.card.id 
                });
                setSearchModal(prev => ({ ...prev, items: prev.items.filter(i => i.card.id !== id) }));
            }
        }
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
            // Pan with: middle button, right button (drag-pan), space+left, or any
            // touch/pen drag. Right-button pans the board; a plain right-click (no
            // movement) is swallowed by onContextMenu below so no browser menu shows.
            if (e.button === 1 || e.button === 2 || (e.button === 0 && (isMobile || !isMouse || isSpacePressed.current))) {
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
        if (e.button === 1 || e.button === 2 || (e.button === 0 && (!isMouse || isSpacePressed.current))) {
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
            // Right-button drags the board (see pointer-down); swallow the browser
            // context menu on the play surface so the pan gesture feels native.
            // Cards handle their own right-click (they stopPropagation), so their
            // behavior is unaffected.
            onContextMenu={(e) => e.preventDefault()}
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
                                matUrl={appearanceFor(p.id).matUrl}
                                sleeveUrl={appearanceFor(p.id).sleeveUrl}
                                matTransform={appearanceFor(p.id).matTransform}
                                sleeveTransform={appearanceFor(p.id).sleeveTransform}
                                combatTargetId={p.id}
                                topGraveyardCard={isMe ? graveyard[0] : undefined}
                                isShuffling={isMe ? isShuffling : false}
                                isControlled={isMe}
                                commanders={isMe ? commandZone : (isLocal ? (localPlayerStates.current[p.id]?.commandZone || []) : (opponentsCommanders[p.id] || []))}
                                onDraw={isMe ? () => drawCard(1) : (isLocal ? () => { } : () => requestViewZone('LIBRARY', p.id))}
                                onShuffle={isMe ? shuffleLibrary : () => { }}
                                onOpenSearch={isMe ? openSearch : (source) => isLocal ? openSearch(source, p.id) : (source === 'LIBRARY' ? requestViewZone(source, p.id) : openSearch(source, p.id))}
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

                    // Combat eligibility for this card this step.
                    let objCombatMode: 'attack' | 'block' | null = null;
                    if (combat?.active) {
                        const iControlObj = isLocal || isControlled;
                        if (combat.step === 'attackers' && obj.controllerId === combat.attackerSeatId && iControlObj) objCombatMode = 'attack';
                        else if (combat.step === 'blockers' && obj.controllerId !== combat.attackerSeatId && iControlObj) objCombatMode = 'block';
                    }
                    const objIsAttacker = !!combat?.attackers.some(a => a.objectId === obj.id);
                    const objIsBlocker = !!combat?.blocks.some(b => b.blockerObjectId === obj.id);

                    return (
                        <div key={obj.id} className="pointer-events-auto">
                            <Card
                                object={obj}
                                sleeveColor={objSleeveColor}
                                sleeveUrl={appearanceFor(obj.controllerId).sleeveUrl}
                                sleeveTransform={appearanceFor(obj.controllerId).sleeveTransform}
                                isControlledByMe={isControlled}
                                onCopy={copyBoardObject}
                                onSteal={stealBoardObject}
                                combatMode={objCombatMode}
                                onCombatStart={onCombatStart}
                                isCombatAttacker={objIsAttacker}
                                isCombatBlocker={objIsBlocker}
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
            tabIndex={0}
            onKeyDown={handleKeyDown}
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
                        {isLocal && <span className="text-blue-400 font-bold uppercase tracking-widest">{playersList[mySeatIndex]?.name}</span>}
                        {mulliganSelectionMode
                            ? `Select ${freeMulligan ? Math.max(0, mulliganCount - 1) : mulliganCount} cards to put on the bottom of your library.`
                            : `You have drawn 7 cards. ${mulliganCount > 0 ? `(Mulligan #${mulliganCount}${freeMulligan && mulliganCount === 1 ? ' - Free' : ''})` : ''}`
                        }
                    </p>

                    {!mulliganSelectionMode ? (
                        <>
                            {/* Larger Card Grid for visibility */}
                            <div className={`flex ${isMobile ? 'overflow-x-auto snap-x snap-mandatory w-full px-[10vw] pb-8 gap-4 items-center' : 'justify-center gap-6 flex-wrap max-w-[90vw]'} mb-12`}>
                                {isLocal && playersList[mySeatIndex]?.id.startsWith('ai-') ? (
                                    <div className="text-gray-400 italic text-xl py-12">
                                        AI is making mulligan decisions...
                                    </div>
                                ) : (
                                    hand.filter(c => !c.isToken).map((card, idx) => (
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
                                    ))
                                )}
                            </div>

                            {!isLocal || !playersList[mySeatIndex]?.id.startsWith('ai-') ? (
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
                            ) : null}
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

            {/* --- UI: Top Bar --- */}
            <div className="flex-none min-h-11 md:min-h-16 safe-area-pt bg-gray-900/90 border-b border-gray-700 flex items-center justify-between px-2 md:px-6 z-50 backdrop-blur-md relative">
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

                    {/* Turn sub-phase strip. Enter (or a click) advances; advancing
                        past End passes the turn. Read-only when it isn't your turn. */}
                    {gamePhase === 'PLAYING' && (
                        <>
                            <div className="hidden lg:flex items-center gap-0.5 bg-gray-800 rounded-lg p-1 border border-gray-600">
                                {TURN_PHASES.map(p => {
                                    const active = turnPhase === p;
                                    const mine = isMyTurn();
                                    return (
                                        <button
                                            key={p}
                                            onClick={() => goToPhase(p)}
                                            disabled={!mine}
                                            className={`px-2 py-1 rounded text-[11px] font-bold transition-colors ${active ? 'bg-blue-600 text-white shadow' : 'text-gray-400 hover:text-white hover:bg-gray-700'} ${!mine ? 'opacity-60 cursor-not-allowed hover:bg-transparent hover:text-gray-400' : ''}`}
                                            title={mine ? `Advance to ${PHASE_LABELS[p]}` : `Current phase: ${PHASE_LABELS[turnPhase]}`}
                                        >
                                            {PHASE_LABELS[p]}
                                        </button>
                                    );
                                })}
                            </div>
                            <button
                                onClick={advancePhase}
                                disabled={!isMyTurn()}
                                className="lg:hidden flex items-center gap-1 px-2 py-1 bg-gray-800 rounded-lg border border-gray-600 text-[11px] font-bold text-blue-300 disabled:opacity-50 disabled:text-gray-500 active:scale-95 transition"
                                title="Tap to advance phase"
                            >
                                {PHASE_LABELS[turnPhase]} <ChevronRight size={12} />
                            </button>
                        </>
                    )}

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

                    <div className="relative">
                        <button 
                            onClick={(e) => { setShowDiceMenu(!showDiceMenu); }} 
                            onContextMenu={(e) => { e.preventDefault(); setShowDiceMenu(!showDiceMenu); }}
                            className="hidden md:flex items-center gap-2 px-3 py-1 bg-gray-800 border border-gray-600 rounded hover:bg-gray-700 text-yellow-500" 
                            title="Roll Dice"
                        >
                            <Dices size={20} />
                            <ChevronDown size={14} className="ml-1 opacity-70" />
                        </button>
                        
                        {showDiceMenu && (
                            <div className="absolute top-full right-0 mt-2 w-32 bg-gray-800 border border-gray-600 rounded-lg shadow-xl overflow-hidden z-[9000]">
                                {[2, 4, 6, 10, 12, 20, 100].map(sides => (
                                    <button 
                                        key={sides}
                                        onClick={() => { rollDice(sides); setShowDiceMenu(false); }}
                                        className="w-full text-left px-4 py-2 hover:bg-gray-700 text-white font-bold text-sm"
                                    >
                                        {sides === 2 ? 'Coin Flip' : `D${sides}`}
                                    </button>
                                ))}
                            </div>
                        )}
                    </div>

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
                    {sideboard.length > 0 && (
                        <button
                            onClick={() => openSearch('SIDEBOARD')}
                            className="p-2 rounded-lg transition-colors hover:bg-gray-800 text-indigo-400 hover:text-indigo-300 relative"
                            title={`Sideboard (${sideboard.length})`}
                        >
                            <Shield size={20} />
                            <span className="absolute -top-1 -right-1 bg-indigo-600 text-white text-[9px] font-bold rounded-full min-w-[15px] h-[15px] flex items-center justify-center px-0.5 border border-gray-900">{sideboard.length}</span>
                        </button>
                    )}
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
                        <div className="relative">
                            <button 
                                onClick={() => { setShowDiceMenu(!showDiceMenu); }} 
                                onContextMenu={(e) => { e.preventDefault(); setShowDiceMenu(!showDiceMenu); }}
                                className="w-full bg-gray-800 p-4 rounded-xl border border-gray-700 flex flex-col items-center gap-2"
                            >
                                <Dices size={24} className="text-yellow-500" />
                                <span className="text-white font-bold text-center flex items-center gap-1">Roll Dice <ChevronDown size={14} /></span>
                            </button>
                            {showDiceMenu && (
                                <div className="absolute bottom-full left-0 right-0 mb-2 bg-gray-800 border border-gray-600 rounded-lg shadow-xl overflow-hidden z-[9000]">
                                    {[2, 4, 6, 10, 12, 20, 100].map(sides => (
                                        <button 
                                            key={sides}
                                            onClick={() => { rollDice(sides); setShowDiceMenu(false); setMobileMenuOpen(false); }}
                                            className="w-full text-center px-4 py-3 hover:bg-gray-700 border-b border-gray-700 last:border-b-0 text-white font-bold"
                                        >
                                            {sides === 2 ? 'Coin Flip' : `D${sides}`}
                                        </button>
                                    ))}
                                </div>
                            )}
                        </div>
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
                        {sideboard.length > 0 && <button onClick={() => { openSearch('SIDEBOARD'); setMobileMenuOpen(false); }} className="w-full py-3 bg-indigo-900/40 text-indigo-200 rounded-xl font-bold flex items-center justify-center gap-2"><Shield /> Sideboard ({sideboard.length})</button>}
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
                                        : 'w-full overflow-x-auto overflow-y-hidden touch-pan-x pb-[calc(1rem+env(safe-area-inset-bottom,0px))] md:pb-8'
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

            {/* AI "thinking" badge */}
            {aiThinkingSeat && (
                <div className="absolute top-6 left-1/2 -translate-x-1/2 z-[9500] pointer-events-none animate-in fade-in slide-in-from-top-2">
                    <div className="bg-purple-900/80 backdrop-blur text-purple-100 px-4 py-1.5 rounded-full text-sm font-bold border border-purple-500/40 shadow-xl flex items-center gap-2">
                        <Loader size={14} className="animate-spin" />
                        🤖 {aiSeatName(aiThinkingSeat)} is thinking…
                    </div>
                </div>
            )}

            {/* Negotiate (talk to an AI opponent) — local games with an AI seat */}
            {isLocal && aiAvailable && gamePhase !== 'SETUP' && voiceAiSeats().length > 0 && !voiceOpen && (
                <button
                    onClick={() => setVoiceOpen(true)}
                    className="fixed bottom-24 left-4 z-[9400] bg-purple-700 hover:bg-purple-600 text-white rounded-full shadow-xl border border-purple-400/40 px-4 py-3 flex items-center gap-2 font-bold text-sm active:scale-95"
                    title="Talk / negotiate with an AI opponent"
                >
                    <Mic size={18} /> Negotiate
                </button>
            )}

            {isLocal && aiAvailable && voiceOpen && (
                <div className="fixed bottom-4 left-4 z-[9600] w-[92vw] max-w-sm bg-gray-900/95 backdrop-blur border border-purple-500/40 rounded-2xl shadow-2xl flex flex-col overflow-hidden animate-in slide-in-from-left-4">
                    <div className="flex items-center justify-between px-4 py-2 bg-purple-900/40 border-b border-purple-500/30">
                        <div className="flex items-center gap-2 font-bold text-purple-100 text-sm"><MessageSquare size={16} /> Negotiate</div>
                        <div className="flex items-center gap-2">
                            {voiceSpeaking && <Volume2 size={14} className="text-purple-300 animate-pulse" />}
                            <button onClick={() => setVoiceOpen(false)} className="text-gray-400 hover:text-white"><X size={18} /></button>
                        </div>
                    </div>

                    {/* Who to talk to + voice backend */}
                    <div className="px-3 py-2 flex items-center gap-2 border-b border-gray-800">
                        <span className="text-[10px] text-gray-400 uppercase font-bold">Talking to</span>
                        <select
                            value={voiceTargetSeat || ''}
                            onChange={e => setVoiceTargetSeat(e.target.value)}
                            className="flex-1 bg-gray-800 border border-gray-700 rounded px-2 py-1 text-xs text-white outline-none"
                        >
                            {voiceAiSeats().map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                        </select>
                        <select
                            value={voiceBackendId}
                            onChange={e => setVoiceBackendId(e.target.value as VoiceBackendId)}
                            className="bg-gray-800 border border-gray-700 rounded px-2 py-1 text-xs text-white outline-none"
                            title="Voice engine"
                        >
                            <option value="web-speech">Browser voice (free)</option>
                            {voiceRealtimeAvailable && <option value="openai-realtime">OpenAI Realtime</option>}
                        </select>
                    </div>

                    {/* Transcript */}
                    <div className="flex-1 max-h-56 overflow-y-auto px-3 py-2 space-y-2 text-sm">
                        {(voiceTargetSeat && voiceHistory[voiceTargetSeat] || []).length === 0 && (
                            <div className="text-gray-500 text-xs text-center py-6">
                                Hold the mic (or type) to negotiate. They won't reveal their hand or plan unless they choose to.
                            </div>
                        )}
                        {(voiceTargetSeat && voiceHistory[voiceTargetSeat] || []).map((t, i) => (
                            <div key={i} className={`flex ${t.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                                <div className={`px-3 py-1.5 rounded-2xl max-w-[80%] ${t.role === 'user' ? 'bg-blue-600 text-white' : 'bg-gray-800 text-purple-100 border border-purple-500/20'}`}>
                                    {t.text}
                                </div>
                            </div>
                        ))}
                        {voiceBusy && <div className="text-purple-300 text-xs flex items-center gap-1"><Loader size={12} className="animate-spin" /> thinking…</div>}
                        {rtConnecting && <div className="text-purple-300 text-xs flex items-center gap-1"><Loader size={12} className="animate-spin" /> connecting realtime voice…</div>}
                        {voiceSpeaking && <div className="text-purple-300 text-xs italic flex items-center gap-1"><Volume2 size={12} /> speaking…</div>}
                        {voiceListening && <div className="text-green-400 text-xs italic">🎙 {voiceBackendId === 'openai-realtime' ? 'listening…' : (voicePartial || 'listening…')}</div>}
                    </div>

                    {/* Deals struck */}
                    {voiceTargetSeat && (aiDeals.current[voiceTargetSeat] || []).length > 0 && (
                        <div className="px-3 py-1.5 border-t border-gray-800 text-[11px] text-amber-300/90">
                            <span className="font-bold">Deals:</span> {(aiDeals.current[voiceTargetSeat] || []).join(' · ')}
                        </div>
                    )}

                    {/* Controls */}
                    <div className="p-3 border-t border-gray-800 flex items-center gap-2">
                        {(voiceBackendId === 'openai-realtime' || voiceInputSupported()) ? (
                            <button
                                onMouseDown={startTalk} onMouseUp={endTalk} onMouseLeave={() => voiceListening && endTalk()}
                                onTouchStart={(e) => { e.preventDefault(); startTalk(); }} onTouchEnd={(e) => { e.preventDefault(); endTalk(); }}
                                disabled={voiceBusy || rtConnecting || (voiceBackendId === 'openai-realtime' && !rtSession.current)}
                                className={`shrink-0 w-12 h-12 rounded-full flex items-center justify-center border transition-colors ${voiceListening ? 'bg-green-600 border-green-400 animate-pulse' : 'bg-purple-700 hover:bg-purple-600 border-purple-400/40'} disabled:opacity-40`}
                                title="Hold to talk"
                            >
                                <Mic size={20} className="text-white" />
                            </button>
                        ) : null}
                        <input
                            value={voiceTextInput}
                            onChange={e => setVoiceTextInput(e.target.value)}
                            onKeyDown={e => { if (e.key === 'Enter') sendTypedVoice(); }}
                            placeholder={(voiceBackendId === 'openai-realtime' || voiceInputSupported()) ? 'hold mic or type…' : 'type your message…'}
                            disabled={voiceBusy}
                            className="flex-1 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white outline-none focus:border-purple-500"
                        />
                        <button onClick={sendTypedVoice} disabled={voiceBusy || !voiceTextInput.trim()} className="shrink-0 px-3 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-white rounded-lg text-sm font-bold">
                            Send
                        </button>
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
                                                <button onClick={() => { sendToZone(cardData, 'GRAVEYARD', obj.ownerId || obj.controllerId); emitAction('REMOVE_OBJECT', { id: obj.id }); setBoardObjects(prev => prev.filter(o => o.id !== obj.id)); setMobileActionCardId(null); }} className="flex flex-col items-center gap-1 p-2 bg-gray-800/80 rounded-xl active:bg-red-900/50">
                                                    <Archive size={24} className="text-red-400" />
                                                    <span className="text-[10px] text-gray-300">Grave</span>
                                                </button>
                                                <button onClick={() => { sendToZone(cardData, 'EXILE', obj.ownerId || obj.controllerId); emitAction('REMOVE_OBJECT', { id: obj.id }); setBoardObjects(prev => prev.filter(o => o.id !== obj.id)); setMobileActionCardId(null); }} className="flex flex-col items-center gap-1 p-2 bg-gray-800/80 rounded-xl active:bg-red-900/50">
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

            {/* Combat: transient assignment drag line */}
            {combatDragFrom && combatDragPos && (() => {
                const el = document.querySelector(`[data-combat-obj="${combatDragFrom}"]`);
                if (!el) return null;
                const r = el.getBoundingClientRect();
                const sx = r.left + r.width / 2, sy = r.top + r.height / 2;
                const color = combat?.step === 'blockers' ? '#38bdf8' : '#ef4444';
                return (
                    <svg className="fixed inset-0 z-[9500] pointer-events-none w-full h-full">
                        <line x1={sx} y1={sy} x2={combatDragPos.x} y2={combatDragPos.y} stroke={color} strokeWidth={3} strokeDasharray="6 4" strokeLinecap="round" />
                        <circle cx={combatDragPos.x} cy={combatDragPos.y} r={5} fill={color} />
                    </svg>
                );
            })()}

            {/* Combat: compact assignment panel */}
            {combat?.active && gamePhase === 'PLAYING' && (
                <div data-attacker-seat={combat.attackerSeatId} 
                    className={`fixed z-[9000] bg-gray-900/95 border border-gray-700 shadow-2xl backdrop-blur animate-in fade-in flex flex-col p-4 ${combatTrayGeom.x === -1 ? 'bottom-[260px] left-1/2 -translate-x-1/2 w-[min(94vw,900px)] rounded-xl slide-in-from-bottom-4' : 'rounded-lg'}`}
                    style={combatTrayGeom.x !== -1 ? { 
                        left: combatTrayGeom.x, 
                        top: combatTrayGeom.y, 
                        width: combatTrayGeom.w > 0 ? combatTrayGeom.w : Math.min(window.innerWidth * 0.94, 900),
                        height: combatTrayGeom.h > 0 ? combatTrayGeom.h : 'auto',
                        transform: `scale(${combatTrayGeom.scale})`,
                        transformOrigin: 'top left',
                        resize: 'both',
                        overflow: 'hidden'
                    } : {}}
                >
                    <div className="flex items-center justify-between mb-2 gap-2 cursor-grab active:cursor-grabbing -mt-2 -mx-2 p-2 rounded hover:bg-gray-800/50"
                        onPointerDown={(e) => {
                            if (e.target instanceof HTMLButtonElement) return;
                            const rect = e.currentTarget.parentElement!.getBoundingClientRect();
                            combatTrayDrag.current = { startX: e.clientX, startY: e.clientY, initialGeom: { x: rect.left, y: rect.top, w: rect.width, h: rect.height, scale: combatTrayGeom.scale }, mode: 'drag' };
                            e.currentTarget.setPointerCapture(e.pointerId);
                        }}
                        onPointerMove={(e) => {
                            if (combatTrayDrag.current?.mode === 'drag') {
                                const { startX, startY, initialGeom } = combatTrayDrag.current;
                                setCombatTrayGeom(prev => ({ ...prev, x: initialGeom.x + (e.clientX - startX), y: initialGeom.y + (e.clientY - startY), w: initialGeom.w, h: initialGeom.h }));
                            }
                        }}
                        onPointerUp={(e) => {
                            combatTrayDrag.current = null;
                            e.currentTarget.releasePointerCapture(e.pointerId);
                        }}
                        onWheel={(e) => {
                            if (e.ctrlKey || e.metaKey || e.shiftKey) {
                                e.preventDefault();
                                setCombatTrayGeom(prev => ({ ...prev, scale: Math.min(2, Math.max(0.5, prev.scale - e.deltaY * 0.001)) }));
                            }
                        }}
                    >
                        <div className="flex items-center gap-2 min-w-0 pointer-events-none">
                            <Swords size={16} className="text-red-400 shrink-0" />
                            <span className="font-bold text-white text-sm truncate">Combat — {COMBAT_STEP_LABEL[combat.step]}</span>
                            <span className="text-xs text-gray-400 hidden sm:inline truncate">({playersList.find(p => p.id === combat.attackerSeatId)?.name || 'Player'}'s attack)</span>
                        </div>
                        {isMyTurn() && (
                            <button onClick={advancePhase} className="px-3 py-1 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold flex items-center gap-1 shrink-0">
                                {combat.step === 'attackers' ? 'To Blockers' : combat.step === 'blockers' ? 'Resolve' : 'End Combat'} <ChevronRight size={14} />
                            </button>
                        )}
                    </div>
                    {combat.attackers.length === 0 ? (
                        <div className="text-xs text-gray-500 py-1.5">
                            {combat.step === 'attackers' ? 'Drag from your creatures onto an opponent to attack.' : 'No attackers were declared.'}
                        </div>
                    ) : (
                        <div className="flex flex-col gap-2 max-h-[42vh] overflow-y-auto custom-scrollbar">
                            {Array.from(new Set(combat.attackers.map(a => a.defenderSeatId))).map(defId => (
                                <div key={defId} className="flex items-start gap-2 bg-gray-800/60 rounded-lg p-2">
                                    <div className="text-[10px] text-gray-300 font-bold uppercase min-w-[64px] pt-2 flex items-center gap-1"><ArrowRight size={10} /> {playersList.find(p => p.id === defId)?.name || 'Player'}</div>
                                    <div className="flex flex-wrap gap-3">
                                        {combat.attackers.filter(a => a.defenderSeatId === defId).map(a => {
                                            const atk = boardObjects.find(o => o.id === a.objectId);
                                            if (!atk) return null;
                                            const blks = combat.blocks.filter(b => b.attackerObjectId === a.objectId);
                                            const canUndoAtk = combat.step === 'attackers' && (isLocal || atk.controllerId === socket.id);
                                            return (
                                                <div key={a.objectId} className="flex flex-col items-center gap-1">
                                                    <div data-combat-obj={a.objectId} className={`relative group ${combat.step === 'blockers' ? 'ring-2 ring-amber-300/60 rounded' : ''}`} onContextMenu={(e) => { e.preventDefault(); setInspectCard(atk.cardData); }} title={`${atk.cardData.name} - right-click to inspect${combat.step === 'blockers' ? ' \n drag a blocker here' : ''}`}>
                                                        <img src={atk.cardData.imageUrl} className="w-[100px] h-[140px] object-cover rounded border-4 border-red-500" />
                                                        {parsePower(atk.cardData.power) > 0 && <span className="absolute bottom-0 right-0 bg-black/80 text-white text-xs font-bold px-2 py-0.5 rounded-tl">{atk.cardData.power}</span>}
                                                        {canUndoAtk && <button onClick={() => removeAttacker(a.objectId)} className="absolute -top-2 -right-2 bg-red-600 text-white rounded-full w-6 h-6 flex items-center justify-center opacity-0 group-hover:opacity-100 shadow"><X size={14} /></button>}
                                                    </div>
                                                    {blks.length > 0 ? (
                                                        <div className="flex gap-1">
                                                            {blks.map(b => {
                                                                const bl = boardObjects.find(o => o.id === b.blockerObjectId);
                                                                if (!bl) return null;
                                                                const canUndoBlk = combat.step === 'blockers' && (isLocal || bl.controllerId === socket.id);
                                                                return (
                                                                    <div key={b.blockerObjectId} className="relative group" onContextMenu={(e) => { e.preventDefault(); setInspectCard(bl.cardData); }} title={`${bl.cardData.name} - right-click to inspect`}>
                                                                        <img src={bl.cardData.imageUrl} className="w-[80px] h-[112px] object-cover rounded border-4 border-sky-400" />
                                                                        {canUndoBlk && <button onClick={() => removeBlock(b.blockerObjectId)} className="absolute -top-2 -right-2 bg-red-600 text-white rounded-full w-6 h-6 flex items-center justify-center opacity-0 group-hover:opacity-100 shadow"><X size={12} /></button>}
                                                                    </div>
                                                                );
                                                            })}
                                                        </div>
                                                    ) : combat.step !== 'attackers' ? (
                                                        <span className="text-[9px] text-red-300 font-bold uppercase">Unblocked</span>
                                                    ) : null}
                                                </div>
                                            );
                                        })}
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                    {combat.step === 'blockers' && <div className="text-[10px] text-gray-500 mt-1.5">Drag from your creatures onto an attacker to block. Multiple blockers per attacker allowed.</div>}
                </div>
            )}

            {changeArtFor && (
                <div className="fixed inset-0 z-[12000] bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in" onClick={() => setChangeArtFor(null)}>
                    <div className="bg-gray-800 border border-gray-600 rounded-xl p-6 shadow-2xl max-w-3xl w-full max-h-[90vh] flex flex-col" onClick={e => e.stopPropagation()}>
                        <div className="flex justify-between items-center mb-4">
                            <h3 className="text-xl font-bold text-white flex items-center gap-2"><Palette className="text-pink-400" /> Change Art — {changeArtFor.cardData.name}</h3>
                            <button onClick={() => setChangeArtFor(null)} className="text-gray-400 hover:text-white"><X size={20} /></button>
                        </div>
                        {artLoading ? (
                            <div className="flex-1 flex items-center justify-center text-gray-400 gap-2 py-12"><Loader className="animate-spin" /> Loading printings…</div>
                        ) : artPrints.length === 0 ? (
                            <div className="flex-1 flex items-center justify-center text-gray-500 py-12">No alternate printings found.</div>
                        ) : (
                            <div className="flex-1 overflow-y-auto custom-scrollbar grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 gap-3 pr-1">
                                {artPrints.map((p, i) => (
                                    <button key={p.scryfallId + i} onClick={() => applyArt(p)} className="relative rounded-lg overflow-hidden border-2 border-transparent hover:border-pink-400 transition-all active:scale-95 group">
                                        <img src={p.imageUrl} alt={p.name} className="w-full aspect-[5/7] object-cover" />
                                        {p.scryfallId === changeArtFor.cardData.scryfallId && (
                                            <div className="absolute top-1 right-1 bg-pink-500 text-white rounded-full p-0.5"><CheckCircle size={14} /></div>
                                        )}
                                    </button>
                                ))}
                            </div>
                        )}
                    </div>
                </div>
            )}

            {showCustomizeModal && (
                <div className="fixed inset-0 z-[12000] bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in" onClick={() => setShowCustomizeModal(false)}>
                    <div className="bg-gray-800 border border-gray-600 rounded-xl p-6 shadow-2xl max-w-md w-full max-h-[90vh] flex flex-col" onClick={e => e.stopPropagation()}>
                        <div className="flex justify-between items-center mb-4">
                            <h3 className="text-xl font-bold text-white flex items-center gap-2"><Palette className="text-purple-400" /> Table Appearance</h3>
                            <button onClick={() => setShowCustomizeModal(false)} className="text-gray-400 hover:text-white"><X size={20} /></button>
                        </div>
                        <p className="text-xs text-gray-400 mb-4">Set a custom playmat and card sleeve. {isLocal ? 'Applies to your board.' : 'Other players see them too.'}</p>
                        <div className="flex-1 overflow-y-auto custom-scrollbar space-y-4 pr-1">
                            <AppearancePicker label="Playmat" url={customMatUrl} transform={matTransform} aspect="16 / 10" onUrl={setCustomMatUrl} onTransform={setMatTransform} />
                            <AppearancePicker label="Card Sleeve" url={customSleeveUrl} transform={sleeveTransform} aspect="5 / 7" onUrl={setCustomSleeveUrl} onTransform={setSleeveTransform} />
                        </div>
                        <div className="pt-4 mt-2 border-t border-gray-700 flex justify-end">
                            <button onClick={() => setShowCustomizeModal(false)} className="px-5 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg font-bold text-sm">Done</button>
                        </div>
                    </div>
                </div>
            )}

            {showShortcuts && (
                <div className="fixed inset-0 z-[11000] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4" onClick={() => { setShowShortcuts(false); setRebindingActionId(null); }}>
                    <div className="bg-gray-800 border border-gray-600 rounded-xl p-6 shadow-2xl max-w-lg w-full max-h-[90vh] flex flex-col animate-in zoom-in-95" onClick={e => e.stopPropagation()}>
                        <div className="flex justify-between items-center mb-4">
                            <h3 className="text-xl font-bold text-white flex items-center gap-2">
                                <Keyboard className="text-blue-400" /> Controls
                            </h3>
                            <button onClick={() => { setShowShortcuts(false); setRebindingActionId(null); }} className="text-gray-400 hover:text-white"><X size={20} /></button>
                        </div>
                        <p className="text-xs text-gray-400 mb-4">Click a key to rebind it. Press the new key, or <kbd className="bg-black/40 px-1 rounded">Esc</kbd> to cancel. Assigning a key already in use clears it from the other action.</p>
                        <div className="flex-1 overflow-y-auto custom-scrollbar pr-1 space-y-4">
                            {['Board', 'Turn', 'Zones', 'Panels'].map(group => (
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
                                                        className={`min-w-[3rem] px-2 py-1 rounded font-mono text-sm border shrink-0 transition-colors ${isRebinding ? 'bg-blue-600 border-blue-400 text-white animate-pulse' : key ? 'bg-black/50 border-gray-600 text-white hover:border-blue-400' : 'bg-red-900/40 border-red-800 text-red-300 hover:border-red-500'}`}
                                                        title="Click to rebind"
                                                    >
                                                        {isRebinding ? 'Press…' : keyLabel(key)}
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
                                    <div className="flex justify-between items-center p-2 bg-gray-700/50 rounded"><span className="text-gray-300">Switch opponent</span><kbd className="bg-black/50 px-2 py-1 rounded text-white font-mono border border-gray-600">← / →</kbd></div>
                                    <div className="flex justify-between items-center p-2 bg-gray-700/50 rounded"><span className="text-gray-300">Toggle tokens</span><kbd className="bg-black/50 px-2 py-1 rounded text-white font-mono border border-gray-600">L-Alt</kbd></div>
                                    <div className="flex justify-between items-center p-2 bg-amber-900/30 rounded border border-amber-800/30"><span className="text-gray-300">Undo</span><kbd className="bg-black/50 px-2 py-1 rounded text-white font-mono border border-gray-600">Ctrl+Z</kbd></div>
                                </div>
                            </div>
                        </div>
                        <div className="pt-4 mt-2 border-t border-gray-700 flex justify-end">
                            <button onClick={resetKeyBindings} className="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-gray-200 rounded-lg text-sm font-bold flex items-center gap-2">
                                <RotateCcw size={14} /> Reset to defaults
                            </button>
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
                                    {searchModal.items.map((item, idx) => {
                                        if (!item || !item.card) return null;
                                        return (
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
                                                            {searchModal.isReadOnly && (
                                                                <div className="flex gap-2 w-full mt-1">
                                                                    <button onClick={() => handleSearchAction(item.card.id, 'CLONE')} className="flex-1 text-xs flex justify-center items-center gap-1 bg-purple-700 hover:bg-purple-600 px-2 py-1.5 rounded" title="Copy to your board">
                                                                        <Copy size={12} /> Clone
                                                                    </button>
                                                                    <button onClick={() => handleSearchAction(item.card.id, 'STEAL')} className="flex-1 text-xs flex justify-center items-center gap-1 bg-rose-700 hover:bg-rose-600 px-2 py-1.5 rounded" title="Take from opponent">
                                                                        <Hand size={12} /> Steal
                                                                    </button>
                                                                </div>
                                                            )}
                                                        </>
                                                    ) : (
                                                        <div className="text-white text-xs font-bold pointer-events-auto">Click to Reveal</div>
                                                    )}
                                                </div>
                                            )}
                                        </div>
                                        );
                                    })}
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

            {activeDice.length > 0 && (
                <div className="fixed inset-0 pointer-events-none z-[11000] flex flex-wrap items-center justify-center gap-6 p-10 bg-black/20">
                    {activeDice.map(die => {
                        const ownerIdx = playersList.findIndex(p => p.id === die.playerId);
                        const color = playersList[ownerIdx]?.color || '#fff';
                        return (
                            <Die
                                key={die.id}
                                value={die.value} 
                                sides={die.sides} 
                                color={color}
                            />
                        );
                    })}
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
                                        <h4 className="font-bold text-white flex items-center gap-2">
                                            {soundMuted ? <Volume2 size={16} className="text-gray-500" /> : <Volume2 size={16} className="text-green-400" />} Sound Effects
                                        </h4>
                                        <p className="text-xs text-gray-400">Procedural cues for turns, plays, draws, and life changes.</p>
                                    </div>
                                    <div
                                        onClick={toggleSound}
                                        className={`w-14 h-8 rounded-full p-1 flex items-center transition-colors ${!soundMuted ? 'bg-green-600 justify-end' : 'bg-gray-600 justify-start'}`}
                                    >
                                        <div className="w-6 h-6 bg-white rounded-full shadow-md transform transition-transform" />
                                    </div>
                                </label>
                            </div>

                            <button
                                onClick={() => { setShowCustomizeModal(true); setShowSettingsModal(false); }}
                                className="w-full bg-gray-700/50 hover:bg-gray-700 p-4 rounded-lg border border-gray-600 flex justify-between items-center transition-colors group"
                            >
                                <div className="flex flex-col items-start">
                                    <h4 className="font-bold text-white flex items-center gap-2"><Palette size={16} className="text-purple-400" /> Table Appearance</h4>
                                    <p className="text-xs text-gray-400 group-hover:text-gray-300">Custom playmat &amp; card sleeve</p>
                                </div>
                                <ChevronRight className="text-gray-500 group-hover:text-white" size={20} />
                            </button>

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

                            {(() => {
                                let total = 0;
                                for (let i = 0; i < localStorage.length; i++) {
                                    const key = localStorage.key(i);
                                    if (key) total += (localStorage.getItem(key)?.length || 0) * 2;
                                }
                                const max = 5 * 1024 * 1024;
                                const pct = Math.min(100, Math.max(0, (total / max) * 100));
                                const color = pct > 90 ? 'bg-red-500' : pct > 70 ? 'bg-yellow-500' : 'bg-blue-500';
                                return (
                                    <div className="w-full bg-gray-700/50 p-4 rounded-lg border border-gray-600 flex flex-col gap-4">
                                        <div className="flex flex-col gap-2">
                                            <div className="flex justify-between items-center text-xs">
                                                <span className="text-gray-300 font-bold flex items-center gap-1"><Archive size={14} className="text-gray-400"/> Local Storage</span>
                                                <span className={pct > 90 ? 'text-red-400 font-bold' : 'text-gray-400'}>{(total / 1024 / 1024).toFixed(2)} MB / 5.00 MB</span>
                                            </div>
                                            <div className="w-full bg-gray-900 rounded-full h-1.5 overflow-hidden">
                                                <div className={`h-full ${color} transition-all duration-500`} style={{ width: `${pct}%` }} />
                                            </div>
                                        </div>
                                        <button
                                            onClick={() => {
                                                let cleared = 0;
                                                Object.keys(localStorage).forEach(key => {
                                                    if (key.startsWith('planeswalker_backup_') && key !== `planeswalker_backup_${roomId}`) {
                                                        localStorage.removeItem(key);
                                                        cleared++;
                                                    }
                                                });
                                                addLog(`Memory cleanup complete: removed ${cleared} old backups.`, "SYSTEM");
                                                setShowSettingsModal(false);
                                            }}
                                            className="w-full bg-red-900/40 hover:bg-red-800/60 p-3 rounded-lg border border-red-900/50 flex justify-between items-center transition-colors group"
                                        >
                                            <div className="flex flex-col items-start">
                                                <h4 className="font-bold text-red-200 flex items-center gap-2"><Trash2 size={16} className="text-red-400" /> Clean Up Memory</h4>
                                                <p className="text-xs text-red-300/70 group-hover:text-red-200">Remove old backups</p>
                                            </div>
                                            <ChevronRight className="text-red-500 group-hover:text-red-300" size={20} />
                                        </button>
                                    </div>
                                );
                            })()}
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
