/**
 * Instant game-cover composition from the actual project art.
 *
 * The AI image provider is slow and (with FLUX's prompt upsampler enabled)
 * likes to invent poster layouts, titles, and brand logos. This module builds a
 * polished 16:9 thumbnail immediately from the game's own backgrounds,
 * sprites, and palette. The publish flow can use it right away and optionally
 * refine it with AI later.
 */

const COVER_WIDTH = 1280;
const COVER_HEIGHT = 720;
const REFERENCE_MAX_CHARS = 2_600_000;

export type CoverStyle = 'pixel-art' | 'illustration';

export interface CoverArtInput {
  title: string;
  genre: string;
  description?: string;

  /** path -> image data URL */
  assets: Record<string, string>;

  /** Colors mined from the game source (optional). */
  palette?: string[];
}

export interface CoverArtResult {
  dataUrl: string;

  /** Base64 reference images (no data URI prefix) for the AI pass. */
  references: string[];
  referencePaths: string[];
  palette: string[];
  accent: string;
  secondary: string;
  style: CoverStyle;
  hasGameArt: boolean;
}

interface LoadedAsset {
  path: string;
  dataUrl: string;
  image: HTMLImageElement;
  width: number;
  height: number;
  hasAlpha: boolean;
  score: number;
}

interface SelectedAssets {
  background?: LoadedAsset;
  hero?: LoadedAsset;
  enemy?: LoadedAsset;
}

const BACKGROUND_HINTS =
  /(?:^|\/)(?:backgrounds?|backdrops?|bg|scenes?|environment|world|level\d*|parallax|sky|map|arena|stage|terrain|landscape|city|forest|space|desert|lava|ocean|castle|track|road|court|dungeon|room|field|island|planet)/i;
const BACKGROUND_AVOID =
  /(?:sprite|sprites|icon|icons|logo|logos|ui|hud|button|buttons|font|tileset|tile|atlas|sheet|frames?|enemy|enemies|boss|monster|demon|dragon|player|hero|character|projectile|bullet|particle|explosion|effect|item|pickup|coin|gem|weapon|sword|gun|shield|portrait|avatar|face|head|hand|leg|arm|overlay|vignette|mask)/i;
const HERO_STRONG =
  /(?:^|\/)(?:player|hero|main[-_]?character|protagonist|ship|car|runner|vehicle|fighter|survivor|avatar|pilot|driver|knight|warrior|ninja|pirate|wizard|archer|hunter|soldier)(?:[-_.\/]|$)/i;
const HERO_HINTS =
  /(?:player|hero|character|ship|car|runner|knight|warrior|mage|robot|mech|survivor|fighter|avatar|pilot|driver|ninja|pirate|king|queen|princess|wizard|archer|hunter|soldier|creature|beast)/i;
const HERO_AVOID =
  /(?:enemy|enemies|boss|monster|demon|dragon|alien|zombie|skeleton|slime|villain|projectile|bullet|particle|explosion|effect|item|pickup|coin|gem|weapon|sword|gun|shield|icon|ui|hud|button|logo|font|tileset|tile|atlas|sheet|background|bg|scene|environment|level|map|arena|terrain|landscape|overlay|mask)/i;
const ENEMY_HINTS =
  /(?:enemy|boss|monster|demon|dragon|alien|zombie|skeleton|skull|slime|villain|creature|beast|robot|mech|guard|minion|mutant|ghost|haunt|witch|troll|orc|goblin|eye)/i;
const ENEMY_AVOID =
  /(?:player|hero|projectile|bullet|particle|explosion|effect|item|pickup|coin|gem|weapon|sword|gun|shield|icon|ui|hud|button|logo|font|tileset|tile|atlas|sheet|background|bg|scene|environment|level|map|arena|overlay|mask)/i;
const SHEET_HINT = /(?:sheet|atlas|frames?|animation|run|walk|idle|jump|attack|sprint|fly)/i;

