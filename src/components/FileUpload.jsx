import { useCallback, useState } from 'react';
import PropTypes from 'prop-types';

const ACCEPTED = '.png,.svg,image/png,image/svg+xml';

export default function FileUpload({ onFilesAdded }) {
  const [dragOver, setDragOver] = useState(false);

  const processFiles = useCallback(
    (fileList) => {
      const valid = Array.from(fileList).filter((f) =>
        /\.(png|svg)$/i.test(f.name) || f.type === 'image/png' || f.type === 'image/svg+xml'
      );
      if (valid.length > 0) onFilesAdded(valid);
    },
    [onFilesAdded]
  );

  const onDrop = useCallback(
    (e) => {
      e.preventDefault();
      setDragOver(false);
      processFiles(e.dataTransfer.files);
    },
    [processFiles]
  );

  const onDragOver = useCallback((e) => { e.preventDefault(); setDragOver(true); }, []);
  const onDragLeave = useCallback(() => setDragOver(false), []);

  const onInputChange = useCallback(
    (e) => processFiles(e.target.files),
    [processFiles]
  );

  return (
    <label
      className={`upload-zone${dragOver ? ' drag-over' : ''}`}
      onDrop={onDrop}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
    >
      <input
        type="file"
        accept={ACCEPTED}
        multiple
        style={{ display: 'none' }}
        onChange={onInputChange}
      />
      <div className="upload-icon">⬆️</div>
      <div className="upload-label">Drag &amp; drop PNG or SVG files here</div>
      <div className="upload-sub">
        or <span>click to browse</span> — batch upload supported
      </div>
    </label>
  );
}

FileUpload.propTypes = {
  onFilesAdded: PropTypes.func.isRequired,
};
