import JSZip from 'jszip';

export interface Html5GameFile {
  path: string;
  bytes: Uint8Array;
  mimeType: string;
}

export interface Html5GameImport {
  files: Html5GameFile[];
  entryPoint: string;
  totalBytes: number;
}

const MAX_GAME_FILES = 250;
const MAX_GAME_BYTES = 24 * 1024 * 1024;
const MAX_INLINE_IMAGE_BYTES = 8 * 1024 * 1024;
const BLOCKED_SOURCE = /\.(?:ts|tsx|mts|cts|jsx|cpp|cxx|cc|c|h|hpp|hh|java|py|pyc|cs|go|rs|rb|swift|kt|php)$/i;
const MIME_BY_EXTENSION: Record<string, string> = {
  '.html': 'text/html',
  '.htm': 'text/html',
  '.css': 'text/css',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.cjs': 'text/javascript',
  '.json': 'application/json',
  '.txt': 'text/plain',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.avif': 'image/avif',
  '.ico': 'image/x-icon',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.m4a': 'audio/mp4',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.gltf': 'model/gltf+json',
  '.glb': 'model/gltf-binary',
  '.bin': 'application/octet-stream',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.wasm': 'application/wasm',
};

function safeRelativePath(input: string): string {
  const normalized = input.replace(/\\/g, '/').replace(/^\/+/, '');
  const segments = normalized.split('/');

  if (
    !normalized ||
    segments.some((segment) => !segment || segment === '.' || segment === '..') ||
    normalized.includes('\0')
  ) {
    throw new Error(`Unsafe game file path: ${input}`);
  }

  return normalized;
}

function extensionOf(path: string) {
  const name = path.split('/').pop() || '';
  const index = name.lastIndexOf('.');
  return index < 0 ? '' : name.slice(index).toLowerCase();
}

function detectMimeType(path: string, declaredType = ''): string {
  if (declaredType && declaredType !== 'application/octet-stream') {
    return declaredType;
  }

  return MIME_BY_EXTENSION[extensionOf(path)] || 'application/octet-stream';
}

function stripOneCommonRoot(files: Html5GameFile[]): Html5GameFile[] {
  if (files.some((file) => file.path.toLowerCase() === 'index.html')) {
    return files;
  }

  const firstSegments = files.map((file) => file.path.split('/')[0]);
  const commonRoot = firstSegments[0];

  if (!commonRoot || !firstSegments.every((segment) => segment === commonRoot)) {
    return files;
  }

  const prefix = `${commonRoot}/`;

  return files.map((file) => ({ ...file, path: file.path.slice(prefix.length) }));
}

function stripEntryFolder(files: Html5GameFile[]): Html5GameFile[] {
  if (files.some((file) => file.path.toLowerCase() === 'index.html')) {
    return files;
  }

  const entries = files.filter((file) => /(?:^|\/)index\.html$/i.test(file.path));

  if (entries.length !== 1) {
    return files;
  }

  const entryPath = entries[0].path;
  const slash = entryPath.lastIndexOf('/');
  if (slash < 0) return files;
  const prefix = entryPath.slice(0, slash + 1);

  // Ignore archive siblings such as a README/build note; keep the game root
  // beside index.html so its local script and asset URLs work at `/`.
  return files
    .filter((file) => file.path.startsWith(prefix))
    .map((file) => ({ ...file, path: file.path.slice(prefix.length) }));
}

async function readSelectedFiles(input: File[]): Promise<Html5GameFile[]> {
  const zipFiles = input.filter((file) => /\.zip$/i.test(file.name));

  if (zipFiles.length > 0) {
    if (zipFiles.length !== 1 || input.length !== 1) {
      throw new Error('Choose one ZIP archive at a time, or select the game files directly.');
    }

    let archive: JSZip;

    try {
      archive = await JSZip.loadAsync(await zipFiles[0].arrayBuffer(), {
        checkCRC32: true,
        createFolders: false,
      });
    } catch {
      throw new Error('That ZIP could not be opened. Choose a valid game archive and try again.');
    }

    const entries = Object.values(archive.files).filter((entry) => !entry.dir);

    if (entries.length > MAX_GAME_FILES) {
      throw new Error(`The game has too many files. Keep it under ${MAX_GAME_FILES} files.`);
    }

    const result: Html5GameFile[] = [];
    let totalBytes = 0;
    let imageBytes = 0;

    for (const entry of entries) {
      const path = safeRelativePath(entry.name);

      if (path.startsWith('__MACOSX/') || path.endsWith('/.DS_Store') || path === '.DS_Store') {
        continue;
      }

      if (BLOCKED_SOURCE.test(path)) {
        throw new Error(
          `${path} is not a browser-ready HTML5 game file. Import built HTML, JavaScript, CSS, and game assets—not TypeScript or native C/C++ source.`,
        );
      }

      const estimatedBytes = Number((entry as any)._data?.uncompressedSize || 0);

      if (estimatedBytes > MAX_GAME_BYTES || (estimatedBytes > 0 && totalBytes + estimatedBytes > MAX_GAME_BYTES)) {
        throw new Error('The uncompressed game is too large. Keep the complete game under 24 MB.');
      }

      const bytes = new Uint8Array(await entry.async('uint8array'));
      totalBytes += bytes.byteLength;
      if (detectMimeType(path).startsWith('image/')) imageBytes += bytes.byteLength;

      if (totalBytes > MAX_GAME_BYTES) {
        throw new Error('The uncompressed game is too large. Keep the complete game under 24 MB.');
      }

      if (imageBytes > MAX_INLINE_IMAGE_BYTES) {
        throw new Error('Game images exceed the safe preview limit. Keep total image files under 8 MB.');
      }

      result.push({ path, bytes, mimeType: detectMimeType(path) });
    }

    return result;
  }

  if (input.length > MAX_GAME_FILES) {
    throw new Error(`The game has too many files. Keep it under ${MAX_GAME_FILES} files.`);
  }

  const result: Html5GameFile[] = [];
  let totalBytes = 0;
  let imageBytes = 0;

  for (const file of input) {
    const relativePath = (file as File & { webkitRelativePath?: string }).webkitRelativePath;
    const path = safeRelativePath(relativePath || file.name);

    if (BLOCKED_SOURCE.test(path)) {
      throw new Error(
        `${path} is not a browser-ready HTML5 game file. Import built HTML, JavaScript, CSS, and game assets—not TypeScript or native C/C++ source.`,
      );
    }

    const bytes = new Uint8Array(await file.arrayBuffer());
    totalBytes += bytes.byteLength;
    if (detectMimeType(path, file.type).startsWith('image/')) imageBytes += bytes.byteLength;

    if (totalBytes > MAX_GAME_BYTES) {
      throw new Error('The game is too large. Keep all selected files under 24 MB.');
    }

    if (imageBytes > MAX_INLINE_IMAGE_BYTES) {
      throw new Error('Game images exceed the safe preview limit. Keep total image files under 8 MB.');
    }

    result.push({ path, bytes, mimeType: detectMimeType(path, file.type) });
  }

  return result;
}