function normalizePath(value: string) {
  return String(value || '')
    .replace(/\\/g, '/')
    .replace(/^(?:\/home\/project\/|\/project\/|home\/project\/|project\/|\/|\.\/)+/, '')
    .replace(/[?#].*$/, '')
    .trim();
}

function hashString(value: string) {
  let hash = 2166136261;

  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }

  return hash >>> 0;
}

function clamp(value: number, min = 0, max = 1) {
  return Math.max(min, Math.min(max, value));
}

function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const clean = String(hex || '')
    .trim()
    .replace(/^#/, '');

  if (/^[0-9a-f]{3}$/i.test(clean)) {
    return {
      r: parseInt(clean[0] + clean[0], 16),
      g: parseInt(clean[1] + clean[1], 16),
      b: parseInt(clean[2] + clean[2], 16),
    };
  }

  if (/^[0-9a-f]{6}$/i.test(clean)) {
    return {
      r: parseInt(clean.slice(0, 2), 16),
      g: parseInt(clean.slice(2, 4), 16),
      b: parseInt(clean.slice(4, 6), 16),
    };
  }

  return null;
}

function rgbToHex(r: number, g: number, b: number) {
  const channel = (value: number) =>
    Math.max(0, Math.min(255, Math.round(value)))
      .toString(16)
      .padStart(2, '0');
  return `#${channel(r)}${channel(g)}${channel(b)}`;
}

function rgbToHsl(r: number, g: number, b: number) {
  const red = r / 255;
  const green = g / 255;
  const blue = b / 255;
  const max = Math.max(red, green, blue);
  const min = Math.min(red, green, blue);
  const delta = max - min;
  let h = 0;

  if (delta > 0) {
    if (max === red) {
      h = ((green - blue) / delta) % 6;
    } else if (max === green) {
      h = (blue - red) / delta + 2;
    } else {
      h = (red - green) / delta + 4;
    }

    h *= 60;

    if (h < 0) {
      h += 360;
    }
  }

  const l = (max + min) / 2;
  const s = delta === 0 ? 0 : delta / (1 - Math.abs(2 * l - 1));

  return { h, s, l };
}

function hslToRgb(h: number, s: number, l: number) {
  const hue = ((h % 360) + 360) % 360;
  const chroma = (1 - Math.abs(2 * l - 1)) * s;
  const x = chroma * (1 - Math.abs(((hue / 60) % 2) - 1));
  const m = l - chroma / 2;
  let r = 0;
  let g = 0;
  let b = 0;

  if (hue < 60) {
    [r, g, b] = [chroma, x, 0];
  } else if (hue < 120) {
    [r, g, b] = [x, chroma, 0];
  } else if (hue < 180) {
    [r, g, b] = [0, chroma, x];
  } else if (hue < 240) {
    [r, g, b] = [0, x, chroma];
  } else if (hue < 300) {
    [r, g, b] = [x, 0, chroma];
  } else {
    [r, g, b] = [chroma, 0, x];
  }

  return {
    r: Math.round((r + m) * 255),
    g: Math.round((g + m) * 255),
    b: Math.round((b + m) * 255),
  };
}

function withAlpha(hex: string, alpha: number) {
  const rgb = hexToRgb(hex);

  if (!rgb) {
    return `rgba(0,0,0,${clamp(alpha)})`;
  }

  return `rgba(${rgb.r},${rgb.g},${rgb.b},${clamp(alpha)})`;
}

function darken(hex: string, amount: number, fallback = '#08101f') {
  const rgb = hexToRgb(hex);

  if (!rgb) {
    return fallback;
  }

  return rgbToHex(rgb.r * (1 - amount), rgb.g * (1 - amount), rgb.b * (1 - amount));
}

function mix(hex: string, target: string, amount: number, fallback = '#ffffff') {
  const from = hexToRgb(hex);
  const to = hexToRgb(target);

  if (!from || !to) {
    return fallback;
  }

  return rgbToHex(
    from.r + (to.r - from.r) * amount,
    from.g + (to.g - from.g) * amount,
    from.b + (to.b - from.b) * amount,
  );
}

function vibrant(hex: string, fallback = '#ff9d35') {
  const rgb = hexToRgb(hex);

  if (!rgb) {
    return fallback;
  }

  const { h, s, l } = rgbToHsl(rgb.r, rgb.g, rgb.b);
  const result = hslToRgb(h, Math.max(0.6, Math.min(1, s)), Math.max(0.44, Math.min(0.66, l)));

  return rgbToHex(result.r, result.g, result.b);
}

function shiftHue(hex: string, degrees: number, fallback = '#49c9ff') {
  const rgb = hexToRgb(hex);

  if (!rgb) {
    return fallback;
  }

  const { h, s, l } = rgbToHsl(rgb.r, rgb.g, rgb.b);
  const result = hslToRgb(h + degrees, Math.max(0.52, s), Math.max(0.44, Math.min(0.65, l)));

  return rgbToHex(result.r, result.g, result.b);
}

function genrePalette(genre: string) {
  const key = String(genre || '').toLowerCase();

  if (/horror|dark|halloween/.test(key)) {
    return { accent: '#ff4d6d', secondary: '#8b5cf6' };
  }

  if (/race|car|sport/.test(key)) {
    return { accent: '#ff9d35', secondary: '#22d3ee' };
  }

  if (/space|sci|flight/.test(key)) {
    return { accent: '#38bdf8', secondary: '#a78bfa' };
  }

  if (/puzzle|strategy|knowledge/.test(key)) {
    return { accent: '#34d399', secondary: '#60a5fa' };
  }

  if (/rpg|adventure|fantasy/.test(key)) {
    return { accent: '#c084fc', secondary: '#fbbf24' };
  }

  return { accent: '#f59e0b', secondary: '#8b5cf6' };
}

function mostVibrant(colors: string[], fallback: string) {
  let best = fallback;
  let bestScore = 0.16;

  for (const hex of colors) {
    const rgb = hexToRgb(hex);

    if (!rgb) {
      continue;
    }

    const { s, l } = rgbToHsl(rgb.r, rgb.g, rgb.b);
    const score = s * (0.32 + Math.min(l, 0.72));

    if (score > bestScore) {
      bestScore = score;
      best = hex;
    }
  }

  return vibrant(best, fallback);
}

function loadImage(dataUrl: string, timeoutMs = 1600): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const image = new Image();
    let settled = false;
    const finish = (value: HTMLImageElement | null) => {
      if (settled) {
        return;
      }

      settled = true;
      window.clearTimeout(timer);
      resolve(value);
    };
    const timer = window.setTimeout(() => finish(null), timeoutMs);

    image.onload = () => finish(image);
    image.onerror = () => finish(null);
    image.decoding = 'async';
    image.src = dataUrl;
  });
}

