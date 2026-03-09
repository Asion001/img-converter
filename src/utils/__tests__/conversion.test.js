import { describe, it, expect } from 'vitest';
import {
  parseAspectRatio,
  buildVfFilter,
  resolveCanvasSize,
  buildFfmpegArgs,
} from '../conversion.js';

// ---------------------------------------------------------------------------
// parseAspectRatio
// ---------------------------------------------------------------------------
describe('parseAspectRatio', () => {
  it('parses "1:1" correctly', () => {
    expect(parseAspectRatio('1:1')).toEqual({ w: 1, h: 1 });
  });

  it('parses "16:9" correctly', () => {
    expect(parseAspectRatio('16:9')).toEqual({ w: 16, h: 9 });
  });

  it('handles decimal values like "1.5:1"', () => {
    expect(parseAspectRatio('1.5:1')).toEqual({ w: 1.5, h: 1 });
  });

  it('returns null for empty string', () => {
    expect(parseAspectRatio('')).toBeNull();
  });

  it('returns null for whitespace-only string', () => {
    expect(parseAspectRatio('   ')).toBeNull();
  });

  it('returns null for null/undefined', () => {
    expect(parseAspectRatio(null)).toBeNull();
    expect(parseAspectRatio(undefined)).toBeNull();
  });

  it('returns null for a single number', () => {
    expect(parseAspectRatio('16')).toBeNull();
  });

  it('returns null for three segments', () => {
    expect(parseAspectRatio('1:2:3')).toBeNull();
  });

  it('returns null when a part is zero', () => {
    expect(parseAspectRatio('0:9')).toBeNull();
    expect(parseAspectRatio('16:0')).toBeNull();
  });

  it('returns null when a part is negative', () => {
    expect(parseAspectRatio('-1:9')).toBeNull();
  });

  it('returns null for non-numeric input', () => {
    expect(parseAspectRatio('a:b')).toBeNull();
  });

  it('trims whitespace around input', () => {
    expect(parseAspectRatio('  16:9  ')).toEqual({ w: 16, h: 9 });
  });
});

// ---------------------------------------------------------------------------
// resolveCanvasSize
// ---------------------------------------------------------------------------
describe('resolveCanvasSize', () => {
  it('returns zeros when no aspect ratio', () => {
    expect(resolveCanvasSize(null, 500, 500)).toEqual({ canvasW: 0, canvasH: 0 });
  });

  it('derives width from maxHeight and aspect ratio', () => {
    // 1:1 ratio, mh=256  → canvasW=256, canvasH=256
    expect(resolveCanvasSize({ w: 1, h: 1 }, 0, 256)).toEqual({ canvasW: 256, canvasH: 256 });
  });

  it('derives height from maxWidth and aspect ratio', () => {
    // 16:9 ratio, mw=1920  → canvasH = round(1920 * 9/16) = 1080
    expect(resolveCanvasSize({ w: 16, h: 9 }, 1920, 0)).toEqual({ canvasW: 1920, canvasH: 1080 });
  });

  it('prefers maxHeight over maxWidth when both are set', () => {
    // 1:1, mw=500, mh=256  → canvasH=256, canvasW=256
    expect(resolveCanvasSize({ w: 1, h: 1 }, 500, 256)).toEqual({ canvasW: 256, canvasH: 256 });
  });

  it('returns zeros when aspect ratio is set but no size limits', () => {
    expect(resolveCanvasSize({ w: 16, h: 9 }, 0, 0)).toEqual({ canvasW: 0, canvasH: 0 });
  });
});

// ---------------------------------------------------------------------------
// buildVfFilter
// ---------------------------------------------------------------------------
describe('buildVfFilter', () => {
  it('returns empty string when no constraints are set', () => {
    expect(buildVfFilter(null, 0, 0, 0, 0)).toBe('');
  });

  it('creates a scale filter for maxWidth only', () => {
    expect(buildVfFilter(null, 0, 0, 500, 0)).toBe("scale='min(500,iw)':-1");
  });

  it('creates a scale filter for maxHeight only', () => {
    expect(buildVfFilter(null, 0, 0, 0, 300)).toBe("scale=-1:'min(300,ih)'");
  });

  it('creates a scale filter for both maxWidth and maxHeight', () => {
    expect(buildVfFilter(null, 0, 0, 500, 300)).toBe(
      "scale='min(500,iw)':'min(300,ih)':force_original_aspect_ratio=decrease"
    );
  });

  it('creates scale+pad filter for aspect ratio with canvas size', () => {
    const filter = buildVfFilter({ w: 1, h: 1 }, 256, 256, 0, 0);
    expect(filter).toContain('scale=');
    expect(filter).toContain('format=rgba');
    expect(filter).toContain('pad=256:256');
  });

  it('creates expression-based pad filter for aspect ratio without canvas size', () => {
    const filter = buildVfFilter({ w: 16, h: 9 }, 0, 0, 0, 0);
    expect(filter).toContain('format=rgba');
    expect(filter).toContain('pad=');
    expect(filter).toContain('gte(');
  });
});

// ---------------------------------------------------------------------------
// buildFfmpegArgs
// ---------------------------------------------------------------------------
describe('buildFfmpegArgs', () => {
  it('builds basic args without video filter', () => {
    expect(buildFfmpegArgs('input.png', '', 80)).toEqual([
      '-i', 'input.png', '-quality', '80', 'output.webp',
    ]);
  });

  it('includes -vf flag when a filter is provided', () => {
    expect(buildFfmpegArgs('input.png', "scale='min(500,iw)':-1", 75)).toEqual([
      '-i', 'input.png', '-vf', "scale='min(500,iw)':-1", '-quality', '75', 'output.webp',
    ]);
  });

  it('converts quality to a string', () => {
    const args = buildFfmpegArgs('input.png', '', 100);
    expect(args).toContain('100');
    expect(typeof args[args.indexOf('100')]).toBe('string');
  });
});
