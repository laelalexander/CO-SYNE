import { url } from './session.js';

// QR scanning for CO-SYNE stickers. Uses the camera with jsQR, and can also
// "scan" a sticker image (simulation) through the very same decoder.
const STICKER_PATH = /\/s\/([\w-]+)(?:[?#].*)?$/;

export function stickerIdFromText(text) {
  if (!text) return null;
  const m = String(text).trim().match(STICKER_PATH);
  if (m) return m[1];
  return /^stk_[\w]+$/.test(text.trim()) ? text.trim() : null;
}

function decode(ctx, w, h) {
  const img = ctx.getImageData(0, 0, w, h);
  return window.jsQR?.(img.data, w, h, { inversionAttempts: 'dontInvert' })?.data ?? null;
}

// Renders a sticker's QR (as served to the printer) onto a canvas and decodes it.
export async function scanStickerImage(stickerId, canvas) {
  const svg = await (await fetch(url(`/api/stickers/${encodeURIComponent(stickerId)}/qr.svg`))).text();
  const blobUrl = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
  try {
    const img = await new Promise((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = reject;
      i.src = blobUrl;
    });
    const size = 320;
    canvas.width = size; canvas.height = size;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, size, size);
    ctx.drawImage(img, 0, 0, size, size);
    return decode(ctx, size, size);
  } finally {
    URL.revokeObjectURL(blobUrl);
  }
}

// Continuously scans the camera until a CO-SYNE sticker is found or stop() is called.
export function startCameraScan(video, canvas, onFound) {
  let stream = null;
  let raf = 0;
  let stopped = false;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const tick = () => {
    if (stopped) return;
    if (video.readyState >= 2 && video.videoWidth) {
      const w = Math.min(640, video.videoWidth);
      const h = Math.round((video.videoHeight / video.videoWidth) * w);
      canvas.width = w; canvas.height = h;
      ctx.drawImage(video, 0, 0, w, h);
      const text = decode(ctx, w, h);
      const id = stickerIdFromText(text);
      if (id) { stop(); onFound(id, text); return; }
    }
    raf = requestAnimationFrame(tick);
  };
  const stop = () => {
    stopped = true;
    cancelAnimationFrame(raf);
    stream?.getTracks().forEach((t) => t.stop());
    video.srcObject = null;
  };
  const ready = navigator.mediaDevices?.getUserMedia({ video: { facingMode: 'environment' } })
    .then((s) => { stream = s; video.srcObject = s; return video.play(); })
    .then(() => { tick(); return true; })
    .catch(() => false);
  return { stop, ready };
}