function detectAlpha(image: HTMLImageElement) {
  try {
    const size = 48;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;

    const ctx = canvas.getContext('2d', { willReadFrequently: true });

    if (!ctx) {
      return false;
    }

    ctx.clearRect(0, 0, size, size);
    ctx.drawImage(image, 0, 0, size, size);

    const data = ctx.getImageData(0, 0, size, size).data;
    const corners = [0, (size - 1) * 4, (size * size - size) * 4, (size * size - 1) * 4];
    const transparentCorners = corners.filter((offset) => data[offset + 3] < 40).length;
    let transparentPixels = 0;

    for (let i = 3; i < data.length; i += 4) {
      if (data[i] < 235) {
        transparentPixels++;
      }
    }

    return transparentCorners >= 2 || transparentPixels > (data.length / 4) * 0.14;
  } catch {
    return false;
  }
}

function scoreAsset(
  path: string,
  role: 'background' | 'hero' | 'enemy',
  width: number,
  height: number,
  hasAlpha: boolean,
) {
  const lower = path.toLowerCase();
  const aspect = width / Math.max(1, height);
  const area = width * height;
  let score = 0;

  if (role === 'background') {
    if (BACKGROUND_HINTS.test(lower)) {
      score += 62;
    }

    if (BACKGROUND_AVOID.test(lower)) {
      score -= 140;
    }

    if (/(?:background|backdrop|bg|scene|environment|parallax|sky|level|world|map|arena|stage)/i.test(lower)) {
      score += 22;
    }

    if (aspect > 1.15) {
      score += 26;
    }

    if (aspect > 2.6) {
      score += 8;
    }

    if (aspect < 0.9) {
      score -= 24;
    }

    if (area > 120_000) {
      score += 14;
    }

    if (area > 400_000) {
      score += 12;
    }

    if (area < 18_000) {
      score -= 22;
    }

    if (hasAlpha) {
      score -= 10;
    }
  }

  if (role === 'hero') {
    if (HERO_STRONG.test(lower)) {
      score += 82;
    } else if (HERO_HINTS.test(lower)) {
      score += 46;
    }

    if (HERO_AVOID.test(lower)) {
      score -= 170;
    }

    if (hasAlpha) {
      score += 38;
    }

    if (area > 4_000) {
      score += 10;
    }

    if (area > 40_000) {
      score += 10;
    }

    if (width > 1_200 && height > 1_200) {
      score -= 28;
    }

    if (aspect > 3) {
      score -= 16;
    }
  }

  if (role === 'enemy') {
    if (ENEMY_HINTS.test(lower)) {
      score += 54;
    }

    if (ENEMY_AVOID.test(lower)) {
      score -= 140;
    }

    if (hasAlpha) {
      score += 30;
    }

    if (area > 3_000) {
      score += 10;
    }

    if (aspect > 3.4) {
      score -= 14;
    }
  }

  return score;
}

function extractPalette(image: HTMLImageElement, max = 7) {
  try {
    const size = 26;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;

    const ctx = canvas.getContext('2d', { willReadFrequently: true });

    if (!ctx) {
      return [];
    }

    ctx.clearRect(0, 0, size, size);
    ctx.drawImage(image, 0, 0, size, size);

    const data = ctx.getImageData(0, 0, size, size).data;
    const counts = new Map<string, { count: number; r: number; g: number; b: number }>();

    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 3] < 128) {
        continue;
      }

      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      const sum = r + g + b;

      if (sum < 54 || sum > 738) {
        continue;
      }

      const key = `${r >> 4},${g >> 4},${b >> 4}`;
      const entry = counts.get(key) || { count: 0, r: 0, g: 0, b: 0 };
      entry.count++;
      entry.r += r;
      entry.g += g;
      entry.b += b;
      counts.set(key, entry);
    }

    return [...counts.values()]
      .sort((left, right) => right.count - left.count)
      .slice(0, max * 2)
      .map((entry) => rgbToHex(entry.r / entry.count, entry.g / entry.count, entry.b / entry.count));
  } catch {
    return [];
  }
}

function wrapWords(ctx: CanvasRenderingContext2D, words: string[], maxWidth: number) {
  const lines: string[] = [];
  let line = '';

  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;

    if (line && ctx.measureText(candidate).width > maxWidth) {
      lines.push(line);
      line = word;
    } else {
      line = candidate;
    }
  }

  if (line) {
    lines.push(line);
  }

  return lines;
}

