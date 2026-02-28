import React, { useMemo } from 'react';
import { CombatState, CombatAssignment, BoardObject, CardData } from '../types';
import { CARD_WIDTH, CARD_HEIGHT } from '../constants';
import { Swords, Shield, Eye, ArrowRight, CheckCircle } from 'lucide-react';

interface Player {
    id: string;
    name: string;
    color: string;
}

interface CombatOverlayProps {
    combatState: CombatState;
    boardObjects: BoardObject[];
    playersList: Player[];
    layout: { x: number; y: number; rot: number }[];
    myId: string;
    matW: number;
    matH: number;
    onToggleAttackerSelection: (boardObjectId: string) => void;
    onAssignAttackersToDefender: (defenderId: string) => void;
    onDeclareAttackers: () => void;
    onAssignBlocker: (blockerId: string, attackerId: string) => void;
    onResolveCombat: () => void;
    onCancelCombat: () => void;
    onSetCombatState: (state: CombatState | null) => void;
    onRemoveAttacker?: (attackerId: string) => void;
    onInspectCard?: (card: CardData) => void;
}

const TRAY_CARD_W = 70;
const TRAY_CARD_H = 98;
const COUNTER_COLORS = ['#3b82f6', '#ef4444', '#22c55e', '#eab308', '#a855f7', '#ec4899', '#64748b'];
const COLOR_NAMES = ['Blue', 'Red', 'Green', 'Yellow', 'Purple', 'Pink', 'Gray'];

