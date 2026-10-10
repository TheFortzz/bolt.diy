import { Agent, createTool } from '@cline/agents';
import { json, type ActionFunctionArgs } from '@remix-run/cloudflare';
import { z, ZodError } from 'zod';
import { getModel } from '~/lib/.server/llm/model';
import { CLINE_TURN_MAX_TOKENS, createBoltAgentModel } from '~/lib/.server/bolt-agent-model';
import { getHarnessSecret, requireSameOrigin, verifyCapability } from '~/lib/.server/harness/capabilities';
import { blueprintSchema, isWorkspacePath, managerBlueprintSchema } from '~/lib/harness/blueprint';
import {
  runAgentBuildCheck,
  runAgentGameplayCheck,
  runAgentQualityCheck,
} from '~/lib/runtime/agent-project-checks';
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
   * Big 12-24-file blueprints and full workspace excerpts exceed the old
   * 12-20k ceilings; rejecting them 400s the run before planning starts.
   */
  prompt: z.string().trim().min(1).max(60_000),
  files: fileMapSchema,
  readOnly: z.boolean().default(false),
  planningOnly: z.boolean().default(false),
  approvedBlueprint: blueprintSchema.optional(),
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
    systems: { type: 'array', minItems: 2, maxItems: 12, items: { type: 'string', minLength: 1, maxLength: 800 } },
    fileOperations: {
      type: 'array',
      minItems: 1,
      maxItems: 24,
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
      maxItems: 4,
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

    const paths = Object.keys(body.files);

    if (paths.length > 500 || paths.some((path) => !isWorkspacePath(path))) {
      return json({ error: 'Workspace snapshot contains too many files or unsafe paths.' }, { status: 400 });
    }

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
      approved.fileOperations.forEach((operation) => approvedPaths.add(operation.path));
    }

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
     * so big files are written whole instead of truncated mid-file. Unknown or
     * small models keep the safe 8000-token turn budget.
     */
    let turnCap = 8000;

    try {
      const modelList = await getModelList(apiKeys, providerSettings);

      const listed = modelList.find((entry) => entry.name === (body.model || DEFAULT_MODEL));

      if (listed && Number.isFinite(listed.maxTokenAllowed) && listed.maxTokenAllowed > 0) {
        turnCap = Math.min(CLINE_TURN_MAX_TOKENS, Math.floor(listed.maxTokenAllowed));
      }
    } catch {
      // Model catalog unreachable; keep the safe default turn budget.
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
                return runAgentBuildCheck(workingFiles);
              },
            });

            const runTests = createTool({
              name: 'run_tests',
              description:
                'Run gameplay-contract and static quality checks (loop, input, diagnostics, polish). Must pass before finish_task.',
              inputSchema: { type: 'object', properties: {} },
              execute: async () => {
                send('status', { message: 'Checking gameplay contracts and quality…' });

                const gameplay = runAgentGameplayCheck(workingFiles);
                const quality = runAgentQualityCheck(workingFiles);
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
                  const build = runAgentBuildCheck(workingFiles);
                  const gameplay = runAgentGameplayCheck(workingFiles);
                  const quality = runAgentQualityCheck(workingFiles);
                  const issues = [...build.issues, ...gameplay.issues, ...quality.issues];

                  if (issues.length > 0) {
                    throw new Error(
                      `finish_task blocked — fix these checks first:\n${issues.slice(0, 20).join('\n')}`,
                    );
                  }
                }

                send('task_complete', value);
                return value;
              },
            });

            const submitPlan = createTool({
              name: 'submit_plan',
              description:
                'Submit the structured game implementation plan (12-24 files, 6-10 systems, genre-derived architecture — never a 3-file repeat) and finish this planning-only run. Do not claim files were changed.',
              inputSchema: managerPlanToolSchema,
              lifecycle: { completesRun: true },
              execute: async (plan: z.infer<typeof managerBlueprintSchema>) => {
                submittedPlan = managerBlueprintSchema.parse(plan);
                send('plan_ready', { plan: submittedPlan });

                return { success: true, plan: submittedPlan };
              },
            });

            const tools = body.planningOnly
              ? [submitPlan]
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
                body.planningOnly
                  ? `Plan only; do not edit files or claim edits. Use the supplied manifest, source excerpts, and context directly; do not call inspection tools. In this turn, call submit_plan with a tailored structured plan. Do not return a plan as free-form text. Plan BIG and ORIGINAL: 12-24 files and 6-10 connected systems totaling at minimum 10,000 lines of complete code, with module names and architecture derived from THIS request only — never the same index/style/main/game/input/audio skeleton twice. The game fills the entire viewport (full-window canvas, resizes with the window); no login, lobby, branding, or text-heavy screens — gameplay only, playable instantly. Source excerpts: ${JSON.stringify(workingFiles).slice(0, 30000)}`
                  : body.readOnly
                    ? 'Read-only chat: answer from supplied context; do not claim file changes.'
                    : `Approved build: edit only ${Array.from(approvedPaths).join(', ')}. Do not delete files or execute shell commands. Read current files, implement the approved plan, run checks, and finish truthfully. For an approved renderer migration, replace renderer-coupled code and markup consistently while retaining the requested gameplay, controls, and HUD; do not force obsolete engine-specific function names to remain. Every visible start, pause/resume, and restart button must have a real handler that changes game state; use the diagnostic state 'paused' while paused, keep HTML IDs and selectors in sync, and wire keyboard/touch controls to the same gameplay actions. Only use 'new' on values defined with the 'class' keyword in an approved file — never 'new' a factory function, arrow function, plain object, or unverified import; call factories without 'new'. Expose window.__GAME_DIAGNOSTICS__ and update its counters only from the real game loop and handlers; preview tests do not fabricate diagnostics or missing DOM nodes. Format source readably with 2-space indentation, one statement per line, and lines near 100 characters; never minify. Use smooth delta-time animation and interpolation rather than abrupt motion. For Three.js, use the pinned 0.160.0 ES module and null-check every canvas and HUD lookup. Full-game builds ship at minimum 10,000 lines of complete working code across 12-24 focused modules: write files in sequence across turns, complete every file fully in its own write, and never truncate. The game fills the entire viewport at all times: full-window canvas that resizes with the window, gameplay only with no text-heavy screens, and a start overlay solely for audio unlock whose handler directly starts the real game. Before finish_task, call run_build and run_tests (they run the real module-graph, syntax, gameplay, and quality gates), repair every reported failure in the approved files, and re-check until they pass — never finish with failing checks or truncated files. Call inspect_project as well: every local stylesheet, script, import, and asset reference must resolve to a real approved file — fix folder mistakes (src/ versus root) by correcting the path to the real file, never by deleting the reference. Bolt will run actual preview validation and send repair errors in a follow-up run.`,
                !body.planningOnly && !body.readOnly
                  ? 'Repair discipline: before editing anything, inspect the actual diagnostic (inspect_errors / read_file), quote the exact error, name the root cause in one sentence, apply the SMALLEST fix, and re-run the checks. Never edit on a guess. If the same diagnostic appears again after a fix, that approach failed — do not vary it: re-read the real file contents and rewrite the broken section with a fundamentally different strategy.'
                  : '',
                'Module wiring (MANDATORY): declare every shared symbol at TOP LEVEL with `export function name(…)` / `export const name = …`. Never hide declarations inside an IIFE, closure, or object facade — a named import only resolves to module-scope bindings. Never use `export default` for symbols other files import by name. Cross-check each named import against the target file’s actual top-level exports before finishing; a missing top-level export is a build-breaking bug. No external packages or network backends — the game must run fully offline.',
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

              // Big full-game builds need many file-writing turns; 18 steps starves 12-24 file projects.
              maxIterations: 32,
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
