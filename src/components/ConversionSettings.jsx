import PropTypes from 'prop-types';

export default function ConversionSettings({
  quality, onQualityChange,
  maxWidth, onMaxWidthChange,
  maxHeight, onMaxHeightChange,
  aspectRatio, onAspectRatioChange,
}) {
  return (
    <div className="card">
      <div className="card-title">⚙️ Conversion Settings</div>
      <div className="settings-grid">
        <div className="field">
          <label htmlFor="quality">Quality: {quality}%</label>
          <div className="quality-row">
            <input
              id="quality"
              type="range"
              min="1"
              max="100"
              value={quality}
              onChange={(e) => onQualityChange(Number(e.target.value))}
            />
            <span className="quality-badge">{quality}</span>
          </div>
        </div>

        <div className="field">
          <label htmlFor="aspectRatio">
            Aspect Ratio <span className="field-hint">(W:H, empty = off)</span>
          </label>
          <input
            id="aspectRatio"
            type="text"
            placeholder="e.g. 1:1 or 16:9"
            value={aspectRatio}
            onChange={(e) => onAspectRatioChange(e.target.value)}
          />
        </div>

        <div className="field">
          <label htmlFor="maxHeight">Max Height (px)</label>
          <input
            id="maxHeight"
            type="number"
            min="1"
            placeholder="e.g. 256"
            value={maxHeight}
            onChange={(e) => onMaxHeightChange(e.target.value)}
          />
        </div>

        <div className="field">
          <label htmlFor="maxWidth">Max Width (px)</label>
          <input
            id="maxWidth"
            type="number"
            min="1"
            placeholder="e.g. 1920"
            value={maxWidth}
            onChange={(e) => onMaxWidthChange(e.target.value)}
          />
        </div>
      </div>
    </div>
  );
}

ConversionSettings.propTypes = {
  quality: PropTypes.number.isRequired,
  onQualityChange: PropTypes.func.isRequired,
  maxWidth: PropTypes.string.isRequired,
  onMaxWidthChange: PropTypes.func.isRequired,
  maxHeight: PropTypes.string.isRequired,
  onMaxHeightChange: PropTypes.func.isRequired,
  aspectRatio: PropTypes.string.isRequired,
  onAspectRatioChange: PropTypes.func.isRequired,
};
