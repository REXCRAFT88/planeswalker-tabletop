import React, { useMemo } from 'react';
import { CombatState, CombatAssignment, BoardObject, CardData } from '../types';
import { CARD_WIDTH, CARD_HEIGHT } from '../constants';
import { Swords, Shield, Eye, ArrowRight } from 'lucide-react';

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
    onRemoveAttacker?: (attackerId: string) => void;
    onInspectCard?: (card: CardData) => void;
}

const TRAY_CARD_W = 70;
const TRAY_CARD_H = 98;

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

    // Check if I'm a defender in this combat
    const amDefender = combatState.assignments.some(a => a.defenderId === myId);

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

                            return (
                                <div key={a.attackerId} className="flex flex-col items-center gap-2">
                                    <div
                                        className={`relative group transition-all duration-300 hover:-translate-y-1 ${((combatState.phase === 'SELECTING_BLOCKERS' || combatState.phase === 'ATTACKERS_DECLARED') && selectedBlockerId) ? 'ring-4 ring-blue-500 ring-offset-2 ring-offset-gray-900 rounded-lg scale-110' : ''}`}
                                        style={{ width: TRAY_CARD_W, height: TRAY_CARD_H }}
                                        onClick={() => {
                                            if ((combatState.phase === 'SELECTING_BLOCKERS' || combatState.phase === 'ATTACKERS_DECLARED') && selectedBlockerId) {
                                                handleAttackerClickForBlock(a.attackerId);
                                            }
                                        }}
                                    >
                                        <img
                                            src={obj.cardData.imageUrl}
                                            className="w-full h-full object-cover rounded-lg shadow-lg border-2 border-red-500/50"
                                            alt="Attacker"
                                        />

                                        <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-1 rounded-lg">
                                            <button
                                                onClick={(e) => { e.stopPropagation(); if (onInspectCard) onInspectCard(obj.cardData); }}
                                                className="p-1.5 bg-white/20 hover:bg-white/40 rounded-full text-white backdrop-blur-sm"
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
                                    boxShadow: isSelected
                                        ? '0 0 20px rgba(245,158,11,0.8), inset 0 0 10px rgba(245,158,11,0.4)'
                                        : '0 0 15px rgba(239,68,68,0.6)',
                                    zIndex: 9999,
                                }}
                                onClick={(e) => {
                                    e.stopPropagation();
                                    if (isAssigned && onRemoveAttacker) {
                                        onRemoveAttacker(obj.id);
                                    } else {
                                        onToggleAttackerSelection(obj.id);
                                    }
                                }}
                            />
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

            {/* Assign-to-defender click targets on opponent mats */}
            {combatState.phase === 'SELECTING_ATTACKERS' && isAttacker && combatState.selectedCardIds.length > 0 && (
                playersList.map((p, idx) => {
                    if (p.id === myId) return null;
                    const pos = layout[idx];
                    if (!pos) return null;

                    return (
                        <div
                            key={`assign-target-${p.id}`}
                            className="absolute cursor-pointer transition-all hover:scale-105 group"
                            style={{
                                left: pos.x,
                                top: pos.y,
                                width: matW,
                                height: matH,
                                zIndex: 9980,
                            }}
                            onClick={() => onAssignAttackersToDefender(p.id)}
                        >
                            <div className="w-full h-full rounded-xl border-4 border-dashed border-red-500/50 group-hover:border-red-400 bg-red-500/10 group-hover:bg-red-500/20 flex items-center justify-center transition-all"
                                style={{ transform: `rotate(${pos.rot}deg)` }}
                            >
                                <div className="bg-red-600/90 px-4 py-2 rounded-lg text-white font-bold flex items-center gap-2 shadow-lg">
                                    <Swords size={18} /> Attack {p.name}
                                </div>
                            </div>
                        </div>
                    );
                })
            )}

            {/* Blocker selection mode */}
            {(combatState.phase === 'SELECTING_BLOCKERS' || combatState.phase === 'ATTACKERS_DECLARED') && amDefender && (
                boardObjects
                    .filter(o => o.controllerId === myId && o.type === 'CARD')
                    .map(obj => {
                        const isBlocker = combatState.assignments.some(a => a.blockerIds.includes(obj.id));
                        const isSelected = selectedBlockerId === obj.id;
                        return (
                            <div
                                key={`block-glow-${obj.id}`}
                                className="absolute pointer-events-auto cursor-pointer"
                                style={{
                                    left: obj.x - 4,
                                    top: obj.y - 4,
                                    width: CARD_WIDTH + 8,
                                    height: CARD_HEIGHT + 8,
                                    border: isSelected ? '3px solid #3b82f6' : isBlocker ? '3px solid #22c55e' : '2px dashed #3b82f680',
                                    borderRadius: 8,
                                    boxShadow: isSelected
                                        ? '0 0 15px rgba(59,130,246,0.6)'
                                        : isBlocker
                                            ? '0 0 15px rgba(34,197,94,0.6)'
                                            : 'none',
                                    zIndex: 9999,
                                }}
                                onClick={(e) => {
                                    e.stopPropagation();
                                    handleBlockerClick(obj.id);
                                }}
                            />
                        );
                    })
            )}

            {/* Blocker selection hint */}
            {(combatState.phase === 'SELECTING_BLOCKERS' || combatState.phase === 'ATTACKERS_DECLARED') && amDefender && selectedBlockerId && (
                <div className="fixed top-20 left-1/2 -translate-x-1/2 z-[10000] bg-blue-600/90 backdrop-blur-sm text-white px-4 py-2 rounded-full shadow-lg text-sm font-bold flex items-center gap-2 animate-pulse">
                    <Shield size={16} />
                    Click an attacker in the tray to assign this blocker
                </div>
            )}
        </>
    );
};