export const CombatOverlay: React.FC<CombatOverlayProps> = ({
    combatState,
    boardObjects,
    playersList,
    layout,
    myId,
    matW,
    matH,
    onToggleAttackerSelection,
    onAssignAttackersToDefender,
    onDeclareAttackers,
    onAssignBlocker,
    onResolveCombat,
    onCancelCombat,
    onSetCombatState,
    onRemoveAttacker,
    onInspectCard,
}) => {
    const isAttacker = combatState.attackerPlayerId === myId;
    const attackerPlayer = playersList.find(p => p.id === combatState.attackerPlayerId);

    // Group assignments by defender
    const assignmentsByDefender = useMemo(() => {
        const map = new Map<string, CombatAssignment[]>();
        for (const a of combatState.assignments) {
            const existing = map.get(a.defenderId) || [];
            existing.push(a);
            map.set(a.defenderId, existing);
        }
        return map;
    }, [combatState.assignments]);

    // Get board object by id
    const getObj = (id: string) => boardObjects.find(o => o.id === id);

    // State for blocker selection
    const [selectedBlockerId, setSelectedBlockerId] = React.useState<string | null>(null);

    // Check if I'm a defender in this combat (I'm a defender if I'm not the attacker AND being attacked)
    const amDefender = !isAttacker && combatState.assignments.some(a => a.defenderId === myId);

    const handleBlockerClick = (blockerId: string) => {
        if (selectedBlockerId === blockerId) {
            setSelectedBlockerId(null);
        } else {
            setSelectedBlockerId(blockerId);
        }
    };

    const handleAttackerClickForBlock = (attackerId: string) => {
        if (selectedBlockerId) {
            onAssignBlocker(selectedBlockerId, attackerId);
            setSelectedBlockerId(null);
        }
    };

    const renderTray = (defenderId: string, assignments: CombatAssignment[], isAttackerPerspective: boolean) => {
        const defenderIdx = playersList.findIndex(p => p.id === defenderId);
        const attackerIdx = playersList.findIndex(p => p.id === combatState.attackerPlayerId);

        if (defenderIdx === -1 || attackerIdx === -1) return null;

        const targetPlayerIdx = isAttackerPerspective ? attackerIdx : defenderIdx;
        const pos = layout[targetPlayerIdx];
        if (!pos) return null;

        // "only appearing for the player it is in front of"
        const isTargetMe = playersList[targetPlayerIdx].id === myId;
        if (!isTargetMe) return null;

        const rot = pos.rot;
        const trayHeight = TRAY_CARD_H + 80;
        const trayWidth = Math.max(assignments.length * (TRAY_CARD_W + 12) + 40, 240);

        // Position relative to mat
        let trayX = pos.x + matW / 2;
        let trayY = pos.y - trayHeight / 2 - 20;

        if (rot === 180) {
            trayY = pos.y + matH + trayHeight / 2 + 20;
        } else if (rot === 90) {
            trayX = pos.x + matW + trayWidth / 2 + 20;
            trayY = pos.y + matH / 2;
        } else if (rot === -90) {
            trayX = pos.x - trayWidth / 2 - 20;
            trayY = pos.y + matH / 2;
        }

        return (
            <div
                key={`atk-tray-${defenderId}-${isAttackerPerspective ? 'atk' : 'def'}`}
                className="absolute"
                style={{
                    left: trayX - trayWidth / 2,
                    top: trayY - trayHeight / 2,
                    zIndex: 9990,
                    transform: `rotate(${rot}deg)`,
                }}
            >
                <div className="bg-gray-900/95 backdrop-blur-md border-2 border-red-500/30 rounded-2xl p-4 shadow-[0_20px_50px_rgba(0,0,0,0.5)] min-w-[200px]">
                    <div className="flex items-center justify-between mb-3 border-b border-white/10 pb-2">
                        <div className="flex items-center gap-2 text-sm font-black italic uppercase tracking-tighter">
                            <Swords size={16} className="text-red-500" />
                            <span className="text-red-400">{attackerPlayer?.name}</span>
                            <ArrowRight size={14} className="text-gray-600" />
                            <span className="text-white">{playersList.find(p => p.id === defenderId)?.name}</span>
                        </div>
                    </div>

                    <div className="flex gap-3 items-end">
                        {assignments.map(a => {
                            const obj = getObj(a.attackerId);
                            if (!obj) return null;
                            const hasBlockers = a.blockerIds.length > 0;
                            const canBlockThis = (combatState.phase === 'SELECTING_BLOCKERS' || combatState.phase === 'ATTACKERS_DECLARED') && selectedBlockerId !== null;

                            return (
                                <div key={a.attackerId} className="flex flex-col items-center gap-2">
                                    <div
                                        className={`relative group transition-all duration-300 ${canBlockThis ? 'cursor-pointer hover:-translate-y-1' : ''}`}
                                        style={{ width: TRAY_CARD_W, height: TRAY_CARD_H }}
                                        onClick={(e) => {
                                            if (canBlockThis) {
                                                e.stopPropagation();
                                                e.preventDefault();
                                                handleAttackerClickForBlock(a.attackerId);
                                            }
                                        }}
                                    >
                                        <img
                                            src={obj.cardData.imageUrl}
                                            className={`w-full h-full object-cover rounded-lg shadow-lg ${canBlockThis ? 'ring-2 ring-blue-500 ring-offset-2 ring-offset-gray-900' : 'border border-gray-700'}`}
                                            alt="Attacker"
                                        />
                                        {canBlockThis && (
                                            <div className="absolute inset-0 bg-blue-500/20 group-hover:bg-blue-500/30 transition-colors rounded-lg pointer-events-none"></div>
                                        )}
                                        {canBlockThis && (
                                            <div className="absolute top-1 left-1 bg-blue-600 text-white text-[8px] px-1.5 py-0.5 rounded font-bold shadow-lg z-20">
                                                Click to block
                                            </div>
                                        )}

                                        <div className="absolute top-1 right-1 flex flex-col gap-0.5 pointer-events-none z-10">
                                            {/* Object Counters (e.g., +1/+1) */}
                                            {Object.entries(obj.counters || {}).map(([k, v]) => {
                                                if (v === 0) return null;
                                                const colorIdx = COLOR_NAMES.findIndex(name => name.toLowerCase() === k.toLowerCase());
                                                const bgColor = colorIdx !== -1 ? COUNTER_COLORS[colorIdx] : 'rgba(0,0,0,0.9)';

                                                return (
                                                    <div
                                                        key={`c-${k}`}
                                                        className="text-white text-[8px] px-1.5 py-0.5 rounded-full border border-white/20 shadow-sm leading-tight text-center font-bold"
                                                        style={{ backgroundColor: bgColor }}
                                                    >
                                                        {(k === '+1/+1' || k === '-1/-1') ? (v > 0 ? `+${v}/+${v}` : `${v}/${v}`) : v}
                                                    </div>
                                                );
                                            })}
                                            {/* Floating Counters (Color tags) */}
                                            {boardObjects.filter(o => o.type === 'COUNTER' && Math.abs(o.x - obj.x) < CARD_WIDTH / 2 && Math.abs(o.y - obj.y) < CARD_HEIGHT / 2).map(fc => {
                                                const colorIndex = fc.counters?.colorIndex || 0;
                                                return (
                                                    <div key={`fc-${fc.id}`} className="text-white text-[9px] w-5 h-5 flex items-center justify-center rounded-full border shadow-sm leading-none font-black"
                                                        style={{ backgroundColor: COUNTER_COLORS[colorIndex] || '#3b82f6', borderColor: 'rgba(255,255,255,0.4)' }}>
                                                        {fc.quantity}
                                                    </div>
                                                );
                                            })}
                                            {/* Attacker Stack Badge */}
                                            {obj.quantity > 1 && (
                                                <div className="bg-red-900/90 text-white text-[8px] px-1.5 py-0.5 rounded border border-red-500 font-bold self-end text-center mt-0.5">
                                                    x{obj.quantity}
                                                </div>
                                            )}
                                        </div>

                                        <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-1 rounded-lg pointer-events-none">
                                            <button
                                                onClick={(e) => { e.stopPropagation(); if (onInspectCard) onInspectCard(obj.cardData); }}
                                                className="p-1.5 bg-white/20 hover:bg-white/40 rounded-full text-white backdrop-blur-sm pointer-events-auto"
                                                title="Inspect"
                                            >
                                                <Eye size={14} />
                                            </button>
                                        </div>

                                        {hasBlockers && (
                                            <div className="absolute -bottom-2 -right-2 bg-blue-600 text-white text-[10px] font-black px-2 py-0.5 rounded-full z-10 shadow-lg border border-white/20">
                                                <Shield size={10} className="inline mr-0.5" /> {a.blockerIds.length}
                                            </div>
                                        )}
                                    </div>

                                    {/* Blocker cards display */}
                                    {hasBlockers && (
                                        <div className="flex flex-wrap justify-center gap-1 max-w-[120px]">
                                            {a.blockerIds.map(bId => {
                                                const bObj = getObj(bId);
                                                if (!bObj) return null;
                                                return (
                                                    <div
                                                        key={bId}
                                                        className="relative group/blocker cursor-pointer"
                                                        style={{ width: TRAY_CARD_W * 0.45, height: TRAY_CARD_H * 0.45 }}
                                                        onClick={(e) => { e.stopPropagation(); if (onInspectCard) onInspectCard(bObj.cardData); }}
                                                    >
                                                        <img
                                                            src={bObj.cardData.imageUrl}
                                                            className="w-full h-full object-cover rounded border border-blue-400 shadow-md"
                                                        />
                                                        <div className="absolute top-0.5 right-0.5 flex flex-col gap-0.5 pointer-events-none z-10 scale-75 origin-top-right">
                                                            {/* Object Counters */}
                                                            {Object.entries(bObj.counters || {}).map(([k, v]) => (
                                                                v !== 0 && (
                                                                    <div key={`bc-${k}`} className="bg-black/90 text-white text-[8px] px-1.5 py-0.5 rounded-full border border-gray-500 font-bold leading-none">
                                                                        {(k === '+1/+1' || k === '-1/-1') ? (v > 0 ? `+${v}/+${v}` : `${v}/${v}`) : `${v} ${k}`}
                                                                    </div>
                                                                )
                                                            ))}
                                                            {/* Floating Counters */}
                                                            {boardObjects.filter(o => o.type === 'COUNTER' && Math.abs(o.x - bObj.x) < CARD_WIDTH / 2 && Math.abs(o.y - bObj.y) < CARD_HEIGHT / 2).map(fc => {
                                                                const colorIndex = fc.counters?.colorIndex || 0;
                                                                return (
                                                                    <div key={`bfc-${fc.id}`} className="text-white text-[9px] w-5 h-5 flex items-center justify-center rounded-full border shadow-sm leading-none font-black"
                                                                        style={{ backgroundColor: COUNTER_COLORS[colorIndex] || '#3b82f6', borderColor: 'rgba(255,255,255,0.4)' }}>
                                                                        {fc.quantity}
                                                                    </div>
                                                                );
                                                            })}
                                                            {/* Blocker Stack Badge */}
                                                            {bObj.quantity > 1 && (
                                                                <div className="bg-blue-900/90 text-white text-[8px] px-1.5 py-0.5 rounded border border-blue-500 font-bold self-end text-center mt-0.5">
                                                                    x{bObj.quantity}
                                                                </div>
                                                            )}
                                                        </div>
                                                        <div className="absolute inset-0 bg-black/40 opacity-0 group-hover/blocker:opacity-100 transition-opacity flex items-center justify-center rounded">
                                                            <Eye size={10} className="text-white" />
                                                        </div>
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                </div>
            </div>
        );
    };

    return (
        <>
            {/* Attacker selection glow on board cards */}
            {combatState.phase === 'SELECTING_ATTACKERS' && isAttacker && (
                boardObjects
                    .filter(o => o.controllerId === myId && o.type === 'CARD')
                    .map(obj => {
                        const isSelected = combatState.selectedCardIds.includes(obj.id);
                        const isAssigned = combatState.assignments.some(a => a.attackerId === obj.id);
                        if (!isSelected && !isAssigned) return null;
                        const isStack = (obj.quantity || 1) > 1;
                        const untappedCount = (obj.quantity || 1) - (obj.tappedQuantity || 0);
                        return (
                            <div
                                key={`select-glow-${obj.id}`}
                                className="absolute pointer-events-auto cursor-pointer"
                                style={{
                                    left: obj.x - 4,
                                    top: obj.y - 4,
                                    width: CARD_WIDTH + 8,
                                    height: CARD_HEIGHT + 8,
                                    border: isSelected ? '4px solid #f59e0b' : '3px solid #ef4444',
                                    borderRadius: 6,
                                    transform: `rotate(${obj.rotation || 0}deg)`,
                                    transformOrigin: '50% 50%',
                                    boxShadow: isSelected
                                        ? '0 0 20px rgba(245,158,11,0.8), inset 0 0 10px rgba(245,158,11,0.4)'
                                        : '0 0 15px rgba(239,68,68,0.6)',
                                    zIndex: (obj.z || 0) + 1,
                                    backgroundColor: 'rgba(255, 255, 255, 0.01)'
                                }}
                                onClick={(e) => {
                                    e.stopPropagation();
                                    if (isAssigned && onRemoveAttacker) {
                                        onRemoveAttacker(obj.id);
                                    } else {
                                        onToggleAttackerSelection(obj.id);
                                    }
                                }}
                            >
                                {isStack && (
                                    <div className={`absolute -top-2 -right-1 font-mono rounded-lg px-2 h-6 border-2 border-gray-900 shadow-xl z-20 flex items-center justify-center text-xs font-bold pointer-events-none whitespace-nowrap ${untappedCount === 0 ? 'bg-gray-600 text-gray-400' : 'bg-blue-600 text-white'}`}>
                                        {untappedCount} / {obj.quantity}
                                    </div>
                                )}
                            </div>
                        );
                    })
            )}

            {/* Tray rendering logic for each defender mat and attacker mat */}
            {Array.from(assignmentsByDefender.entries()).map(([defenderId, assignments]) => (
                <React.Fragment key={`trays-${defenderId}`}>
                    {renderTray(defenderId, assignments, false)} {/* Near Defender */}
                    {renderTray(defenderId, assignments, true)}  {/* Near Attacker */}
                </React.Fragment>
            ))}

            {/* SVG Tethers from blockers to attackers */}
            <svg className="absolute inset-0 pointer-events-none" style={{ zIndex: 9995, overflow: 'visible' }}>
                {combatState.assignments.flatMap(a =>
                    a.blockerIds.map(bId => {
                        const atkObj = getObj(a.attackerId);
                        const blkObj = getObj(bId);
                        if (!atkObj || !blkObj) return null;
                        const defPlayer = playersList.find(p => p.id === a.defenderId);

                        return (
                            <line
                                key={`tether-${a.attackerId}-${bId}`}
                                x1={blkObj.x + CARD_WIDTH / 2}
                                y1={blkObj.y + CARD_HEIGHT / 2}
                                x2={atkObj.x + CARD_WIDTH / 2}
                                y2={atkObj.y + CARD_HEIGHT / 2}
                                stroke={defPlayer?.color || '#3b82f6'}
                                strokeWidth={3}
                                strokeDasharray="8 4"
                                opacity={0.7}
                            />
                        );
                    })
                )}
            </svg>

            {/* Right-click targets on opponent mats for assigning attackers */}
            {combatState.phase === 'SELECTING_ATTACKERS' && isAttacker && combatState.selectedCardIds.length > 0 && (
                playersList.map((p, idx) => {
                    if (p.id === myId) return null;
                    const pos = layout[idx];
                    if (!pos) return null;

                    return (
                        <div
                            key={`assign-target-${p.id}`}
                            className="absolute"
                            style={{
                                left: pos.x,
                                top: pos.y,
                                width: matW,
                                height: matH,
                                zIndex: 9970,
                            }}
                            onContextMenu={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                onAssignAttackersToDefender(p.id);
                            }}
                            onClick={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                onAssignAttackersToDefender(p.id);
                            }}
                        />
                    );
                })
            )}

            {/* Small "Assign" button for attacker (only shows when attackers selected) */}
            {combatState.phase === 'SELECTING_ATTACKERS' && isAttacker && combatState.selectedCardIds.length > 0 && combatState.assignments.length === 0 && (
                <div
                    className="fixed top-4 right-4 z-[10000] bg-red-600 hover:bg-red-500 text-white px-4 py-3 rounded-lg shadow-lg cursor-pointer font-bold text-sm flex items-center gap-2 transition-all"
                    onClick={() => {
                        const defender = playersList.find(p => p.id !== myId);
                        if (defender) {
                            onAssignAttackersToDefender(defender.id);
                        }
                    }}
                >
                    <Swords size={16} /> Assign to Opponent
                </div>
            )}

            {/* Small "Declare" button for attacker (only shows when attackers assigned but not declared) */}
            {combatState.phase === 'SELECTING_ATTACKERS' && isAttacker && combatState.assignments.length > 0 && (
                <div
                    className="fixed top-4 right-4 z-[10000] bg-green-600 hover:bg-green-500 text-white px-4 py-3 rounded-lg shadow-lg cursor-pointer font-bold text-sm flex items-center gap-2 transition-all"
                    onClick={onDeclareAttackers}
                >
                    <CheckCircle size={16} /> Declare Attackers
                </div>
            )}

            {/* Small "Done Blocking" button for defender (only shows when blockers phase) */}
            {(combatState.phase === 'SELECTING_BLOCKERS' || combatState.phase === 'ATTACKERS_DECLARED') && amDefender && (
                <div
                    className="fixed top-4 right-4 z-[10000] bg-blue-600 hover:bg-blue-500 text-white px-4 py-3 rounded-lg shadow-lg cursor-pointer font-bold text-sm flex items-center gap-2 transition-all"
                    onClick={() => {
                        onSetCombatState(prev => {
                            if (!prev) return prev;
                            const newState = { ...prev, phase: 'BLOCKERS_DECLARED' };
                            return newState;
                        });
                    }}
                >
                    <Shield size={16} /> Done Blocking
                </div>
            )}

            {/* Blocker selection mode */}
            {(combatState.phase === 'SELECTING_BLOCKERS' || combatState.phase === 'ATTACKERS_DECLARED') && amDefender && (
                boardObjects
                    .filter(o => o.controllerId === myId && o.type === 'CARD')
                    .map(obj => {
                        const isBlocker = combatState.assignments.some(a => a.blockerIds.includes(obj.id));
                        const isSelected = selectedBlockerId === obj.id;
                        const isStack = (obj.quantity || 1) > 1;
                        const untappedCount = (obj.quantity || 1) - (obj.tappedQuantity || 0);

                        return (
                            <div
                                key={`block-glow-${obj.id}`}
                                className="absolute pointer-events-auto cursor-pointer"
                                style={{
                                    left: obj.x - 4,
                                    top: obj.y - 4,
                                    width: CARD_WIDTH + 8,
                                    height: CARD_HEIGHT + 8,
                                    border: isSelected ? '4px solid #3b82f6' : isBlocker ? '3px solid #22c55e' : '3px dashed #3b82f6',
                                    borderRadius: '12px',
                                    transform: `rotate(${obj.rotation || 0}deg)`,
                                    transformOrigin: '50% 50%',
                                    boxShadow: (isSelected || isBlocker) ? `0 0 25px ${isSelected ? 'rgba(59,130,246,0.6)' : 'rgba(34,197,94,0.5)'}` : '0 0 10px rgba(59,130,246,0.3)',
                                    zIndex: (obj.z || 0) + 1,
                                    pointerEvents: 'auto',
                                    backgroundColor: 'rgba(255, 255, 255, 0.01)'
                                }}
                                onClick={(e) => {
                                    e.stopPropagation();
                                    e.preventDefault();
                                    handleBlockerClick(obj.id);
                                }}
                            >
                                {isStack && (
                                    <div className={`absolute -top-2 -right-1 font-mono rounded-lg px-2 h-6 border-2 border-gray-900 shadow-xl z-20 flex items-center justify-center text-xs font-bold pointer-events-none whitespace-nowrap ${untappedCount === 0 ? 'bg-gray-600 text-gray-400' : 'bg-blue-600 text-white'}`}>
                                        {untappedCount} / {obj.quantity}
                                    </div>
                                )}
                                {isSelected && (
                                    <div className="absolute -top-1 -left-1 bg-blue-600 text-white text-xs px-2 py-1 rounded-lg font-bold shadow-lg z-30">
                                        Click attacker to block
                                    </div>
                                )}
                            </div>
                        );
                    })
            )}

        </>
    );
};
