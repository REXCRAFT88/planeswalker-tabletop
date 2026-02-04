import React, { useState, useRef, useEffect } from 'react';
import { CardData, BoardObject, LogEntry, PlayerStats } from '../types';
import { Card } from './Card';
import { JudgeChat } from './JudgeChat';
import { GameStatsModal } from './GameStatsModal';
import { searchCards } from '../services/scryfall';
import { socket } from '../services/socket';
import { CARD_WIDTH, CARD_HEIGHT } from '../constants';
import { 
    LogOut, MessageSquare, Search, ZoomIn, ZoomOut, History, ArrowUp, ArrowDown, 
    Archive, X, Eye, Shuffle, Crown, Dices, Layers, ChevronRight, Hand, Play, Settings, Swords,
    Clock, Users, CheckCircle, Ban, ArrowRight, Disc, ChevronLeft, Trash2, ArrowLeft, Minus, Plus, Keyboard, RefreshCw, Loader, RotateCcw, BarChart3
} from 'lucide-react';

interface TabletopProps {
    initialDeck: CardData[];
    initialTokens: CardData[];
    playerName: string;
    sleeveColor?: string;
    roomId: string;
    initialGameStarted?: boolean;
    onExit: () => void;
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
    tokenQuery?: string;
}

interface LibraryActionState {
    isOpen: boolean;
    cardId: string;
}

// --- Layout Constants ---
const MAT_W = 700;
const MAT_H = 400;
const GAP = 300; 

// World Coordinates (Absolute)
const LOCAL_MAT_POS = { x: -MAT_W / 2, y: GAP }; // Seat 0 (Bottom)
const LEFT_MAT_POS = { x: -1200, y: -MAT_H / 2 }; // Seat 1 (Left)
const TOP_MAT_POS = { x: -MAT_W / 2, y: -MAT_H - GAP }; // Seat 2 (Top)
const RIGHT_MAT_POS = { x: 500, y: -MAT_H / 2 }; // Seat 3 (Right)

