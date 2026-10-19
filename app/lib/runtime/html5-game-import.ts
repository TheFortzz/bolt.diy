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
export const MAX_GAME_IMPORT_BYTES = 100 * 1024 * 1024;
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
  if (!files.length || files.some((file) => !file.path.includes('/'))) {
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

/** Every imported project is normalized to the entry path the preview/publisher serves. */
function normalizeEntryPoint(files: Html5GameFile[]): Html5GameFile[] {
  const rootIndex = files.find((file) => file.path.toLowerCase() === 'index.html');
  if (rootIndex) {
    return rootIndex.path === 'index.html'
      ? files
      : files.map((file) => file === rootIndex ? { ...file, path: 'index.html' } : file);
  }

  const htmlFiles = files.filter((file) => /\.html?$/i.test(file.path));
  const entry = htmlFiles.find((file) => /(?:^|\/)index\.html$/i.test(file.path)) ||
    htmlFiles.find((file) => /(?:^|\/)(?:game|play|main|start)\.html?$/i.test(file.path)) ||
    htmlFiles[0];
  if (!entry) return files;

  const slash = entry.path.lastIndexOf('/');
  const prefix = slash >= 0 ? entry.path.slice(0, slash + 1) : '';
  const scoped = prefix ? files.filter((file) => file.path.startsWith(prefix)) : files;
  return scoped.map((file) => {
    const relativePath = prefix ? file.path.slice(prefix.length) : file.path;
    return relativePath === (prefix ? entry.path.slice(prefix.length) : entry.path)
      ? { ...file, path: 'index.html' }
      : { ...file, path: relativePath };
  });
}

async function readSelectedFiles(input: File[]): Promise<Html5GameFile[]> {
  const zipFiles = input.filter((file) => /\.zip$/i.test(file.name));

  if (zipFiles.length > 0) {
    if (zipFiles.length !== 1 || input.length !== 1) {
      throw new Error('Choose one ZIP archive at a time, or select the game files directly.');
    }
    if (zipFiles[0].size > MAX_GAME_IMPORT_BYTES) {
      throw new Error('The ZIP archive is too large. Keep ZIP uploads under 100 MB.');
    }

    let archive: JSZip;

    try {
      archive = await JSZip.loadAsync(await zipFiles[0].arrayBuffer(), {
        checkCRC32: false,
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
    for (const entry of entries) {
      const path = safeRelativePath(entry.name);

      if (path.startsWith('__MACOSX/') || path.endsWith('/.DS_Store') || path === '.DS_Store') {
        continue;
      }

      const estimatedBytes = Number((entry as any)._data?.uncompressedSize || 0);

      if (estimatedBytes > MAX_GAME_IMPORT_BYTES || (estimatedBytes > 0 && totalBytes + estimatedBytes > MAX_GAME_IMPORT_BYTES)) {
        throw new Error('The uncompressed game is too large. Keep the complete game under 100 MB.');
      }

      const bytes = new Uint8Array(await entry.async('uint8array'));
      totalBytes += bytes.byteLength;
      if (totalBytes > MAX_GAME_IMPORT_BYTES) {
        throw new Error('The uncompressed game is too large. Keep the complete game under 100 MB.');
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
  for (const file of input) {
    const relativePath = (file as File & { webkitRelativePath?: string }).webkitRelativePath;
    const path = safeRelativePath(relativePath || file.name);

    if (file.size > MAX_GAME_IMPORT_BYTES || totalBytes + file.size > MAX_GAME_IMPORT_BYTES) {
      throw new Error('The game is too large. Keep all selected files under 100 MB.');
    }

    const bytes = new Uint8Array(await file.arrayBuffer());
    totalBytes += bytes.byteLength;

    if (totalBytes > MAX_GAME_IMPORT_BYTES) {
      throw new Error('The game is too large. Keep all selected files under 100 MB.');
    }

    result.push({ path, bytes, mimeType: detectMimeType(path, file.type) });
  }

  return result;
}

/** Accept a safe ZIP/files selection whenever it contains at least one HTML page. */
export async function prepareHtml5GameImport(input: File[]): Promise<Html5GameImport> {
  if (!input.length) {
    throw new Error('Choose a ZIP or the files from an HTML5 game.');
  }

  let files = normalizeEntryPoint(stripEntryFolder(stripOneCommonRoot(await readSelectedFiles(input))));

  if (!files.length) {
    throw new Error('The selection does not contain any game files.');
  }

  if (files.length > MAX_GAME_FILES) {
    throw new Error(`The game has too many files. Keep it under ${MAX_GAME_FILES} files.`);
  }

  const entry = files.find((file) => file.path.toLowerCase() === 'index.html');

  if (!entry) {
    throw new Error('No .html file was found in this upload.');
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