function drawImageCover(
  ctx: CanvasRenderingContext2D,
  image: HTMLImageElement,
  x: number,
  y: number,
  width: number,
  height: number,
) {
  const scale = Math.max(width / image.width, height / image.height);
  const drawWidth = image.width * scale;
  const drawHeight = image.height * scale;
  ctx.drawImage(image, x + (width - drawWidth) / 2, y + (height - drawHeight) / 2, drawWidth, drawHeight);
}

function drawAbstractBackground(ctx: CanvasRenderingContext2D, palette: string[], accent: string, secondary: string) {
  const base = ctx.createLinearGradient(0, 0, COVER_WIDTH, COVER_HEIGHT);
  base.addColorStop(0, darken(palette[0] || '#0b1024', 0.42));
  base.addColorStop(0.52, darken(palette[1] || palette[0] || '#101a38', 0.5));
  base.addColorStop(1, '#04060f');
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, COVER_WIDTH, COVER_HEIGHT);

  const glow = ctx.createRadialGradient(880, 300, 24, 880, 300, 560);
  glow.addColorStop(0, withAlpha(accent, 0.44));
  glow.addColorStop(0.42, withAlpha(secondary, 0.2));
  glow.addColorStop(1, 'transparent');
  ctx.fillStyle = glow;
  ctx.fillRect(180, 0, COVER_WIDTH, COVER_HEIGHT);

  const lowerGlow = ctx.createRadialGradient(280, 640, 20, 280, 640, 460);
  lowerGlow.addColorStop(0, withAlpha(secondary, 0.24));
  lowerGlow.addColorStop(1, 'transparent');
  ctx.fillStyle = lowerGlow;
  ctx.fillRect(0, 240, 780, 480);

  ctx.save();
  ctx.translate(890, 300);
  ctx.rotate(-0.22);

  for (let i = 0; i < 10; i++) {
    ctx.strokeStyle = withAlpha(i % 2 ? secondary : accent, 0.1 + i * 0.012);
    ctx.lineWidth = i % 3 === 0 ? 3 : 1;
    ctx.beginPath();
    ctx.ellipse(0, 0, 180 + i * 29, 102 + i * 18, 0, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.restore();

  ctx.save();
  ctx.globalAlpha = 0.11;
  ctx.strokeStyle = '#dbeafe';
  ctx.lineWidth = 1;

  for (let x = -320; x < COVER_WIDTH; x += 62) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x + 360, COVER_HEIGHT);
    ctx.stroke();
  }
  ctx.restore();
}

function drawSpeedLines(ctx: CanvasRenderingContext2D, accent: string, secondary: string, seed: number) {
  let state = seed || 1;
  const random = () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };

  for (let i = 0; i < 7; i++) {
    const y = 80 + random() * 520;
    const length = 180 + random() * 380;
    const startX = 620 + random() * 500;
    ctx.strokeStyle = withAlpha(i % 2 ? secondary : accent, 0.08 + random() * 0.12);
    ctx.lineWidth = 1 + random() * 3;
    ctx.beginPath();
    ctx.moveTo(startX, y);
    ctx.lineTo(startX + length, y + (random() - 0.5) * 90);
    ctx.stroke();
  }
}

