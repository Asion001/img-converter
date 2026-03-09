import { useState, useRef, useCallback } from 'react';
import { FFmpeg } from '@ffmpeg/ffmpeg';
import { fetchFile, toBlobURL } from '@ffmpeg/util';
import JSZip from 'jszip';
import FileUpload from './components/FileUpload.jsx';
import ConversionSettings from './components/ConversionSettings.jsx';
import ImageList from './components/ImageList.jsx';

const FFMPEG_CORE_CDN_URLS = [
  'https://unpkg.com/@ffmpeg/core@0.12.6/dist/umd',
  'https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.6/dist/umd',
];

/**
 * Parse an aspect ratio string like "1:1" or "16:9" into {w, h}.
 * Returns null if the value is empty or invalid.
 */
function parseAspectRatio(value) {
  if (!value || !value.trim()) return null;
  const parts = value.trim().split(':');
  if (parts.length !== 2) return null;
  const w = parseFloat(parts[0]);
  const h = parseFloat(parts[1]);
  if (isNaN(w) || isNaN(h) || w <= 0 || h <= 0) return null;
  return { w, h };
}

/**
 * Rasterise an SVG file to a PNG Blob via Canvas.
 * When fitWidth/fitHeight are provided the image is scaled to fit within them.
 * allowUpscale=true lets the image grow beyond its natural size (useful for SVG).
 */
async function svgToPngBlob(svgFile, fitWidth, fitHeight, allowUpscale = false) {
  const svgText = await svgFile.text();
  const blob = new Blob([svgText], { type: 'image/svg+xml' });
  const url = URL.createObjectURL(blob);
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      let w = img.naturalWidth || 300;
      let h = img.naturalHeight || 300;
      if (fitWidth && fitHeight) {
        const scale = Math.min(fitWidth / w, fitHeight / h);
        if (scale < 1 || allowUpscale) {
          w = Math.round(w * scale);
          h = Math.round(h * scale);
        }
      } else if (fitWidth && (fitWidth < w || allowUpscale)) {
        h = Math.round(h * (fitWidth / w));
        w = fitWidth;
      } else if (fitHeight && (fitHeight < h || allowUpscale)) {
        w = Math.round(w * (fitHeight / h));
        h = fitHeight;
      }
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, w, h);
      URL.revokeObjectURL(url);
      canvas.toBlob((b) => resolve(b), 'image/png');
    };
    img.onerror = (e) => { URL.revokeObjectURL(url); reject(e); };
    img.src = url;
  });
}

