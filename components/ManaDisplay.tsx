import React, { useState } from 'react';
import { ManaPool } from '../services/mana';
import { Eye, EyeOff } from 'lucide-react';

interface ManaDisplayProps {
    pool: ManaPool;
    potentialPool: ManaPool;
}

const MANA_TYPES = ['W', 'U', 'B', 'R', 'G', 'C'] as const;

export const ManaDisplay: React.FC<ManaDisplayProps> = ({ pool, potentialPool }) => {
    const [showAll, setShowAll] = useState(false);

    const hasMana = (type: keyof ManaPool) => (pool[type] || 0) > 0 || (potentialPool[type] || 0) > 0;

    const getIconPath = (type: string) => {
        // Mapping based on standard conventions, user can replace files in public/mana/
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

    return (
        <div className="absolute right-0 top-1/4 flex flex-col items-end gap-1 p-2 pointer-events-none z-40">
            {MANA_TYPES.map(type => {
                if (!showAll && !hasMana(type)) return null;
                const count = pool[type] || 0;
                const potential = potentialPool[type] || 0;

                return (
                    <div key={type} className="flex items-center gap-1 bg-black/40 rounded-l-full pr-2 pl-1 py-1 backdrop-blur-sm pointer-events-auto transition-all hover:pr-4">
                        <div className="flex flex-col items-center justify-center w-8">
                            <span className="font-bold text-white text-xl drop-shadow-[0_2px_2px_rgba(0,0,0,0.8)] leading-none">{count}</span>
                            {potential > 0 && <span className="text-[10px] text-gray-300 font-mono leading-none">({potential})</span>}
                        </div>

                        <div className="relative w-8 h-8 group">
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

            <button
                onClick={() => setShowAll(!showAll)}
                className="pointer-events-auto p-1.5 bg-black/30 hover:bg-black/50 text-white/70 hover:text-white rounded-full transition-colors mt-2"
                title={showAll ? "Hide unused mana types" : "Show all mana types"}
            >
                {showAll ? <EyeOff size={14} /> : <Eye size={14} />}
            </button>
        </div>
    );
};
