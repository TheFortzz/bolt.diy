import type { FileMap } from '~/lib/stores/files';
import type { GeneratedAsset } from '~/lib/stores/generated-assets';
import type { ValidationState } from '~/lib/runtime/build-validator';
import { cleanWorkDirRelativePath } from '~/utils/diff';

export const MAX_SYSTEM_CONTEXT_LENGTH = 12000;

const MAX_FILES = 120;
const privatePath =
  /(?:^|\/)(?:node_modules|\.git|\.env[^/]*|[^/]*(?:secret|credential|private[-_]?key)[^/]*)(?:\/|$)/i;

/** Read-only, token-bounded projection. Never include source contents or binaries. */
export function compileSystemContext(
  files: FileMap,
  assets: Record<string, GeneratedAsset>,
  validation: ValidationState,
  options?: { importedGame?: boolean },
) {
  const entries = Object.entries(files)
    .map(([path, file]) => [cleanWorkDirRelativePath(path), file] as const)
    .filter(([path]) => path && !privatePath.test(path))
    .sort(([left], [right]) => left.localeCompare(right));
  const fileEntries = entries.filter(([, file]) => file?.type === 'file');
  const globals = new Set<string>();
  const scripts: string[] = [];

  for (const [, file] of fileEntries) {
    if (file?.type !== 'file' || file.isBinary) {
      continue;
    }

    for (const match of file.content.matchAll(/\bwindow\.([A-Za-z_$][\w$]*)\s*=/g)) {
      if (globals.size < 40) {
        globals.add(`window.${match[1]}`);
      }
    }
  }

  const entrypoint = fileEntries.find(([path]) => path === 'index.html');

  if (entrypoint?.[1]?.type === 'file') {
    for (const match of entrypoint[1].content.matchAll(/<script\b[^>]*\bsrc\s*=\s*["']([^"']+)["']/gi)) {
      if (scripts.length < 30) {
        scripts.push(match[1]);
      }
    }
  }

  const assetEntries = fileEntries.filter(([path]) =>
    /\.(?:png|apng|jpg|jpeg|webp|gif|svg|bmp|glb|gltf|bin|obj|mtl|fbx|wav|mp3|ogg|ktx2|ttf|otf|woff2?)$/i.test(path),
  );

  return [
    '# SYSTEM_CONTEXT.md',
    '',
    '## Snapshot',
    '- Source: client workspace snapshot; not a backend authorization or runtime proof.',
    `- File count: ${fileEntries.length}`,
    `- Validation state: ${validation.status}`,
    '',
    ...(options?.importedGame
      ? [
          '## Workspace Origin — UPLOADED GAME (PRESERVE IT)',
          '- The user UPLOADED this HTML5 game (single page or multi-file export). Its files and assets are the source of truth.',
          '- Edit in place: read the existing files first and change only what the user asked for. Keep every other file and asset untouched.',
          '- NEVER delete, clear, replace wholesale, or rebuild this game from scratch. NEVER regenerate it as an AI-made imitation.',
          '- Only an explicit user request for a new game / start over allows replacing the project.',
          '',
        ]
      : []),
    '## Active File Tree',
    ...entries
      .slice(0, MAX_FILES)
      .map(
        ([path, file]) =>
          `- ${JSON.stringify(path)} (${file?.type === 'folder' ? 'folder' : file?.type === 'file' && file.isBinary ? 'binary' : 'source'})`,
      ),
    ...(entries.length > MAX_FILES ? [`- ${entries.length - MAX_FILES} entries omitted for token budget.`] : []),
    '',
    '## Existing Asset Paths (images, models, textures, audio, and fonts)',
    ...assetEntries
      .slice(0, 60)
      .map(
        ([path]) =>
          `- ${JSON.stringify(path)} — ${assets[path] ? `${assets[path].byteLength} bytes available to the preview` : 'existing binary; runtime checks still required'}`,
      ),
    '',
    '## Declared Engine Globals (not observed runtime values)',
    ...Array.from(globals)
      .sort()
      .map((name) => `- ${name}`),
    '',
    '## Script Load Order Declared in index.html',
    ...scripts.map((path, index) => `- ${index + 1}. ${JSON.stringify(path)}`),
    '',
    '## Build Requirements',
    '- Preserve existing file paths and declared engine contracts.',
    '- Never reference an image that is not in the file tree; use explicit procedural visuals when no asset is available.',
    '- Complete the playable loop: start, controls, objective, loss/win, restart, HUD, and responsive canvas.',
    '- Do not claim verification; the environment performs code, asset, and iframe checks after mutations.',
  ]
    .join('\n')
    .slice(0, MAX_SYSTEM_CONTEXT_LENGTH);
}
