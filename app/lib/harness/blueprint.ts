import { z } from 'zod';

export const MAX_GAME_FILE_OPERATIONS = 24;
export const MAX_GAME_SOURCE_BYTES = 4 * 1024 * 1024;
export const MAX_GAME_RESPONSE_SEGMENTS = 64;

export const isWorkspacePath = (path: string) =>
  /^[A-Za-z0-9_][A-Za-z0-9_./-]{0,179}$/.test(path) &&
  !path.split('/').some((part) => !part || part === '.' || part === '..' || ['node_modules', 'dist', 'build'].includes(part)) &&
  !/(?:^|\/)(?:\.env|\.git|.*(?:secret|credential|private[-_]?key))/i.test(path);

const pathSchema = z.string().refine(isWorkspacePath, 'Use a safe, project-relative path.');
const hashSchema = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const textSchema = z.string().min(1).max(800);

export const workspaceManifestSchema = z.array(z.object({
  path: pathSchema,
  hash: hashSchema,
  bytes: z.number().int().nonnegative().max(64 * 1024 * 1024),
}).strict()).max(500).superRefine((entries, context) => {
  const names = new Set<string>();

  for (const entry of entries) {
    const key = entry.path.toLowerCase();
    if (names.has(key)) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: `Duplicate manifest path: ${entry.path}` });
    }
    names.add(key);
  }
});

const fileOperationSchema = z.object({
  path: pathSchema.refine((path) => /\.(?:html|css|js|mjs|json|md)$/.test(path), 'Static game source files only.'),
  operation: z.enum(['create', 'edit']),
  purpose: textSchema,
}).strict();

export const assetOperationSchema = z.object({
  id: z.string().regex(/^[a-z][a-z0-9._-]{0,59}$/),
  path: pathSchema.refine((path) => /^assets\/.+\.png$/.test(path), 'Generated PNGs belong in assets/.'),
  kind: z.enum(['sprite', 'background', 'ui']),
  prompt: z.string().min(10).max(1600),
  width: z.number().int().min(64).max(1024).multipleOf(32),
  height: z.number().int().min(64).max(1024).multipleOf(32),
}).strict();

export const managerBlueprintSchema = z.object({
  title: z.string().min(1).max(100),
  summary: z.string().min(1).max(1200),
  engine: z.enum(['canvas2d', 'webgl']),
  systems: z.array(textSchema).min(2).max(12),
  fileOperations: z.array(fileOperationSchema).min(1).max(MAX_GAME_FILE_OPERATIONS),
  assetOperations: z.array(assetOperationSchema).max(4),
  scriptOrder: z.array(pathSchema).min(1).max(MAX_GAME_FILE_OPERATIONS),
  acceptanceCriteria: z.array(textSchema).min(3).max(12),
}).strict();

export const blueprintSchema = managerBlueprintSchema.extend({
  schemaVersion: z.literal('1.0'),
  id: z.string().uuid(),
  workspaceId: z.string().min(1).max(100),
  baseRevision: hashSchema,
  manifest: workspaceManifestSchema,
  fileOperations: z
    .array(fileOperationSchema.extend({ expectedHash: hashSchema.nullable() }))
    .min(1)
    .max(MAX_GAME_FILE_OPERATIONS),
  verification: z.object({
    scenarios: z.tuple([z.literal('startup'), z.literal('controls'), z.literal('restart'), z.literal('resize')]),
    minimumSimulationSteps: z.number().int().min(1).max(1000),
    requireDiagnostics: z.literal(true),
    requireWebGL: z.boolean().default(false),
  }).strict(),
  budgets: z.object({
    assetAttempts: z.literal(1),
    maximumSourceBytes: z.literal(MAX_GAME_SOURCE_BYTES),
    maximumResponseSegments: z.literal(MAX_GAME_RESPONSE_SEGMENTS),
  }).strict(),
}).strict().superRefine((plan, context) => {
  const paths = new Set<string>();
  const existing = new Map(plan.manifest.map((file) => [file.path, file]));

  for (const operation of [...plan.fileOperations, ...plan.assetOperations]) {
    const key = operation.path.toLowerCase();
    if (paths.has(key)) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: `Duplicate planned destination: ${operation.path}` });
    }
    paths.add(key);
    const collision = plan.manifest.find((file) => file.path.toLowerCase() === key && file.path !== operation.path);
    if (collision) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: `Case-colliding path: ${operation.path}` });
    }
  }
  for (const operation of plan.fileOperations) {
    const base = existing.get(operation.path);
    if (operation.operation === 'create' ? base || operation.expectedHash !== null : !base || base.hash !== operation.expectedHash) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: `Incorrect base file precondition: ${operation.path}` });
    }
  }
  for (const asset of plan.assetOperations) {
    if (existing.has(asset.path)) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: `Reuse existing assets instead of overwriting: ${asset.path}` });
    }
  }
  const assetIds = plan.assetOperations.map((asset) => asset.id);
  if (new Set(assetIds).size !== assetIds.length) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'Asset IDs must be unique.' });
  }
  for (const path of plan.scriptOrder) {
    if (!/\.(?:js|mjs)$/.test(path) || !existing.has(path) && !plan.fileOperations.some((file) => file.path === path)) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: `Script not found in the planned tree: ${path}` });
    }
  }
  if (!existing.has('index.html') && !plan.fileOperations.some((file) => file.path === 'index.html')) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'A game must have index.html.' });
  }
});

export type Blueprint = z.infer<typeof blueprintSchema>;
export type WorkspaceManifest = z.infer<typeof workspaceManifestSchema>;

