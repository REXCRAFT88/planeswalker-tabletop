import React, { useMemo } from 'react';
import { CombatState, CombatAssignment, BoardObject } from '../types';
import { CARD_WIDTH, CARD_HEIGHT } from '../constants';
import { Swords, Shield, X, Check, ArrowRight } from 'lucide-react';

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

    return (
        <>
            {/* Attacker selection glow on board cards - uses actual card size */}
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
                                        // Click on an assigned attacker to remove it
                                        onRemoveAttacker(obj.id);
                                    } else {
                                        onToggleAttackerSelection(obj.id);
                                    }
                                }}
                                title={isAssigned ? 'Click to remove attacker' : isSelected ? 'Click to deselect' : ''}
                            />
                        );
                    })
            )}

            {/* Cards assigned as attackers get color outline */}
            {combatState.assignments.map(assignment => {
                const obj = getObj(assignment.attackerId);
                if (!obj) return null;
                const defenderPlayer = playersList.find(p => p.id === assignment.defenderId);
                const color = defenderPlayer?.color || '#ef4444';
                return (
                    <div
                        key={`atk-outline-${assignment.attackerId}`}
                        className="absolute pointer-events-none"
                        style={{
                            left: obj.x - 3,
                            top: obj.y - 3,
                            width: CARD_WIDTH + 6,
                            height: CARD_HEIGHT + 6,
                            border: `4px solid ${color}`,
                            borderRadius: 6,
                            boxShadow: `0 0 15px ${color}88, inset 0 0 8px ${color}44`,
                            zIndex: 9998,
                        }}
                    />
                );
            })}

            {/* Attacker Trays — positioned ABOVE each defender's mat (not covering it) */}
            {Array.from(assignmentsByDefender.entries()).map(([defenderId, assignments]) => {
                const defenderIdx = playersList.findIndex(p => p.id === defenderId);
                if (defenderIdx === -1 || !layout[defenderIdx]) return null;
                const defPos = layout[defenderIdx];
                const defRot = defPos.rot;

                // Position tray ABOVE the defender's mat with enough gap
                const trayHeight = TRAY_CARD_H + 60; // card height + padding + header
                let trayX = defPos.x + matW / 2;
                let trayY = defPos.y - trayHeight - 10;

                // Adjust based on mat rotation for proper positioning
                if (defRot === 180) {
                    trayY = defPos.y + matH + 10;
                } else if (defRot === 90) {
                    trayX = defPos.x + matW + 30;
                    trayY = defPos.y + matH / 2 - trayHeight / 2;
                } else if (defRot === -90) {
                    trayX = defPos.x - 30;
                    trayY = defPos.y + matH / 2 - trayHeight / 2;
                }

                const trayWidth = Math.max(assignments.length * (TRAY_CARD_W + 8) + 24, 200);

                return (
                    <div
                        key={`atk-tray-${defenderId}`}
                        className="absolute"
                        style={{
                            left: trayX - trayWidth / 2,
                            top: trayY,
                            zIndex: 9990,
                        }}
                    >
                        <div className="bg-gray-900/90 backdrop-blur-sm border border-red-500/50 rounded-xl p-3 shadow-2xl">
                            <div className="flex items-center gap-2 mb-2 text-xs font-bold">
                                <Swords size={14} className="text-red-400" />
                                <span className="text-red-300">{attackerPlayer?.name || 'Attacker'}</span>
                                <ArrowRight size={12} className="text-gray-500" />
                                <span className="text-white">{playersList.find(p => p.id === defenderId)?.name}</span>
                            </div>
                            <div className="flex gap-2">
                                {assignments.map(a => {
                                    const obj = getObj(a.attackerId);
                                    if (!obj) return null;
                                    const hasBlockers = a.blockerIds.length > 0;
                                    return (
                                        <div
                                            key={a.attackerId}
                                            className={`relative cursor-pointer transition-transform hover:scale-105 ${(combatState.phase === 'SELECTING_BLOCKERS' || combatState.phase === 'BLOCKERS_DECLARED') && selectedBlockerId ? 'ring-2 ring-blue-400 rounded' : ''}`}
                                            style={{ width: TRAY_CARD_W, height: TRAY_CARD_H }}
                                            onClick={() => {
                                                if ((combatState.phase === 'SELECTING_BLOCKERS' || combatState.phase === 'ATTACKERS_DECLARED') && selectedBlockerId) {
                                                    handleAttackerClickForBlock(a.attackerId);
                                                }
                                            }}
                                        >
                                            <img
                                                src={obj.cardData.imageUrl}
                                                className="w-full h-full object-cover rounded"
                                                style={{
                                                    border: `2px solid ${attackerPlayer?.color || '#ef4444'}`,
                                                }}
                                            />
                                            {hasBlockers && (
                                                <div className="absolute -bottom-1 -right-1 bg-blue-600 text-white text-[9px] font-bold px-1 rounded-full z-10">
                                                    <Shield size={8} className="inline" /> {a.blockerIds.length}
                                                </div>
                                            )}
                                            {/* Blocker cards below */}
                                            {hasBlockers && (
                                                <div className="absolute -bottom-12 left-0 right-0 flex justify-center gap-1">
                                                    {a.blockerIds.map(bId => {
                                                        const bObj = getObj(bId);
                                                        if (!bObj) return null;
                                                        return (
                                                            <div key={bId} className="relative" style={{ width: TRAY_CARD_W * 0.5, height: TRAY_CARD_H * 0.5 }}>
                                                                <img
                                                                    src={bObj.cardData.imageUrl}
                                                                    className="w-full h-full object-cover rounded border border-blue-400"
                                                                />
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
            })}

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

            {/* Name labels as click targets for assigning attackers */}
            {combatState.phase === 'SELECTING_ATTACKERS' && isAttacker && combatState.selectedCardIds.length > 0 && (
                playersList.map((p, idx) => {
                    if (p.id === myId) return null;
                    const pos = layout[idx];
                    if (!pos) return null;

                    return (
                        <div
                            key={`name-target-${p.id}`}
                            className="absolute cursor-pointer z-[9985]"
                            style={{
                                left: pos.x + matW / 2,
                                top: pos.y - 60,
                                transform: 'translateX(-50%)',
                            }}
                            onClick={() => onAssignAttackersToDefender(p.id)}
                        >
                            <div className="bg-red-600 hover:bg-red-500 text-white font-bold px-4 py-2 rounded-full shadow-lg flex items-center gap-2 text-sm transition-colors">
                                <Swords size={14} /> Attack {p.name}
                            </div>
                        </div>
                    );
                })
            )}

            {/* Blocker selection mode — click own cards to select as blocker, then click an attacker in the tray */}
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
                                title={isSelected ? 'Now click an attacker in the tray to block it' : 'Click to select as blocker'}
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
