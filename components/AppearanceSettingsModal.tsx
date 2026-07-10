import React, { useState, useEffect } from 'react';
import { X, Palette } from 'lucide-react';
import { AppearancePicker, DEFAULT_TRANSFORM, ImgTransform } from '../appearance';

export const AppearanceSettingsModal: React.FC<{ onClose: () => void }> = ({ onClose }) => {
    const [customMatUrl, setCustomMatUrl] = useState(() => localStorage.getItem('planeswalker_mat_url') || '');
    const [customSleeveUrl, setCustomSleeveUrl] = useState(() => localStorage.getItem('planeswalker_sleeve_url') || '');
    
    const [matTransform, setMatTransform] = useState<ImgTransform>(() => {
        try { return JSON.parse(localStorage.getItem('planeswalker_mat_tf') || '') } catch { return DEFAULT_TRANSFORM }
    });
    
    const [sleeveTransform, setSleeveTransform] = useState<ImgTransform>(() => {
        try { return JSON.parse(localStorage.getItem('planeswalker_sleeve_tf') || '') } catch { return DEFAULT_TRANSFORM }
    });

    useEffect(() => {
        localStorage.setItem('planeswalker_mat_url', customMatUrl);
        localStorage.setItem('planeswalker_mat_tf', JSON.stringify(matTransform));
    }, [customMatUrl, matTransform]);

    useEffect(() => {
        localStorage.setItem('planeswalker_sleeve_url', customSleeveUrl);
        localStorage.setItem('planeswalker_sleeve_tf', JSON.stringify(sleeveTransform));
    }, [customSleeveUrl, sleeveTransform]);

    return (
        <div className="fixed inset-0 z-[12000] bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in" onClick={onClose}>
            <div className="bg-gray-800 border border-gray-600 rounded-xl p-6 shadow-2xl max-w-md w-full max-h-[90vh] flex flex-col" onClick={e => e.stopPropagation()}>
                <div className="flex justify-between items-center mb-4">
                    <h3 className="text-xl font-bold text-white flex items-center gap-2"><Palette className="text-purple-400" /> Table Appearance</h3>
                    <button onClick={onClose} className="text-gray-400 hover:text-white"><X size={20} /></button>
                </div>
                <p className="text-xs text-gray-400 mb-4">Set a custom playmat and card sleeve for your games.</p>
                <div className="flex-1 overflow-y-auto custom-scrollbar space-y-4 pr-1">
                    <AppearancePicker label="Playmat" url={customMatUrl} transform={matTransform} aspect="16 / 10" onUrl={setCustomMatUrl} onTransform={setMatTransform} />
                    <AppearancePicker label="Card Sleeve" url={customSleeveUrl} transform={sleeveTransform} aspect="5 / 7" onUrl={setCustomSleeveUrl} onTransform={setSleeveTransform} />
                </div>
                <div className="pt-4 mt-2 border-t border-gray-700 flex justify-end">
                    <button onClick={onClose} className="px-5 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg font-bold text-sm">Done</button>
                </div>
            </div>
        </div>
    );
};
