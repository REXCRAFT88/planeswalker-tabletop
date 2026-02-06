import React, { useState, useRef, useEffect } from 'react';
import { CardData, BoardObject, LogEntry, PlayerStats } from '../types';
import { Card } from './Card';
import { GameStatsModal } from './GameStatsModal';
import { searchCards } from '../services/scryfall';
import { socket } from '../services/socket';
import { CARD_WIDTH, CARD_HEIGHT } from '../constants';
import { PLAYER_COLORS } from '../constants';
import { 
    LogOut, Search, ZoomIn, ZoomOut, History, ArrowUp, ArrowDown, GripVertical, Palette, Menu, Maximize, Minimize,
    Archive, X, Eye, Shuffle, Crown, Dices, Layers, ChevronRight, Hand, Play, Settings, Swords, Shield,
    Clock, Users, CheckCircle, Ban, ArrowRight, Disc, ChevronLeft, Trash2, ArrowLeft, Minus, Plus, Keyboard, RefreshCw, Loader, RotateCcw, BarChart3, ChevronUp, ChevronDown
} from 'lucide-react';

interface TabletopProps {
    initialDeck: CardData[];
    initialTokens: CardData[];
    playerName: string;
    sleeveColor?: string;
    roomId: string;
    initialGameStarted?: boolean;
    isLocal?: boolean;
    localOpponents?: { name: string, deck: CardData[], tokens: CardData[], color: string }[];
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
    source: 'LIBRARY' | 'GRAVEYARD' | 'EXILE' | 'TOKENS';
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

const SEAT_ROTATIONS = [
    0,   // 0: Bottom
    90,  // 1: Left
    180, // 2: Top
    -90  // 3: Right
];

// Helper to map player index to seat index
// In 2 player games, map opponent (index 1) to Top Seat (index 2)
const getSeatMapping = (playerIndex: number, totalPlayers: number) => {
    if (totalPlayers === 2) {
        return playerIndex === 0 ? 0 : 2;
    }
    return playerIndex % 4;
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
}> = ({ card, scale, onInspect, onPlay, onSendToZone, isMobile, onMobileAction }) => {
  const width = 140 * scale; 
  const height = 196 * scale; 
  const [showOverlay, setShowOverlay] = useState(false);
  const touchStart = useRef<{x: number, y: number} | null>(null);
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
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
    >
        <div className="relative w-full h-full rounded-xl overflow-hidden shadow-2xl border border-black/50 bg-gray-800">
            <img src={card.imageUrl} className="w-full h-full object-cover" alt={card.name} />
            
            <div className={`absolute inset-0 bg-black/60 transition-opacity flex flex-col items-center justify-center gap-2 ${showOverlay ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}>
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

const Die: React.FC<{ value: number, sides: number, x: number, y: number, color: string }> = ({ value, sides, x, y, color }) => {
    return (
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
                <span className="text-3xl font-bold text-white drop-shadow-md">{value}</span>
                <span className="absolute bottom-1 text-[8px] text-gray-400 font-bold">D{sides}</span>
            </div>
        </div>
    );
};

const PlaymatGhost: React.FC<{
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  playerName: string;
}> = ({ x, y, width, height, rotation, playerName }) => {
  return (
    <div
      className="absolute border-2 border-dashed border-white/10 rounded-3xl flex flex-col items-center justify-center bg-white/5 pointer-events-none"
      style={{
        left: x,
        top: y,
        width,
        height,
        transform: `rotate(${rotation}deg)`,
      }}
    >
      <div className="text-2xl font-bold text-white/20">{playerName}</div>
    </div>
  );
};

const Playmat: React.FC<{
  x: number;
  y: number;
  width: number;
  height: number;
  playerName: string;
  rotation: number;
  zones: any;
  counts: any;
  sleeveColor: string;
  topGraveyardCard?: CardData;
  isShuffling: boolean;
  isControlled: boolean;
  commanders: CardData[];
  onDraw: () => void;
  onShuffle: () => void;
  onOpenSearch: (source: 'LIBRARY' | 'GRAVEYARD' | 'EXILE' | 'TOKENS') => void;
  onPlayCommander: (card: CardData) => void;
  onPlayTopLibrary: () => void;
  onPlayTopGraveyard: () => void;
  onInspectCommander: (card: CardData) => void;
  isMobile: boolean;
  onMobileZoneAction: (zone: string) => void;
}> = ({
  x, y, width, height, playerName, rotation, zones, counts, sleeveColor,
  topGraveyardCard, isShuffling, isControlled, commanders,
  onDraw, onShuffle, onOpenSearch, onPlayCommander, onPlayTopLibrary, onPlayTopGraveyard, onInspectCommander,
  isMobile, onMobileZoneAction
}) => {

  const handleZoneTouch = (zone: string, e: React.TouchEvent) => {
      if (!isMobile || !isControlled) return;
      // Simple long press simulation for zones or just tap to open menu
      // For zones, tap is usually fine to open menu since there are multiple actions
      e.stopPropagation();
      onMobileZoneAction(zone);
  };

  const handleCommanderTouch = (cmd: CardData, e: React.TouchEvent) => {
      if (!isMobile) return;
      e.stopPropagation();
      if (isControlled) onPlayCommander(cmd);
      else onInspectCommander(cmd);
  };

  return (
    <div
      className="absolute bg-gray-900/40 rounded-3xl border"
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

      {/* Library Zone */}
      <div
        className="absolute group"
        style={{ left: zones.library.x, top: zones.library.y, width: CARD_WIDTH, height: CARD_HEIGHT }}
      >
        <div 
            className="w-full h-full rounded bg-gray-800 border-2 border-white/20 flex items-center justify-center hover:border-blue-400 transition relative overflow-hidden cursor-pointer active:scale-95"
            onClick={isMobile ? (e: any) => handleZoneTouch('LIBRARY', e) : onDraw}
            style={{ backgroundColor: sleeveColor }}
        >
            <div className="text-white font-bold text-2xl z-10 pointer-events-none">{counts.library}</div>
            {isShuffling && <div className="absolute inset-0 flex items-center justify-center bg-black/50 text-xs text-white z-20">Shuffling...</div>}
            
             <div className={`absolute inset-0 bg-black/60 opacity-0 ${!isMobile ? 'group-hover:opacity-100' : ''} transition-opacity flex flex-col items-center justify-center gap-2 z-30`}
                onClick={(e) => e.stopPropagation()}
             >
                 {isControlled && (
                     <>
                     <button onClick={onDraw} className="px-3 py-1 bg-green-600 hover:bg-green-500 text-white rounded-full text-xs font-bold shadow-lg w-20 flex items-center justify-center gap-1">
                        <Hand size={12}/> Draw
                     </button>
                     <button onClick={onPlayTopLibrary} className="px-3 py-1 bg-blue-600 hover:bg-blue-500 text-white rounded-full text-xs font-bold shadow-lg w-20 flex items-center justify-center gap-1">
                        <Play size={12}/> Play
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
            onClick={isMobile ? (e: any) => handleZoneTouch('GRAVEYARD', e) : () => onOpenSearch('GRAVEYARD')}
        >
            {topGraveyardCard ? (
                <img src={topGraveyardCard.imageUrl} className="w-full h-full object-cover rounded opacity-80 hover:opacity-100" alt="Graveyard" />
            ) : (
                 <div className="text-white/20 text-3xl"><Archive /></div>
            )}
             <div className="absolute top-0 right-0 bg-black/80 text-white text-xs px-1.5 rounded-bl font-bold z-10">{counts.graveyard}</div>

             <div className={`absolute inset-0 bg-black/60 opacity-0 ${!isMobile ? 'group-hover:opacity-100' : ''} transition-opacity flex flex-col items-center justify-center gap-2 z-20`}
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
            onClick={isMobile ? (e: any) => handleZoneTouch('EXILE', e) : () => onOpenSearch('EXILE')}
        >
             <div className="text-white/20 text-sm rotate-45">Exile</div>
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
    </div>
  );
};

const DamageReportModal: React.FC<{
    isOpen: boolean;
    onClose: () => void;
    players: {id: string, name: string, color: string}[];
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
    players: {id: string, name: string, color: string}[];
    onKick: (id: string) => void;
    onReorder: (fromIdx: number, toIdx: number) => void;
    onAssignState: (playerId: string, seatIdx: number) => void;
    onResetGame: () => void;
}> = ({ isOpen, onClose, players, onKick, onReorder, onAssignState, onResetGame }) => {
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
                    <h3 className="text-2xl font-bold text-white flex items-center gap-2"><Shield className="text-blue-500"/> Host Controls</h3>
                    <button onClick={onClose} className="text-gray-400 hover:text-white"><X size={24}/></button>
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
                                <GripVertical className="text-gray-500 cursor-grab" size={16}/>
                                <span className="text-gray-400 font-mono w-4">{idx+1}.</span>
                                <div className="w-6 h-6 rounded-full border border-white/20" style={{backgroundColor: p.color}} />
                                <span className="flex-1 font-semibold text-white truncate">{p.name}</span>
                                <button onClick={() => onAssignState(p.id, idx)} className="px-2 py-1 bg-blue-600/20 hover:bg-blue-600/40 text-blue-300 text-xs rounded border border-blue-500/30" title="Load saved data for this seat">Load Data</button>
                                <button onClick={() => onKick(p.id)} className="p-1.5 bg-red-900/30 hover:bg-red-900/50 text-red-400 rounded border border-red-900/50" title="Kick Player"><Ban size={14}/></button>
                            </div>
                        ))}
                    </div>
                </div>

                <div className="pt-4 border-t border-gray-700 flex gap-3">
                    <button onClick={onResetGame} className="flex-1 py-3 bg-red-600 hover:bg-red-500 text-white rounded-lg font-bold flex items-center justify-center gap-2"><RotateCcw size={18}/> Reset Table</button>
                </div>
            </div>
        </div>
    );
};

const emptyStats: PlayerStats = {
    damageDealt: {}, damageReceived: 0, healingGiven: 0, healingReceived: 0, selfHealing: 0,
    tappedCounts: {},
    totalTurnTime: 0, cardsPlayed: 0, cardsSentToGraveyard: 0,
    cardsExiled: 0, cardsDrawn: 0
};

export const Tabletop: React.FC<TabletopProps> = ({ initialDeck, initialTokens, playerName, sleeveColor = '#ef4444', roomId, initialGameStarted, isLocal = false, localOpponents = [], onExit }) => {
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

    const [playersList, setPlayersList] = useState<{id: string, name: string, color: string}[]>([
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

    const [incomingViewRequest, setIncomingViewRequest] = useState<{ requesterId: string, requesterName: string, zone: string } | null>(null);
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
    const [handScale, setHandScale] = useState(1);
    
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
    const [disconnectModal, setDisconnectModal] = useState<{ isOpen: boolean, player: {id: string, name: string} | null }>({ isOpen: false, player: null });
    const [mobileZoneMenu, setMobileZoneMenu] = useState<string | null>(null);
    const disconnectModalRef = useRef(disconnectModal);
    const damageTakenThisTurn = useRef(0);
    const healingReceivedThisTurn = useRef(0);
    const [damageReportData, setDamageReportData] = useState({ damage: 0, healing: 0 });
    const [ghostPlayers, setGhostPlayers] = useState<{id: string, name: string, color: string}[]>([]);
    const [joinHandlingModal, setJoinHandlingModal] = useState<{ isOpen: boolean, newPlayer: {id: string, name: string} | null }>({ isOpen: false, newPlayer: null });
    const [activeDice, setActiveDice] = useState<DieRoll[]>([]);
    
    // Local Game State Storage
    const localPlayerStates = useRef<Record<string, LocalPlayerState>>({});

    // State Refs for Syncing
    const boardObjectsRef = useRef(boardObjects);
    const turnRef = useRef(turn);
    const roundRef = useRef(round);
    const currentTurnPlayerIdRef = useRef(currentTurnPlayerId);
    const commanderDamageRef = useRef(commanderDamage);
    const lifeRef = useRef(life);
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
    const lastPinchCenter = useRef<{ x: number, y: number } | null>(null);
    
    // State Refs for Socket Handlers
    const libraryRef = useRef(library);
    const playersListRef = useRef(playersList);
    const turnStartTimeRef = useRef(turnStartTime);
    const gamePhaseRef = useRef(gamePhase);
    const prevIsHost = useRef(isHost);
    const startingGameRef = useRef(false);
    const ghostPlayersRef = useRef(ghostPlayers);
    const turnOrderRef = useRef(turnOrder);
    const trackDamageRef = useRef(trackDamage);
    const prevPlayersListForLayout = useRef(playersList);

    const [isMobile, setIsMobile] = useState(false);
    const [mobileActionCardId, setMobileActionCardId] = useState<string | null>(null);
    const [isHandVisible, setIsHandVisible] = useState(true);
    const touchStartRef = useRef<number | null>(null);
    
    const isTwoPlayer = playersList.length === 2 || (isLocal && localOpponents.length === 1);
    const currentRadius = isTwoPlayer ? 210 : 625;

    const seatPositions = [
        { x: -MAT_W / 2, y: currentRadius - MAT_H / 2 }, // Seat 0 (Bottom)
        { x: -currentRadius - MAT_W / 2, y: -MAT_H / 2 }, // Seat 1 (Left)
        { x: -MAT_W / 2, y: -currentRadius - MAT_H / 2 }, // Seat 2 (Top)
        { x: currentRadius - MAT_W / 2, y: -MAT_H / 2 }  // Seat 3 (Right)
    ];

    useEffect(() => { libraryRef.current = library; }, [library]);
    useEffect(() => { playersListRef.current = playersList; }, [playersList]);
    useEffect(() => { turnStartTimeRef.current = turnStartTime; }, [turnStartTime]);
    useEffect(() => { gamePhaseRef.current = gamePhase; }, [gamePhase]);

    useEffect(() => { boardObjectsRef.current = boardObjects; }, [boardObjects]);
    useEffect(() => { turnRef.current = turn; }, [turn]);
    useEffect(() => { roundRef.current = round; }, [round]);
    useEffect(() => { currentTurnPlayerIdRef.current = currentTurnPlayerId; }, [currentTurnPlayerId]);
    useEffect(() => { commanderDamageRef.current = commanderDamage; }, [commanderDamage]);
    useEffect(() => { turnOrderRef.current = turnOrder; }, [turnOrder]);
    useEffect(() => { lifeRef.current = life; }, [life]);
    useEffect(() => { ghostPlayersRef.current = ghostPlayers; }, [ghostPlayers]);
    useEffect(() => { trackDamageRef.current = trackDamage; }, [trackDamage]);

    // --- Layout Update Effect ---
    useEffect(() => {
        const oldPlayers = prevPlayersListForLayout.current;
        const newPlayers = playersList;
        
        const oldIsTwoPlayer = oldPlayers.length === 2; 
        const newIsTwoPlayer = newPlayers.length === 2;
        
        const oldRadius = oldIsTwoPlayer ? 210 : 625;
        const newRadius = newIsTwoPlayer ? 210 : 625;

        const getSeatPos = (i: number, r: number) => {
            if (i === 0) return { x: -MAT_W / 2, y: r - MAT_H / 2 };
            if (i === 1) return { x: -r - MAT_W / 2, y: -MAT_H / 2 };
            if (i === 2) return { x: -MAT_W / 2, y: -r - MAT_H / 2 };
            if (i === 3) return { x: r - MAT_W / 2, y: -MAT_H / 2 };
            return { x: 0, y: 0 };
        };

        const updates: {id: string, updates: Partial<BoardObject>}[] = [];
        const oldPlayerMap = new Map<string, {seatIdx: number, pos: {x:number, y:number}, rot: number}>();
        
        oldPlayers.forEach((p, idx) => {
            const seatIdx = getSeatMapping(idx, oldPlayers.length);
            oldPlayerMap.set(p.id, {
                seatIdx,
                pos: getSeatPos(seatIdx, oldRadius),
                rot: SEAT_ROTATIONS[seatIdx]
            });
        });

        const currentBoardObjects = boardObjectsRef.current;

        newPlayers.forEach((p, idx) => {
            const oldData = oldPlayerMap.get(p.id);
            if (!oldData) return;

            const newSeatIdx = getSeatMapping(idx, newPlayers.length);
            const newPos = getSeatPos(newSeatIdx, newRadius);
            const newRot = SEAT_ROTATIONS[newSeatIdx];

            const posChanged = oldData.pos.x !== newPos.x || oldData.pos.y !== newPos.y;
            const rotChanged = oldData.rot !== newRot;

            if (posChanged || rotChanged) {
                const playerObjects = currentBoardObjects.filter(obj => obj.controllerId === p.id);
                
                const oldCenter = { x: oldData.pos.x + MAT_W/2, y: oldData.pos.y + MAT_H/2 };
                const newCenter = { x: newPos.x + MAT_W/2, y: newPos.y + MAT_H/2 };
                
                const rotDiff = newRot - oldData.rot;
                const rad = -rotDiff * (Math.PI / 180);
                const cos = Math.cos(rad);
                const sin = Math.sin(rad);

                playerObjects.forEach(obj => {
                    const w = obj.type === 'CARD' ? CARD_WIDTH : 25;
                    const h = obj.type === 'CARD' ? CARD_HEIGHT : 25;
                    const cx = obj.x + w/2;
                    const cy = obj.y + h/2;
                    const rx = cx - oldCenter.x;
                    const ry = cy - oldCenter.y;
                    const rxNew = rx * cos - ry * sin;
                    const ryNew = rx * sin + ry * cos;
                    const newCx = newCenter.x + rxNew;
                    const newCy = newCenter.y + ryNew;
                    
                    updates.push({
                        id: obj.id,
                        updates: { x: newCx - w/2, y: newCy - h/2, rotation: obj.rotation + rotDiff }
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

    useEffect(() => {
        disconnectModalRef.current = disconnectModal;
    }, [disconnectModal]);

    useEffect(() => {
        rootRef.current?.focus();
        const checkMobile = () => setIsMobile(window.innerWidth < 768 || (window.innerHeight < 600 && window.innerWidth < 1000));
        checkMobile();
        window.addEventListener('resize', checkMobile);
        return () => window.removeEventListener('resize', checkMobile);
    }, []);

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
                const pid = opp.id || `player-${idx + 1}`;
                states[pid] = createInitialState(pid, opp.deck, opp.tokens);
            });
            
            localPlayerStates.current = states;
        }
    }, [isLocal]);

    useEffect(() => {
        if (!prevIsHost.current && isHost) {
            addLog("You are now the Host", "SYSTEM");
        }
        prevIsHost.current = isHost;
    }, [isHost]);

    useEffect(() => {
        if ((initialGameStarted || isLocal) && gamePhase === 'SETUP') {
             // Wait for explicit start in local to allow re-ordering if needed, but if auto-start:
             if (initialGameStarted) handleStartGameLogic({ mulligansAllowed: true, trackDamage: false });
        }
    }, [initialGameStarted]);

    // --- Game Phase Persistence ---
    useEffect(() => {
        const savedPhase = localStorage.getItem(`game_phase_${roomId}`);
        if (savedPhase && (savedPhase === 'MULLIGAN' || savedPhase === 'PLAYING')) {
             if (gamePhase === 'SETUP') {
                 setGamePhase(savedPhase as any);
             }
        }
    }, []);

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
        
        const getUserId = () => {
            let id = localStorage.getItem('planeswalker_user_id');
            if (!id) {
                id = crypto.randomUUID();
                localStorage.setItem('planeswalker_user_id', id);
            }
            return id;
        };

        // Handle socket reconnection
        const handleReconnection = () => {
            console.log("Socket reconnected, re-joining room...");
            socket.emit('join_room', { room: roomId, name: playerName, color: sleeveColor, userId: getUserId() });
        };

        socket.on('connect', handleReconnection);

        return () => {
            socket.off('connect', handleReconnection);
        };
    }, [roomId, playerName, sleeveColor]);

    const handleExit = () => {
        socket.emit('leave_room', { room: roomId });
        localStorage.removeItem(`game_phase_${roomId}`);
        sessionStorage.removeItem('active_game_session');
        onExit();
    };

    // Emit life changes
    useEffect(() => {
        if (!isLocal && (gamePhase === 'PLAYING' || gamePhase === 'MULLIGAN')) {
            socket.emit('game_action', { room: roomId, action: 'UPDATE_LIFE', data: { life } });
        }
    }, [life, gamePhase, roomId, playersList.length]);

    // Emit Count Changes
    useEffect(() => {
        if (!isLocal && (gamePhase === 'PLAYING' || gamePhase === 'MULLIGAN')) {
             socket.emit('game_action', { 
                 room: roomId, 
                 action: 'UPDATE_COUNTS', 
                 data: { 
                     library: library.length, 
                     graveyard: graveyard.length, 
                     exile: exile.length, 
                     hand: hand.filter(c => !c.isToken).length,
                     command: commandZone.length,
                     commanders: commandZone
                 } 
             });
        }
    }, [library.length, graveyard.length, exile.length, hand.length, commandZone.length, commandZone, gamePhase, roomId, playersList.length]);

    // --- State Backup ---
    useEffect(() => {
        if (!isLocal && (gamePhase === 'PLAYING' || gamePhase === 'MULLIGAN')) {
            const state = {
                hand,
                library,
                graveyard,
                exile,
                commandZone,
                life
            };
            // Backup state to the current seat index
            socket.emit('backup_state', { room: roomId, seatIndex: mySeatIndex, state });
        }
    }, [hand, library, graveyard, exile, commandZone, life, mySeatIndex, gamePhase, roomId]);

    // Stats Helper
    const updateMyStats = (updates: Partial<PlayerStats>) => {
        setGameStats(prev => {
            const myId = socket.id;
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
            mulliganCount: 0,
            hasKeptHand: false
        };
    };

    // --- Helper Logic ---
    const handleTakeoverGhost = (ghostId: string) => {
        if (!joinHandlingModal.newPlayer) return;
        const newPlayerId = joinHandlingModal.newPlayer.id;
        
        // Transfer objects
        emitAction('TRANSFER_OBJECTS', { fromId: ghostId, toId: newPlayerId });
        
        // Remove ghost
        setGhostPlayers(prev => prev.filter(g => g.id !== ghostId));
        setJoinHandlingModal({ isOpen: false, newPlayer: null });
        addLog(`${joinHandlingModal.newPlayer.name} took over ${ghostPlayers.find(g => g.id === ghostId)?.name}'s seat`, 'SYSTEM');
    };

    const handleOverwriteGhost = (ghostId: string) => {
        // Remove ghost objects
        const toRemove = boardObjects.filter(o => o.controllerId === ghostId);
        toRemove.forEach(o => emitAction('REMOVE_OBJECT', { id: o.id }));
        
        // Remove ghost
        setGhostPlayers(prev => prev.filter(g => g.id !== ghostId));
        setJoinHandlingModal({ isOpen: false, newPlayer: null });
        addLog(`Cleared ${ghostPlayers.find(g => g.id === ghostId)?.name}'s seat for ${joinHandlingModal.newPlayer?.name}`, 'SYSTEM');
    };

    const handleAssignNewSeat = () => {
        setJoinHandlingModal({ isOpen: false, newPlayer: null });
        addLog(`${joinHandlingModal.newPlayer?.name} assigned to a new seat`, 'SYSTEM');
    };

    const JoinHandlingModal: React.FC<{
        isOpen: boolean;
        newPlayer: {id: string, name: string} | null;
        ghosts: {id: string, name: string, color: string}[];
        onTakeover: (ghostId: string) => void;
        onOverwrite: (ghostId: string) => void;
        onNewSeat: () => void;
    }> = ({ isOpen, newPlayer, ghosts, onTakeover, onOverwrite, onNewSeat }) => {
        if (!isOpen || !newPlayer) return null;
    
        return (
            <div className="fixed inset-0 z-[13000] bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in">
                <div className="bg-gray-800 border border-gray-600 rounded-xl p-6 shadow-2xl max-w-lg w-full">
                    <h3 className="text-xl font-bold text-white mb-4">New Player Joined</h3>
                    <p className="text-gray-300 mb-6">
                        <span className="font-bold text-blue-400">{newPlayer.name}</span> has joined. 
                        There are abandoned seats from previous players. How would you like to seat them?
                    </p>
                    
                    <div className="space-y-3 mb-6">
                        {ghosts.map(ghost => (
                            <div key={ghost.id} className="bg-gray-700/50 p-3 rounded border border-gray-600 flex flex-col gap-2">
                                <div className="flex items-center gap-2">
                                    <div className="w-4 h-4 rounded-full" style={{backgroundColor: ghost.color}}/>
                                    <span className="text-gray-300 font-bold">{ghost.name}'s Seat</span>
                                </div>
                                <div className="flex gap-2">
                                    <button 
                                        onClick={() => onTakeover(ghost.id)}
                                        className="flex-1 py-2 bg-blue-600 hover:bg-blue-500 text-white text-sm font-bold rounded"
                                    >
                                        Take Over
                                    </button>
                                    <button 
                                        onClick={() => onOverwrite(ghost.id)}
                                        className="flex-1 py-2 bg-red-900/50 hover:bg-red-900 text-red-200 text-sm font-bold rounded"
                                    >
                                        Overwrite (New Mat)
                                    </button>
                                </div>
                            </div>
                        ))}
                    </div>
    
                    <div className="pt-4 border-t border-gray-700">
                        <button 
                            onClick={onNewSeat}
                            className="w-full py-3 bg-gray-700 hover:bg-gray-600 text-white font-bold rounded-lg"
                        >
                            Assign to Empty Seat
                        </button>
                    </div>
                </div>
            </div>
        );
    };

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

    const addLog = (message: string, type: 'ACTION' | 'SYSTEM' = 'ACTION', overrideName?: string) => {
        console.log(`Adding log: ${message} (${type})`); // Debug
        const entry: LogEntry = {
            id: crypto.randomUUID(),
            timestamp: Date.now(),
            playerId: overrideName ? 'remote' : 'local',
            playerName: overrideName || playerName,
            message,
            type
        };
        setLogs(prev => [entry, ...prev]);
        const displayMsg = type === 'SYSTEM' ? message : `${overrideName || playerName} ${message.toLowerCase()}`;
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

    const sortPlayers = (players: any[], order: string[]) => {
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
        const handleRoomUpdate = (data: any) => {
            const roomPlayers = Array.isArray(data) ? data : data.players;
            const hostId = !Array.isArray(data) ? data.hostId : null;
            
            console.log("Room Update Received:", roomPlayers);
            
            // Detect left players
            const prevPlayers = playersListRef.current;
            const leftPlayers = prevPlayers.filter(p => 
                !roomPlayers.find(rp => rp.id === p.id) && 
                p.id !== 'local-player' && 
                p.id !== 'player-0' &&
                !ghostPlayersRef.current.find(g => g.id === p.id)
            );
            
            // Determine if I am the host
            let amIHost = hostId ? socket.id === hostId : false;
            if (hostId) setIsHost(amIHost);

            const currentModal = disconnectModalRef.current;
            let leaverToHandle = currentModal.isOpen ? currentModal.player : null;

            if (leftPlayers.length > 0 && amIHost && gamePhaseRef.current !== 'SETUP') {
                 if (!leaverToHandle) {
                     leaverToHandle = leftPlayers[0];
                     setDisconnectModal({ isOpen: true, player: leaverToHandle });
                 }
            }

            // Merge lists: Server Players + Ghosts + Leaver (if handling)
            let combinedPlayers = [...roomPlayers];
            
            // Add ghosts if not present
            ghostPlayersRef.current.forEach(g => {
                if (!combinedPlayers.find(p => p.id === g.id)) {
                    combinedPlayers.push(g);
                }
            });

            // Add leaver if handling and not present
            if (leaverToHandle) {
                if (!combinedPlayers.find(p => p.id === leaverToHandle!.id)) {
                    const leaverObj = prevPlayers.find(p => p.id === leaverToHandle!.id) || leftPlayers.find(p => p.id === leaverToHandle!.id);
                    if (leaverObj) {
                        combinedPlayers.push(leaverObj);
                    }
                }
            }
            
            // Detect new players and Sync Game State if Host
            const newPlayers = roomPlayers.filter(rp => !prevPlayers.find(p => p.id === rp.id));
            if (newPlayers.length > 0 && amIHost && gamePhaseRef.current !== 'SETUP') {
                 console.log("New player joined game in progress, syncing state...");
                 const safeBoardObjects = boardObjectsRef.current.map(obj => ({
                     ...obj,
                     controllerId: obj.controllerId === 'local-player' ? socket.id : obj.controllerId
                 }));
                 socket.emit('game_action', { room: roomId, action: 'GAME_STATE_SYNC', data: {
                     phase: gamePhaseRef.current,
                     boardObjects: safeBoardObjects,
                     turn: turnRef.current,
                     round: roundRef.current,
                     currentTurnPlayerId: currentTurnPlayerIdRef.current,
                     turnStartTime: turnStartTimeRef.current,
                     commanderDamage: commanderDamageRef.current,
                     turnOrder: turnOrderRef.current
                 }});
            }

            // Check for join handling if Host and there are ghosts
            if (newPlayers.length > 0 && amIHost && ghostPlayersRef.current.length > 0) {
                // Handle the first new player found
                setJoinHandlingModal({ isOpen: true, newPlayer: newPlayers[0] });
            }

            let sortedPlayers = sortPlayers(combinedPlayers, turnOrderRef.current);
            let myIndex = sortedPlayers.findIndex(p => p.id === socket.id);

            if (myIndex >= 4) {
                alert("The room is full (Max 4 players).");
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

        const handleLoadState = (state: unknown) => {
            const loadedState = state as Partial<LocalPlayerState>;
            if (loadedState) {
                if (loadedState.hand) setHand(loadedState.hand);
                if (loadedState.library) setLibrary(loadedState.library);
                if (loadedState.graveyard) setGraveyard(loadedState.graveyard);
                if (loadedState.exile) setExile(loadedState.exile);
                if (loadedState.commandZone) setCommandZone(loadedState.commandZone);
                if (loadedState.life !== undefined) setLife(loadedState.life);
                addLog("Game data loaded from server", "SYSTEM");
            }
        };

        const handleAction = ({ action, data, playerId }: { action: string, data: any, playerId: string }) => {
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
                     setOpponentsCounts(prev => ({ ...prev, [sender.id]: data }));
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
                     updateMyStats({ healingGiven: (gameStats[socket.id]?.healingGiven || 0) + data.amount });
                 }
             }
             else if (action === 'ADD_OBJECT') {
                setBoardObjects(prev => {
                    if (prev.some(o => o.id === data.id)) return prev; 
                    return [...prev, data];
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
                 if (data.turnOrder) {
                     setTurnOrder(data.turnOrder);
                     setPlayersList(prev => sortPlayers(prev, data.turnOrder));
                 }
                 addLog("Synced game state from Host", "SYSTEM");
            }
            else if (action === 'ROLL_DICE') {
                setActiveDice(prev => [...prev, data]);
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
        socket.on('notification', (data) => addLog(data.message, "SYSTEM"));
        socket.on('player_kicked', () => { alert("You have been kicked from the game."); handleExit(); });
        
        socket.emit('get_players', { room: roomId });

        return () => {
            socket.off('room_players_update', handleRoomUpdate);
            socket.off('game_action', handleAction);
            socket.off('host_approval_request', handleHostApprovalRequest);
            socket.off('load_state', handleLoadState);
            socket.off('notification');
            socket.off('player_kicked');
        };
    }, []);

    // --- Initialization ---
    useEffect(() => {
        if (!isLocal) {
            const commanders = initialDeck.filter(c => c.isCommander);
            const deck = initialDeck.filter(c => !c.isCommander);
            const shuffled = [...deck].sort(() => Math.random() - 0.5);
            
            setLibrary(shuffled);
            setCommandZone(commanders);
            setHand(initialTokens);
            setGraveyard([]);
            setExile([]);
        }

        const matCenterY = seatPositions[0].y + MAT_H / 2;
        const isMobile = window.innerWidth < 768;
        const startScale = isMobile ? 0.5 : 0.8;
        setView({
            x: window.innerWidth / 2, 
            y: window.innerHeight / 2 - (matCenterY * startScale),
            scale: startScale
        });
    }, [initialDeck]);
    
    // Auto-center opponent view
    useEffect(() => {
        if (isOpponentViewOpen) {
            const opponents = playersList.filter(p => p.id !== socket.id);
            if (opponents.length === 0) return;
            
            const targetPlayer = opponents[selectedOpponentIndex % opponents.length];
            const targetSeatIndex = playersList.findIndex(p => p.id === targetPlayer.id);
            const targetSeatPosIndex = getSeatMapping(targetSeatIndex, playersList.length);
            const targetPos = seatPositions[targetSeatPosIndex];
            const targetRot = SEAT_ROTATIONS[targetSeatPosIndex];
            
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

    // --- Game Flow Methods ---
    const handleStartGameLogic = (options?: { mulligansAllowed: boolean, trackDamage?: boolean }) => {
         const shouldUseMulligans = options?.mulligansAllowed ?? true;
         setMulligansAllowed(shouldUseMulligans);
         if (options?.trackDamage !== undefined) setTrackDamage(options.trackDamage);
         
         if (isLocal) {
             // Draw 7 for everyone
             Object.values(localPlayerStates.current).forEach((state: LocalPlayerState) => {
                 if (state.library.length >= 7) {
                     const initialHand = state.library.slice(0, 7);
                     state.library = state.library.slice(7);
                     // Keep tokens if any
                     const tokens = state.hand.filter(c => c.isToken);
                     state.hand = [...initialHand, ...tokens];
                 }
             });
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
        if (confirm(`Overwrite ${playersList.find(p=>p.id===targetId)?.name}'s game data with saved data from Seat ${seatIdx+1}?`)) {
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
        return isLocal ? playersList[mySeatIndex].id : (socket.id || 'local-player');
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
    
    const handleRemoveDisconnected = () => {
        if (!disconnectModal.player) return;
        const pid = disconnectModal.player.id;
        const toRemove = boardObjects.filter(o => o.controllerId === pid);
        toRemove.forEach(o => emitAction('REMOVE_OBJECT', { id: o.id }));
        setPlayersList(prev => prev.filter(p => p.id !== pid));
        setDisconnectModal({ isOpen: false, player: null });
        addLog(`removed ${disconnectModal.player.name}'s items`, 'SYSTEM');
    };

    const handleKeepDisconnected = () => {
        if (!disconnectModal.player) return;
        addLog(`kept ${disconnectModal.player.name}'s items on table`, 'SYSTEM');
        
        const player = playersList.find(p => p.id === disconnectModal.player!.id) || { ...disconnectModal.player, color: '#888' };
        setGhostPlayers(prev => [...prev, player as any]);

        setDisconnectModal({ isOpen: false, player: null });
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
        const mySeatPosIndex = getSeatMapping(mySeatIndex, playersList.length);
        const myDefaultRotation = SEAT_ROTATIONS[mySeatPosIndex];
        const myId = isLocal ? currentTurnPlayerId : (socket.id || 'local-player');

        const myCards = boardObjects.filter(o => o.controllerId === myId && (o.tappedQuantity > 0 || o.rotation !== myDefaultRotation));
        if (myCards.length === 0) return;
        
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

    const unstackCards = (id: string) => {
        const obj = boardObjects.find(o => o.id === id);
        if (!obj || obj.quantity <= 1) return;
        const newObjects: BoardObject[] = [];
        for(let i = 1; i < obj.quantity; i++) {
            newObjects.push({
                ...obj, id: crypto.randomUUID(), quantity: 1, tappedQuantity: 0,
                x: obj.x + (i * 20), y: obj.y + (i * 20), z: maxZ + i
            });
        }
        setMaxZ(prev => prev + obj.quantity);
        setBoardObjects(prev => [
            ...prev.map(o => o.id === id ? {...o, quantity: 1, tappedQuantity: 0} : o),
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
            const changes: {id: string, updates: Partial<BoardObject>}[] = [];
            
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
                 if (movingObj && movingObj.controllerId === socket.id) {
                     const isTap = (updates.rotation === 90 && movingObj.rotation === 0) ||
                                   (updates.tappedQuantity !== undefined && updates.tappedQuantity > movingObj.tappedQuantity);
                     if (isTap) {
                         const cardName = movingObj.cardData.name;
                         updateMyStats({
                             tappedCounts: {
                                 ...gameStats[socket.id]?.tappedCounts,
                                 [cardName]: (gameStats[socket.id]?.tappedCounts?.[cardName] || 0) + 1
                             }
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
        const seatIdx = getSeatMapping(mySeatIndex, playersList.length);
        const myPos = seatPositions[seatIdx];
        const defaultX = myPos.x + MAT_W / 2 - CARD_WIDTH / 2;
        const defaultY = myPos.y + MAT_H / 2 - CARD_HEIGHT / 2;
        const newObject: BoardObject = {
            id: crypto.randomUUID(), type: 'CARD', cardData: card,
            x: spawnX ?? (defaultX + (Math.random() * 40 - 20)),
            y: spawnY ?? (defaultY + (Math.random() * 40 - 20)),
            z: maxZ + 1, rotation: isLocal ? SEAT_ROTATIONS[seatIdx] : SEAT_ROTATIONS[seatIdx], isFaceDown: false, isTransformed: false,
            counters: {}, commanderDamage: {}, controllerId: getControllerId(),
            quantity: 1, tappedQuantity: 0
        };
        setMaxZ(prev => prev + 1);
        setBoardObjects(prev => [...prev, newObject]);
        emitAction('ADD_OBJECT', newObject);
        updateMyStats({ cardsPlayed: (gameStats[socket.id]?.cardsPlayed || 0) + 1 });
        if (!card.isToken) setHand(prev => prev.filter(c => c.id !== card.id));
        addLog(`played ${card.name} ${card.isToken ? '(Token)' : ''}`);
    };

    const spawnCounter = () => {
        const seatIdx = getSeatMapping(mySeatIndex, playersList.length);
        const myPos = seatPositions[seatIdx];
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
        updateMyStats({ cardsPlayed: (gameStats[socket.id]?.cardsPlayed || 0) + 1 });
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
        updateMyStats({ cardsDrawn: (gameStats[socket.id]?.cardsDrawn || 0) + count });
        addLog(`drew ${count} card${count > 1 ? 's' : ''}`);
    };

    const playCommander = (card: CardData) => {
        setCommandZone(prev => prev.filter(c => c.id !== card.id));
        const seatIdx = getSeatMapping(mySeatIndex, playersList.length);
        const myPos = seatPositions[seatIdx];
        const defaultX = myPos.x + MAT_W / 2 - CARD_WIDTH / 2;
        const defaultY = myPos.y + MAT_H / 2 - CARD_HEIGHT / 2;
        const newObject: BoardObject = {
            id: crypto.randomUUID(), type: 'CARD', cardData: card,
            x: defaultX, y: defaultY, z: maxZ + 1, rotation: SEAT_ROTATIONS[seatIdx], isFaceDown: false, isTransformed: false,
            counters: {}, commanderDamage: {}, controllerId: getControllerId(),
            quantity: 1, tappedQuantity: 0
        };
        setMaxZ(prev => prev + 1);
        setBoardObjects(prev => [...prev, newObject]);
        emitAction('ADD_OBJECT', newObject);
        updateMyStats({ cardsPlayed: (gameStats[socket.id]?.cardsPlayed || 0) + 1 });
        addLog(`cast commander ${card.name}`);
    };

    const handleDamageReport = (damageReport: Record<string, number>, healingReport: Record<string, number>) => {
        const myId = socket.id;
        
        // Process Damage
        let totalDamageReceived = 0;
        Object.entries(damageReport).forEach(([sourceId, amount]) => {
            if (amount > 0) {
                totalDamageReceived += amount;
                emitAction('TRACK_DAMAGE_DEALT', { sourceId, targetId: myId, amount });
                addLog(`reported taking ${amount} damage from ${playersList.find(p=>p.id===sourceId)?.name}`, 'ACTION');
            }
        });
        if (totalDamageReceived > 0) {
            updateMyStats({ damageReceived: (gameStats[myId]?.damageReceived || 0) + totalDamageReceived });
        }

        // Process Healing
        let totalHealingReceived = 0;
        let totalSelfHealing = 0;
        Object.entries(healingReport).forEach(([sourceId, amount]) => {
            if (amount > 0) {
                totalHealingReceived += amount;
                if (sourceId === myId) totalSelfHealing += amount;
                emitAction('TRACK_HEALING_GIVEN', { sourceId, amount });
                addLog(`reported receiving ${amount} healing from ${playersList.find(p=>p.id===sourceId)?.name}`, 'ACTION');
            }
        });
        if (totalHealingReceived > 0) {
            updateMyStats({ 
                healingReceived: (gameStats[myId]?.healingReceived || 0) + totalHealingReceived,
                selfHealing: (gameStats[myId]?.selfHealing || 0) + totalSelfHealing
            });
        }
    };

    const playTopLibrary = () => {
        if (library.length === 0) return;
        const card = library[0];
        setLibrary(prev => prev.slice(1));
        const seatIdx = getSeatMapping(mySeatIndex, playersList.length);
        const myPos = seatPositions[seatIdx];
        const spawnX = myPos.x + MAT_W / 2 - CARD_WIDTH / 2;
        const spawnY = myPos.y + MAT_H / 2 - CARD_HEIGHT / 2;
        const newObject: BoardObject = {
            id: crypto.randomUUID(), type: 'CARD', cardData: card,
            x: spawnX, y: spawnY, z: maxZ + 1, rotation: SEAT_ROTATIONS[seatIdx], isFaceDown: false, isTransformed: false,
            counters: {}, commanderDamage: {}, controllerId: getControllerId(),
            quantity: 1, tappedQuantity: 0
        };
        setMaxZ(prev => prev + 1);
        setBoardObjects(prev => [...prev, newObject]);
        emitAction('ADD_OBJECT', newObject);
        updateMyStats({ cardsPlayed: (gameStats[socket.id]?.cardsPlayed || 0) + 1 });
        addLog(`played top card of library`);
    };

    const playTopGraveyard = () => {
        if (graveyard.length === 0) return;
        const card = graveyard[0];
        setGraveyard(prev => prev.slice(1));
        const seatIdx = getSeatMapping(mySeatIndex, playersList.length);
        const myPos = seatPositions[seatIdx];
        const spawnX = myPos.x + MAT_W / 2 - CARD_WIDTH / 2;
        const spawnY = myPos.y + MAT_H / 2 - CARD_HEIGHT / 2;
        const newObject: BoardObject = {
            id: crypto.randomUUID(), type: 'CARD', cardData: card,
            x: spawnX, y: spawnY, z: maxZ + 1, rotation: SEAT_ROTATIONS[seatIdx], isFaceDown: false, isTransformed: false,
            counters: {}, commanderDamage: {}, controllerId: getControllerId(),
            quantity: 1, tappedQuantity: 0
        };
        setMaxZ(prev => prev + 1);
        setBoardObjects(prev => [...prev, newObject]);
        emitAction('ADD_OBJECT', newObject);
        updateMyStats({ cardsPlayed: (gameStats[socket.id]?.cardsPlayed || 0) + 1 });
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
        const rollerId = isLocal ? currentTurnPlayerId : socket.id;
        const rollerIdx = playersList.findIndex(p => p.id === rollerId);
        if (rollerIdx === -1) return;
        
        const seatIdx = getSeatMapping(rollerIdx, playersList.length);
        const pos = seatPositions[seatIdx];
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
        const seatIndex = getSeatMapping(playerIndex, playersList.length);
        const matPos = seatPositions[seatIndex];
        const rotation = SEAT_ROTATIONS[seatIndex];
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
                const targetSeatIdx = getSeatMapping(i, playersList.length);
                updateBoardObject(id, { controllerId: targetPlayer.id, rotation: SEAT_ROTATIONS[targetSeatIdx] });
                addLog(`gave control of ${obj.cardData.name} to ${targetPlayer.name}`);
                return;
            }
        }
        
        // Check My Mat for regaining control
        if (checkZoneCollision(x, y, mySeatIndex, 'MAT')) {
            if (!isLocal && obj.controllerId !== socket.id && obj.controllerId !== 'local-player') {
                const mySeatIdx = getSeatMapping(mySeatIndex, playersList.length);
                updateBoardObject(id, { controllerId: socket.id || 'local-player', rotation: SEAT_ROTATIONS[mySeatIdx] });
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
                    setView(v => ({...v})); // Force re-render for cursor update
                }
                break;
            case 'd': drawCard(1); break;
            case 'u': untapAll(); break;
            case 's': shuffleLibrary(); break;
            case 'l': setIsLogOpen(prev => !prev); break;
            case '?': setShowShortcuts(prev => !prev); break;
        }
    };

    const handleKeyUp = (e: React.KeyboardEvent) => {
        if (e.key === ' ') {
            isSpacePressed.current = false;
            setView(v => ({...v})); // Force re-render for cursor update
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
    const openSearch = (source: any, targetPlayerId?: string) => {
        let items: any[] = [];
        let targetLibrary = library;
        let targetGraveyard = graveyard;
        
        if (isLocal && targetPlayerId && targetPlayerId !== currentTurnPlayerId) {
            // Access other player's state from ref
            targetLibrary = localPlayerStates.current[targetPlayerId]?.library || [];
            targetGraveyard = localPlayerStates.current[targetPlayerId]?.graveyard || [];
        }

        if (source === 'LIBRARY') items = targetLibrary.map(c => ({ card: c, isRevealed: false }));
        else if (source === 'GRAVEYARD') items = targetGraveyard.map(c => ({ card: c, isRevealed: true }));
        else if (source === 'EXILE') items = exile.map(c => ({ card: c, isRevealed: true }));
        setSearchModal({ isOpen: true, source, items, tray: [], playerId: targetPlayerId });
    };
    const searchTokens = async () => {
        if (!tokenSearchTerm) return;
        const results = await searchCards(tokenSearchTerm);
        setSearchModal(prev => ({ ...prev, items: results.map(c => ({ card: {...c, isToken: true, id: crypto.randomUUID()}, isRevealed: true })) }));
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

    const handleTrayAction = (action: any) => {
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
            lastPinchCenter.current = {
                x: (points[0].x + points[1].x) / 2,
                y: (points[0].y + points[1].y) / 2
            };
            isDraggingView.current = false;
        } else if (activePointers.current.size === 1) {
            const isMouse = e.pointerType === 'mouse';
            if (e.button === 1 || (e.button === 0 && (!isMouse || isSpacePressed.current))) {
                 isDraggingView.current = true;
                 lastMousePos.current = { x: e.clientX, y: e.clientY };
                 e.preventDefault();
            }
        }
    };

    const handleContainerPointerMove = (e: React.PointerEvent) => {
        activePointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });

        if (activePointers.current.size === 2 && initialPinchDist.current && initialPinchCenter.current && lastPinchCenter.current) {
            const points = Array.from(activePointers.current.values()) as { x: number; y: number }[];
            const dist = Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y);
            const scaleChange = dist / initialPinchDist.current;
            const newScale = Math.min(Math.max(0.1, initialScale.current * scaleChange), 5);
            
            const currentCenter = {
                x: (points[0].x + points[1].x) / 2,
                y: (points[0].y + points[1].y) / 2
            };
            
            // Calculate new view position based on zooming into the initial pinch center
            const worldPointX = (initialPinchCenter.current.x - initialView.current.x) / initialScale.current;
            const worldPointY = (initialPinchCenter.current.y - initialView.current.y) / initialScale.current;
            
            // Add panning delta (current center vs last center)
            const dx = currentCenter.x - lastPinchCenter.current.x;
            const dy = currentCenter.y - lastPinchCenter.current.y;
            lastPinchCenter.current = currentCenter;

            // We calculate the new view position such that the world point remains under the pinch center
            // plus any movement of the pinch center itself.
            // Actually, simpler: Re-calculate view based on initial pinch center mapping to current pinch center
            // But we need to account for the fact that the pinch center MOVES.
            // Standard approach: view = currentCenter - worldPoint * newScale
            
            const newX = currentCenter.x - worldPointX * newScale;
            const newY = currentCenter.y - worldPointY * newScale;

            setView({ x: newX, y: newY, scale: newScale });
            return;
        }

        if (isDraggingView.current && activePointers.current.size === 1) {
            const dx = e.clientX - lastMousePos.current.x;
            const dy = e.clientY - lastMousePos.current.y;
            setView(prev => ({ ...prev, x: prev.x + dx, y: prev.y + dy }));
            lastMousePos.current = { x: e.clientX, y: e.clientY };
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
            lastPinchCenter.current = null;
        }
        
        if (activePointers.current.size === 0) {
            isDraggingView.current = false;
        }
    };

    const handleWheel = (e: React.WheelEvent) => {
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
                    backgroundSize: '512px',
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
                    const seatIdx = getSeatMapping(idx, playersList.length);
                    const pos = seatPositions[seatIdx];
                    const rot = SEAT_ROTATIONS[seatIdx];
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
                                zones={{library: ZONE_LIBRARY_OFFSET, graveyard: ZONE_GRAVEYARD_OFFSET, exile: ZONE_EXILE_OFFSET, command: ZONE_COMMAND_OFFSET}}
                                counts={counts}
                                sleeveColor={p.color}
                                topGraveyardCard={isMe ? graveyard[0] : undefined}
                                isShuffling={isMe ? isShuffling : false}
                                isControlled={isMe}
                                commanders={isMe ? commandZone : (isLocal ? (localPlayerStates.current[p.id]?.commandZone || []) : (opponentsCommanders[p.id] || []))}
                                onDraw={isMe ? () => drawCard(1) : (isLocal ? () => {} : () => requestViewZone('LIBRARY', p.id))}
                                onShuffle={isMe ? shuffleLibrary : () => {}}
                                onOpenSearch={isMe ? openSearch : (source) => isLocal ? openSearch(source, p.id) : requestViewZone(source, p.id)}
                                onPlayCommander={isMe ? playCommander : (isLocal ? () => {} : () => {})}
                                onPlayTopLibrary={isMe ? playTopLibrary : () => {}}
                                onPlayTopGraveyard={isMe ? playTopGraveyard : () => {}}
                                onInspectCommander={setInspectCard}
                                isMobile={isMobile}
                                onMobileZoneAction={setMobileZoneMenu}
                            />
                            {!isMe && (
                                <div 
                                    className="absolute text-white font-bold text-lg bg-black/50 px-2 rounded pointer-events-none flex flex-col items-center"
                                    style={{ 
                                        left: pos.x + MAT_W/2, 
                                        top: pos.y + MAT_H/2, 
                                        transform: `translate(-50%, -50%) rotate(${rot}deg) translateY(${MAT_H/2 + 20}px)` 
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
                    const owner = playersList.find(p => p.id === die.playerId);
                    return (
                        <Die 
                            key={die.id} 
                            value={die.value} sides={die.sides} x={die.x} y={die.y} 
                            color={owner?.color || '#fff'} 
                        />
                    );
                })}

                {boardObjects.map(obj => {
                    const isOwnerInGame = playersList.some(p => p.id === obj.controllerId);
                    const isControlled = isLocal || obj.controllerId === socket.id || obj.controllerId === 'local-player' || !isOwnerInGame;
                    
                    const controller = playersList.find(p => p.id === obj.controllerId);
                    const objSleeveColor = controller ? controller.color : sleeveColor;

                    return (
                    <div key={obj.id} className="pointer-events-auto">
                        <Card 
                            object={obj} 
                            sleeveColor={objSleeveColor}
                            isControlledByMe={isControlled}
                            players={playersList} 
                            onUpdate={updateBoardObject} 
                            onBringToFront={(id) => { setMaxZ(p => p+1); updateBoardObject(id, {z: maxZ+1}); }}
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
                            onMobileAction={() => setMobileActionCardId(obj.id)}
                        />
                    </div>
                    );
                })}
            </div>
        </div>
    );

    const cardsInHand = hand.filter(c => !c.isToken);
    const tokensInHand = hand.filter(c => c.isToken);
    
    const mySeatPosIndex = getSeatMapping(mySeatIndex, playersList.length);

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
                                        <Shuffle size={12}/> Shuffle Order
                                    </button>
                                )}
                            </h3>
                            <div className="space-y-2">
                                {playersList.map((player) => (
                                    <div key={player.id} className="flex items-center gap-4 bg-gray-700/50 p-3 rounded-lg border border-gray-600">
                                        <div 
                                            className={`w-10 h-10 rounded-full border-2 border-white/20 shadow-lg flex items-center justify-center font-bold text-white text-lg ${player.id === socket.id ? 'cursor-pointer hover:scale-110 transition-transform' : ''}`} 
                                            style={{backgroundColor: player.color}}
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
                                                <CheckCircle size={14}/> Ready
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
                                        {mulligansAllowed && <CheckCircle size={14} className="text-white"/>}
                                    </div>
                                        <input type="checkbox" className="hidden" checked={mulligansAllowed} onChange={() => updateMulliganSetting(!mulligansAllowed)} disabled={!isHost} />
                                    <div>
                                        <div className="font-bold text-white text-sm">Enable Mulligans</div>
                                    </div>
                                </label>

                                <label className={`flex-1 flex items-center gap-3 bg-gray-700/50 p-3 rounded-lg cursor-pointer border border-gray-600 hover:bg-gray-700 transition ${!mulligansAllowed ? 'opacity-50 pointer-events-none' : ''}`}>
                                    <div className={`w-5 h-5 rounded border flex items-center justify-center ${freeMulligan ? 'bg-green-600 border-green-500' : 'border-gray-500'}`}>
                                        {freeMulligan && <CheckCircle size={14} className="text-white"/>}
                                    </div>
                                    <input type="checkbox" className="hidden" checked={freeMulligan} onChange={() => updateFreeMulliganSetting(!freeMulligan)} disabled={!isHost || !mulligansAllowed} />
                                    <div>
                                        <div className="font-bold text-white text-sm">Free 1st Mulligan</div>
                                    </div>
                                </label>

                                <label className="flex-1 flex items-center gap-3 bg-gray-700/50 p-3 rounded-lg cursor-pointer border border-gray-600 hover:bg-gray-700 transition">
                                    <div className={`w-5 h-5 rounded border flex items-center justify-center ${trackDamage ? 'bg-blue-600 border-blue-500' : 'border-gray-500'}`}>
                                        {trackDamage && <CheckCircle size={14} className="text-white"/>}
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
                             <div className="flex justify-center gap-6 mb-12 flex-wrap max-w-[90vw]">
                                {hand.filter(c => !c.isToken).map((card, idx) => (
                                     <div 
                                        key={idx} 
                                        className="w-32 md:w-48 aspect-[2.5/3.5] rounded-xl overflow-hidden shadow-2xl transform hover:-translate-y-4 transition-transform cursor-pointer group relative"
                                        onClick={() => setInspectCard(card)}
                                     >
                                         <img src={card.imageUrl} className="w-full h-full object-cover"/>
                                          <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 flex items-center justify-center">
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
                                     <RefreshCw size={20}/> Mulligan
                                 </button>
                                 <button 
                                    onClick={() => handleMulliganChoice(true)}
                                    className="flex items-center gap-2 px-8 py-3 bg-green-600 hover:bg-green-500 text-white font-bold rounded-full shadow-lg"
                                 >
                                     <CheckCircle size={20}/> Keep Hand
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
                                                     <img src={card.imageUrl} className="w-full h-full object-cover rounded shadow-lg"/>
                                                     <div className="absolute inset-0 bg-blue-500/20 opacity-0 group-hover:opacity-100 transition-opacity rounded flex items-center justify-center">
                                                         <ArrowRight size={24} className="text-white drop-shadow-md"/>
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
                                                  <span className="text-gray-500 font-mono w-4">{idx+1}.</span>
                                                  <img src={card.imageUrl} className="w-8 h-11 rounded object-cover"/>
                                                  <span className="text-sm font-medium truncate">{card.name}</span>
                                                  <X size={16} className="ml-auto opacity-0 group-hover:opacity-100 text-red-400"/>
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
            <div className="flex-none h-11 md:h-16 bg-gray-900/90 border-b border-gray-700 flex items-center justify-between px-2 md:px-6 z-50 backdrop-blur-md relative">
                 {/* Left Side: Player Info (Always Visible) */}
                 <div className="flex items-center gap-2 md:gap-6 overflow-hidden flex-1">
                    {/* Players List */}
                    <div className="flex items-center gap-4 overflow-x-auto max-w-[60vw] md:max-w-none custom-scrollbar pb-1">
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
                                                     <div className="w-1.5 h-1.5 rounded-full" style={{backgroundColor: td.color}}></div>
                                                     <span className={`font-bold text-[9px] leading-none ${td.dmg >= 21 ? 'text-red-500' : 'text-gray-300'}`}>{td.dmg}</span>
                                                 </div>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                    
                    {/* Life Controls (Local) */}
                    <div className="flex items-center gap-1 bg-gray-800 rounded-lg p-1 border border-gray-600 shadow-inner">
                        <button onClick={() => handleLifeChange(-1)} className="text-red-400 hover:text-red-300 font-bold text-lg px-2 active:scale-90 transition">-</button>
                        <button onClick={() => handleLifeChange(1)} className="text-green-400 hover:text-green-300 font-bold text-lg px-2 active:scale-90 transition">+</button>
                    </div>
                    
                    <div className="flex items-center gap-2 bg-gray-800 rounded-lg p-1 border border-gray-600 mx-1 md:mx-2">
                         <div className="flex items-center gap-1 md:gap-2 px-2 border-r border-gray-600">
                             <Clock size={16} className="text-gray-400 hidden md:block"/>
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
                    <div className="flex flex-col items-end mr-2 hidden md:flex">
                        <span className="text-[10px] text-gray-500 uppercase font-bold tracking-wider">Room Code</span>
                        <span className="text-sm font-mono font-bold text-gray-300 select-all">{isLocal ? 'LOCAL' : roomId}</span>
                    </div>

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
                         onClick={() => setShowShortcuts(true)}
                         className="p-2 rounded-lg hover:bg-gray-800 text-gray-400 hover:text-white"
                         title="Keyboard Shortcuts"
                    >
                        <Keyboard size={20} />
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

                 {/* Mobile Hamburger */}
                 <button 
                    className="md:hidden p-2 text-gray-300 hover:text-white"
                    onClick={() => setMobileMenuOpen(true)}
                 >
                     <Menu size={24} />
                 </button>
            </div>

            {/* Mobile Menu Overlay */}
            {mobileMenuOpen && (
                <div className="fixed inset-0 z-[10000] bg-gray-900/95 backdrop-blur-xl flex flex-col p-6 animate-in slide-in-from-right">
                    <div className="flex justify-between items-center mb-8">
                        <h2 className="text-2xl font-bold text-white">Menu</h2>
                        <button onClick={() => setMobileMenuOpen(false)} className="p-2 bg-gray-800 rounded-full text-white"><X size={24}/></button>
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
                            <ChevronRight size={24} className="text-green-400"/>
                            <span className="text-white font-bold">Pass Turn</span>
                        </button>
                        <button onClick={toggleFullScreen} className="bg-gray-800 p-4 rounded-xl border border-gray-700 flex flex-col items-center gap-2">
                            <Maximize size={24} className="text-blue-400"/>
                            <span className="text-white font-bold">Full Screen</span>
                        </button>
                        <button onClick={() => {setShowCmdrDamage(true); setMobileMenuOpen(false);}} className="bg-gray-800 p-4 rounded-xl border border-gray-700 flex flex-col items-center gap-2">
                            <Swords size={24} className="text-red-400"/>
                            <span className="text-white font-bold">Cmdr Dmg</span>
                        </button>
                        <button onClick={() => {rollDice(6); setMobileMenuOpen(false);}} className="bg-gray-800 p-4 rounded-xl border border-gray-700 flex flex-col items-center gap-2">
                            <Dices size={24} className="text-yellow-500"/>
                            <span className="text-white font-bold">Roll D6</span>
                        </button>
                        <button onClick={() => {spawnCounter(); setMobileMenuOpen(false);}} className="bg-gray-800 p-4 rounded-xl border border-gray-700 flex flex-col items-center gap-2">
                            <Disc size={24} className="text-cyan-400"/>
                            <span className="text-white font-bold">Counter</span>
                        </button>
                        {!isLocal && (
                        <button onClick={() => {setIsOpponentViewOpen(!isOpponentViewOpen); setMobileMenuOpen(false);}} className="bg-gray-800 p-4 rounded-xl border border-gray-700 flex flex-col items-center gap-2">
                            <Users size={24} className="text-purple-400"/>
                            <span className="text-white font-bold">Opponents</span>
                        </button>
                        )}
                    </div>

                    <div className="mt-auto space-y-3">
                        <button onClick={() => {setIsLogOpen(true); setMobileMenuOpen(false);}} className="w-full py-3 bg-gray-800 rounded-xl text-white font-bold flex items-center justify-center gap-2"><History/> Game Log</button>
                        <button onClick={() => {setShowStatsModal(true); setMobileMenuOpen(false);}} className="w-full py-3 bg-gray-800 rounded-xl text-white font-bold flex items-center justify-center gap-2"><BarChart3/> Stats</button>
                        {isHost && <button onClick={() => {setShowPlayerManager(true); setMobileMenuOpen(false);}} className="w-full py-3 bg-blue-900/50 text-blue-200 rounded-xl font-bold flex items-center justify-center gap-2"><Shield/> Host Controls</button>}
                        <button onClick={handleExit} className="w-full py-3 bg-red-900/50 text-red-200 rounded-xl font-bold flex items-center justify-center gap-2"><LogOut/> Leave Game</button>
                    </div>
                </div>
            )}

            {/* --- Main Content Area --- */}
            <div className="flex-1 flex flex-col md:flex-row overflow-hidden relative">
                
                {/* Left / Main Pane */}
                <div className={`${isOpponentViewOpen ? (isMobile ? 'hidden' : 'h-1/2 w-full md:w-1/2 md:h-full border-b md:border-b-0 md:border-r border-gray-700') : 'w-full h-full'} relative transition-all duration-300`}>
                     {renderWorld(view, containerRef, {
                         onDown: handleContainerPointerDown,
                         onMove: handleContainerPointerMove,
                         onUp: handleContainerPointerUp,
                         onWheel: handleWheel
                     }, -SEAT_ROTATIONS[mySeatPosIndex], false)}

                    {/* Controls Overlay (Zoom) */}
                    <div className="absolute top-4 right-4 flex flex-col gap-2 z-10 hidden md:flex">
                         <button onClick={() => setView(v => ({...v, scale: Math.min(v.scale + 0.1, 3)}))} className="p-2 bg-gray-800/80 border border-gray-600 hover:bg-gray-700 rounded text-gray-300"><ZoomIn size={18}/></button>
                        <button onClick={() => setView(v => ({...v, scale: Math.max(v.scale - 0.1, 0.1)}))} className="p-2 bg-gray-800/80 border border-gray-600 hover:bg-gray-700 rounded text-gray-300"><ZoomOut size={18}/></button>
                    </div>

                    {/* Hand UI (Only visible in Setup/Playing) */}
                    {gamePhase !== 'SETUP' && (
                        <>
                        <div 
                            className={`absolute bottom-0 left-0 right-0 z-50 flex flex-col items-center pointer-events-auto transition-transform duration-300 ${isHandVisible ? 'translate-y-0' : 'translate-y-[100%]'}`}
                            onTouchStart={handleHandTouchStart}
                            onTouchEnd={handleHandTouchEnd}
                        >
                            {/* Swipe Handle / Tab for Mobile */}
                            {isMobile && (
                                <div className={`w-full h-8 flex items-center justify-center pointer-events-auto transition-transform ${!isHandVisible ? '-translate-y-12' : '-mt-6'}`} onClick={() => setIsHandVisible(!isHandVisible)}>
                                    <div className={`px-6 py-1 bg-gray-800 border border-gray-600 rounded-t-xl shadow-lg flex items-center justify-center ${!isHandVisible ? 'rounded-b-xl border-b' : ''}`}>
                                        <div className="w-12 h-1.5 bg-gray-500 rounded-full" />
                                    </div>
                                </div>
                            )}

                            <div className={`w-full h-48 pointer-events-none absolute bottom-0 ${isMobile ? '' : 'bg-gradient-to-t from-black via-black/80 to-transparent'}`} />
                            
                            {/* Hand Scroll Container */}
                            <div 
                                ref={handContainerRef}
                                onWheel={handleHandWheel}
                                className="relative w-full overflow-x-auto overflow-y-hidden pointer-events-auto touch-pan-x pb-4 md:pb-8"
                                style={{ 
                                    scrollbarWidth: 'none', 
                                    msOverflowStyle: 'none',
                                }}
                            >
                                <style>{`div::-webkit-scrollbar { display: none; }`}</style>
                                <div 
                                    className="flex items-end gap-2 h-full w-max"
                                    style={{ paddingLeft: `calc(50vw - ${70 * handScale}px)`, paddingRight: `calc(50vw - ${70 * handScale}px)` }}
                                >
                                    {cardsInHand.map((card, idx) => (
                                        <HandCard 
                                            key={card.id} 
                                            card={card} 
                                            scale={handScale}
                                            onInspect={setInspectCard} 
                                            onPlay={playCardFromHand} 
                                            onSendToZone={sendToZone}
                                            isMobile={isMobile}
                                            onMobileAction={() => setMobileActionCardId(card.id)}
                                        />
                                    ))}
                                    
                                    {/* Tokens Pile / Add Button */}
                                    <div className="flex flex-col items-center justify-end h-full pb-1">
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
                                                <div className="flex gap-2 animate-in slide-in-from-bottom-10 fade-in duration-300 items-end">
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
                                                        />
                                                    ))}
                                                    <div className="flex flex-col gap-2 pb-10">
                                                        <button 
                                                            onClick={() => openSearch('TOKENS')}
                                                            className="w-8 h-8 bg-blue-600 hover:bg-blue-500 text-white rounded-full flex items-center justify-center shadow-lg"
                                                            title="Add Token"
                                                        >
                                                            <Plus size={16}/>
                                                        </button>
                                                        <button 
                                                            onClick={() => setAreTokensExpanded(false)}
                                                            className="w-8 h-8 bg-gray-700 hover:bg-gray-600 text-gray-300 rounded-full flex items-center justify-center shadow-lg border border-gray-600"
                                                            title="Collapse"
                                                        >
                                                            <X size={16}/>
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
                                    <ChevronLeft size={20}/>
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
                                    <ChevronRight size={20}/>
                                </button>
                            </div>
                            {isMobile && (
                                <button onClick={() => setIsOpponentViewOpen(false)} className="p-1 bg-red-900/50 text-red-200 rounded"><X size={16}/></button>
                            )}
                            <div className="flex items-center gap-2">
                                <button onClick={() => setOpponentView(v => ({...v, scale: Math.min(v.scale + 0.1, 3)}))} className="p-1.5 hover:bg-gray-700 rounded text-gray-300"><ZoomIn size={16}/></button>
                                <button onClick={() => setOpponentView(v => ({...v, scale: Math.max(v.scale - 0.1, 0.1)}))} className="p-1.5 hover:bg-gray-700 rounded text-gray-300"><ZoomOut size={16}/></button>
                            </div>
                        </div>

                        {/* Opponent Viewport */}
                        <div className="flex-1 relative overflow-hidden">
                             {(() => {
                                 const opponents = playersList.filter(p => p.id !== socket.id);
                                 if (opponents.length === 0) return null;
                                 const targetPlayer = opponents[selectedOpponentIndex % opponents.length];
                                 const targetSeatIndex = playersList.findIndex(p => p.id === targetPlayer.id);
                                 const targetSeatPosIndex = getSeatMapping(targetSeatIndex, playersList.length);
                                 const targetRot = SEAT_ROTATIONS[targetSeatPosIndex];
                                 
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
                            <button onClick={handleRestartGame} className="w-full py-3 bg-blue-600 hover:bg-blue-500 text-white rounded-lg font-bold flex items-center justify-center gap-2"><RotateCcw size={18}/> Restart Lobby</button>
                            <button onClick={() => setShowStatsModal(true)} className="w-full py-3 bg-gray-700 hover:bg-gray-600 text-white rounded-lg font-bold flex items-center justify-center gap-2"><BarChart3 size={18}/> View Stats</button>
                            <button onClick={handleExit} className="w-full py-3 bg-red-600 hover:bg-red-500 text-white rounded-lg font-bold flex items-center justify-center gap-2"><LogOut size={18}/> Return to Menu</button>
                            <button onClick={() => setShowEndGameModal(false)} className="w-full py-2 text-gray-400 hover:text-white mt-2">Cancel</button>
                        </div>
                    </div>
                </div>
            )}

            {disconnectModal.isOpen && disconnectModal.player && (
                <div className="fixed inset-0 z-[10000] bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in">
                    <div className="bg-gray-800 border border-gray-600 rounded-xl p-8 shadow-2xl max-w-md w-full text-center">
                        <h3 className="text-2xl font-bold text-white mb-4">Player Left</h3>
                        <p className="text-gray-300 mb-8"><span className="font-bold text-blue-400">{disconnectModal.player.name}</span> has left the game. Do you want to keep their cards on the table?</p>
                        <div className="flex gap-4 justify-center">
                            <button onClick={handleRemoveDisconnected} className="px-6 py-3 bg-red-600 hover:bg-red-500 text-white rounded-lg font-bold flex-1">Remove</button>
                            <button onClick={handleKeepDisconnected} className="px-6 py-3 bg-green-600 hover:bg-green-500 text-white rounded-lg font-bold flex-1">Keep</button>
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
                                    <button onClick={() => { drawCard(1); setMobileZoneMenu(null); }} className="flex flex-col items-center gap-2 p-4 bg-gray-800 rounded-xl active:bg-blue-600"><Hand size={24} className="text-green-400"/><span className="text-sm text-white">Draw</span></button>
                                    <button onClick={() => { playTopLibrary(); setMobileZoneMenu(null); }} className="flex flex-col items-center gap-2 p-4 bg-gray-800 rounded-xl active:bg-blue-600"><Play size={24} className="text-blue-400"/><span className="text-sm text-white">Play Top</span></button>
                                    <button onClick={() => { openSearch('LIBRARY'); setMobileZoneMenu(null); }} className="flex flex-col items-center gap-2 p-4 bg-gray-800 rounded-xl active:bg-blue-600"><Search size={24} className="text-white"/><span className="text-sm text-white">Search</span></button>
                                    <button onClick={() => { shuffleLibrary(); setMobileZoneMenu(null); }} className="flex flex-col items-center gap-2 p-4 bg-gray-800 rounded-xl active:bg-blue-600"><Shuffle size={24} className="text-purple-400"/><span className="text-sm text-white">Shuffle</span></button>
                                </>
                            )}
                            {mobileZoneMenu === 'GRAVEYARD' && (
                                <>
                                    <button onClick={() => { openSearch('GRAVEYARD'); setMobileZoneMenu(null); }} className="flex flex-col items-center gap-2 p-4 bg-gray-800 rounded-xl active:bg-blue-600"><Search size={24} className="text-white"/><span className="text-sm text-white">View All</span></button>
                                    <button onClick={() => { playTopGraveyard(); setMobileZoneMenu(null); }} className="flex flex-col items-center gap-2 p-4 bg-gray-800 rounded-xl active:bg-blue-600"><Play size={24} className="text-blue-400"/><span className="text-sm text-white">Play Top</span></button>
                                </>
                            )}
                            {mobileZoneMenu === 'EXILE' && (
                                <button onClick={() => { openSearch('EXILE'); setMobileZoneMenu(null); }} className="flex flex-col items-center gap-2 p-4 bg-gray-800 rounded-xl active:bg-blue-600"><Search size={24} className="text-white"/><span className="text-sm text-white">View All</span></button>
                            )}
                            <button onClick={() => setMobileZoneMenu(null)} className="flex flex-col items-center gap-2 p-4 bg-gray-800 rounded-xl active:bg-red-600 col-span-3 mt-2">
                                <X size={24} className="text-white"/>
                                <span className="text-sm text-white">Cancel</span>
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Mobile Card Actions Modal */}
            {mobileActionCardId && (
                <div className="fixed inset-0 z-[12000] bg-black/80 backdrop-blur-sm flex items-end justify-center animate-in slide-in-from-bottom-10" onClick={() => setMobileActionCardId(null)}>
                    <div className="bg-gray-900 w-full rounded-t-2xl border-t border-gray-700 p-6 pb-10" onClick={e => e.stopPropagation()}>
                        {(() => {
                            const obj = boardObjects.find(o => o.id === mobileActionCardId);
                            if (!obj) return null;
                            const isStack = obj.quantity > 1;
                            
                            return (
                                <div className="flex flex-col gap-4">
                                    <div className="flex items-center gap-4 mb-2">
                                        <img src={obj.cardData.imageUrl} className="w-16 h-24 rounded object-cover border border-gray-600" />
                                        <div>
                                            <h3 className="text-white font-bold text-lg line-clamp-1">{obj.cardData.name}</h3>
                                            <p className="text-gray-400 text-sm">{obj.cardData.typeLine}</p>
                                        </div>
                                        <button onClick={() => setMobileActionCardId(null)} className="ml-auto p-2 bg-gray-800 rounded-full text-gray-400"><X/></button>
                                    </div>
                                    
                                    <div className="grid grid-cols-4 gap-3">
                                        <button onClick={() => { updateBoardObject(obj.id, { rotation: obj.rotation === 0 ? 90 : 0 }); setMobileActionCardId(null); }} className="flex flex-col items-center gap-1 p-3 bg-gray-800 rounded-xl active:bg-blue-600">
                                            <RefreshCw size={24} className="text-white"/>
                                            <span className="text-xs text-gray-300">Tap</span>
                                        </button>
                                        <button onClick={() => { setInspectCard(obj.cardData); setMobileActionCardId(null); }} className="flex flex-col items-center gap-1 p-3 bg-gray-800 rounded-xl active:bg-blue-600">
                                            <ZoomIn size={24} className="text-white"/>
                                            <span className="text-xs text-gray-300">Inspect</span>
                                        </button>
                                        <button onClick={() => { updateBoardObject(obj.id, { counters: { ...obj.counters, "+1/+1": (obj.counters["+1/+1"] || 0) + 1 } }); }} className="flex flex-col items-center gap-1 p-3 bg-gray-800 rounded-xl active:bg-blue-600">
                                            <Plus size={24} className="text-green-400"/>
                                            <span className="text-xs text-gray-300">+1/+1</span>
                                        </button>
                                        <button onClick={() => { updateBoardObject(obj.id, { counters: { ...obj.counters, "+1/+1": (obj.counters["+1/+1"] || 0) - 1 } }); }} className="flex flex-col items-center gap-1 p-3 bg-gray-800 rounded-xl active:bg-blue-600">
                                            <Minus size={24} className="text-red-400"/>
                                            <span className="text-xs text-gray-300">-1/-1</span>
                                        </button>
                                        <button onClick={() => { returnToHand(obj.id); setMobileActionCardId(null); }} className="flex flex-col items-center gap-1 p-3 bg-gray-800 rounded-xl active:bg-blue-600">
                                            <Hand size={24} className="text-blue-300"/>
                                            <span className="text-xs text-gray-300">Hand</span>
                                        </button>
                                        <button onClick={() => { updateBoardObject(obj.id, { isFaceDown: !obj.isFaceDown }); setMobileActionCardId(null); }} className="flex flex-col items-center gap-1 p-3 bg-gray-800 rounded-xl active:bg-blue-600">
                                            <Eye size={24} className="text-purple-300"/>
                                            <span className="text-xs text-gray-300">Flip</span>
                                        </button>
                                        {isStack && <button onClick={() => { unstackCards(obj.id); setMobileActionCardId(null); }} className="flex flex-col items-center gap-1 p-3 bg-gray-800 rounded-xl active:bg-blue-600 col-span-2"><Layers size={24} className="text-white"/><span className="text-xs text-gray-300">Unstack All</span></button>}
                                    </div>
                                </div>
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
            />

            <JoinHandlingModal 
                isOpen={joinHandlingModal.isOpen}
                newPlayer={joinHandlingModal.newPlayer}
                ghosts={ghostPlayers}
                onTakeover={handleTakeoverGhost}
                onOverwrite={handleOverwriteGhost}
                onNewSeat={handleAssignNewSeat}
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
                             <h3 className="font-bold text-red-100 flex items-center gap-2"><Swords className="text-red-500"/> Incoming Commander Damage</h3>
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
                                            <div className="w-8 h-8 rounded-full border-2 border-white/20" style={{backgroundColor: p.color}} />
                                            <div>
                                                <div className="font-bold text-gray-300">{p.name}</div>
                                                <div className="text-[10px] text-gray-500 uppercase">Damage Source</div>
                                            </div>
                                        </div>
                                        <div className="flex items-center gap-3">
                                             <button onClick={() => updateCommanderDamage(oppCommanderId, socket.id, -1)} className="w-8 h-8 rounded bg-gray-700 hover:bg-gray-600 flex items-center justify-center text-red-400"><Minus size={16}/></button>
                                             <span className={`text-xl font-bold w-8 text-center ${currentDmg >= 21 ? 'text-red-500' : 'text-white'}`}>{currentDmg}</span>
                                             <button onClick={() => updateCommanderDamage(oppCommanderId, socket.id, 1)} className="w-8 h-8 rounded bg-gray-700 hover:bg-gray-600 flex items-center justify-center text-green-400"><Plus size={16}/></button>
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
                                <Keyboard className="text-blue-400"/> Keyboard Shortcuts
                            </h3>
                            <button onClick={() => setShowShortcuts(false)} className="text-gray-400 hover:text-white"><X size={20}/></button>
                        </div>
                        <div className="grid grid-cols-2 gap-4 text-sm">
                            <div className="flex justify-between items-center p-2 bg-gray-700/50 rounded"><span className="text-gray-300">Draw Card</span><kbd className="bg-black/50 px-2 py-1 rounded text-white font-mono border border-gray-600">D</kbd></div>
                            <div className="flex justify-between items-center p-2 bg-gray-700/50 rounded"><span className="text-gray-300">Untap All</span><kbd className="bg-black/50 px-2 py-1 rounded text-white font-mono border border-gray-600">U</kbd></div>
                            <div className="flex justify-between items-center p-2 bg-gray-700/50 rounded"><span className="text-gray-300">Shuffle Library</span><kbd className="bg-black/50 px-2 py-1 rounded text-white font-mono border border-gray-600">S</kbd></div>
                            <div className="flex justify-between items-center p-2 bg-gray-700/50 rounded"><span className="text-gray-300">Toggle Log</span><kbd className="bg-black/50 px-2 py-1 rounded text-white font-mono border border-gray-600">L</kbd></div>
                            <div className="flex justify-between items-center p-2 bg-gray-700/50 rounded"><span className="text-gray-300">Help / Shortcuts</span><kbd className="bg-black/50 px-2 py-1 rounded text-white font-mono border border-gray-600">?</kbd></div>
                            <div className="flex justify-between items-center p-2 bg-gray-700/50 rounded col-span-2"><span className="text-gray-300">Pan Camera</span><kbd className="bg-black/50 px-2 py-1 rounded text-white font-mono border border-gray-600">Space (Hold) + Drag</kbd></div>
                            <div className="flex justify-between items-center p-2 bg-gray-700/50 rounded col-span-2"><span className="text-gray-300">Zoom Camera</span><kbd className="bg-black/50 px-2 py-1 rounded text-white font-mono border border-gray-600">Mouse Wheel</kbd></div>
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
                            <br/><span className="text-xs text-gray-500">Color: {incomingJoinRequest.color}</span>
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
                        <button onClick={() => setLibraryAction({isOpen: false, cardId: ''})} className="mt-4 w-full text-center text-gray-500 hover:text-white">Cancel</button>
                    </div>
                </div>
            )}
            
            {inspectCard && (
                <div 
                    className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/80 backdrop-blur-sm p-8 animate-in fade-in duration-200"
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
                <div className={`fixed z-[9000] bg-gray-900/95 backdrop-blur-xl flex flex-col animate-in fade-in ${isMobile ? 'bottom-0 left-0 right-0 top-[10vh] rounded-t-2xl p-4' : 'inset-0 p-8'}`}>
                    {(() => {
                        const activeId = isLocal ? playersList[mySeatIndex]?.id : socket.id;
                        const searchTargetId = searchModal.playerId || activeId;
                        const searchTargetPlayer = playersList.find(p => p.id === searchTargetId);
                        const displaySleeveColor = searchTargetPlayer ? searchTargetPlayer.color : sleeveColor;
                        
                        return (
                        <>
                    <div className="flex justify-between items-center mb-6 pb-4 border-b border-gray-700 sticky top-0 bg-gray-900/95 z-10">
                        <div className="flex items-center gap-4">
                            <Search className="text-blue-400" size={32} />
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
                                    <button onClick={revealAll} className="flex items-center gap-2 px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded-lg text-white transition">
                                        <Eye size={16}/> Reveal All
                                    </button>
                                    <button onClick={shuffleAndClose} className="flex items-center gap-2 px-4 py-2 bg-purple-600 hover:bg-purple-500 rounded-lg text-white transition shadow-lg shadow-purple-900/50">
                                        <Shuffle size={16}/> Shuffle & Close
                                    </button>
                                </>
                            )}
                            <button onClick={() => setSearchModal({...searchModal, isOpen: false})} className="p-2 hover:bg-gray-800 rounded-full text-gray-400 hover:text-white"><X size={32} /></button>
                        </div>
                    </div>

                    <div className="flex-1 overflow-y-auto pr-2 pb-60">
                        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 xl:grid-cols-8 gap-4">
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
                                            onClick={() => toggleRevealItem(idx)}
                                        >
                                            <div className="w-10 h-10 rounded-full bg-black/20" />
                                        </div>
                                    )}
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
                                </div>
                            ))}
                        </div>
                    </div>

                    {searchModal.source !== 'TOKENS' && !searchModal.isReadOnly && (
                        <div className="absolute bottom-0 left-0 right-0 bg-gray-900 border-t border-gray-700 p-4 h-80 flex flex-col shadow-2xl z-20">
                            <div className="flex flex-col md:flex-row justify-between items-center mb-2 gap-2">
                                <h3 className="text-sm font-bold text-gray-300 uppercase tracking-wide flex items-center gap-2">
                                    <Layers size={14} /> Selected Cards Tray ({searchModal.tray.length})
                                </h3>
                                <div className="flex gap-2 flex-wrap justify-center">
                                    <button onClick={() => handleTrayAction('HAND')} disabled={searchModal.tray.length===0} className="px-3 py-1 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 rounded text-xs text-white font-bold flex items-center gap-1"><Hand size={12}/> Hand</button>
                                    <button onClick={() => handleTrayAction('HAND_REVEAL')} disabled={searchModal.tray.length===0} className="px-3 py-1 bg-cyan-600 hover:bg-cyan-500 disabled:opacity-50 rounded text-xs text-white font-bold flex items-center gap-1"><Eye size={12}/> Hand & Reveal</button>
                                    <button onClick={() => handleTrayAction('GRAVEYARD')} disabled={searchModal.tray.length===0} className="px-3 py-1 bg-gray-700 hover:bg-gray-600 disabled:opacity-50 rounded text-xs text-white font-bold flex items-center gap-1"><Archive size={12}/> Grave</button>
                                    <button onClick={() => handleTrayAction('EXILE')} disabled={searchModal.tray.length===0} className="px-3 py-1 bg-gray-700 hover:bg-gray-600 disabled:opacity-50 rounded text-xs text-white font-bold flex items-center gap-1"><X size={12}/> Exile</button>
                                    <div className="w-px h-6 bg-gray-700 mx-2" />
                                    <button onClick={() => handleTrayAction('TOP')} disabled={searchModal.tray.length===0} className="px-3 py-1 bg-purple-600 hover:bg-purple-500 disabled:opacity-50 rounded text-xs text-white font-bold flex items-center gap-1"><ArrowUp size={12}/> Top Lib</button>
                                    <button onClick={() => handleTrayAction('BOTTOM')} disabled={searchModal.tray.length===0} className="px-3 py-1 bg-purple-600 hover:bg-purple-500 disabled:opacity-50 rounded text-xs text-white font-bold flex items-center gap-1"><ArrowDown size={12}/> Bot Lib</button>
                                    <button onClick={() => handleTrayAction('SHUFFLE')} disabled={searchModal.tray.length===0} className="px-3 py-1 bg-green-600 hover:bg-green-500 disabled:opacity-50 rounded text-xs text-white font-bold flex items-center gap-1"><Shuffle size={12}/> Shuffle In</button>
                                </div>
                            </div>
                            
                            <div className="flex-1 bg-gray-800/50 rounded-lg border-2 border-dashed border-gray-700 flex items-center px-4 overflow-x-auto gap-4">
                                {searchModal.tray.length === 0 ? (
                                    <div className="text-gray-500 text-sm italic w-full text-center">Add cards from above to perform actions on them. Left is Top, Right is Bottom.</div>
                                ) : (
                                    searchModal.tray.map((card, idx) => (
                                        <div key={card.id} className="relative flex-shrink-0 group w-24 aspect-[2.5/3.5] bg-gray-800 rounded">
                                            <img src={card.imageUrl} className="w-full h-full object-cover rounded" />
                                            <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 flex flex-col justify-between p-1 transition-opacity">
                                                 <div className="flex justify-end">
                                                     <button onClick={() => removeFromTray(card.id)} className="bg-red-500 hover:bg-red-400 p-1 rounded-full text-white"><X size={10}/></button>
                                                 </div>
                                                 <div className="flex justify-between mt-auto">
                                                     <button onClick={() => onTrayReorder(idx, 'LEFT')} disabled={idx===0} className="bg-gray-700 hover:bg-gray-600 disabled:opacity-30 p-1 rounded text-white"><ChevronLeft size={12}/></button>
                                                     <button onClick={() => onTrayReorder(idx, 'RIGHT')} disabled={idx===searchModal.tray.length-1} className="bg-gray-700 hover:bg-gray-600 disabled:opacity-30 p-1 rounded text-white"><ChevronRight size={12}/></button>
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
                    )}
                        </>
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
        </div>
    );
};
