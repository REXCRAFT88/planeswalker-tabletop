// Shared appearance types and utilities used by both Tabletop and AppearanceSettingsModal.
// Extracted to avoid circular imports.

import React, { useState, useRef } from 'react';
import { Trash2, Upload, Loader } from 'lucide-react';

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

// Shared appearance picker component used in both in-game settings and lobby settings.
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
