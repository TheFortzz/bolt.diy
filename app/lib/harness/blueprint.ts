import { z } from 'zod';

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
  fileOperations: z.array(fileOperationSchema).min(1).max(24),
  assetOperations: z.array(assetOperationSchema).max(4),
  scriptOrder: z.array(pathSchema).min(1).max(24),
  acceptanceCriteria: z.array(textSchema).min(3).max(12),
}).strict();

export const blueprintSchema = managerBlueprintSchema.extend({
  schemaVersion: z.literal('1.0'),
  id: z.string().uuid(),
  workspaceId: z.string().min(1).max(100),
  baseRevision: hashSchema,
  manifest: workspaceManifestSchema,
  fileOperations: z.array(fileOperationSchema.extend({ expectedHash: hashSchema.nullable() })).min(1).max(24),
  verification: z.object({
    scenarios: z.tuple([z.literal('startup'), z.literal('controls'), z.literal('restart'), z.literal('resize')]),
    minimumSimulationSteps: z.literal(120),
    requireDiagnostics: z.literal(true),
  }).strict(),
  budgets: z.object({
    assetAttempts: z.literal(1),
    maximumSourceBytes: z.literal(1048576),
    maximumResponseSegments: z.literal(8),
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
  const clean = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');

  return managerBlueprintSchema.parse(JSON.parse(clean));
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
