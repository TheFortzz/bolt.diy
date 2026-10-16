import { Agent, createTool } from '@cline/agents';
import { json, type ActionFunctionArgs } from '@remix-run/cloudflare';
import { z, ZodError } from 'zod';
import { getModel } from '~/lib/.server/llm/model';
import { CLINE_TURN_MAX_TOKENS, createBoltAgentModel } from '~/lib/.server/bolt-agent-model';
import { getHarnessSecret, requireSameOrigin, verifyCapability } from '~/lib/.server/harness/capabilities';
import { blueprintSchema, isWorkspacePath, managerBlueprintSchema } from '~/lib/harness/blueprint';
import { runAgentBuildCheck, runAgentGameplayCheck, runAgentQualityCheck } from '~/lib/runtime/agent-project-checks';
import { resolveStaticPreviewFileLoose } from '~/lib/runtime/static-preview';
import type { IProviderSetting } from '~/types/model';
import { DEFAULT_MODEL, DEFAULT_PROVIDER, getModelList } from '~/utils/constants';

const fileMapSchema = z
  .record(z.string().max(2_000_000))
  .refine(
    (files) => Object.values(files).reduce((sum, content) => sum + content.length, 0) <= 9_000_000,
    'Workspace snapshot exceeds the 9 MB Cline context limit.',
  );

const requestSchema = z.object({
  /*
   * Large blueprints and full workspace excerpts exceed the old
   * 12-20k ceilings; rejecting them 400s the run before planning starts.
   */
  prompt: z.string().trim().min(1).max(60_000),
  files: fileMapSchema,
  readOnly: z.boolean().default(false),
  planningOnly: z.boolean().default(false),
  clarificationRounds: z.number().int().min(0).max(3).default(0),
  askedQuestions: z.array(z.string().max(240)).max(6).default([]),
  approvedBlueprint: blueprintSchema.optional(),

  /*
   * Phased builds send the full approved blueprint (the execution token is
   * bound to it) plus the paths this specific run may write; the route
   * intersects them into the write allowlist.
   */
  phasePaths: z.array(z.string().max(400)).max(200).optional(),
  availableAssetPaths: z.array(z.string().max(400)).max(64).default([]),
  executionToken: z.string().max(4096).optional(),
  history: z
    .array(z.object({ role: z.enum(['user', 'assistant']), content: z.string().max(60_000) }))
    .max(20)
    .default([]),
  previewErrors: z
    .array(
      z.object({
        message: z.string().max(2000),
        source: z.string().max(500).optional(),
        line: z.number().int().positive().optional(),
      }),
    )
    .max(50)
    .default([]),
  systemContext: z.string().max(60_000).optional(),
  provider: z.string().max(60).optional(),
  model: z.string().max(128).optional(),
  apiKey: z.string().max(2_000).optional(),
  baseUrl: z.string().max(2_000).optional(),
  providerSettings: z
    .record(z.object({ enabled: z.boolean().optional(), baseUrl: z.string().max(2_000).optional() }))
    .optional(),
});

/**
 * A 400 here kills the whole build/repair run before the agent can act. Long
 * history entries, oversized diagnostics, or extra client keys must degrade
 * (clamped/dropped) instead of rejecting the request.
 */
function lenientRequestBody(raw: unknown): unknown {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return raw;
  }

  const body: Record<string, unknown> = { ...(raw as Record<string, unknown>) };

  if (typeof body.prompt === 'string') {
    body.prompt = body.prompt.trim().slice(0, 60_000);
  }

  if (typeof body.systemContext === 'string') {
    body.systemContext = body.systemContext.slice(0, 60_000);
  }

  if (Array.isArray(body.history)) {
    body.history = body.history
      .slice(-20)
      .map((entry) => {
        const role = (entry as { role?: unknown })?.role === 'assistant' ? 'assistant' : 'user';
        const content =
          typeof (entry as { content?: unknown })?.content === 'string' ? (entry as { content: string }).content : '';

        return { role, content: content.slice(0, 60_000) };
      })
      .filter((entry) => entry.content.length > 0);
  }

  if (Array.isArray(body.previewErrors)) {
    body.previewErrors = body.previewErrors.slice(-50).map((entry) => {
      const source =
        typeof (entry as { source?: unknown })?.source === 'string'
          ? (entry as { source: string }).source.slice(0, 500)
          : undefined;
      const line = (entry as { line?: unknown })?.line;
      const clean: { message: string; source?: string; line?: number } = {
        message: String((entry as { message?: unknown })?.message || '').slice(0, 2_000),
      };

      if (source) {
        clean.source = source;
      }

      if (typeof line === 'number' && Number.isInteger(line) && line > 0) {
        clean.line = line;
      }

      return clean;
    });
  }

  if (body.files && typeof body.files === 'object' && !Array.isArray(body.files)) {
    const files: Record<string, string> = {};

    for (const [path, content] of Object.entries(body.files as Record<string, unknown>)) {
      files[path] = typeof content === 'string' ? content.slice(0, 2_000_000) : '';
    }

    body.files = files;
  }

  return body;
}

const managerPlanToolSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    title: { type: 'string', minLength: 1, maxLength: 100 },
    summary: { type: 'string', minLength: 1, maxLength: 1200 },
    engine: { type: 'string', enum: ['canvas2d', 'webgl'] },
    systems: { type: 'array', minItems: 2, maxItems: 6, items: { type: 'string', minLength: 1, maxLength: 800 } },
    fileOperations: {
      type: 'array',
      minItems: 1,
      maxItems: 10,
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          path: { type: 'string', pattern: '^[A-Za-z0-9_][A-Za-z0-9_./-]{0,179}$' },
          operation: { type: 'string', enum: ['create', 'edit'] },
          purpose: { type: 'string', minLength: 1, maxLength: 800 },
        },
        required: ['path', 'operation', 'purpose'],
      },
    },
    assetOperations: {
      type: 'array',
      maxItems: 3,
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          id: { type: 'string', pattern: '^[a-z][a-z0-9._-]{0,59}$' },
          path: { type: 'string', pattern: '^assets/.+\\.png$' },
          kind: { type: 'string', enum: ['sprite', 'background', 'ui'] },
          prompt: { type: 'string', minLength: 10, maxLength: 1600 },
          width: { type: 'integer', minimum: 64, maximum: 1024, multipleOf: 32 },
          height: { type: 'integer', minimum: 64, maximum: 1024, multipleOf: 32 },
        },
        required: ['id', 'path', 'kind', 'prompt', 'width', 'height'],
      },
    },
    libraryAssets: {
      type: 'array',
      maxItems: 24,
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          id: { type: 'string', minLength: 1, maxLength: 200 },
          path: { type: 'string', pattern: '^assets/[a-zA-Z0-9_./-]+$' },
          dimension: { type: 'string', enum: ['2d', '3d', 'audio', 'font', 'data'] },
          category: { type: 'string', minLength: 1, maxLength: 40 },
          group: { type: 'array', maxItems: 24, items: { type: 'string', pattern: '^assets/' } },
        },
        required: ['id', 'path', 'dimension', 'category', 'group'],
      },
    },
    scriptOrder: {
      type: 'array',
      minItems: 1,
      maxItems: 24,
      items: { type: 'string', pattern: '^[A-Za-z0-9_][A-Za-z0-9_./-]{0,179}$' },
    },
    acceptanceCriteria: {
      type: 'array',
      minItems: 3,
      maxItems: 12,
      items: { type: 'string', minLength: 1, maxLength: 800 },
    },
  },
  required: [
    'title',
    'summary',
    'engine',
    'systems',
    'fileOperations',
    'assetOperations',
    'libraryAssets',
    'scriptOrder',
    'acceptanceCriteria',
  ],
} satisfies Record<string, unknown>;

function parseCookieMap(cookieHeader: string) {
  const cookies: Record<string, string> = {};

  for (const item of cookieHeader.split(';')) {
    const [name, ...value] = item.trim().split('=');

    if (!name || !value.length) {
      continue;
    }

    try {
      cookies[decodeURIComponent(name)] = decodeURIComponent(value.join('='));
    } catch {
      // Ignore malformed cookies.
    }
  }

  return cookies;
}

