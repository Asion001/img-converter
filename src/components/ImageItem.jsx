import { useCallback } from 'react';
import PropTypes from 'prop-types';

const STATUS_LABEL = { idle: 'Ready', converting: 'Converting…', done: 'Done', error: 'Error' };

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export default function ImageItem({ item, onConvert, onRemove, ffmpegLoading }) {
  const { id, file, name, preview, status, result, resultBlob, error } = item;

  const handleDownload = useCallback(() => {
    if (!result) return;
    const a = document.createElement('a');
    a.href = result;
    a.download = name;
    a.click();
  }, [result, name]);

  const canConvert = status === 'idle' || status === 'error';

  return (
    <div className={`image-item status-${status}`}>
      {/* Thumbnail: show result preview if done, else source preview */}
      <img
        className="image-thumb"
        src={status === 'done' && result ? result : preview}
        alt={file.name}
      />

      <div className="image-info">
        <div className="image-name" title={file.name}>{file.name}</div>
        <div className="image-meta">
          {formatBytes(file.size)}
          {resultBlob && (
            <> → <strong>{formatBytes(resultBlob.size)}</strong> WebP</>
          )}
        </div>
        <span className={`status-badge ${status}`}>
          {status === 'converting' && <span className="spinner" />}
          {STATUS_LABEL[status]}
        </span>
        {error && <div className="image-error" title={error}>⚠ {error.slice(0, 120)}</div>}
      </div>

      <div className="image-actions">
        {canConvert && (
          <button
            className="btn btn-primary btn-sm"
            onClick={() => onConvert(id)}
            disabled={ffmpegLoading}
            title="Convert this file"
          >
            Convert
          </button>
        )}
        {status === 'done' && (
          <button
            className="btn btn-secondary btn-sm"
            onClick={handleDownload}
            title="Download WebP"
          >
            ⬇ Download
          </button>
        )}
        <button
          className="btn btn-icon btn-sm"
          onClick={() => onRemove(id)}
          title="Remove"
        >
          ✕
        </button>
      </div>
    </div>
  );
}

ImageItem.propTypes = {
  item: PropTypes.shape({
    id: PropTypes.string.isRequired,
    file: PropTypes.instanceOf(File).isRequired,
    name: PropTypes.string.isRequired,
    preview: PropTypes.string.isRequired,
    status: PropTypes.oneOf(['idle', 'converting', 'done', 'error']).isRequired,
    result: PropTypes.string,
    resultBlob: PropTypes.instanceOf(Blob),
    error: PropTypes.string,
  }).isRequired,
  onConvert: PropTypes.func.isRequired,
  onRemove: PropTypes.func.isRequired,
  ffmpegLoading: PropTypes.bool.isRequired,
};