const SEAT_POSITIONS = [
    LOCAL_MAT_POS, // 0: Bottom
    LEFT_MAT_POS,  // 1: Left
    TOP_MAT_POS,   // 2: Top
    RIGHT_MAT_POS  // 3: Right
];

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
}> = ({ card, scale, onInspect, onPlay, onSendToZone }) => {
  const width = 140 * scale; 
  const height = 196 * scale; 
  const [showOverlay, setShowOverlay] = useState(false);

  return (
    <div 
        className="relative flex-shrink-0 transition-transform duration-200 ease-out cursor-pointer group hover:-translate-y-4 hover:z-50"
        style={{ width, height }}
        onClick={() => setShowOverlay(!showOverlay)}
        onMouseLeave={() => setShowOverlay(false)}
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
}> = ({
  x, y, width, height, playerName, rotation, zones, counts, sleeveColor,
  topGraveyardCard, isShuffling, isControlled, commanders,
  onDraw, onShuffle, onOpenSearch, onPlayCommander, onPlayTopLibrary, onPlayTopGraveyard, onInspectCommander
}) => {
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
            className="w-full h-full rounded bg-gray-800 border-2 border-white/20 flex items-center justify-center hover:border-blue-400 transition relative overflow-hidden cursor-pointer"
            onClick={onDraw}
            style={{ backgroundColor: sleeveColor }}
        >
            <div className="text-white font-bold text-2xl z-10 pointer-events-none">{counts.library}</div>
            {isShuffling && <div className="absolute inset-0 flex items-center justify-center bg-black/50 text-xs text-white z-20">Shuffling...</div>}
            
             <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex flex-col items-center justify-center gap-2 z-30"
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
            className="w-full h-full rounded bg-gray-800/50 border-2 border-white/10 flex items-center justify-center relative overflow-hidden cursor-pointer"
            onClick={() => onOpenSearch('GRAVEYARD')}
        >
            {topGraveyardCard ? (
                <img src={topGraveyardCard.imageUrl} className="w-full h-full object-cover rounded opacity-80 hover:opacity-100" alt="Graveyard" />
            ) : (
                 <div className="text-white/20 text-3xl"><Archive /></div>
            )}
             <div className="absolute top-0 right-0 bg-black/80 text-white text-xs px-1.5 rounded-bl font-bold z-10">{counts.graveyard}</div>

             <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex flex-col items-center justify-center gap-2 z-20"
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
            className="w-full h-full rounded bg-black/40 border-2 border-dashed border-white/10 flex items-center justify-center cursor-pointer hover:border-red-400/50"
            onClick={() => onOpenSearch('EXILE')}
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
                onClick={() => isControlled ? onPlayCommander(cmd) : onInspectCommander(cmd)}
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

const emptyStats: PlayerStats = {
    damageDealt: {}, damageReceived: 0, healing: 0,
    tappedCounts: {}, cardDamageCounts: {}, blockCounts: {},
    totalTurnTime: 0, cardsPlayed: 0, cardsSentToGraveyard: 0,
    cardsExiled: 0, cardsDrawn: 0
};

export const Tabletop: React.FC<TabletopProps> = ({ initialDeck, initialTokens, playerName, sleeveColor = '#ef4444', roomId, initialGameStarted, onExit }) => {
    // --- State Declarations ---
    const [gamePhase, setGamePhase] = useState<'SETUP' | 'MULLIGAN' | 'PLAYING'>('SETUP');
    const [mulligansAllowed, setMulligansAllowed] = useState(true);
    const [freeMulligan, setFreeMulligan] = useState(true);
    const [mulliganCount, setMulliganCount] = useState(0);
    const [mulliganSelectionMode, setMulliganSelectionMode] = useState(false);
    const [cardsToBottom, setCardsToBottom] = useState<CardData[]>([]);

    const [turnStartTime, setTurnStartTime] = useState(Date.now());
    const [elapsedTime, setElapsedTime] = useState(0);
    const [round, setRound] = useState(1);
    const [turn, setTurn] = useState(1);
    const [currentTurnPlayerId, setCurrentTurnPlayerId] = useState<string>('');

    const [playersList, setPlayersList] = useState<{id: string, name: string, color: string}[]>([
        { id: 'local-player', name: playerName, color: sleeveColor }
    ]);
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
    const [isJudgeOpen, setIsJudgeOpen] = useState(false);
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

    // Refs
    const dragStartRef = useRef<{ x: number, y: number } | null>(null);
    const isSpacePressed = useRef(false);
    const containerRef = useRef<HTMLDivElement>(null);
    const rootRef = useRef<HTMLDivElement>(null);
    const opponentContainerRef = useRef<HTMLDivElement>(null);
    
    // View Control Refs
    const isDraggingView = useRef(false);
    const lastMousePos = useRef({ x: 0, y: 0 });
    const isDraggingOpponentView = useRef(false);
    const lastOpponentMousePos = useRef({ x: 0, y: 0 });
    
    // Pinch Zoom Refs
    const activePointers = useRef<Map<number, { x: number, y: number }>>(new Map());
    const initialPinchDist = useRef<number | null>(null);
    const initialScale = useRef<number>(1);
    const lastPinchCenter = useRef<{ x: number, y: number } | null>(null);
    
    // State Refs for Socket Handlers
    const libraryRef = useRef(library);
    const playersListRef = useRef(playersList);
    const turnStartTimeRef = useRef(turnStartTime);
    const gamePhaseRef = useRef(gamePhase);
    const prevIsHost = useRef(isHost);
    const startingGameRef = useRef(false);
    
    useEffect(() => { libraryRef.current = library; }, [library]);
    useEffect(() => { playersListRef.current = playersList; }, [playersList]);
    useEffect(() => { turnStartTimeRef.current = turnStartTime; }, [turnStartTime]);
    useEffect(() => { gamePhaseRef.current = gamePhase; }, [gamePhase]);

    useEffect(() => {
        rootRef.current?.focus();
    }, []);

    useEffect(() => {
        if (!prevIsHost.current && isHost) {
            addLog("You are now the Host", "SYSTEM");
        }
        prevIsHost.current = isHost;
    }, [isHost]);

    useEffect(() => {
        if (initialGameStarted && gamePhase === 'SETUP') {
             handleStartGameLogic({ mulligansAllowed: true });
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
        // Save session on mount
        localStorage.setItem('active_game_session', roomId);
        
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
        localStorage.removeItem('active_game_session');
        onExit();
    };

    // Emit life changes
    useEffect(() => {
        if (gamePhase === 'PLAYING' || gamePhase === 'MULLIGAN') {
            socket.emit('game_action', { room: roomId, action: 'UPDATE_LIFE', data: { life } });
        }
    }, [life, gamePhase, roomId]);

    // Emit Count Changes
    useEffect(() => {
        if (gamePhase === 'PLAYING' || gamePhase === 'MULLIGAN') {
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
    }, [library.length, graveyard.length, exile.length, hand.length, commandZone.length, commandZone, gamePhase, roomId]);

    // Stats Helper
    const updateMyStats = (updates: Partial<PlayerStats>) => {
        setGameStats(prev => {
            const myId = socket.id;
            const current = prev[myId] || emptyStats;
            const newStats = { ...current, ...updates };
            
            if (updates.damageDealt) newStats.damageDealt = { ...current.damageDealt, ...updates.damageDealt };
            if (updates.tappedCounts) newStats.tappedCounts = { ...current.tappedCounts, ...updates.tappedCounts };
            if (updates.cardDamageCounts) newStats.cardDamageCounts = { ...current.cardDamageCounts, ...updates.cardDamageCounts };
            if (updates.blockCounts) newStats.blockCounts = { ...current.blockCounts, ...updates.blockCounts };

            socket.emit('game_action', { room: roomId, action: 'UPDATE_STATS', data: { playerId: myId, stats: newStats } });
            return { ...prev, [myId]: newStats };
        });
    };

    // --- Helper Logic ---
    const emitAction = (action: string, data: any) => {
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

    // --- Socket Logic ---
    useEffect(() => {
        const handleRoomUpdate = (roomPlayers: any[]) => {
            console.log("Room Update Received:", roomPlayers);
            const myIndex = roomPlayers.findIndex(p => p.id === socket.id);

            if (myIndex >= 4) {
                alert("The room is full (Max 4 players).");
                handleExit();
                return;
            }

            setPlayersList(roomPlayers);
            if (myIndex !== -1) {
                setMySeatIndex(myIndex);
                setIsHost(myIndex === 0);
            }
        };

        const handleHostApprovalRequest = (data: any) => {
            setIncomingJoinRequest(data);
        };

        const handlePlayerLeft = (id: string) => {
            setBoardObjects(prev => prev.filter(o => o.controllerId !== id));
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
                 handleStartGameLogic(data);
                 if (data.firstPlayerId) {
                     setCurrentTurnPlayerId(data.firstPlayerId);
                 }
             }
             else if (action === 'UPDATE_SETTINGS') {
                 if (data.mulligansAllowed !== undefined) setMulligansAllowed(data.mulligansAllowed);
                 if (data.freeMulligan !== undefined) setFreeMulligan(data.freeMulligan);
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
        };

        socket.on('room_players_update', handleRoomUpdate);
        socket.on('game_action', handleAction);
        socket.on('host_approval_request', handleHostApprovalRequest);
        
        socket.emit('get_players', { room: roomId });

        return () => {
            socket.off('room_players_update', handleRoomUpdate);
            socket.off('game_action', handleAction);
            socket.off('host_approval_request', handleHostApprovalRequest);
        };
    }, []);

    // --- Initialization ---
    useEffect(() => {
        const commanders = initialDeck.filter(c => c.isCommander);
        const deck = initialDeck.filter(c => !c.isCommander);
        const shuffled = [...deck].sort(() => Math.random() - 0.5);
        
        setLibrary(shuffled);
        setCommandZone(commanders);
        setHand(initialTokens);
        setGraveyard([]);
        setExile([]);

        const matCenterY = LOCAL_MAT_POS.y + MAT_H / 2;
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
            const targetPos = SEAT_POSITIONS[targetSeatPosIndex];
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
            
            const s = 1.1; 
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
    const handleStartGameLogic = (options?: { mulligansAllowed: boolean }) => {
         const shouldUseMulligans = options?.mulligansAllowed ?? true;
         setMulligansAllowed(shouldUseMulligans);
         
         const lib = libraryRef.current.length > 0 ? libraryRef.current : initialDeck;
         if (lib.length >= 7) {
             const initialHand = lib.slice(0, 7);
             const remaining = lib.slice(7);
             setHand([...initialHand, ...initialTokens]);
             setLibrary(remaining);
         }
         
         setTurnStartTime(Date.now());
         addLog("Game Started", "SYSTEM", "Host");

         if (shouldUseMulligans) {
             setGamePhase('MULLIGAN');
         } else {
             setGamePhase('PLAYING');
         }
    };

    const startGame = () => {
        if (!isHost) return;
        const startingPlayer = playersList[Math.floor(Math.random() * playersList.length)];
        emitAction('START_GAME', { mulligansAllowed, firstPlayerId: startingPlayer.id });
        handleStartGameLogic({ mulligansAllowed });
        setCurrentTurnPlayerId(startingPlayer.id);
    };

    const handleRestartGame = () => {
        emitAction('RESTART_GAME', {});
        setShowEndGameModal(false);
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
                setGamePhase('PLAYING');
                addLog(`kept hand with ${mulliganCount} mulligans`);
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
        setGamePhase('PLAYING');
        addLog(`kept hand and put ${requiredCount} cards on bottom`);
        setMulliganSelectionMode(false);
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

    const nextTurn = () => {
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
    };

    const formatTime = (ms: number) => {
        const totalSeconds = Math.floor(ms / 1000);
        const minutes = Math.floor(totalSeconds / 60);
        const seconds = totalSeconds % 60;
        return `${minutes}:${seconds.toString().padStart(2, '0')}`;
    };

    const untapAll = () => {
        setBoardObjects(prev => prev.map(o => o.controllerId === socket.id ? { ...o, rotation: 0, tappedQuantity: 0 } : o));
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
        const myPos = SEAT_POSITIONS[seatIdx];
        const defaultX = myPos.x + MAT_W / 2 - CARD_WIDTH / 2;
        const defaultY = myPos.y + MAT_H / 2 - CARD_HEIGHT / 2;
        const newObject: BoardObject = {
            id: crypto.randomUUID(), type: 'CARD', cardData: card,
            x: spawnX ?? (defaultX + (Math.random() * 40 - 20)),
            y: spawnY ?? (defaultY + (Math.random() * 40 - 20)),
            z: maxZ + 1, rotation: SEAT_ROTATIONS[seatIdx], isFaceDown: false, isTransformed: false,
            counters: {}, commanderDamage: {}, controllerId: socket.id || 'local-player',
            quantity: 1, tappedQuantity: 0
        };
        setMaxZ(prev => prev + 1);
        setBoardObjects(prev => [...prev, newObject]);
        emitAction('ADD_OBJECT', newObject);
        if (!card.isToken) setHand(prev => prev.filter(c => c.id !== card.id));
        addLog(`played ${card.name} ${card.isToken ? '(Token)' : ''}`);
    };

    const spawnCounter = () => {
        const seatIdx = getSeatMapping(mySeatIndex, playersList.length);
        const myPos = SEAT_POSITIONS[seatIdx];
        const defaultX = myPos.x + MAT_W / 2 - 20;
        const defaultY = myPos.y + MAT_H / 2 - 20;
        const newObject: BoardObject = {
             id: crypto.randomUUID(), type: 'COUNTER',
             cardData: { ...initialTokens[0] || initialDeck[0], name: "Counter", id: "counter" },
             x: defaultX + (Math.random() * 40 - 20),
             y: defaultY + (Math.random() * 40 - 20),
             z: maxZ + 1, rotation: 0, isFaceDown: false, isTransformed: false,
             counters: {}, commanderDamage: {}, controllerId: socket.id || 'local-player',
             quantity: 1, tappedQuantity: 0
        };
        setMaxZ(prev => prev + 1);
        setBoardObjects(prev => [...prev, newObject]);
        emitAction('ADD_OBJECT', newObject);
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
        addLog(`drew ${count} card${count > 1 ? 's' : ''}`);
    };

    const playCommander = (card: CardData) => {
        setCommandZone(prev => prev.filter(c => c.id !== card.id));
        const seatIdx = getSeatMapping(mySeatIndex, playersList.length);
        const myPos = SEAT_POSITIONS[seatIdx];
        const defaultX = myPos.x + MAT_W / 2 - CARD_WIDTH / 2;
        const defaultY = myPos.y + MAT_H / 2 - CARD_HEIGHT / 2;
        const newObject: BoardObject = {
            id: crypto.randomUUID(), type: 'CARD', cardData: card,
            x: defaultX, y: defaultY, z: maxZ + 1, rotation: SEAT_ROTATIONS[seatIdx], isFaceDown: false, isTransformed: false,
            counters: {}, commanderDamage: {}, controllerId: socket.id || 'local-player',
            quantity: 1, tappedQuantity: 0
        };
        setMaxZ(prev => prev + 1);
        setBoardObjects(prev => [...prev, newObject]);
        emitAction('ADD_OBJECT', newObject);
        addLog(`cast commander ${card.name}`);
    };

    const playTopLibrary = () => {
        if (library.length === 0) return;
        const card = library[0];
        setLibrary(prev => prev.slice(1));
        const seatIdx = getSeatMapping(mySeatIndex, playersList.length);
        const myPos = SEAT_POSITIONS[seatIdx];
        const spawnX = myPos.x + MAT_W / 2 - CARD_WIDTH / 2;
        const spawnY = myPos.y + MAT_H / 2 - CARD_HEIGHT / 2;
        const newObject: BoardObject = {
            id: crypto.randomUUID(), type: 'CARD', cardData: card,
            x: spawnX, y: spawnY, z: maxZ + 1, rotation: SEAT_ROTATIONS[seatIdx], isFaceDown: false, isTransformed: false,
            counters: {}, commanderDamage: {}, controllerId: socket.id || 'local-player',
            quantity: 1, tappedQuantity: 0
        };
        setMaxZ(prev => prev + 1);
        setBoardObjects(prev => [...prev, newObject]);
        emitAction('ADD_OBJECT', newObject);
        addLog(`played top card of library`);
    };

    const playTopGraveyard = () => {
        if (graveyard.length === 0) return;
        const card = graveyard[0];
        setGraveyard(prev => prev.slice(1));
        const seatIdx = getSeatMapping(mySeatIndex, playersList.length);
        const myPos = SEAT_POSITIONS[seatIdx];
        const spawnX = myPos.x + MAT_W / 2 - CARD_WIDTH / 2;
        const spawnY = myPos.y + MAT_H / 2 - CARD_HEIGHT / 2;
        const newObject: BoardObject = {
            id: crypto.randomUUID(), type: 'CARD', cardData: card,
            x: spawnX, y: spawnY, z: maxZ + 1, rotation: SEAT_ROTATIONS[seatIdx], isFaceDown: false, isTransformed: false,
            counters: {}, commanderDamage: {}, controllerId: socket.id || 'local-player',
            quantity: 1, tappedQuantity: 0
        };
        setMaxZ(prev => prev + 1);
        setBoardObjects(prev => [...prev, newObject]);
        emitAction('ADD_OBJECT', newObject);
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

    const rollDice = () => {
        const result = Math.floor(Math.random() * 6) + 1;
        addLog(`rolled a ${result} on a D6`);
        alert(`Rolled a ${result}!`);
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
        const matPos = SEAT_POSITIONS[seatIndex];
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
            if (i === mySeatIndex) continue;
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
            if (obj.controllerId !== socket.id && obj.controllerId !== 'local-player') {
                const mySeatIdx = getSeatMapping(mySeatIndex, playersList.length);
                updateBoardObject(id, { controllerId: socket.id, rotation: SEAT_ROTATIONS[mySeatIdx] });
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
            case 'j': setIsJudgeOpen(prev => !prev); break;
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
    const openSearch = (source: any) => {
        let items: any[] = [];
        if (source === 'LIBRARY') items = library.map(c => ({ card: c, isRevealed: false }));
        else if (source === 'GRAVEYARD') items = graveyard.map(c => ({ card: c, isRevealed: true }));
        else if (source === 'EXILE') items = exile.map(c => ({ card: c, isRevealed: true }));
        setSearchModal({ isOpen: true, source, items, tray: [] });
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

    // --- Rendering Helpers ---

    const handleContainerPointerDown = (e: React.PointerEvent) => {
        (e.target as HTMLElement).setPointerCapture(e.pointerId);
        activePointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });

        if (activePointers.current.size === 2) {
            const points = Array.from(activePointers.current.values()) as { x: number; y: number }[];
            initialPinchDist.current = Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y);
            initialScale.current = view.scale;
            lastPinchCenter.current = {
                x: (points[0].x + points[1].x) / 2,
                y: (points[0].y + points[1].y) / 2
            };
            isDraggingView.current = false;
        } else if (activePointers.current.size === 1) {
            if (e.button === 1 || (e.button === 0 && isSpacePressed.current)) {
                 isDraggingView.current = true;
                 lastMousePos.current = { x: e.clientX, y: e.clientY };
                 e.preventDefault();
            }
        }
    };

    const handleContainerPointerMove = (e: React.PointerEvent) => {
        activePointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });

        if (activePointers.current.size === 2 && initialPinchDist.current && lastPinchCenter.current) {
            const points = Array.from(activePointers.current.values()) as { x: number; y: number }[];
            const dist = Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y);
            const scaleChange = dist / initialPinchDist.current;
            const newScale = Math.min(Math.max(0.1, initialScale.current * scaleChange), 5);
            
            const currentCenter = {
                x: (points[0].x + points[1].x) / 2,
                y: (points[0].y + points[1].y) / 2
            };
            const dx = currentCenter.x - lastPinchCenter.current.x;
            const dy = currentCenter.y - lastPinchCenter.current.y;
            lastPinchCenter.current = currentCenter;

            setView(prev => ({ 
                ...prev, 
                scale: newScale,
                x: prev.x + dx,
                y: prev.y + dy
            }));
            return;
        }

        if (isDraggingView.current && activePointers.current.size === 1) {
            const dx = e.clientX - lastMousePos.current.x;
            const dy = e.clientY - lastMousePos.current.y;
            setView(prev => ({ ...prev, x: prev.x + dx, y: prev.y + dy }));
            lastMousePos.current = { x: e.clientX, y: e.clientY };
        }
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
        const scaleAmount = -e.deltaY * 0.001;
        const newScale = Math.min(Math.max(0.1, view.scale + scaleAmount), 5); 
        setView(prev => ({ ...prev, scale: newScale }));
    };

    const handleOpponentPointerDown = (e: React.PointerEvent) => {
         if (e.button === 1 || (e.button === 0 && isSpacePressed.current)) {
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
        const scaleAmount = -e.deltaY * 0.001;
        const newScale = Math.min(Math.max(0.1, opponentView.scale + scaleAmount), 5);
        setOpponentView(prev => ({ ...prev, scale: newScale }));
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
                    const pos = SEAT_POSITIONS[seatIdx];
                    const rot = SEAT_ROTATIONS[seatIdx];
                    const isMe = p.id === socket.id;
                    const counts = isMe 
                        ? { library: library.length, graveyard: graveyard.length, exile: exile.length, command: commandZone.length }
                        : opponentsCounts[p.id] || { library: 0, graveyard: 0, exile: 0, command: 0 };
                    
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
                                commanders={isMe ? commandZone : (opponentsCommanders[p.id] || [])}
                                onDraw={isMe ? () => drawCard(1) : () => requestViewZone('LIBRARY', p.id)}
                                onShuffle={isMe ? shuffleLibrary : () => {}}
                                onOpenSearch={isMe ? openSearch : (source) => requestViewZone(source, p.id)}
                                onPlayCommander={isMe ? playCommander : () => {}}
                                onPlayTopLibrary={isMe ? playTopLibrary : () => {}}
                                onPlayTopGraveyard={isMe ? playTopGraveyard : () => {}}
                                onInspectCommander={setInspectCard}
                            />
                            {!isMe && (
                                <div 
                                    className="absolute text-white font-bold text-lg bg-black/50 px-2 rounded pointer-events-none"
                                    style={{ 
                                        left: pos.x + MAT_W/2, 
                                        top: pos.y + MAT_H/2, 
                                        transform: `translate(-50%, -50%) rotate(${rot}deg) translateY(${MAT_H/2 + 20}px)` 
                                    }}
                                >
                                    {opponentsLife[p.id] ?? 40} HP
                                </div>
                            )}
                        </React.Fragment>
                    );
                })}

                {boardObjects.map(obj => (
                    <div key={obj.id} className="pointer-events-auto"> 
                        <Card 
                            object={obj} 
                            sleeveColor={sleeveColor}
                            isControlledByMe={obj.controllerId === socket.id}
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
                        />
                    </div>
                ))}
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
                <div className="absolute inset-0 z-[100] bg-gray-900/95 backdrop-blur-md flex items-center justify-center animate-in fade-in p-4">
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
                            <h3 className="text-sm font-bold text-gray-400 uppercase tracking-wide mb-4">Connected Players ({playersList.length})</h3>
                            <div className="space-y-2">
                                {playersList.map((player) => (
                                    <div key={player.id} className="flex items-center gap-4 bg-gray-700/50 p-3 rounded-lg border border-gray-600">
                                        <div className="w-10 h-10 rounded-full border-2 border-white/20 shadow-lg flex items-center justify-center font-bold text-white text-lg" style={{backgroundColor: player.color}}>
                                            {player.name.charAt(0).toUpperCase()}
                                        </div>
                                        <div className="flex-1">
                                            <div className="font-bold text-white text-lg">{player.name}</div>
                                            <div className="text-xs text-gray-400">{player.id === socket.id ? '(You)' : 'Opponent'}</div>
                                        </div>
                                        {player.id === socket.id && (
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
                            <div className="flex gap-4">
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
                     <p className="text-gray-400 mb-8 text-center max-w-lg">
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
                                        className="w-48 aspect-[2.5/3.5] rounded-xl overflow-hidden shadow-2xl transform hover:-translate-y-4 transition-transform cursor-pointer group relative"
                                        onClick={() => setInspectCard(card)}
                                     >
                                         <img src={card.imageUrl} className="w-full h-full object-cover"/>
                                          <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 flex items-center justify-center">
                                              <span className="bg-black/80 px-2 py-1 rounded text-xs text-white">Click to Inspect</span>
                                          </div>
                                     </div>
                                ))}
                             </div>

                             <div className="flex gap-6">
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
                             <div className="flex gap-8 w-full mb-8 min-h-[400px]">
                                 
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
                                 <div className="w-80 bg-gray-800/50 rounded-xl p-6 border border-gray-700 flex flex-col">
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
                                 Confirm & Start Game
                             </button>
                         </div>
                     )}
                </div>
            )}

            {/* --- UI: Top Bar --- */}
            <div className="flex-none h-16 bg-gray-900/90 border-b border-gray-700 flex items-center justify-between px-6 z-50 backdrop-blur-md relative">
                 <div className="flex items-center gap-6">
                    {/* Players List */}
                    <div className="flex items-center gap-4 overflow-x-auto max-w-[30vw] md:max-w-none custom-scrollbar pb-1">
                        {playersList.map(p => {
                            const isMe = p.id === socket.id;
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
                                <div key={p.id} className={`flex items-center gap-2 bg-gray-800/50 rounded-full pr-3 pl-1 py-1 border ${isTurn ? 'border-yellow-500 shadow-[0_0_10px_rgba(234,179,8,0.3)]' : 'border-gray-700'}`}>
                                    <div 
                                        className="w-8 h-8 rounded-full flex items-center justify-center font-bold text-xs border border-white/20 shadow-lg shrink-0"
                                        style={{ backgroundColor: p.color }}
                                    >
                                        {p.name.charAt(0).toUpperCase()}
                                    </div>
                                    <div className="flex flex-col leading-none">
                                        <span className={`text-xs font-bold ${isTurn ? 'text-yellow-400' : 'text-gray-300'} max-w-[80px] truncate`}>{p.name}</span>
                                        <div className="flex items-center gap-2 text-[10px]">
                                            <span className="text-white font-mono">{pLife} HP</span>
                                            {takenDamage.map(td => (
                                                 <div key={td.id} className="flex items-center gap-0.5 bg-black/40 px-1 rounded" title={`Damage from ${td.name}'s Commander`}>
                                                     <div className="w-1.5 h-1.5 rounded-full" style={{backgroundColor: td.color}}></div>
                                                     <span className={`font-bold ${td.dmg >= 21 ? 'text-red-500' : 'text-gray-300'}`}>{td.dmg}</span>
                                                 </div>
                                            ))}
                                        </div>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                    
                    {/* Life Controls (Local) */}
                    <div className="flex items-center gap-1 bg-gray-800 rounded-lg p-1 border border-gray-600 shadow-inner">
                        <button onClick={() => {setLife(l => l - 1); addLog("lost 1 life");}} className="text-red-400 hover:text-red-300 font-bold text-lg px-2 active:scale-90 transition">-</button>
                        <button onClick={() => {setLife(l => l + 1); addLog("gained 1 life");}} className="text-green-400 hover:text-green-300 font-bold text-lg px-2 active:scale-90 transition">+</button>
                    </div>
                    
                    <div className="flex items-center gap-2 bg-gray-800 rounded-lg p-1 border border-gray-600 mx-2">
                         <div className="flex items-center gap-2 px-2 border-r border-gray-600">
                             <Clock size={16} className="text-gray-400"/>
                             <span className="text-sm font-bold text-white">Turn {turn}</span>
                         </div>
                         <div className="px-2 text-sm text-blue-400 font-bold max-w-[100px] truncate">
                             {playersList.find(p => p.id === currentTurnPlayerId)?.name || '...'}
                         </div>
                         <button 
                            onClick={nextTurn} 
                            disabled={currentTurnPlayerId !== socket.id}
                            className="p-1 hover:bg-gray-700 rounded text-green-400 disabled:text-gray-600 disabled:hover:bg-transparent disabled:cursor-not-allowed" 
                            title="Pass Turn"
                         >
                             <ChevronRight size={16} />
                         </button>
                    </div>
                    
                    <button 
                        onClick={() => setShowCmdrDamage(true)}
                        className="flex items-center gap-2 px-3 py-1 bg-gray-800 border border-gray-600 rounded hover:bg-gray-700 text-red-400"
                        title="Commander Damage"
                    >
                        <Swords size={20} />
                        <span className="text-xs font-bold uppercase hidden lg:inline">Cmdr Dmg</span>
                    </button>
                    
                    <div className="w-px h-6 bg-gray-700 mx-2" />
                    
                    <button onClick={rollDice} className="flex items-center gap-2 px-3 py-1 bg-gray-800 border border-gray-600 rounded hover:bg-gray-700 text-yellow-500">
                        <Dices size={20} />
                        <span className="text-xs font-bold uppercase hidden md:inline">Roll D6</span>
                    </button>
                    
                     <button onClick={spawnCounter} className="flex items-center gap-2 px-3 py-1 bg-gray-800 border border-gray-600 rounded hover:bg-gray-700 text-cyan-400">
                        <Disc size={20} />
                        <span className="text-xs font-bold uppercase hidden md:inline">Add Counter</span>
                    </button>
                 </div>

                 <div className="flex items-center gap-3">
                    <div className="flex flex-col items-end mr-2 hidden md:flex">
                        <span className="text-[10px] text-gray-500 uppercase font-bold tracking-wider">Room Code</span>
                        <span className="text-sm font-mono font-bold text-gray-300 select-all">{roomId}</span>
                    </div>

                    <button 
                        onClick={() => setIsOpponentViewOpen(!isOpponentViewOpen)}
                        className={`p-2 rounded-lg transition-colors ${isOpponentViewOpen ? 'bg-blue-600 text-white' : 'hover:bg-gray-800 text-gray-400'}`}
                        title="Toggle Opponent View"
                    >
                        <Users size={20} />
                    </button>
                    
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
                    {isHost && (
                        <button onClick={() => setShowEndGameModal(true)} className="p-2 rounded-lg hover:bg-gray-800 text-red-400 hover:text-red-300" title="End Game">
                            <RotateCcw size={20} />
                        </button>
                    )}
                    <button 
                        onClick={() => setIsJudgeOpen(!isJudgeOpen)} 
                        className={`flex items-center gap-2 px-4 py-2 rounded-lg border transition-colors ${isJudgeOpen ? 'bg-purple-600 border-purple-500 text-white' : 'bg-gray-800 border-gray-600 text-gray-300 hover:bg-gray-700'}`}
                    >
                        <MessageSquare size={16} />
                        <span className="hidden md:inline">Judge</span>
                    </button>
                    <button onClick={handleExit} className="flex items-center gap-2 px-4 py-2 bg-red-900/50 hover:bg-red-900/80 border border-red-800 text-red-200 rounded-lg transition-colors">
                        <LogOut size={16} />
                        <span className="hidden md:inline">Leave</span>
                    </button>
                 </div>
            </div>

            {/* --- Main Content Area --- */}
            <div className="flex-1 flex overflow-hidden relative">
                
                {/* Left / Main Pane */}
                <div className={`${isOpponentViewOpen ? 'w-1/2 border-r border-gray-700' : 'w-full'} relative h-full transition-all duration-300`}>
                     {renderWorld(view, containerRef, {
                         onDown: handleContainerPointerDown,
                         onMove: handleContainerPointerMove,
                         onUp: handleContainerPointerUp,
                         onWheel: handleWheel
                     }, -SEAT_ROTATIONS[mySeatPosIndex], false)}

                    {/* Controls Overlay (Zoom) */}
                    <div className="absolute top-4 right-4 flex flex-col gap-2 z-10">
                         <button onClick={() => setView(v => ({...v, scale: Math.min(v.scale + 0.1, 3)}))} className="p-2 bg-gray-800/80 border border-gray-600 hover:bg-gray-700 rounded text-gray-300"><ZoomIn size={18}/></button>
                        <button onClick={() => setView(v => ({...v, scale: Math.max(v.scale - 0.1, 0.1)}))} className="p-2 bg-gray-800/80 border border-gray-600 hover:bg-gray-700 rounded text-gray-300"><ZoomOut size={18}/></button>
                    </div>

                    {/* Hand UI (Only visible in Setup/Playing) */}
                    {gamePhase !== 'SETUP' && (
                        <>
                        <div className="absolute bottom-0 left-0 right-0 z-50 flex flex-col items-center pointer-events-none">
                            <div className="w-full h-48 bg-gradient-to-t from-black via-black/80 to-transparent pointer-events-none absolute bottom-0" />
                            <div className="relative w-full px-8 pb-8 flex items-end justify-center pointer-events-auto">
                                <div className="flex gap-2 items-end min-w-min px-4 overflow-x-auto overflow-y-hidden pb-4 mx-auto scrollbar-thin scrollbar-thumb-gray-500 scrollbar-track-gray-800/50" style={{ maxWidth: '85vw' }}>
                                    {cardsInHand.map((card, idx) => (
                                        <HandCard 
                                            key={card.id} 
                                            card={card} 
                                            scale={handScale}
                                            onInspect={setInspectCard} 
                                            onPlay={playCardFromHand} 
                                            onSendToZone={sendToZone}
                                        />
                                    ))}
                                    
                                    {/* Tokens Pile / Add Button */}
                                    <div className="flex flex-col items-center justify-end h-full pb-1">
                                            {!areTokensExpanded ? (
                                                <div 
                                                    className={`w-24 h-32 bg-gray-800 border-2 ${tokensInHand.length > 0 ? 'border-yellow-500' : 'border-gray-600 border-dashed'} rounded-lg flex flex-col items-center justify-center cursor-pointer hover:scale-105 transition-transform shadow-lg`}
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
                                {hand.length === 0 && <div className="h-48 flex items-center text-gray-500 italic relative z-10">Hand is empty</div>}
                            </div>
                        </div>
                        
                        <div className="absolute bottom-6 right-6 z-[60] flex flex-col items-center bg-gray-800/80 backdrop-blur rounded-lg p-2 border border-gray-600">
                            <Settings size={16} className="text-gray-400 mb-2" />
                            <input 
                                type="range" 
                                min="0.5" 
                                max="1.5" 
                                step="0.1" 
                                value={handScale}
                                onChange={(e) => setHandScale(parseFloat(e.target.value))}
                                className="h-24 w-1 bg-gray-600 rounded-lg appearance-none cursor-pointer vertical-range"
                                style={{ writingMode: 'vertical-lr', direction: 'rtl' }}
                            />
                        </div>
                        </>
                    )}
                </div>
                
                {/* Right / Opponent Pane */}
                {isOpponentViewOpen && (
                    <div className="w-1/2 h-full relative bg-gray-900 border-l border-gray-700 flex flex-col">
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
            <JudgeChat isOpen={isJudgeOpen} onClose={() => setIsJudgeOpen(false)} />
            
            {showEndGameModal && (
                <div className="fixed inset-0 z-[10000] bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in">
                    <div className="bg-gray-800 border border-gray-600 rounded-xl p-8 shadow-2xl max-w-md w-full text-center">
                        <h3 className="text-2xl font-bold text-white mb-4">End Game?</h3>
                        <p className="text-gray-300 mb-8">Do you want to restart the lobby with current players or return to the main menu?</p>
                        <div className="flex flex-col gap-3">
                            <button onClick={handleRestartGame} className="w-full py-3 bg-blue-600 hover:bg-blue-500 text-white rounded-lg font-bold flex items-center justify-center gap-2"><RotateCcw size={18}/> Restart Lobby</button>
                            <button onClick={handleExit} className="w-full py-3 bg-red-600 hover:bg-red-500 text-white rounded-lg font-bold flex items-center justify-center gap-2"><LogOut size={18}/> Return to Menu</button>
                            <button onClick={() => setShowEndGameModal(false)} className="w-full py-2 text-gray-400 hover:text-white mt-2">Cancel</button>
                        </div>
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
                            <div className="flex justify-between items-center p-2 bg-gray-700/50 rounded"><span className="text-gray-300">Judge Chat</span><kbd className="bg-black/50 px-2 py-1 rounded text-white font-mono border border-gray-600">J</kbd></div>
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
                <div className="fixed inset-0 z-[9000] bg-gray-900/95 backdrop-blur-xl flex flex-col p-8 animate-in fade-in">
                    <div className="flex justify-between items-center mb-6 pb-4 border-b border-gray-700 sticky top-0 bg-gray-900/95 z-10">
                        <div className="flex items-center gap-4">
                            <Search className="text-blue-400" size={32} />
                            <div>
                                <h2 className="text-3xl font-bold text-white capitalize flex items-center gap-3">
                                    {searchModal.source === 'TOKENS' ? 'Search Tokens' : searchModal.source.toLowerCase()}
                                    {searchModal.source !== 'TOKENS' && <span className="text-gray-500 text-lg">({searchModal.items.length} cards)</span>}
                                </h2>
                                {searchModal.source === 'TOKENS' && (
                                    <div className="flex gap-2 mt-2">
                                        <input 
                                            className="bg-gray-800 border border-gray-600 rounded px-3 py-1 text-white"
                                            placeholder="e.g. Goblin, Treasure"
                                            value={tokenSearchTerm}
                                            onChange={(e) => setTokenSearchTerm(e.target.value)}
                                            onKeyDown={(e) => e.key === 'Enter' && searchTokens()}
                                        />
                                        <button onClick={searchTokens} className="bg-blue-600 px-3 py-1 rounded text-white">Search</button>
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
                                            style={{ backgroundColor: sleeveColor }}
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
                            <div className="flex justify-between items-center mb-2">
                                <h3 className="text-sm font-bold text-gray-300 uppercase tracking-wide flex items-center gap-2">
                                    <Layers size={14} /> Selected Cards Tray ({searchModal.tray.length})
                                </h3>
                                <div className="flex gap-2">
                                    <button onClick={() => handleTrayAction('HAND')} disabled={searchModal.tray.length===0} className="px-3 py-1 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 rounded text-xs text-white font-bold flex items-center gap-1"><Hand size={12}/> Hand</button>
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
