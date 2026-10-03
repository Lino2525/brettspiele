// Macht aus einer Bilddatei einen kleinen Avatar (Data-URL), der sich schnell verschicken lässt.
import { MAX_AVATAR_CHARS } from './session.js';

const MAX_SIDE = 300;

function loadImage(file) {
    return new Promise((resolve, reject) => {
        const url = URL.createObjectURL(file);
        const img = new Image();
        img.onload = () => {
            URL.revokeObjectURL(url);
            resolve(img);
        };
        img.onerror = () => {
            URL.revokeObjectURL(url);
            reject(new Error('Das Bild konnte nicht gelesen werden.'));
        };
        img.src = url;
    });
}

export async function fileToAvatar(file) {
    if (!file.type.startsWith('image/')) throw new Error('Das ist keine Bilddatei.');
    const img = await loadImage(file);
    let scale = Math.min(1, MAX_SIDE / Math.max(img.naturalWidth, img.naturalHeight));
    for (let attempt = 0; attempt < 6; attempt++, scale *= 0.75) {
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
        canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
        canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
        // WebP behält Transparenz und ist klein; Browser ohne WebP-Export liefern automatisch PNG.
        const data = canvas.toDataURL('image/webp', 0.85);
        if (data.length <= MAX_AVATAR_CHARS) return data;
    }
    throw new Error('Das Bild ist zu groß.');
}
