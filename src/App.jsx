import { useState, useRef, useCallback, useEffect } from 'react';
import { FFmpeg } from '@ffmpeg/ffmpeg';
import { fetchFile, toBlobURL } from '@ffmpeg/util';
import JSZip from 'jszip';
import FileUpload from './components/FileUpload.jsx';
import ConversionSettings from './components/ConversionSettings.jsx';
import ImageList from './components/ImageList.jsx';
import { parseAspectRatio, buildVfFilter, resolveCanvasSize, buildFfmpegArgs } from './utils/conversion.js';

const FFMPEG_CORE_CDN_URLS = [
  'https://unpkg.com/@ffmpeg/core@0.12.6/dist/umd',
  'https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.6/dist/umd',
];

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
  const filesRef = useRef(files);
  filesRef.current = files;

  const loadFfmpeg = useCallback(async () => {
    if (ffmpegRef.current) return ffmpegRef.current;
    setFfmpegLoading(true);
    const ffmpeg = new FFmpeg();
    try {
      let lastError = null;
      let loaded = false;
      for (const baseUrl of FFMPEG_CORE_CDN_URLS) {
        try {
          await ffmpeg.load({
            coreURL: await toBlobURL(`${baseUrl}/ffmpeg-core.js`, 'text/javascript'),
            wasmURL: await toBlobURL(`${baseUrl}/ffmpeg-core.wasm`, 'application/wasm'),
          });
          loaded = true;
          break;
        } catch (error) {
          lastError = error;
        }
      }
      if (!loaded && lastError) throw lastError;
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
    setFiles((prev) =>
      prev.map((f) => (f.id === id ? { ...f, status: 'converting', error: null } : f))
    );

    try {
      const ffmpeg = await loadFfmpeg();

      // Read from ref so we always see the latest files array, even when
      // convertAll calls us in a loop with a stale closure.
      const item = filesRef.current.find((f) => f.id === id);
      if (!item) return;

      const mw = maxWidth ? parseInt(maxWidth, 10) : 0;
      const mh = maxHeight ? parseInt(maxHeight, 10) : 0;
      const ar = parseAspectRatio(aspectRatio);
      const { canvasW, canvasH } = resolveCanvasSize(ar, mw, mh);

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

      const vfFilter = buildVfFilter(ar, canvasW, canvasH, mw, mh);
      const ffmpegArgs = buildFfmpegArgs(inputName, vfFilter, quality);

      await ffmpeg.exec(ffmpegArgs);
      const data = await ffmpeg.readFile('output.webp');
      await ffmpeg.deleteFile(inputName);
      await ffmpeg.deleteFile('output.webp');

      const blob = new Blob([data], { type: 'image/webp' });
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
  }, [quality, maxWidth, maxHeight, aspectRatio, loadFfmpeg]);

  const convertAll = useCallback(async () => {
    // Read pending list from the ref so it reflects the latest state.
    const pending = filesRef.current.filter((f) => f.status === 'idle' || f.status === 'error');
    for (const f of pending) {
      await convertSingle(f.id);
    }
  }, [convertSingle]);

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
  const isConverting = ffmpegLoading || files.some((f) => f.status === 'converting');

  useEffect(() => {
    if (!isConverting) return undefined;
    const handleBeforeUnload = (event) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [isConverting]);

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