function decodeHtml(bytes: Uint8Array, path: string): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw new Error(`${path} is not valid UTF-8 HTML.`);
  }
}

function referencedLocalScripts(html: string): string[] {
  const references: string[] = [];
  const matcher = /<script\b[^>]*\bsrc\s*=\s*(["'])(.*?)\1[^>]*>/gi;
  let match: RegExpExecArray | null;

  while ((match = matcher.exec(html))) {
    const reference = match[2].trim();

    if (!reference || /^(?:[a-z]+:|\/\/|#|data:|blob:)/i.test(reference)) {
      continue;
    }

    references.push(decodeURIComponent(reference.split(/[?#]/, 1)[0]).replace(/^\.\//, ''));
  }

  return references;
}

/** Read ZIP/files, reject non-web source, and require a runnable HTML5 entry. */
export async function prepareHtml5GameImport(input: File[]): Promise<Html5GameImport> {
  if (!input.length) {
    throw new Error('Choose a ZIP or the files from an HTML5 game.');
  }

  let files = stripEntryFolder(stripOneCommonRoot(await readSelectedFiles(input)));

  if (!files.length) {
    throw new Error('The selection does not contain any game files.');
  }

  if (files.length > MAX_GAME_FILES) {
    throw new Error(`The game has too many files. Keep it under ${MAX_GAME_FILES} files.`);
  }

  const paths = new Map(files.map((file) => [file.path.toLowerCase(), file]));
  const htmlFiles = files.filter((file) => /\.html?$/i.test(file.path));
  const entry = htmlFiles.find((file) => file.path.toLowerCase() === 'index.html') || htmlFiles[0];

  if (!entry) {
    throw new Error('No index.html was found. Upload a built HTML5 game with an index.html entry point.');
  }

  const html = decodeHtml(entry.bytes, entry.path);

  if (!/<html\b/i.test(html) && !/<canvas\b/i.test(html)) {
    throw new Error(`${entry.path} does not look like an HTML5 game page.`);
  }

  if (!/<script\b/i.test(html) && !/<canvas\b/i.test(html)) {
    throw new Error(`${entry.path} has no game script or canvas to run.`);
  }

  if (/<script\b[^>]*\btype\s*=\s*(["'])(?:text|application)\/(?:typescript|tsx)\1/i.test(html)) {
    throw new Error(`${entry.path} uses a TypeScript browser script. Upload a built HTML5 export with JavaScript files.`);
  }

  const localScripts = referencedLocalScripts(html);

  for (const reference of localScripts) {
    if (/\.(?:ts|tsx|mts|cts)$/i.test(reference)) {
      throw new Error(`${reference} is TypeScript. Upload a built HTML5 export with browser-ready JavaScript.`);
    }

    const normalized = safeRelativePath(reference);

    if (/\.(?:js|mjs|cjs)$/i.test(normalized) && !paths.has(normalized.toLowerCase())) {
      throw new Error(`${entry.path} references ${normalized}, but that file is missing from the upload.`);
    }
  }

  files = files.sort((left, right) => left.path.localeCompare(right.path));

  return {
    files,
    entryPoint: entry.path,
    totalBytes: files.reduce((total, file) => total + file.bytes.byteLength, 0),
  };
}

export function bytesToDataUrl(bytes: Uint8Array, mimeType: string): string {
  let binary = '';

  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }

  return `data:${mimeType};base64,${btoa(binary)}`;
}
