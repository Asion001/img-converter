import { useState, useRef, useCallback } from 'react';
import { FFmpeg } from '@ffmpeg/ffmpeg';
import { fetchFile, toBlobURL } from '@ffmpeg/util';
import JSZip from 'jszip';
import FileUpload from './components/FileUpload.jsx';
import ConversionSettings from './components/ConversionSettings.jsx';
import ImageList from './components/ImageList.jsx';

const FFMPEG_BASE_URL = 'https://unpkg.com/@ffmpeg/core@0.12.6/dist/umd';

/** Rasterise an SVG file to a PNG Blob via OffscreenCanvas / Canvas */
async function svgToPngBlob(svgFile, maxWidth, maxHeight) {
  const svgText = await svgFile.text();
  const blob = new Blob([svgText], { type: 'image/svg+xml' });
  const url = URL.createObjectURL(blob);
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      let w = img.naturalWidth || 300;
      let h = img.naturalHeight || 300;
      if (maxWidth && w > maxWidth) { h = Math.round(h * (maxWidth / w)); w = maxWidth; }
      if (maxHeight && h > maxHeight) { w = Math.round(w * (maxHeight / h)); h = maxHeight; }
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
  const [ffmpegLoaded, setFfmpegLoaded] = useState(false);
  const [ffmpegLoading, setFfmpegLoading] = useState(false);
  const ffmpegRef = useRef(null);

  const loadFfmpeg = useCallback(async () => {
    if (ffmpegRef.current) return ffmpegRef.current;
    setFfmpegLoading(true);
    const ffmpeg = new FFmpeg();
    try {
      await ffmpeg.load({
        coreURL: await toBlobURL(`${FFMPEG_BASE_URL}/ffmpeg-core.js`, 'text/javascript'),
        wasmURL: await toBlobURL(`${FFMPEG_BASE_URL}/ffmpeg-core.wasm`, 'application/wasm'),
      });
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

      let inputBlob;
      let inputName;
      if (/\.svg$/i.test(item.file.name)) {
        inputBlob = await svgToPngBlob(item.file, mw || null, mh || null);
        inputName = 'input.png';
      } else {
        inputBlob = item.file;
        inputName = 'input.png';
      }

      await ffmpeg.writeFile(inputName, await fetchFile(inputBlob));

      // Build vf scale filter for size limiting (only downscale, never upscale)
      let vfScale = '';
      if (mw && mh) {
        vfScale = `scale='min(${mw},iw)':'min(${mh},ih)':force_original_aspect_ratio=decrease`;
      } else if (mw) {
        vfScale = `scale='min(${mw},iw)':-1`;
      } else if (mh) {
        vfScale = `scale=-1:'min(${mh},ih)'`;
      }

      const ffmpegArgs = ['-i', inputName];
      if (vfScale) ffmpegArgs.push('-vf', vfScale);
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
  }, [files, quality, maxWidth, maxHeight, loadFfmpeg]);

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