function drawParticles(
  ctx: CanvasRenderingContext2D,
  accent: string,
  secondary: string,
  seed: number,
  count = 46,
  foreground = false,
) {
  let state = (seed || 7) ^ (foreground ? 0x9e3779b9 : 0);
  const random = () => {
    state = (Math.imul(state, 1103515245) + 12345) >>> 0;
    return state / 4294967296;
  };

  for (let i = 0; i < count; i++) {
    const x = random() * COVER_WIDTH;
    const y = random() * COVER_HEIGHT;
    const radius = foreground ? 1.4 + random() * 3.4 : 0.5 + random() * 2.2;
    const alpha = foreground ? 0.18 + random() * 0.4 : 0.12 + random() * 0.36;
    ctx.fillStyle = withAlpha(i % 3 === 0 ? secondary : accent, alpha);
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawSprite(
  ctx: CanvasRenderingContext2D,
  asset: LoadedAsset,
  box: { x: number; y: number; w: number; h: number },
  options: { flip?: boolean; rotate?: number; glow?: string; alpha?: number; foreground?: boolean },
) {
  const image = asset.image;
  const sourceX = 0;
  const sourceY = 0;
  let sourceWidth = image.width;
  const sourceHeight = image.height;

  if (SHEET_HINT.test(asset.path.toLowerCase()) && sourceWidth / sourceHeight > 2.2) {
    const frames = Math.max(2, Math.min(8, Math.round(sourceWidth / sourceHeight)));
    sourceWidth /= frames;
  }

  const scale = Math.min(box.w / sourceWidth, box.h / sourceHeight);
  const drawWidth = sourceWidth * scale;
  const drawHeight = sourceHeight * scale;
  const drawX = box.x + (box.w - drawWidth) / 2;
  const drawY = box.y + (box.h - drawHeight) / 2;

  ctx.save();
  ctx.imageSmoothingEnabled = image.width > 220;
  ctx.globalAlpha = options.alpha ?? 1;
  ctx.translate(drawX + drawWidth / 2, drawY + drawHeight / 2);

  if (options.rotate) {
    ctx.rotate(options.rotate);
  }

  if (options.flip) {
    ctx.scale(-1, 1);
  }

  if (options.glow) {
    ctx.shadowColor = options.glow;
    ctx.shadowBlur = options.foreground ? 36 : 26;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 0;
  }

  ctx.drawImage(
    image,
    sourceX,
    sourceY,
    sourceWidth,
    sourceHeight,
    -drawWidth / 2,
    -drawHeight / 2,
    drawWidth,
    drawHeight,
  );
  ctx.restore();
}

function drawScene(
  ctx: CanvasRenderingContext2D,
  background: HTMLImageElement | undefined,
  palette: string[],
  accent: string,
  secondary: string,
  style: CoverStyle,
) {
  if (background) {
    const base = ctx.createLinearGradient(0, 0, COVER_WIDTH, COVER_HEIGHT);
    base.addColorStop(0, darken(palette[0] || '#0b1024', 0.35));
    base.addColorStop(0.55, darken(palette[1] || palette[0] || '#101a38', 0.45));
    base.addColorStop(1, '#04060f');
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, COVER_WIDTH, COVER_HEIGHT);

    ctx.save();
    ctx.imageSmoothingEnabled = style !== 'pixel-art' || background.width > 300;
    drawImageCover(ctx, background, 0, 0, COVER_WIDTH, COVER_HEIGHT);
    ctx.restore();

    const grade = ctx.createLinearGradient(0, 0, COVER_WIDTH, COVER_HEIGHT);
    grade.addColorStop(0, withAlpha(accent, 0.16));
    grade.addColorStop(0.5, 'rgba(0,0,0,0)');
    grade.addColorStop(1, withAlpha(secondary, 0.13));
    ctx.save();
    ctx.globalCompositeOperation = 'soft-light';
    ctx.fillStyle = grade;
    ctx.fillRect(0, 0, COVER_WIDTH, COVER_HEIGHT);
    ctx.restore();
  } else {
    drawAbstractBackground(ctx, palette, accent, secondary);
  }

  const vignette = ctx.createRadialGradient(
    COVER_WIDTH * 0.57,
    COVER_HEIGHT * 0.46,
    160,
    COVER_WIDTH * 0.57,
    COVER_HEIGHT * 0.46,
    880,
  );
  vignette.addColorStop(0, 'rgba(0,0,0,0)');
  vignette.addColorStop(0.62, 'rgba(2,5,14,0.16)');
  vignette.addColorStop(1, 'rgba(2,5,14,0.8)');
  ctx.fillStyle = vignette;
  ctx.fillRect(0, 0, COVER_WIDTH, COVER_HEIGHT);
}

function drawCornerGlow(ctx: CanvasRenderingContext2D, secondary: string) {
  const glow = ctx.createRadialGradient(COVER_WIDTH, 0, 0, COVER_WIDTH, 0, 560);
  glow.addColorStop(0, withAlpha(secondary, 0.26));
  glow.addColorStop(0.5, withAlpha(secondary, 0.08));
  glow.addColorStop(1, 'transparent');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, COVER_WIDTH, COVER_HEIGHT);
}

