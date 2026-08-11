// Client-side image compression.
// Reads a File, draws it to a canvas capped at `maxWidth`, exports JPEG at `quality`.
// Falls back to the original File if canvas is unavailable or decoding fails.
export async function compressImage(file, { maxWidth = 1600, quality = 0.8 } = {}) {
  if (typeof document === 'undefined') {
    return { file, previewUrl: null, width: null, height: null, bytes: file.size };
  }

  try {
    const dataUrl = await readFileAsDataURL(file);
    const img = await loadImage(dataUrl);

    const srcW = img.width || maxWidth;
    const srcH = img.height || maxWidth;
    const scale = Math.min(1, maxWidth / srcW);
    const targetW = Math.max(1, Math.round(srcW * scale));
    const targetH = Math.max(1, Math.round(srcH * scale));

    const canvas = document.createElement('canvas');
    canvas.width = targetW;
    canvas.height = targetH;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D context unavailable.');
    ctx.fillStyle = '#ffffff'; // flatten transparency (good for JPEG of charts)
    ctx.fillRect(0, 0, targetW, targetH);
    ctx.drawImage(img, 0, 0, targetW, targetH);

    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
    if (!blob) throw new Error('Canvas toBlob produced no output.');

    const out = new File([blob], replaceExt(file.name || 'chart.jpg', '.jpg'), {
      type: 'image/jpeg',
    });
    const previewUrl = canvas.toDataURL('image/jpeg', quality);

    return { file: out, previewUrl, width: targetW, height: targetH, bytes: out.size };
  } catch (err) {
    console.warn('[compress] Falling back to original file:', err.message);
    return {
      file,
      previewUrl: URL.createObjectURL(file),
      width: null,
      height: null,
      bytes: file.size,
    };
  }
}

function readFileAsDataURL(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error || new Error('FileReader error'));
    reader.readAsDataURL(file);
  });
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Image decode failed'));
    img.src = src;
  });
}

function replaceExt(name, ext) {
  const dot = name.lastIndexOf('.');
  return (dot > 0 ? name.slice(0, dot) : name) + ext;
}
