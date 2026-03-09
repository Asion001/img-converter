/**
 * Parse an aspect ratio string like "1:1" or "16:9" into {w, h}.
 * Returns null if the value is empty or invalid.
 */
export function parseAspectRatio(value) {
  if (!value || !value.trim()) return null;
  const parts = value.trim().split(':');
  if (parts.length !== 2) return null;
  const w = parseFloat(parts[0]);
  const h = parseFloat(parts[1]);
  if (isNaN(w) || isNaN(h) || w <= 0 || h <= 0) return null;
  return { w, h };
}

/**
 * Build an FFmpeg video-filter string based on the conversion settings.
 *
 * @param {{ w: number, h: number } | null} ar  – parsed aspect ratio
 * @param {number} canvasW  – resolved canvas width  (0 = unset)
 * @param {number} canvasH  – resolved canvas height (0 = unset)
 * @param {number} mw       – maxWidth  (0 = unset)
 * @param {number} mh       – maxHeight (0 = unset)
 * @returns {string}  FFmpeg -vf value (empty string when no filter is needed)
 */
export function buildVfFilter(ar, canvasW, canvasH, mw, mh) {
  if (ar) {
    if (canvasW && canvasH) {
      return [
        `scale='min(${canvasW},iw)':'min(${canvasH},ih)':force_original_aspect_ratio=decrease`,
        'format=rgba',
        `pad=${canvasW}:${canvasH}:(ow-iw)/2:(oh-ih)/2:color=0x00000000`,
      ].join(',');
    }
    const arW = ar.w;
    const arH = ar.h;
    const isWider = `gte(iw*${arH},ih*${arW})`;
    return [
      'format=rgba',
      `pad='if(${isWider},iw,ceil(ih*${arW}/${arH}))':` +
        `'if(${isWider},ceil(iw*${arH}/${arW}),ih)':` +
        `(ow-iw)/2:(oh-ih)/2:color=0x00000000`,
    ].join(',');
  }

  if (mw && mh) {
    return `scale='min(${mw},iw)':'min(${mh},ih)':force_original_aspect_ratio=decrease`;
  }
  if (mw) {
    return `scale='min(${mw},iw)':-1`;
  }
  if (mh) {
    return `scale=-1:'min(${mh},ih)'`;
  }
  return '';
}

/**
 * Compute a canvas size from an aspect ratio and optional max dimensions.
 *
 * @param {{ w: number, h: number } | null} ar
 * @param {number} mw – maxWidth  (0 = unset)
 * @param {number} mh – maxHeight (0 = unset)
 * @returns {{ canvasW: number, canvasH: number }}
 */
export function resolveCanvasSize(ar, mw, mh) {
  let canvasW = 0;
  let canvasH = 0;
  if (ar) {
    if (mh) {
      canvasH = mh;
      canvasW = Math.round(mh * (ar.w / ar.h));
    } else if (mw) {
      canvasW = mw;
      canvasH = Math.round(mw * (ar.h / ar.w));
    }
  }
  return { canvasW, canvasH };
}

/**
 * Build the full FFmpeg argument list for converting a single image.
 *
 * @param {string}  inputName – virtual filesystem input filename
 * @param {string}  vfFilter  – video filter string (may be empty)
 * @param {number}  quality   – WebP quality 1-100
 * @returns {string[]}
 */
export function buildFfmpegArgs(inputName, vfFilter, quality) {
  const args = ['-i', inputName];
  if (vfFilter) args.push('-vf', vfFilter);
  args.push('-quality', String(quality), 'output.webp');
  return args;
}