export function parseManagerOutput(text: string) {
  let clean = text.trim();

  // Extract from markdown code block if present
  const codeBlockMatch = clean.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (codeBlockMatch) {
    clean = codeBlockMatch[1].trim();
  }

  // Extract outermost JSON object if there is surrounding conversational text
  const firstBrace = clean.indexOf('{');
  const lastBrace = clean.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    clean = clean.slice(firstBrace, lastBrace + 1);
  }

  // Strip trailing commas before closing braces/brackets
  clean = clean.replace(/,(\s*[}\]])/g, '$1');

  let raw: any;
  try {
    raw = JSON.parse(clean);
  } catch {
    // Attempt cleaning non-JSON wrappers
    clean = clean.replace(/^[^{\[]*/, '').replace(/[^}\]]*$/, '');
    raw = JSON.parse(clean);
  }

  if (typeof raw !== 'object' || raw === null) {
    throw new Error('Manager agent output is not a JSON object.');
  }

  const title = typeof raw.title === 'string' && raw.title.trim() ? raw.title.slice(0, 100) : 'Fortz Arcade';
  const summary = typeof raw.summary === 'string' && raw.summary.trim() ? raw.summary.slice(0, 1200) : 'Interactive game build';
  const engine = raw.engine === 'webgl' ? 'webgl' : 'canvas2d';

  const rawSystems = Array.isArray(raw.systems) ? raw.systems.map((s: unknown) => String(s).slice(0, 800)).filter(Boolean) : [];
  const systems = rawSystems.length >= 2
    ? rawSystems
    : [
        rawSystems[0] || 'Responsive player controls, physics, and gameplay mechanics',
        'Game state lifecycle, HUD display, restart handling, and diagnostics',
      ];

  const rawFileOps = Array.isArray(raw.fileOperations)
    ? raw.fileOperations
        .filter((f: any) => f && typeof f.path === 'string')
        .map((f: any) => ({
          path: String(f.path).replace(/^\.?\//, '').trim(),
          operation: f.operation === 'edit' ? ('edit' as const) : ('create' as const),
          purpose: typeof f.purpose === 'string' && f.purpose.trim() ? f.purpose.slice(0, 800) : 'Implement game component',
        }))
    : [];

  const fileOperations = rawFileOps.length > 0
    ? rawFileOps
    : [
        { path: 'index.html', operation: 'create' as const, purpose: 'Game HTML canvas wrapper' },
        { path: 'game.js', operation: 'create' as const, purpose: 'Main game logic and controls' },
      ];

  const assetOperations = Array.isArray(raw.assetOperations)
    ? raw.assetOperations
        .filter(
          (a: any) =>
            a &&
            typeof a.id === 'string' &&
            typeof a.path === 'string' &&
            /^assets\/.+\.png$/.test(a.path.replace(/^\.?\//, '').trim()),
        )
        .map((a: any) => ({
          id: a.id,
          path: a.path.replace(/^\.?\//, '').trim(),
          kind: a.kind === 'background' || a.kind === 'ui' ? a.kind : ('sprite' as const),
          prompt: typeof a.prompt === 'string' ? a.prompt.slice(0, 1600) : 'Game sprite asset',
          width:
            typeof a.width === 'number' && a.width >= 64 && a.width <= 1024 ? Math.round(a.width / 32) * 32 : 512,
          height:
            typeof a.height === 'number' && a.height >= 64 && a.height <= 1024 ? Math.round(a.height / 32) * 32 : 512,
        }))
    : [];

  const rawScriptOrder = Array.isArray(raw.scriptOrder)
    ? raw.scriptOrder
        .map((s: unknown) => String(s).replace(/^\.?\//, '').trim())
        .filter((s: string) => /\.(?:js|mjs)$/.test(s))
    : [];

  const scriptOrder = rawScriptOrder.length > 0 ? rawScriptOrder : ['game.js'];

  const rawCriteria = Array.isArray(raw.acceptanceCriteria)
    ? raw.acceptanceCriteria.map((c: unknown) => String(c).slice(0, 800)).filter(Boolean)
    : [];

  const acceptanceCriteria = rawCriteria.length >= 3
    ? rawCriteria
    : [
        rawCriteria[0] || 'The game loads and starts immediately upon input.',
        rawCriteria[1] || 'Controls respond smoothly to keyboard and pointer inputs.',
        'Game diagnostics and restart loop work reliably.',
      ];

  return managerBlueprintSchema.parse({
    title,
    summary,
    engine,
    systems,
    fileOperations,
    assetOperations,
    scriptOrder,
    acceptanceCriteria,
  });
}

export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(',')}]`;
  }
  if (value !== null && typeof value === 'object') {
    return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`).join(',')}}`;
  }

  return JSON.stringify(value);
}

export async function contentHash(value: string | Uint8Array) {
  const bytes = typeof value === 'string' ? new TextEncoder().encode(value) : value;
  const digest = await crypto.subtle.digest('SHA-256', new Uint8Array(bytes));

  return `sha256:${Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')}`;
}

export async function revisionHash(manifest: WorkspaceManifest) {
  return contentHash(canonicalJson([...manifest].sort((a, b) => a.path.localeCompare(b.path))));
}

export async function createWorkspaceManifest(files: Record<string, Uint8Array>) {
  const entries = await Promise.all(Object.entries(files).filter(([path]) => isWorkspacePath(path)).map(async ([path, bytes]) => ({
    path, bytes: bytes.byteLength, hash: await contentHash(bytes),
  })));

  return workspaceManifestSchema.parse(entries.sort((a, b) => a.path.localeCompare(b.path)));
}