function drawTypography(
  ctx: CanvasRenderingContext2D,
  input: { title: string; genre: string; description?: string; accent: string; secondary: string },
) {
  const { accent, secondary } = input;
  const cleanTitle = (input.title || 'YOUR GAME').trim().replace(/\s+/g, ' ').slice(0, 100) || 'YOUR GAME';
  const genreLabel = (input.genre || 'GAME').trim().toUpperCase().slice(0, 18) || 'GAME';
  const tagline = String(input.description || '')
    .replace(/https?:\/\/\S+/gi, '')
    .replace(/\s+/g, ' ')
    .trim()
    .split(/[.!?]\s/)[0]
    .slice(0, 92)
    .trim();

  const bottom = ctx.createLinearGradient(0, 280, 0, COVER_HEIGHT);
  bottom.addColorStop(0, 'rgba(3,6,16,0)');
  bottom.addColorStop(0.5, 'rgba(3,6,16,0.48)');
  bottom.addColorStop(1, 'rgba(3,6,16,0.97)');
  ctx.fillStyle = bottom;
  ctx.fillRect(0, 250, COVER_WIDTH, COVER_HEIGHT - 250);

  const left = ctx.createLinearGradient(0, 0, 820, 0);
  left.addColorStop(0, 'rgba(3,6,16,0.62)');
  left.addColorStop(1, 'rgba(3,6,16,0)');
  ctx.fillStyle = left;
  ctx.fillRect(0, 0, 820, COVER_HEIGHT);

  ctx.fillStyle = accent;
  ctx.fillRect(62, 56, 7, 34);
  ctx.font = '800 15px Arial, sans-serif';
  ctx.fillStyle = 'rgba(255,255,255,0.86)';
  ctx.fillText('THEFORTZ  /  ORIGINAL', 82, 78);

  ctx.font = '800 17px Arial, sans-serif';

  const badgeWidth = Math.max(112, ctx.measureText(genreLabel).width + 36);
  const badgeHeight = 36;
  const badgeX = 62;
  const badgeY = 352;
  ctx.save();
  ctx.fillStyle = accent;
  ctx.beginPath();

  if (typeof ctx.roundRect === 'function') {
    ctx.roundRect(badgeX, badgeY, badgeWidth, badgeHeight, 8);
  } else {
    ctx.rect(badgeX, badgeY, badgeWidth, badgeHeight);
  }

  ctx.fill();
  ctx.fillStyle = '#07101e';
  ctx.fillText(genreLabel, badgeX + 18, badgeY + 24);
  ctx.restore();

  const maxTitleWidth = 850;
  const words = cleanTitle.toUpperCase().split(/\s+/).filter(Boolean);
  let titleSize = 94;
  let lines: string[] = [];

  for (; titleSize >= 48; titleSize -= 4) {
    ctx.font = `900 ${titleSize}px "Arial Black", Impact, "Arial Narrow", sans-serif`;
    lines = wrapWords(ctx, words, maxTitleWidth);

    if (lines.length <= 2 && lines.every((line) => ctx.measureText(line).width <= maxTitleWidth)) {
      break;
    }
  }

  if (lines.length > 2) {
    titleSize = Math.min(titleSize, 54);
    ctx.font = `900 ${titleSize}px "Arial Black", Impact, "Arial Narrow", sans-serif`;
    lines = wrapWords(ctx, words, maxTitleWidth).slice(0, 3);
  }

  const lineHeight = titleSize * 0.92;
  const firstBaseline = lines.length <= 1 ? 548 : lines.length === 2 ? 492 : 480;
  const titleGradient = ctx.createLinearGradient(
    0,
    firstBaseline - titleSize,
    0,
    firstBaseline + lineHeight * Math.max(0, lines.length - 1) + 14,
  );
  titleGradient.addColorStop(0, '#ffffff');
  titleGradient.addColorStop(0.62, '#f8fbff');
  titleGradient.addColorStop(1, mix(accent, '#ffffff', 0.58));

  ctx.save();
  ctx.textBaseline = 'alphabetic';
  ctx.lineJoin = 'round';
  ctx.lineWidth = Math.max(4, titleSize * 0.075);
  ctx.strokeStyle = 'rgba(3,6,16,0.9)';
  ctx.shadowColor = 'rgba(0,0,0,0.75)';
  ctx.shadowBlur = 18;
  ctx.shadowOffsetY = 6;
  (ctx as CanvasRenderingContext2D & { letterSpacing?: string }).letterSpacing = '-1.5px';

  lines.forEach((line, index) => {
    const y = firstBaseline + index * lineHeight;
    ctx.strokeText(line, 62, y, maxTitleWidth);
    ctx.fillStyle = titleGradient;
    ctx.fillText(line, 62, y, maxTitleWidth);
  });
  ctx.restore();

  if (tagline) {
    const taglineY = lines.length >= 3 ? 648 : 662;
    ctx.save();
    ctx.font = '700 16px Arial, sans-serif';
    ctx.fillStyle = 'rgba(255,255,255,0.72)';
    ctx.shadowColor = 'rgba(0,0,0,0.85)';
    ctx.shadowBlur = 8;
    (ctx as CanvasRenderingContext2D & { letterSpacing?: string }).letterSpacing = '0.8px';
    ctx.fillText(tagline.toUpperCase(), 64, taglineY, 880);
    ctx.restore();
  }

  const underline = ctx.createLinearGradient(62, 0, 320, 0);
  underline.addColorStop(0, withAlpha(accent, 0.9));
  underline.addColorStop(1, withAlpha(secondary, 0));
  ctx.fillStyle = underline;
  ctx.fillRect(62, 700, 250, 3);
}