export default function App() {
  const [files, setFiles] = useState([]); // { id, file, name, preview, status, result, error }
  const [quality, setQuality] = useState(80);
  const [maxWidth, setMaxWidth] = useState('');
  const [maxHeight, setMaxHeight] = useState('');
  const [aspectRatio, setAspectRatio] = useState('1:1');
  const [ffmpegLoaded, setFfmpegLoaded] = useState(false);
  const [ffmpegLoading, setFfmpegLoading] = useState(false);
  const ffmpegRef = useRef(null);

  const loadFfmpeg = useCallback(async () => {
    if (ffmpegRef.current) return ffmpegRef.current;
    setFfmpegLoading(true);
    const ffmpeg = new FFmpeg();
    try {
      let lastError = null;
      for (const baseUrl of FFMPEG_CORE_CDN_URLS) {
        try {
          await ffmpeg.load({
            coreURL: await toBlobURL(`${baseUrl}/ffmpeg-core.js`, 'text/javascript'),
            wasmURL: await toBlobURL(`${baseUrl}/ffmpeg-core.wasm`, 'application/wasm'),
          });
          lastError = null;
          break;
        } catch (error) {
          lastError = error;
        }
      }
      if (lastError) throw lastError;
      ffmpegRef.current = ffmpeg;
      setFfmpegLoaded(true);
    } finally {
      setFfmpegLoading(false);
    }
    return ffmpegRef.current;
  }, []);

  const handleFilesAdded = useCallback((newFiles) => {
    const entries = newFiles.map((file) => ({
      id: `${file.name}-${file.size}-${Date.now()}-${Math.random()}`,
      file,
      name: file.name.replace(/\.(png|svg)$/i, '.webp'),
      preview: URL.createObjectURL(file),
      status: 'idle', // idle | converting | done | error
      result: null,
      error: null,
    }));
    setFiles((prev) => [...prev, ...entries]);
  }, []);

  const handleRemove = useCallback((id) => {
    setFiles((prev) => {
      const item = prev.find((f) => f.id === id);
      if (item) {
        URL.revokeObjectURL(item.preview);
        if (item.result) URL.revokeObjectURL(item.result);
      }
      return prev.filter((f) => f.id !== id);
    });
  }, []);

  const convertSingle = useCallback(async (id) => {
    const ffmpeg = await loadFfmpeg();
    setFiles((prev) =>
      prev.map((f) => (f.id === id ? { ...f, status: 'converting', error: null } : f))
    );

    const item = files.find((f) => f.id === id);
    if (!item) return;

    try {
      const mw = maxWidth ? parseInt(maxWidth, 10) : 0;
      const mh = maxHeight ? parseInt(maxHeight, 10) : 0;
      const ar = parseAspectRatio(aspectRatio);

      // When an aspect ratio is set, compute an explicit canvas size.
      // maxHeight drives the canvas height; maxWidth is the fallback.
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
        // If no size limit is provided, canvas dimensions are resolved via
        // FFmpeg expression at encode time (see vfFilter below).
      }

      let inputBlob;
      let inputName;
      if (/\.svg$/i.test(item.file.name)) {
        // SVG is vector: scale to fill the canvas when aspect ratio is on,
        // otherwise downscale-only to any size limits.
        if (ar && canvasW && canvasH) {
          inputBlob = await svgToPngBlob(item.file, canvasW, canvasH, true);
        } else {
          inputBlob = await svgToPngBlob(item.file, mw || null, mh || null, false);
        }
        inputName = 'input.png';
      } else {
        inputBlob = item.file;
        inputName = 'input.png';
      }

      await ffmpeg.writeFile(inputName, await fetchFile(inputBlob));

      // Build the FFmpeg video filter chain.
      let vfFilter = '';
      if (ar) {
        if (canvasW && canvasH) {
          // Fixed canvas: scale to fit (downscale only for raster, handled above for SVG),
          // ensure RGBA, then pad to exact canvas size with transparent margins.
          vfFilter = [
            `scale='min(${canvasW},iw)':'min(${canvasH},ih)':force_original_aspect_ratio=decrease`,
            'format=rgba',
            `pad=${canvasW}:${canvasH}:(ow-iw)/2:(oh-ih)/2:color=0x00000000`,
          ].join(',');
        } else {
          // No size limit: expand canvas to the smallest bounding box that matches
          // the requested aspect ratio and fully contains the image (no upscaling).
          //
          // The condition `gte(iw*arH, ih*arW)` checks whether the image is wider
          // relative to the target ratio (i.e. width is the constraining dimension):
          //   wider  → canvas_w = iw,          canvas_h = ceil(iw * arH / arW)
          //   taller → canvas_w = ceil(ih*arW/arH), canvas_h = ih
          const arW = ar.w;
          const arH = ar.h;
          const isWider = `gte(iw*${arH},ih*${arW})`;
          vfFilter = [
            'format=rgba',
            `pad='if(${isWider},iw,ceil(ih*${arW}/${arH}))':` +
              `'if(${isWider},ceil(iw*${arH}/${arW}),ih)':` +
              `(ow-iw)/2:(oh-ih)/2:color=0x00000000`,
          ].join(',');
        }
      } else {
        // No aspect ratio: simple downscale-only, no padding.
        if (mw && mh) {
          vfFilter = `scale='min(${mw},iw)':'min(${mh},ih)':force_original_aspect_ratio=decrease`;
        } else if (mw) {
          vfFilter = `scale='min(${mw},iw)':-1`;
        } else if (mh) {
          vfFilter = `scale=-1:'min(${mh},ih)'`;
        }
      }

      const ffmpegArgs = ['-i', inputName];
      if (vfFilter) ffmpegArgs.push('-vf', vfFilter);
      ffmpegArgs.push('-quality', String(quality), 'output.webp');

      await ffmpeg.exec(ffmpegArgs);
      const data = await ffmpeg.readFile('output.webp');
      await ffmpeg.deleteFile(inputName);
      await ffmpeg.deleteFile('output.webp');

      const blob = new Blob([data.buffer], { type: 'image/webp' });
      const resultUrl = URL.createObjectURL(blob);

      setFiles((prev) =>
        prev.map((f) =>
          f.id === id ? { ...f, status: 'done', result: resultUrl, resultBlob: blob } : f
        )
      );
    } catch (err) {
      setFiles((prev) =>
        prev.map((f) =>
          f.id === id ? { ...f, status: 'error', error: err.message || String(err) } : f
        )
      );
    }
  }, [files, quality, maxWidth, maxHeight, aspectRatio, loadFfmpeg]);

  const convertAll = useCallback(async () => {
    const pending = files.filter((f) => f.status === 'idle' || f.status === 'error');
    for (const f of pending) {
      await convertSingle(f.id);
    }
  }, [files, convertSingle]);

  const downloadAll = useCallback(async () => {
    const done = files.filter((f) => f.status === 'done' && f.resultBlob);
    if (done.length === 0) return;
    const zip = new JSZip();
    done.forEach((f) => zip.file(f.name, f.resultBlob));
    const zipBlob = await zip.generateAsync({ type: 'blob' });
    const url = URL.createObjectURL(zipBlob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'converted-webp.zip';
    a.click();
    URL.revokeObjectURL(url);
  }, [files]);

  const hasPending = files.some((f) => f.status === 'idle' || f.status === 'error');
  const hasDone = files.some((f) => f.status === 'done');

  return (
    <div className="app">
      <header className="app-header">
        <div className="logo">
          <span className="logo-icon">🖼️</span>
          <div>
            <h1>IMG Converter</h1>
            <p>Convert PNG &amp; SVG to WebP — 100% in your browser</p>
          </div>
        </div>
      </header>

      <main className="app-main">
        <FileUpload onFilesAdded={handleFilesAdded} />

        {files.length > 0 && (
          <>
            <ConversionSettings
              quality={quality}
              onQualityChange={setQuality}
              maxWidth={maxWidth}
              onMaxWidthChange={setMaxWidth}
              maxHeight={maxHeight}
              onMaxHeightChange={setMaxHeight}
              aspectRatio={aspectRatio}
              onAspectRatioChange={setAspectRatio}
            />

            <div className="actions-bar">
              <button
                className="btn btn-primary"
                onClick={convertAll}
                disabled={!hasPending || ffmpegLoading}
              >
                {ffmpegLoading ? 'Loading FFmpeg…' : `Convert All (${files.filter((f) => f.status === 'idle' || f.status === 'error').length})`}
              </button>
              <button
                className="btn btn-secondary"
                onClick={downloadAll}
                disabled={!hasDone}
              >
                ⬇ Download All as ZIP
              </button>
              {!ffmpegLoaded && !ffmpegLoading && (
                <span className="hint">FFmpeg loads on first conversion</span>
              )}
              {ffmpegLoading && <span className="hint loading-pulse">Loading FFmpeg WASM…</span>}
            </div>

            <ImageList
              files={files}
              onConvert={convertSingle}
              onRemove={handleRemove}
              ffmpegLoading={ffmpegLoading}
            />
          </>
        )}

        {files.length === 0 && (
          <div className="empty-state">
            <div className="empty-icon">📂</div>
            <p>No files added yet. Drop PNG or SVG files above to get started.</p>
          </div>
        )}
      </main>

      <footer className="app-footer">
        <p>All processing happens locally in your browser. No files are uploaded to any server.</p>
      </footer>
    </div>
  );
}
