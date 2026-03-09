import PropTypes from 'prop-types';
import ImageItem from './ImageItem.jsx';

export default function ImageList({ files, onConvert, onRemove, ffmpegLoading }) {
  return (
    <div>
      <div className="image-list-header">
        <span className="image-list-title">Files ({files.length})</span>
      </div>
      <div className="image-list">
        {files.map((f) => (
          <ImageItem
            key={f.id}
            item={f}
            onConvert={onConvert}
            onRemove={onRemove}
            ffmpegLoading={ffmpegLoading}
          />
        ))}
      </div>
    </div>
  );
}

const itemShape = PropTypes.shape({
  id: PropTypes.string.isRequired,
  file: PropTypes.instanceOf(File).isRequired,
  name: PropTypes.string.isRequired,
  preview: PropTypes.string.isRequired,
  status: PropTypes.oneOf(['idle', 'converting', 'done', 'error']).isRequired,
  result: PropTypes.string,
  resultBlob: PropTypes.instanceOf(Blob),
  error: PropTypes.string,
});

ImageList.propTypes = {
  files: PropTypes.arrayOf(itemShape).isRequired,
  onConvert: PropTypes.func.isRequired,
  onRemove: PropTypes.func.isRequired,
  ffmpegLoading: PropTypes.bool.isRequired,
};