function toReference(image: HTMLImageElement, maxWidth: number, transparent: boolean) {
  try {
    const scale = Math.min(1, maxWidth / Math.max(1, image.width));
    const width = Math.max(1, Math.round(image.width * scale));
    const height = Math.max(1, Math.round(image.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;

    const ctx = canvas.getContext('2d');

    if (!ctx) {
      return '';
    }

    if (!transparent) {
      ctx.fillStyle = '#0b1020';
      ctx.fillRect(0, 0, width, height);
    }

    ctx.imageSmoothingEnabled = image.width > 220;
    ctx.drawImage(image, 0, 0, width, height);

    const dataUrl = transparent ? canvas.toDataURL('image/png') : canvas.toDataURL('image/jpeg', 0.82);
    const base64 = dataUrl.slice(dataUrl.indexOf(',') + 1);

    return base64.length >= 32 && base64.length <= REFERENCE_MAX_CHARS ? base64 : '';
  } catch {
    return '';
  }
}

async function selectAssets(assets: Record<string, string>) {
  const entries = Object.entries(assets)
    .map(([rawPath, dataUrl]) => ({ path: normalizePath(rawPath), dataUrl: String(dataUrl || '') }))
    .filter(
      (entry) =>
        entry.path &&
        /^data:image\//i.test(entry.dataUrl) &&
        entry.dataUrl.length <= 12_000_000 &&
        !/(?:^|\/)\.static_server(?:\/|$)/i.test(entry.path) &&
        !/\.(?:mp3|wav|ogg|m4a|glb|gltf|fbx|obj|mtl|wasm|woff2?|ttf|otf|json|js|css|html?)$/i.test(entry.path),
    );

  const candidatesFor = (role: 'background' | 'hero' | 'enemy', limit: number) =>
    entries
      .map((entry) => ({
        ...entry,
        score: scoreAsset(entry.path, role, 512, 512, role !== 'background'),
      }))
      .sort((left, right) => right.score - left.score)
      .slice(0, limit);

  const backgroundCandidates = candidatesFor('background', 8);
  const heroCandidates = candidatesFor('hero', 8);
  const enemyCandidates = candidatesFor('enemy', 6);
  const unique = new Map<string, { path: string; dataUrl: string }>();

  for (const candidate of [...backgroundCandidates, ...heroCandidates, ...enemyCandidates]) {
    if (!unique.has(candidate.path)) {
      unique.set(candidate.path, candidate);
    }
  }

  const loaded = await Promise.all(
    [...unique.values()].map(async (entry) => {
      const image = await loadImage(entry.dataUrl);

      if (!image || !image.width || !image.height) {
        return null;
      }

      const hasAlpha = detectAlpha(image);

      return {
        ...entry,
        image,
        width: image.width,
        height: image.height,
        hasAlpha,
      } as LoadedAsset;
    }),
  );

  const valid = loaded.filter((asset): asset is LoadedAsset => Boolean(asset));

  const pick = (role: 'background' | 'hero' | 'enemy', excluded: Set<string>, requireAlpha: boolean) => {
    const scored = valid
      .filter((asset) => !excluded.has(asset.path) && (!requireAlpha || asset.hasAlpha))
      .map((asset) => ({ ...asset, score: scoreAsset(asset.path, role, asset.width, asset.height, asset.hasAlpha) }))
      .sort((left, right) => right.score - left.score);

    return scored[0] && scored[0].score > 0 ? scored[0] : undefined;
  };

  const used = new Set<string>();
  const background = pick('background', used, false);

  if (background) {
    used.add(background.path);
  }

  const hero = pick('hero', used, true);

  if (hero) {
    used.add(hero.path);
  }

  const enemy = pick('enemy', used, true);

  return {
    selected: { background, hero, enemy } as SelectedAssets,
    style: detectStyle([background, hero, enemy].filter(Boolean) as LoadedAsset[]),
  };
}

function detectStyle(selected: LoadedAsset[]): CoverStyle {
  const pixelHints = selected.filter((asset) => /pixel|8bit|16bit|tileset|sprite/i.test(asset.path)).length;
  const small = selected.some((asset) => asset.width <= 256 && asset.height <= 256);

  return pixelHints >= 1 && small ? 'pixel-art' : 'illustration';
}

function buildReferences(selected: SelectedAssets) {
  /*
   * Background and player art are enough for visual matching; enemy art is
   * deliberately kept out of image-provider safety screening.
   */
  const ordered = [selected.background, selected.hero].filter(Boolean) as LoadedAsset[];
  const references: string[] = [];
  const referencePaths: string[] = [];

  for (const asset of ordered) {
    const reference = toReference(
      asset.image,
      asset === selected.background ? 768 : 448,
      asset !== selected.background,
    );

    if (!reference) {
      continue;
    }

    references.push(reference);
    referencePaths.push(asset.path);

    if (references.length >= 3) {
      break;
    }
  }

  return { references, referencePaths };
}

function createCanvas() {
  const canvas = document.createElement('canvas');
  canvas.width = COVER_WIDTH;
  canvas.height = COVER_HEIGHT;

  const ctx = canvas.getContext('2d');

  if (!ctx) {
    throw new Error('This browser could not create the cover image.');
  }

  return { canvas, ctx };
}

/**
 * Builds the instant local cover. It never waits on a network request; the only
 * async work is decoding image data URLs already held by the Studio.
 */
export async function createGameArtCover(input: CoverArtInput): Promise<CoverArtResult> {
  const { selected, style } = await selectAssets(input.assets || {});
  const palette = [
    ...(selected.background ? extractPalette(selected.background.image) : []),
    ...(selected.hero ? extractPalette(selected.hero.image) : []),
    ...(input.palette || []),
  ];
  const uniquePalette = [...new Set(palette.map((hex) => hex.toLowerCase()))].slice(0, 9);
  const fallback = genrePalette(input.genre);
  const accent = mostVibrant(uniquePalette, fallback.accent);
  const secondary = uniquePalette.length > 1 ? shiftHue(accent, 152, fallback.secondary) : fallback.secondary;
  const seed = hashString(
    `${input.title}|${input.genre}|${selected.background?.path || ''}|${selected.hero?.path || ''}`,
  );

  const { canvas, ctx } = createCanvas();
  drawScene(ctx, selected.background?.image, uniquePalette, accent, secondary, style);

  const glow = ctx.createRadialGradient(940, 300, 30, 940, 300, 440);
  glow.addColorStop(0, withAlpha(accent, 0.44));
  glow.addColorStop(0.44, withAlpha(secondary, 0.16));
  glow.addColorStop(1, 'transparent');
  ctx.fillStyle = glow;
  ctx.fillRect(300, 0, COVER_WIDTH, COVER_HEIGHT);

  drawSpeedLines(ctx, accent, secondary, seed);
  drawParticles(ctx, accent, secondary, seed);

  if (selected.enemy) {
    drawSprite(
      ctx,
      selected.enemy,
      { x: 18, y: 150, w: 430, h: 440 },
      { flip: true, rotate: -0.045, glow: withAlpha(secondary, 0.85), alpha: 0.9 },
    );
  }

  if (selected.hero) {
    drawSprite(
      ctx,
      selected.hero,
      { x: 610, y: 66, w: 610, h: 560 },
      { rotate: -0.018, glow: withAlpha(accent, 0.95), foreground: true },
    );
  }

  drawParticles(ctx, accent, secondary, seed + 17, 18, true);
  drawCornerGlow(ctx, secondary);
  drawTypography(ctx, {
    title: input.title,
    genre: input.genre,
    description: input.description,
    accent,
    secondary,
  });

  const { references, referencePaths } = buildReferences(selected);

  return {
    dataUrl: canvas.toDataURL('image/jpeg', 0.92),
    references,
    referencePaths,
    palette: uniquePalette,
    accent,
    secondary,
    style,
    hasGameArt: Boolean(selected.background || selected.hero),
  };
}

/** Composes the title and branding over an AI-generated scene. */
export async function composeAiCover(
  aiDataUrl: string,
  base: CoverArtResult,
  input: Pick<CoverArtInput, 'title' | 'genre' | 'description'>,
): Promise<string> {
  const image = await loadImage(aiDataUrl, 6000);

  if (!image) {
    throw new Error('The AI cover image could not be decoded.');
  }

  const { canvas, ctx } = createCanvas();
  ctx.fillStyle = '#050814';
  ctx.fillRect(0, 0, COVER_WIDTH, COVER_HEIGHT);
  ctx.imageSmoothingEnabled = true;
  drawImageCover(ctx, image, 0, 0, COVER_WIDTH, COVER_HEIGHT);

  const grade = ctx.createLinearGradient(0, 0, COVER_WIDTH, COVER_HEIGHT);
  grade.addColorStop(0, withAlpha(base.accent, 0.13));
  grade.addColorStop(0.5, 'rgba(0,0,0,0)');
  grade.addColorStop(1, withAlpha(base.secondary, 0.12));
  ctx.save();
  ctx.globalCompositeOperation = 'soft-light';
  ctx.fillStyle = grade;
  ctx.fillRect(0, 0, COVER_WIDTH, COVER_HEIGHT);
  ctx.restore();

  const vignette = ctx.createRadialGradient(
    COVER_WIDTH * 0.55,
    COVER_HEIGHT * 0.45,
    180,
    COVER_WIDTH * 0.55,
    COVER_HEIGHT * 0.45,
    900,
  );
  vignette.addColorStop(0, 'rgba(0,0,0,0)');
  vignette.addColorStop(0.66, 'rgba(2,5,14,0.14)');
  vignette.addColorStop(1, 'rgba(2,5,14,0.78)');
  ctx.fillStyle = vignette;
  ctx.fillRect(0, 0, COVER_WIDTH, COVER_HEIGHT);

  drawParticles(ctx, base.accent, base.secondary, hashString(input.title), 16, true);
  drawCornerGlow(ctx, base.secondary);
  drawTypography(ctx, {
    title: input.title,
    genre: input.genre,
    description: input.description,
    accent: base.accent,
    secondary: base.secondary,
  });

  return canvas.toDataURL('image/jpeg', 0.92);
}

/** Last-resort local cover when canvas asset composition throws. */
export function createFallbackCover(title: string, genre: string): string {
  const { canvas, ctx } = createCanvas();
  const { accent, secondary } = genrePalette(genre);
  drawAbstractBackground(ctx, [], accent, secondary);
  drawParticles(ctx, accent, secondary, hashString(`${title}|${genre}`));
  drawCornerGlow(ctx, secondary);
  drawTypography(ctx, { title, genre, accent, secondary });

  return canvas.toDataURL('image/jpeg', 0.92);
}
