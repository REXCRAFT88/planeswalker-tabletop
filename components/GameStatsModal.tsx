import React from 'react';
import { PlayerStats } from '../types';
import { X, Clock, BarChart3 } from 'lucide-react';

interface GameStatsModalProps {
    isOpen: boolean;
    onClose: () => void;
    stats: Record<string, PlayerStats>;
    players: {id: string, name: string, color: string}[];
}

export const GameStatsModal: React.FC<GameStatsModalProps> = ({ isOpen, onClose, stats, players }) => {
    if (!isOpen) return null;

    const BASIC_LANDS = new Set(['Plains', 'Island', 'Swamp', 'Mountain', 'Forest', 'Wastes', 'Snow-Covered Plains', 'Snow-Covered Island', 'Snow-Covered Swamp', 'Snow-Covered Mountain', 'Snow-Covered Forest']);

    const getMost = (counts: Record<string, number>) => {
        let max = 0;
        let name = '-';
        if (!counts) return { name, count: max };
        Object.entries(counts).forEach(([k, v]) => {
            // Filter out basic lands for "Most Tapped"
            if (v > max && !BASIC_LANDS.has(k)) {
                max = v;
                name = k;
            }
        });
        return { name, count: max };
    };

    const formatTime = (ms: number) => {
        const seconds = Math.floor(ms / 1000);
        const m = Math.floor(seconds / 60);
        const s = seconds % 60;
        return `${m}m ${s}s`;
    };

    return (
        <div className="fixed inset-0 z-[10000] bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in">
            <div className="bg-gray-800 border border-gray-600 rounded-xl shadow-2xl w-full max-w-6xl max-h-[90vh] flex flex-col">
                <div className="p-4 border-b border-gray-700 flex justify-between items-center bg-gray-900 rounded-t-xl">
                    <h3 className="text-2xl font-bold text-white flex items-center gap-2">
                        <BarChart3 className="text-blue-500"/> Game Statistics
                    </h3>
                    <button onClick={onClose} className="text-gray-400 hover:text-white"><X size={24}/></button>
                </div>
                
                <div className="flex-1 overflow-auto p-6 custom-scrollbar">
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                        {players.map(p => {
                            const s = stats[p.id] || {
                                damageDealt: {}, damageReceived: 0, healingGiven: 0, healingReceived: 0, selfHealing: 0,
                                tappedCounts: {},
                                totalTurnTime: 0, cardsPlayed: 0, cardsSentToGraveyard: 0,
                                cardsExiled: 0, cardsDrawn: 0
                            };
                            
                            const mostTapped = getMost(s.tappedCounts);
                            const totalDamageDealt = (Object.values(s.damageDealt || {}) as number[]).reduce((a, b) => a + b, 0);

                            return (
                                <div key={p.id} className="bg-gray-700/50 rounded-xl border border-gray-600 overflow-hidden flex flex-col">
                                    <div className="p-3 border-b border-gray-600 flex items-center gap-3" style={{backgroundColor: `${p.color}20`}}>
                                        <div className="w-8 h-8 rounded-full border-2 border-white/20 shadow-sm flex items-center justify-center font-bold text-white" style={{backgroundColor: p.color}}>
                                            {p.name.charAt(0).toUpperCase()}
                                        </div>
                                        <span className="font-bold text-white truncate">{p.name}</span>
                                    </div>
                                    
                                    <div className="p-4 space-y-4 text-sm flex-1">
                                        <div className="space-y-1">
                                            <div className="text-gray-400 text-xs uppercase font-bold border-b border-gray-600 pb-1 mb-1">Combat & Health</div>
                                            <div className="flex justify-between text-gray-300"><span>Damage Dealt:</span> <span className="text-white font-mono">{totalDamageDealt}</span></div>
                                            <div className="flex justify-between text-gray-300"><span>Damage Taken:</span> <span className="text-red-400 font-mono">{s.damageReceived}</span></div>
                                            <div className="flex justify-between text-gray-300"><span>Healing Given:</span> <span className="text-green-400 font-mono">{s.healingGiven}</span></div>
                                            <div className="flex justify-between text-gray-300"><span>Healing Recv:</span> <span className="text-green-300 font-mono">{s.healingReceived}</span></div>
                                            <div className="flex justify-between text-gray-300"><span>Self Healing:</span> <span className="text-green-200 font-mono">{s.selfHealing}</span></div>
                                        </div>

                                        <div className="space-y-1">
                                            <div className="text-gray-400 text-xs uppercase font-bold border-b border-gray-600 pb-1 mb-1">Card Stats</div>
                                            <div className="flex justify-between text-gray-300"><span>Played:</span> <span className="text-white font-mono">{s.cardsPlayed}</span></div>
                                            <div className="flex justify-between text-gray-300"><span>Drawn:</span> <span className="text-white font-mono">{s.cardsDrawn}</span></div>
                                            <div className="flex justify-between text-gray-300"><span>Graveyard:</span> <span className="text-white font-mono">{s.cardsSentToGraveyard}</span></div>
                                            <div className="flex justify-between text-gray-300"><span>Exiled:</span> <span className="text-white font-mono">{s.cardsExiled}</span></div>
                                        </div>

                                        <div className="space-y-1">
                                            <div className="text-gray-400 text-xs uppercase font-bold border-b border-gray-600 pb-1 mb-1">Highlights</div>
                                            <div className="text-gray-300 text-xs">
                                                <span className="block text-gray-500">Most Tapped:</span>
                                                <span className="text-white truncate block" title={mostTapped.name}>{mostTapped.name} ({mostTapped.count})</span>
                                            </div>
                                        </div>
                                    </div>
                                    
                                    <div className="p-3 bg-gray-800/50 border-t border-gray-600">
                                        <div className="flex justify-between items-center">
                                            <span className="text-gray-400 text-xs uppercase font-bold flex items-center gap-1"><Clock size={12}/> Turn Time</span>
                                            <span className="text-white font-mono text-xs">{formatTime(s.totalTurnTime)}</span>
                                        </div>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </div>
            </div>
        </div>
    );
};