export async function action({ request, context }: ActionFunctionArgs) {
  try {
    requireSameOrigin(request);

    let body: z.infer<typeof requestSchema>;

    try {
      body = requestSchema.parse(lenientRequestBody(await request.json()));
    } catch (error) {
      if (error instanceof ZodError) {
        const detail = error.issues
          .slice(0, 8)
          .map((issue) => `${issue.path.join('.') || 'body'}: ${issue.message}`)
          .join('; ');

        return json({ error: `Invalid Cline request — ${detail}` }, { status: 400 });
      }

      throw error;
    }

    /*
     * Checkpoints can contain hidden tool files or a large dependency snapshot.
     * Never fail an otherwise usable continuation for those entries: expose only
     * safe project source paths and keep the tool context bounded.
     */
    const safeFileEntries = Object.entries(body.files)
      .filter(([path]) => isWorkspacePath(path))
      .slice(0, 500);
    body.files = Object.fromEntries(safeFileEntries);
    const paths = Object.keys(body.files);

    const readOnly = body.readOnly || body.planningOnly;
    const approvedPaths = new Set<string>();

    if (!readOnly) {
      if (!body.approvedBlueprint || !body.executionToken) {
        return json({ error: 'Cline build tools require a valid approved Bolt blueprint.' }, { status: 403 });
      }

      const approved = await verifyCapability(
        body.executionToken,
        body.approvedBlueprint,
        'execute',
        await getHarnessSecret(context.cloudflare.env),
        new URL(request.url).origin,
      );
      approved.fileOperations.forEach((operation) => {
        if (!body.phasePaths || body.phasePaths.includes(operation.path)) {
          approvedPaths.add(operation.path);
        }
      });
    }

    /*
     * Phased runs work over an intentionally incomplete workspace: their
     * in-loop gates (run_build / run_tests / finish_task) are scoped to the
     * phase's own files, and references to planned future-phase modules are
     * reported as deferred instead of unfixable blockers.
     */
    const allowedAssetPaths = new Set([
      ...(body.approvedBlueprint?.assetOperations || []).map((asset) => asset.path),
      ...(body.approvedBlueprint?.libraryAssets || []).flatMap((asset) => [asset.path, ...asset.group]),
    ]);
    const availableAssetPaths = body.availableAssetPaths.filter((path) => allowedAssetPaths.has(path));

    const phaseScope =
      !readOnly && body.phasePaths?.length && body.approvedBlueprint
        ? {
            phasePaths: body.phasePaths,
            plannedPaths: body.approvedBlueprint.fileOperations.map((operation) => operation.path),

            /*
             * Generated images live outside fileOperations. Only suppress a
             * missing-ref error when the bytes really arrived in this build's
             * workspace snapshot; a planned-but-failed asset is still an error.
             */
            plannedAssetPaths: availableAssetPaths,
          }
        : undefined;

    /*
     * Planning-only runs get a request-specific, bounded shortlist from the
     * server-side catalogue. No catalogue bytes or Appwrite credentials enter
     * the browser or model context.
     */
    let libraryCandidateBriefing = '';

    /*
     * Appwrite-backed library candidates are intentionally disabled. 2D imagery
     * is generated through FLUX.2-pro, so planning no longer benefits from the
     * external asset shortlist.
     */
    libraryCandidateBriefing = '';

    const cookies = parseCookieMap(request.headers.get('Cookie') || '');
    const apiKeys = JSON.parse(cookies.apiKeys || '{}') as Record<string, string>;
    const providerSettings =
      body.providerSettings || (JSON.parse(cookies.providers || '{}') as Record<string, IProviderSetting>);
    const provider = body.provider || DEFAULT_PROVIDER.name;

    if (body.apiKey) {
      apiKeys[provider] = body.apiKey;
    }

    if (body.baseUrl) {
      providerSettings[provider] = { ...providerSettings[provider], baseUrl: body.baseUrl };
    }

    const boltModel = getModel(
      provider,
      body.model || DEFAULT_MODEL,
      context.cloudflare.env,
      apiKeys,
      providerSettings,
    );

    /*
     * Size each turn to the model's real output ceiling (Fortz models: 32768)
     * so big files are written whole instead of truncated mid-file. Catalog
     * entries reporting <= 8000 carry the default placeholder rather than a
     * real output cap (nearly every dynamic provider hardcodes 8000, and the
     * model a user actually picked often is not in the catalog at all), so
     * they count as unknown: start at the full turn budget and let the model
     * adapter walk down only when the provider actually rejects the size.
     */
    let turnCap = CLINE_TURN_MAX_TOKENS;

    try {
      const modelList = await getModelList(apiKeys, providerSettings);

      const listed = modelList.find((entry) => entry.name === (body.model || DEFAULT_MODEL));

      if (listed && Number.isFinite(listed.maxTokenAllowed) && listed.maxTokenAllowed > 8000) {
        turnCap = Math.min(CLINE_TURN_MAX_TOKENS, Math.floor(listed.maxTokenAllowed));
      }
    } catch {
      // Model catalog unreachable; keep the full turn budget.
    }

    const agentModel = createBoltAgentModel(boltModel, turnCap);
    const workingFiles = { ...body.files };
    const encoder = new TextEncoder();
    let activeAgent: Agent | undefined;
    let requestAbortHandler: (() => void) | undefined;
    let keepAliveTimer: ReturnType<typeof setInterval> | undefined;

    const responseStream = new ReadableStream<Uint8Array>({
      start(controller) {
        const send = (type: string, payload: unknown) => {
          try {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type, payload })}\n\n`));
          } catch {
            // Client closed stream; cancellation aborts the model/tool loop.
          }
        };

        /*
         * First byte + periodic pings: long model/tool turns must never leave
         * the connection silent, or the Cloudflare → Pages gateway times the
         * request out with a 504 before any event arrives.
         */
        send('status', { message: 'Cline session starting…' });
        keepAliveTimer = setInterval(() => send('ping', {}), 15_000);

        requestAbortHandler = () => activeAgent?.abort('Bolt client disconnected');
        request.signal.addEventListener('abort', requestAbortHandler, { once: true });

        void (async () => {
          let unsubscribe: (() => void) | undefined;
          let submittedPlan: z.infer<typeof managerBlueprintSchema> | undefined;
          let submittedQuestions:
            | Array<{ question: string; options: Array<{ label: string; description?: string }> }>
            | undefined;

          try {
            const readFile = createTool({
              name: 'read_file',
              description: 'Read a current text file from the Bolt project workspace.',
              inputSchema: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] },
              execute: async ({ path }: { path: string }) => {
                const safePath = String(path || '').replace(/^\.?\//, '');

                if (!isWorkspacePath(safePath)) {
                  return { error: 'Unsafe project path.' };
                }

                return workingFiles[safePath] === undefined
                  ? { error: `File not found: ${safePath}`, availableFiles: Object.keys(workingFiles) }
                  : { path: safePath, content: workingFiles[safePath] };
              },
            });

            const writeFile = createTool({
              name: 'write_file',
              description:
                'Create a new file, or overwrite a file ONLY with its COMPLETE new content (every existing function and constant kept, plus changes). Never emit a partial rewrite — for small changes call edit_file instead.',
              inputSchema: {
                type: 'object',
                properties: { path: { type: 'string' }, content: { type: 'string' } },
                required: ['path', 'content'],
              },
              execute: async ({ path, content }: { path: string; content: string }) => {
                const safePath = String(path || '').replace(/^\.?\//, '');

                if (!isWorkspacePath(safePath)) {
                  return { error: 'Unsafe project path.' };
                }

                if (readOnly || !approvedPaths.has(safePath)) {
                  return { error: `Write blocked: ${safePath} is not approved.` };
                }

                if (content.length > 2_000_000) {
                  return { error: 'File exceeds the 2 MB limit.' };
                }

                const total = Object.entries(workingFiles).reduce(
                  (sum, [existingPath, value]) => sum + (existingPath === safePath ? 0 : value.length),
                  content.length,
                );

                if (total > 7_500_000) {
                  return { error: 'Project text exceeds the 7.5 MB session limit.' };
                }

                workingFiles[safePath] = content;
                send('file_write', { path: safePath, content });
                send('status', { message: `Writing ${safePath}…` });

                return { success: true, path: safePath, chars: content.length };
              },
            });

            const editFile = createTool({
              name: 'edit_file',
              description: 'Replace a precise string in an approved Bolt project file.',
              inputSchema: {
                type: 'object',
                properties: {
                  path: { type: 'string' },
                  targetContent: { type: 'string' },
                  replacementContent: { type: 'string' },
                },
                required: ['path', 'targetContent', 'replacementContent'],
              },
              execute: async ({
                path,
                targetContent,
                replacementContent,
              }: {
                path: string;
                targetContent: string;
                replacementContent: string;
              }) => {
                const safePath = String(path || '').replace(/^\.?\//, '');

                if (!isWorkspacePath(safePath)) {
                  return { error: 'Unsafe project path.' };
                }

                if (readOnly || !approvedPaths.has(safePath)) {
                  return { error: `Edit blocked: ${safePath} is not approved.` };
                }

                const current = workingFiles[safePath];

                if (current === undefined) {
                  return { error: `File not found: ${safePath}` };
                }

                if (!current.includes(targetContent)) {
                  return { error: `Target content not found in ${safePath}.` };
                }

                const updated = current.replace(targetContent, replacementContent);

                if (updated.length > 2_000_000) {
                  return { error: 'File exceeds the 2 MB limit.' };
                }

                workingFiles[safePath] = updated;
                send('file_write', { path: safePath, content: updated });

                return { success: true, path: safePath };
              },
            });

            const listFiles = createTool({
              name: 'list_files',
              description: 'List files in the current Bolt workspace snapshot.',
              inputSchema: { type: 'object', properties: {} },
              execute: async () => ({
                files: Object.entries(workingFiles).map(([path, content]) => ({ path, chars: content.length })),
              }),
            });

            const searchCode = createTool({
              name: 'search_code',
              description: 'Search current workspace files and return matching lines.',
              inputSchema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
              execute: async ({ query }: { query: string }) => {
                const needle = String(query || '').toLowerCase();
                const matches: Array<{ path: string; line: number; text: string }> = [];

                for (const [path, content] of Object.entries(workingFiles)) {
                  content.split('\n').forEach((line, index) => {
                    if (line.toLowerCase().includes(needle) && matches.length < 100) {
                      matches.push({ path, line: index + 1, text: line.slice(0, 240) });
                    }
                  });
                }

                return { matches };
              },
            });

            const inspectProject = createTool({
              name: 'inspect_project',
              description: 'Inspect the game entry point and referenced local scripts/styles.',
              inputSchema: { type: 'object', properties: {} },
              execute: async () => {
                const html = workingFiles['index.html'] || '';
                const fileList = Object.entries(workingFiles).map(([path, content]) => ({ path, content }));
                const references = [
                  ...html.matchAll(/<(?:script|link)\b[^>]*(?:src|href)=["']([^"']+)["'][^>]*>/gi),
                ].map((match) => match[1]);

                return {
                  hasIndexHtml: Boolean(html),
                  references,
                  missingReferences: references.filter(
                    (path) =>
                      !/^https?:\/\//i.test(path) &&
                      !path.startsWith('data:') &&
                      !resolveStaticPreviewFileLoose(fileList, path),
                  ),
                  files: Object.keys(workingFiles),
                };
              },
            });

            const runBuild = createTool({
              name: 'run_build',
              description:
                'Run the real Bolt wiring/syntax/module-graph checks used before preview. Fix every reported issue before finish_task.',
              inputSchema: { type: 'object', properties: {} },
              execute: async () => {
                send('status', { message: 'Running Bolt build / module-graph checks…' });
                return runAgentBuildCheck(workingFiles, phaseScope);
              },
            });

            const runTests = createTool({
              name: 'run_tests',
              description:
                'Run gameplay-contract and static quality checks (loop, input, diagnostics, polish). Must pass before finish_task.',
              inputSchema: { type: 'object', properties: {} },
              execute: async () => {
                send('status', { message: 'Checking gameplay contracts and quality…' });

                const gameplay = runAgentGameplayCheck(workingFiles, phaseScope);
                const quality = runAgentQualityCheck(workingFiles, phaseScope);
                const tests = [...(gameplay.tests || []), ...(quality.tests || [])];
                const issues = [...gameplay.issues, ...quality.issues];

                return {
                  success: gameplay.success && quality.success,
                  passed: gameplay.success && quality.success,
                  issues,
                  tests,
                  note: 'Gameplay + static quality gates. Bolt still runs a live preview probe after finish_task.',
                };
              },
            });

            const inspectErrors = createTool({
              name: 'inspect_errors',
              description: 'Inspect actual recent Bolt preview/build errors supplied with this run.',
              inputSchema: { type: 'object', properties: {} },
              execute: async () => ({
                hasErrors: body.previewErrors.length > 0,
                errors: body.previewErrors.slice(-10),
              }),
            });

            const finishTask = createTool({
              name: 'finish_task',
              description:
                'Finish only after run_build and run_tests both succeed. Throws if checks still fail so the run continues repairing.',
              inputSchema: {
                type: 'object',
                properties: {
                  summary: { type: 'string' },
                  controls: { type: 'string' },
                  features: { type: 'array', items: { type: 'string' } },
                },
                required: ['summary'],
              },
              lifecycle: { completesRun: true },
              execute: async (value: { summary: string; controls?: string; features?: string[] }) => {
                if (!body.readOnly) {
                  const build = runAgentBuildCheck(workingFiles, phaseScope);
                  const gameplay = runAgentGameplayCheck(workingFiles, phaseScope);
                  const quality = runAgentQualityCheck(workingFiles, phaseScope);
                  const issues = [...build.issues, ...gameplay.issues, ...quality.issues];

                  if (issues.length > 0) {
                    throw new Error(`finish_task blocked — fix these checks first:\n${issues.slice(0, 20).join('\n')}`);
                  }
                }

                send('task_complete', value);

                return value;
              },
            });

            const submitPlan = createTool({
              name: 'submit_plan',
              description:
                'Submit a focused game implementation plan (8-10 files, 4-6 systems, genre-derived architecture) and finish this planning-only run. Do not claim files were changed.',
              inputSchema: managerPlanToolSchema,
              lifecycle: { completesRun: true },
              execute: async (plan: z.infer<typeof managerBlueprintSchema>) => {
                submittedPlan = managerBlueprintSchema.parse(plan);
                send('plan_ready', { plan: submittedPlan });

                return { success: true, plan: submittedPlan };
              },
            });

            const askQuestions = createTool({
              name: 'ask_questions',
              description:
                'Ask 2-3 concise, choice-based questions only when the initial game request is genuinely ambiguous. Use this before submitting a plan, then stop and wait for the user. Never ask more than three rounds.',
              inputSchema: {
                type: 'object',
                additionalProperties: false,
                properties: {
                  questions: {
                    type: 'array',
                    minItems: 2,
                    maxItems: 3,
                    items: {
                      type: 'object',
                      additionalProperties: false,
                      properties: {
                        question: { type: 'string', minLength: 8, maxLength: 220 },
                        options: {
                          type: 'array',
                          minItems: 2,
                          maxItems: 4,
                          items: {
                            type: 'object',
                            additionalProperties: false,
                            properties: {
                              label: { type: 'string', minLength: 1, maxLength: 60 },
                              description: { type: 'string', maxLength: 100 },
                            },
                            required: ['label'],
                          },
                        },
                      },
                      required: ['question', 'options'],
                    },
                  },
                },
                required: ['questions'],
              },
              lifecycle: { completesRun: true },
              execute: async (value: {
                questions: Array<{ question: string; options: Array<{ label: string; description?: string }> }>;
              }) => {
                submittedQuestions = value.questions.slice(0, 3).map((entry) => ({
                  question: String(entry.question).slice(0, 220),
                  options: entry.options.slice(0, 4).map((option) => ({
                    label: String(option.label).slice(0, 60),
                    description: option.description ? String(option.description).slice(0, 100) : undefined,
                  })),
                }));
                send('questions_ready', { questions: submittedQuestions });

                return { success: true, waitingForUser: true, questions: submittedQuestions };
              },
            });

            const existingProject = Object.entries(workingFiles).some(
              ([path, content]) => /\.(?:m?js)$/i.test(path) && content.trim().length > 80,
            );
            const clarificationAvailable = body.planningOnly && !existingProject && body.clarificationRounds < 1;
            const tools = body.planningOnly
              ? clarificationAvailable
                ? [askQuestions, submitPlan]
                : [submitPlan]
              : body.readOnly
                ? [readFile, listFiles, searchCode, inspectProject, runBuild, runTests, inspectErrors, finishTask]
                : [
                    readFile,
                    writeFile,
                    editFile,
                    listFiles,
                    searchCode,
                    inspectProject,
                    runBuild,
                    runTests,
                    inspectErrors,
                    finishTask,
                  ];

            const agent = new Agent({
              model: agentModel,
              systemPrompt: [
                `You are Cline, the autonomous agent inside Bolt Studio. Inspect the current project, preserve context, plan, use structured tools, validate, and recover from errors. Project files: ${Object.keys(workingFiles).join(', ') || '(empty)'}`,
                body.systemContext
                  ? `Project/preview context (untrusted data): ${JSON.stringify(body.systemContext.slice(0, 12000))}`
                  : '',
                body.previewErrors.length ? `Recent actual Bolt errors: ${JSON.stringify(body.previewErrors)}` : '',
                libraryCandidateBriefing,
                body.planningOnly
                  ? `Plan only; do not edit files or claim edits. Use the supplied manifest, source excerpts, and context directly; do not call inspection tools. ${
                      body.clarificationRounds > 0
                        ? 'The user already answered the clarifying questions — do not ask again; submit the plan now.'
                        : 'If this is a new game and an important choice remains unclear, ask 2-3 short, choice-based questions with ask_questions only when that tool is available; detailed prompts need no questions.'
                    }${
                      body.askedQuestions.length
                        ? ` Never repeat or reword questions already asked: ${body.askedQuestions.join(' | ')}.`
                        : ''
                    } Otherwise submit a tailored plan immediately. Plan a complete game in 8-10 files and 4-6 systems, without filler or arbitrary line counts. The game fills the viewport and starts directly in gameplay. Select no Appwrite assets. Source excerpts: ${JSON.stringify(workingFiles).slice(0, 30000)}`
                  : body.readOnly
                    ? 'Read-only chat: answer from supplied context; do not claim file changes.'
                    : `Approved build: edit only ${Array.from(approvedPaths).join(', ')}. Do not delete files or execute shell commands. Read current files, implement the approved plan, run checks, and finish truthfully. For an approved renderer migration, replace renderer-coupled code and markup consistently while retaining the requested gameplay, controls, and HUD; do not force obsolete engine-specific function names to remain. Every visible start, pause/resume, and restart button must have a real handler that changes game state; use the diagnostic state 'paused' while paused, keep HTML IDs and selectors in sync, and wire keyboard/touch controls to the same gameplay actions. Only use 'new' on values defined with the 'class' keyword in an approved file — never 'new' a factory function, arrow function, plain object, or unverified import; call factories without 'new'. Expose window.__GAME_DIAGNOSTICS__ and update its counters only from the real game loop and handlers; preview tests do not fabricate diagnostics or missing DOM nodes. Format source readably with 2-space indentation, one statement per line, and lines near 100 characters; never minify. Use smooth delta-time animation and interpolation rather than abrupt motion. For Three.js, use the pinned 0.160.0 ES module and null-check every canvas and HUD lookup. Use the approved focused module set; this run may cover one phase — write every approved path completely, wire files as they land, and never truncate. The game fills the entire viewport at all times: full-window canvas that resizes with the window, gameplay only with no text-heavy screens, and a start overlay solely for audio unlock whose handler directly starts the real game. Before finish_task, call run_build and run_tests (they run the real module-graph, syntax, gameplay, and quality gates), repair every reported failure in the approved files, and re-check until they pass — never finish with failing checks or truncated files. Call inspect_project as well: every local stylesheet, script, and import must resolve to a real approved file — fix folder mistakes (src/ versus root) by correcting the path to the real file, never by deleting the reference. The images listed under APPROVED IMAGES already exist at exactly those paths: load them as-is and never delete or rename those references. Bolt will run actual preview validation and send repair errors in a follow-up run.`,
                !body.planningOnly && !body.readOnly
                  ? 'Repair discipline: inspect the actual diagnostic and named source before editing, state the cause briefly, make the smallest fix, then rerun checks. For `SyntaxError: Identifier X has already been declared`, search all declarations/imports of X and index.html script tags; remove the duplicate or keep one canonical owner. Never paper over the error with a renamed unrelated function. If the same diagnostic repeats, inspect the real files and pivot strategy.'
                  : '',
                'Module wiring (MANDATORY): shared ES-module symbols use top-level named exports. Load modules through one entry point; never include the same module as an extra classic script tag, and never redeclare a top-level binding. Cross-check imports against real exports. No external packages or network backends — the game must run fully offline.',
                !body.planningOnly && !body.readOnly
                  ? 'Audio (SAFE): Prefer procedural Web Audio (AudioContext oscillators + gain envelopes) unlocked on a user gesture. Never fetch remote audio files. Wrap AudioContext creation in try/catch and degrade silently if unavailable. Do not let audio throw and break gameplay.'
                  : '',
              ]
                .filter(Boolean)
                .join('\n\n'),
              tools,
              completionPolicy: { requireCompletionTool: true },
              initialMessages: body.history.slice(-20).map((message, index) => ({
                id: `bolt-history-${index}`,
                role: message.role,
                content: [{ type: 'text' as const, text: message.content }],
                createdAt: Date.now() - (body.history.length - index) * 1000,
              })),

              // Phased builds need enough file-writing turns to complete the approved module set.
              maxIterations: 56,
            });
            activeAgent = agent;

            unsubscribe = agent.subscribe((event: any) => {
              if (event.type === 'assistant-text-delta') {
                send('text', { chunk: event.text, accumulated: event.accumulatedText });
              } else if (event.type === 'assistant-reasoning-delta') {
                send('reasoning', { status: 'Planning the next step…' });
              } else if (event.type === 'tool-started') {
                send('tool_start', {
                  tool: event.toolCall.toolName,
                  input: event.toolCall.input,
                  toolCallId: event.toolCall.toolCallId,
                  startTime: Date.now(),
                });
              } else if (event.type === 'tool-finished') {
                send('tool_end', { tool: event.toolCall.toolName, toolCallId: event.toolCall.toolCallId });
              } else if (event.type === 'usage-updated') {
                send('usage', event.usage);
              } else if (event.type === 'status-notice') {
                send('status', { message: event.message });
              }
            });

            const result = await agent.run(body.prompt);

            if (result.status === 'failed' || result.status === 'aborted') {
              send('fatal_error', {
                error:
                  result.error?.message ||
                  (result.status === 'aborted' ? 'Cline Agent run was aborted.' : 'Cline Agent run failed.'),
              });
            } else {
              send('result', {
                summary: result.outputText,
                plan: submittedPlan,
                questions: submittedQuestions,
                filesTouched: Object.keys(workingFiles).filter((path) => workingFiles[path] !== body.files[path]),
                usage: result.usage,
                status: result.status,
              });
            }
          } catch (error) {
            /*
             * Always emit a terminal SSE event before [DONE]. Otherwise the
             * client throws "stream ended without a result" on proxy cuts and
             * uncaught agent exceptions.
             */
            send('fatal_error', { error: error instanceof Error ? error.message : 'Cline Agent failed.' });
          } finally {
            unsubscribe?.();

            if (keepAliveTimer) {
              clearInterval(keepAliveTimer);
            }

            if (requestAbortHandler) {
              request.signal.removeEventListener('abort', requestAbortHandler);
            }

            try {
              controller.enqueue(encoder.encode('data: [DONE]\n\n'));
              controller.close();
            } catch {
              // Client already closed the stream.
            }
          }
        })();
      },
      cancel() {
        if (keepAliveTimer) {
          clearInterval(keepAliveTimer);
        }

        activeAgent?.abort('Bolt client cancelled the run');
      },
    });

    return new Response(responseStream, {
      headers: {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        'X-Accel-Buffering': 'no',
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Cline request failed.';
    const status = message.includes('same studio origin') ? 403 : 400;

    return json({ error: message }, { status });
  }
}
