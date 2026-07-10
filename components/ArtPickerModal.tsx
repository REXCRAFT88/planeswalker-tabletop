import React, { useState, useEffect } from 'react';
import { X, Loader } from 'lucide-react';
import { CardData } from '../types';
import { fetchPrints } from '../services/scryfall';

export const ArtPickerModal: React.FC<{
    card: CardData;
    onClose: () => void;
    onSelectArt: (newArtCard: CardData) => void;
}> = ({ card, onClose, onSelectArt }) => {
    const [prints, setPrints] = useState<CardData[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const load = async () => {
            setLoading(true);
            const res = await fetchPrints(card.name);
            setPrints(res);
            setLoading(false);
        };
        load();
    }, [card.name]);

    return (
        <div className="fixed inset-0 z-[13000] bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in" onClick={onClose}>
            <div className="bg-gray-800 border border-gray-600 rounded-xl p-6 shadow-2xl max-w-4xl w-full h-[85vh] flex flex-col" onClick={e => e.stopPropagation()}>
                <div className="flex justify-between items-center mb-4">
                    <h3 className="text-xl font-bold text-white flex items-center gap-2">Choose Art for {card.name}</h3>
                    <button onClick={onClose} className="text-gray-400 hover:text-white"><X size={20} /></button>
                </div>
                
                <div className="flex-1 overflow-y-auto custom-scrollbar p-2">
                    {loading ? (
                        <div className="flex items-center justify-center h-full text-gray-400 gap-2">
                            <Loader className="animate-spin" /> Loading prints...
                        </div>
                    ) : prints.length === 0 ? (
                        <div className="text-gray-400 text-center mt-10">No alternative prints found.</div>
                    ) : (
                        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
                            {prints.map(p => (
                                <div 
                                    key={p.scryfallId} 
                                    onClick={() => onSelectArt(p)}
                                    className={`relative aspect-[2.5/3.5] rounded-lg cursor-pointer transition-transform border-2 ${p.scryfallId === card.scryfallId ? 'border-amber-500 scale-105' : 'border-transparent hover:border-gray-400 hover:scale-105'}`}
                                >
                                    <img src={p.imageUrl} className="w-full h-full object-cover rounded-md" />
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};
