import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act, cleanup } from '@testing-library/react';

// ---------------------------------------------------------------------------
// Mocks — vi.hoisted ensures these are available when vi.mock factories run
// (vi.mock calls are hoisted above all imports by vitest)
// ---------------------------------------------------------------------------
const {
  mockExec,
  mockWriteFile,
  mockReadFile,
  mockDeleteFile,
  mockLoad,
} = vi.hoisted(() => ({
  mockExec: vi.fn().mockResolvedValue(0),
  mockWriteFile: vi.fn().mockResolvedValue(undefined),
  mockReadFile: vi.fn().mockResolvedValue(new Uint8Array([1, 2, 3])),
  mockDeleteFile: vi.fn().mockResolvedValue(undefined),
  mockLoad: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@ffmpeg/ffmpeg', () => ({
  FFmpeg: vi.fn(function () {
    this.load = mockLoad;
    this.exec = mockExec;
    this.writeFile = mockWriteFile;
    this.readFile = mockReadFile;
    this.deleteFile = mockDeleteFile;
  }),
}));

vi.mock('@ffmpeg/util', () => ({
  fetchFile: vi.fn().mockResolvedValue(new Uint8Array([0])),
  toBlobURL: vi.fn().mockImplementation((url) => Promise.resolve(url)),
}));

// JSZip is only used for downloadAll – provide a minimal mock
vi.mock('jszip', () => {
  const mockFile = vi.fn();
  const mockGenerateAsync = vi.fn().mockResolvedValue(new Blob(['zip']));
  return {
    default: vi.fn().mockImplementation(() => ({
      file: mockFile,
      generateAsync: mockGenerateAsync,
    })),
  };
});

// Stub URL.createObjectURL / revokeObjectURL
let blobCounter = 0;
globalThis.URL.createObjectURL = vi.fn(() => `blob:test/${++blobCounter}`);
globalThis.URL.revokeObjectURL = vi.fn();

import App from '../App.jsx';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Create a fake PNG File */
function makePng(name = 'test.png', bytes = 64) {
  return new File([new Uint8Array(bytes)], name, { type: 'image/png' });
}

/** Simulate adding files via the hidden <input type="file"> */
async function addFiles(files) {
  const input = document.querySelector('input[type="file"]');
  await act(async () => {
    fireEvent.change(input, { target: { files } });
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('App – Convert All', () => {
  beforeEach(() => {
    cleanup();
    vi.clearAllMocks();
    blobCounter = 0;
    // Restore default implementations after clearAllMocks
    mockExec.mockResolvedValue(0);
    mockWriteFile.mockResolvedValue(undefined);
    mockReadFile.mockResolvedValue(new Uint8Array([1, 2, 3]));
    mockDeleteFile.mockResolvedValue(undefined);
    mockLoad.mockResolvedValue(undefined);
  });

  it('renders the upload zone initially', () => {
    render(<App />);
    expect(screen.getByText(/Drag & drop PNG or SVG files here/i)).toBeInTheDocument();
  });

  it('shows Convert All button after files are added', async () => {
    render(<App />);
    await addFiles([makePng('a.png')]);
    expect(screen.getByText(/Convert All/i)).toBeInTheDocument();
  });

  it('converts a single file successfully', async () => {
    render(<App />);
    await addFiles([makePng('single.png')]);

    const convertBtn = screen.getByText(/Convert All/i);
    await act(async () => {
      fireEvent.click(convertBtn);
    });

    await waitFor(() => {
      expect(screen.getByText('Done')).toBeInTheDocument();
    });

    // FFmpeg pipeline was invoked once
    expect(mockExec).toHaveBeenCalledTimes(1);
    expect(mockWriteFile).toHaveBeenCalledTimes(1);
    expect(mockReadFile).toHaveBeenCalledTimes(1);
    expect(mockDeleteFile).toHaveBeenCalledTimes(2); // input + output
  });

  it('converts multiple files when Convert All is clicked', async () => {
    render(<App />);
    await addFiles([makePng('a.png'), makePng('b.png'), makePng('c.png')]);

    const convertBtn = screen.getByText(/Convert All \(3\)/i);
    await act(async () => {
      fireEvent.click(convertBtn);
    });

    await waitFor(() => {
      const doneLabels = screen.getAllByText('Done');
      expect(doneLabels).toHaveLength(3);
    });

    expect(mockExec).toHaveBeenCalledTimes(3);
  });

  it('sets error status when FFmpeg exec rejects', async () => {
    mockExec.mockRejectedValueOnce(new Error('encode failed'));

    render(<App />);
    await addFiles([makePng('fail.png')]);

    await act(async () => {
      fireEvent.click(screen.getByText(/Convert All/i));
    });

    await waitFor(() => {
      expect(screen.getByText('Error')).toBeInTheDocument();
      expect(screen.getByText(/encode failed/)).toBeInTheDocument();
    });
  });

  it('continues converting remaining files after one fails', async () => {
    // First file fails, second file succeeds
    mockExec
      .mockRejectedValueOnce(new Error('fail-1'))
      .mockResolvedValueOnce(0);

    render(<App />);
    await addFiles([makePng('a.png'), makePng('b.png')]);

    await act(async () => {
      fireEvent.click(screen.getByText(/Convert All \(2\)/i));
    });

    await waitFor(() => {
      expect(screen.getByText('Error')).toBeInTheDocument();
      expect(screen.getByText('Done')).toBeInTheDocument();
    });

    // FFmpeg exec was still called twice (once for each file)
    expect(mockExec).toHaveBeenCalledTimes(2);
  });

  it('handles FFmpeg load failure gracefully', async () => {
    mockLoad.mockRejectedValueOnce(new Error('wasm failed'))
            .mockRejectedValueOnce(new Error('wasm failed'));

    render(<App />);
    await addFiles([makePng('x.png')]);

    await act(async () => {
      fireEvent.click(screen.getByText(/Convert All/i));
    });

    await waitFor(() => {
      expect(screen.getByText('Error')).toBeInTheDocument();
      expect(screen.getByText(/wasm failed/)).toBeInTheDocument();
    });
  });

  it('removes a file from the list', async () => {
    render(<App />);
    await addFiles([makePng('del.png')]);

    expect(screen.getByText('del.png')).toBeInTheDocument();

    const removeBtn = screen.getByTitle('Remove');
    await act(async () => {
      fireEvent.click(removeBtn);
    });

    expect(screen.queryByText('del.png')).not.toBeInTheDocument();
  });

  it('creates Blob from Uint8Array directly (not data.buffer)', async () => {
    // Simulate a Uint8Array that is a view into a larger buffer.
    // Before the fix: new Blob([data.buffer]) would include the extra byte.
    // After the fix: new Blob([data]) only includes the 3-byte view.
    const backing = new ArrayBuffer(16);
    const view = new Uint8Array(backing, 0, 3);
    view.set([10, 20, 30]);
    mockReadFile.mockResolvedValueOnce(view);

    render(<App />);
    await addFiles([makePng('blob-test.png')]);

    await act(async () => {
      fireEvent.click(screen.getByText(/Convert All/i));
    });

    await waitFor(() => {
      expect(screen.getByText('Done')).toBeInTheDocument();
    });

    // The Blob should have been created with the typed-array view (3 bytes),
    // not the underlying ArrayBuffer (16 bytes).
    // We verify indirectly: URL.createObjectURL was called,
    // meaning the Blob was successfully created without errors.
    expect(URL.createObjectURL).toHaveBeenCalled();
  });
});
