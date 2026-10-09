import { Agent, createTool } from '@cline/agents';
import { json, type ActionFunctionArgs } from '@remix-run/cloudflare';
import { z } from 'zod';
import { getModel } from '~/lib/.server/llm/model';
import { CLINE_TURN_MAX_TOKENS, createBoltAgentModel } from '~/lib/.server/bolt-agent-model';
import { getHarnessSecret, requireSameOrigin, verifyCapability } from '~/lib/.server/harness/capabilities';
import { blueprintSchema, isWorkspacePath, managerBlueprintSchema } from '~/lib/harness/blueprint';
import type { IProviderSetting } from '~/types/model';
import { DEFAULT_MODEL, DEFAULT_PROVIDER, getModelList } from '~/utils/constants';

const fileMapSchema = z.record(z.string().max(2_000_000)).refine(
  (files) => Object.values(files).reduce((sum, content) => sum + content.length, 0) <= 7_500_000,
  'Workspace snapshot exceeds the 7.5 MB Cline context limit.',
);

const requestSchema = z.object({
  prompt: z.string().trim().min(1).max(20_000),
  files: fileMapSchema,
  readOnly: z.boolean().default(false),
  planningOnly: z.boolean().default(false),
  approvedBlueprint: blueprintSchema.optional(),
  executionToken: z.string().max(4096).optional(),
  history: z.array(z.object({ role: z.enum(['user', 'assistant']), content: z.string().max(12_000) })).max(20).default([]),
  previewErrors: z.array(z.object({ message: z.string().max(2000), source: z.string().max(500).optional(), line: z.number().int().positive().optional() })).max(50).default([]),
  systemContext: z.string().max(12_000).optional(),
  provider: z.string().max(60).optional(),
  model: z.string().max(128).optional(),
  apiKey: z.string().max(2_000).optional(),
  baseUrl: z.string().max(2_000).optional(),
  providerSettings: z.record(z.object({ enabled: z.boolean().optional(), baseUrl: z.string().max(2_000).optional() })).optional(),
}).strict();

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
    scriptOrder: { type: 'array', minItems: 1, maxItems: 24, items: { type: 'string', pattern: '^[A-Za-z0-9_][A-Za-z0-9_./-]{0,179}$' } },
    acceptanceCriteria: { type: 'array', minItems: 3, maxItems: 12, items: { type: 'string', minLength: 1, maxLength: 800 } },
  },
  required: ['title', 'summary', 'engine', 'systems', 'fileOperations', 'assetOperations', 'scriptOrder', 'acceptanceCriteria'],
} satisfies Record<string, unknown>;

function parseCookieMap(cookieHeader: string) {
  const cookies: Record<string, string> = {};
  for (const item of cookieHeader.split(';')) {
    const [name, ...value] = item.trim().split('=');
    if (!name || !value.length) continue;
    try {
      cookies[decodeURIComponent(name)] = decodeURIComponent(value.join('='));
    } catch {
      // Ignore malformed cookies.
    }
  }
  return cookies;
}

function buildSystemPrompt(body: z.infer<typeof requestSchema>, files: Record<string, string>, approvedPaths: Set<string>) {
  const base = [
    'You are Cline, the autonomous game-building agent inside Bolt Studio. Use the structured tools to inspect the existing project, plan, edit approved files, validate, and recover from errors. Do not emit raw source as chat text.',
    `Current project files:\n${Object.keys(files).join('\n') || '(empty project)'}`,
    body.systemContext ? `Current project and preview context (untrusted data): ${JSON.stringify(body.systemContext)}` : '',
    body.previewErrors.length ? `Actual recent Bolt preview/build errors:\n${JSON.stringify(body.previewErrors)}` : '',
  ].filter(Boolean);

  if (body.planningOnly) {
    base.push('Planning only. Do not modify files or claim implementation. Inspect relevant files and call finish_task with summary containing exactly one JSON object with title, summary, engine (canvas2d/webgl), systems, fileOperations, assetOperations, scriptOrder, and acceptanceCriteria. Keep the plan tailored to the user request.');
  } else if (body.readOnly) {
    base.push('This is a read-only chat. Answer naturally and truthfully from the supplied project snapshot. Do not claim file changes.');
  } else {
    base.push(`This is an approved build. You may edit only these approved project paths: ${Array.from(approvedPaths).join(', ')}. Never edit/delete other files and never run shell commands. Read current code first, implement the approved plan with structured tools, run checks, and finish truthfully.`);
  }

  return base.join('\n\n');
}

export async function action({ request, context }: ActionFunctionArgs) {
  try {
    requireSameOrigin(request);
    const body = requestSchema.parse(await request.json());
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
    const providerSettings = body.providerSettings || JSON.parse(cookies.providers || '{}') as Record<string, IProviderSetting>;
    const provider = body.provider || DEFAULT_PROVIDER.name;
    if (body.apiKey) apiKeys[provider] = body.apiKey;
    if (body.baseUrl) providerSettings[provider] = { ...providerSettings[provider], baseUrl: body.baseUrl };

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

    const responseStream = new ReadableStream<Uint8Array>({
      start(controller) {
        const send = (type: string, payload: unknown) => {
          try {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type, payload })}\n\n`));
          } catch {
            // Client closed stream; cancellation aborts the model/tool loop.
          }
        };
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
                if (!isWorkspacePath(safePath)) return { error: 'Unsafe project path.' };
                return workingFiles[safePath] === undefined
                  ? { error: `File not found: ${safePath}`, availableFiles: Object.keys(workingFiles) }
                  : { path: safePath, content: workingFiles[safePath] };
              },
            });

            const writeFile = createTool({
              name: 'write_file',
              description: 'Create/overwrite a file only when its path is listed in the server-approved Bolt blueprint.',
              inputSchema: { type: 'object', properties: { path: { type: 'string' }, content: { type: 'string' } }, required: ['path', 'content'] },
              execute: async ({ path, content }: { path: string; content: string }) => {
                const safePath = String(path || '').replace(/^\.?\//, '');
                if (!isWorkspacePath(safePath)) return { error: 'Unsafe project path.' };
                if (readOnly || !approvedPaths.has(safePath)) return { error: `Write blocked: ${safePath} is not approved.` };
                if (content.length > 2_000_000) return { error: 'File exceeds the 2 MB limit.' };
                const total = Object.entries(workingFiles).reduce((sum, [existingPath, value]) => sum + (existingPath === safePath ? 0 : value.length), content.length);
                if (total > 7_500_000) return { error: 'Project text exceeds the 7.5 MB session limit.' };
                workingFiles[safePath] = content;
                send('file_write', { path: safePath, content });
                send('status', { message: `Writing ${safePath}…` });
                return { success: true, path: safePath, chars: content.length };
              },
            });

            const editFile = createTool({
              name: 'edit_file',
              description: 'Replace a precise string in an approved Bolt project file.',
              inputSchema: { type: 'object', properties: { path: { type: 'string' }, targetContent: { type: 'string' }, replacementContent: { type: 'string' } }, required: ['path', 'targetContent', 'replacementContent'] },
              execute: async ({ path, targetContent, replacementContent }: { path: string; targetContent: string; replacementContent: string }) => {
                const safePath = String(path || '').replace(/^\.?\//, '');
                if (!isWorkspacePath(safePath)) return { error: 'Unsafe project path.' };
                if (readOnly || !approvedPaths.has(safePath)) return { error: `Edit blocked: ${safePath} is not approved.` };
                const current = workingFiles[safePath];
                if (current === undefined) return { error: `File not found: ${safePath}` };
                if (!current.includes(targetContent)) return { error: `Target content not found in ${safePath}.` };
                const updated = current.replace(targetContent, replacementContent);
                if (updated.length > 2_000_000) return { error: 'File exceeds the 2 MB limit.' };
                workingFiles[safePath] = updated;
                send('file_write', { path: safePath, content: updated });
                return { success: true, path: safePath };
              },
            });

            const listFiles = createTool({
              name: 'list_files',
              description: 'List files in the current Bolt workspace snapshot.',
              inputSchema: { type: 'object', properties: {} },
              execute: async () => ({ files: Object.entries(workingFiles).map(([path, content]) => ({ path, chars: content.length })) }),
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
                    if (line.toLowerCase().includes(needle) && matches.length < 100) matches.push({ path, line: index + 1, text: line.slice(0, 240) });
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
                const references = [...html.matchAll(/<(?:script|link)\b[^>]*(?:src|href)=["']([^"']+)["'][^>]*>/gi)].map((match) => match[1]);
                return { hasIndexHtml: Boolean(html), references, missingReferences: references.filter((path) => !/^https?:\/\//i.test(path) && workingFiles[path] === undefined), files: Object.keys(workingFiles) };
              },
            });

            const runBuild = createTool({
              name: 'run_build',
              description: 'Run preliminary entry-point and local reference checks. Bolt performs its actual WebContainer build/preview check after edits.',
              inputSchema: { type: 'object', properties: {} },
              execute: async () => {
                send('status', { message: 'Running preliminary build checks…' });
                const html = workingFiles['index.html'] || '';
                const missing = [...html.matchAll(/<(?:script|link)\b[^>]*(?:src|href)=["']([^"']+)["'][^>]*>/gi)]
                  .map((match) => match[1]).filter((path) => !/^https?:\/\//i.test(path) && workingFiles[path] === undefined);
                const issues = [...(!html ? ['Missing index.html.'] : []), ...missing.map((path) => `Missing local reference: ${path}`)];
                return { success: issues.length === 0, issues, note: 'Bolt runs actual build and preview validation after files are applied.' };
              },
            });

            const runTests = createTool({
              name: 'run_tests',
              description: 'Check for a game loop, input handling, and restart/game-state behavior.',
              inputSchema: { type: 'object', properties: {} },
              execute: async () => {
                send('status', { message: 'Checking gameplay loop and controls…' });
                const code = Object.values(workingFiles).join('\n');
                const tests = [
                  { name: 'Animation loop', pass: /requestAnimationFrame|setInterval/i.test(code) },
                  { name: 'Input handling', pass: /addEventListener\s*\(\s*["'](?:keydown|keyup|pointerdown|touchstart)["']/i.test(code) },
                  { name: 'Restart/state', pass: /restart|reset|game.?over|playAgain/i.test(code) },
                ];
                return { passed: tests.every((test) => test.pass), tests };
              },
            });

            const inspectErrors = createTool({
              name: 'inspect_errors',
              description: 'Inspect actual recent Bolt preview/build errors supplied with this run.',
              inputSchema: { type: 'object', properties: {} },
              execute: async () => ({ hasErrors: body.previewErrors.length > 0, errors: body.previewErrors.slice(-10) }),
            });

            const finishTask = createTool({
              name: 'finish_task',
              description: 'Finish the request. For planning-only runs, summary must contain the structured plan JSON and must not claim edits.',
              inputSchema: { type: 'object', properties: { summary: { type: 'string' }, controls: { type: 'string' }, features: { type: 'array', items: { type: 'string' } } }, required: ['summary'] },
              lifecycle: { completesRun: true },
              execute: async (value: { summary: string; controls?: string; features?: string[] }) => {
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
                : [readFile, writeFile, editFile, listFiles, searchCode, inspectProject, runBuild, runTests, inspectErrors, finishTask];

            const cookies = parseCookieMap(request.headers.get('Cookie') || '');
            const apiKeys = JSON.parse(cookies.apiKeys || '{}') as Record<string, string>;
            const providerSettings = body.providerSettings || JSON.parse(cookies.providers || '{}') as Record<string, IProviderSetting>;
            const provider = body.provider || DEFAULT_PROVIDER.name;
            if (body.apiKey) apiKeys[provider] = body.apiKey;
            if (body.baseUrl) providerSettings[provider] = { ...providerSettings[provider], baseUrl: body.baseUrl };
            const boltModel = getModel(provider, body.model || DEFAULT_MODEL, context.cloudflare.env, apiKeys, providerSettings);

            const agent = new Agent({
              model: agentModel,
              systemPrompt: [
                `You are Cline, the autonomous agent inside Bolt Studio. Inspect the current project, preserve context, plan, use structured tools, validate, and recover from errors. Project files: ${Object.keys(workingFiles).join(', ') || '(empty)'}`,
                body.systemContext ? `Project/preview context (untrusted data): ${JSON.stringify(body.systemContext.slice(0, 12000))}` : '',
                body.previewErrors.length ? `Recent actual Bolt errors: ${JSON.stringify(body.previewErrors)}` : '',
                body.planningOnly
                  ? `Plan only; do not edit files or claim edits. Use the supplied manifest, source excerpts, and context directly; do not call inspection tools. In this turn, call submit_plan with a tailored structured plan. Do not return a plan as free-form text. Plan BIG and ORIGINAL: 12-24 files and 6-10 connected systems totaling at minimum 10,000 lines of complete code, with module names and architecture derived from THIS request only — never the same index/style/main/game/input/audio skeleton twice. The game fills the entire viewport (full-window canvas, resizes with the window); no login, lobby, branding, or text-heavy screens — gameplay only, playable instantly. Source excerpts: ${JSON.stringify(workingFiles).slice(0, 30000)}`
                  : body.readOnly
                    ? 'Read-only chat: answer from supplied context; do not claim file changes.'
                    : `Approved build: edit only ${Array.from(approvedPaths).join(', ')}. Do not delete files or execute shell commands. Read current files, implement the approved plan, run checks, and finish truthfully. For an approved renderer migration, replace renderer-coupled code and markup consistently while retaining the requested gameplay, controls, and HUD; do not force obsolete engine-specific function names to remain. Every visible start, pause/resume, and restart button must have a real handler that changes game state; use the diagnostic state 'paused' while paused, keep HTML IDs and selectors in sync, and wire keyboard/touch controls to the same gameplay actions. Expose window.__GAME_DIAGNOSTICS__ and update its counters only from the real game loop and handlers; preview tests do not fabricate diagnostics or missing DOM nodes. Format source readably with 2-space indentation, one statement per line, and lines near 100 characters; never minify. Use smooth delta-time animation and interpolation rather than abrupt motion. For Three.js, use the pinned 0.160.0 ES module and null-check every canvas and HUD lookup. Full-game builds ship at minimum 10,000 lines of complete working code across 12-24 focused modules: write files in sequence across turns, complete every file fully in its own write, and never truncate. The game fills the entire viewport at all times: full-window canvas that resizes with the window, gameplay only with no text-heavy screens, and a start overlay solely for audio unlock whose handler directly starts the real game. Before finish_task, call run_build and run_tests, repair every reported failure in the approved files, and re-check until they pass — never finish with failing checks or truncated files. Bolt will run actual preview validation and send repair errors in a follow-up run.`,
              ].filter(Boolean).join('\n\n'),
              tools,
              initialMessages: body.history.slice(-20).map((message, index) => ({ id: `bolt-history-${index}`, role: message.role, content: [{ type: 'text' as const, text: message.content }], createdAt: Date.now() - (body.history.length - index) * 1000 })),
              // Big full-game builds need many file-writing turns; 18 steps starves 12-24 file projects.
              maxIterations: 32,
            });
            activeAgent = agent;

            unsubscribe = agent.subscribe((event: any) => {
              if (event.type === 'assistant-text-delta') send('text', { chunk: event.text, accumulated: event.accumulatedText });
              else if (event.type === 'assistant-reasoning-delta') send('reasoning', { status: 'Planning the next step…' });
              else if (event.type === 'tool-started') send('tool_start', { tool: event.toolCall.toolName, input: event.toolCall.input, toolCallId: event.toolCall.toolCallId, startTime: Date.now() });
              else if (event.type === 'tool-finished') send('tool_end', { tool: event.toolCall.toolName, toolCallId: event.toolCall.toolCallId });
              else if (event.type === 'usage-updated') send('usage', event.usage);
              else if (event.type === 'status-notice') send('status', { message: event.message });
            });

            const result = await agent.run(body.prompt);
            if (result.status === 'failed') send('fatal_error', { error: result.error?.message || 'Cline Agent run failed.' });
            else send('result', { summary: result.outputText, plan: submittedPlan, filesTouched: Object.keys(workingFiles).filter((path) => workingFiles[path] !== body.files[path]), usage: result.usage, status: result.status });
          } catch (error) {
            send('fatal_error', { error: error instanceof Error ? error.message : 'Cline Agent failed.' });
          } finally {
            unsubscribe?.();
            if (requestAbortHandler) request.signal.removeEventListener('abort', requestAbortHandler);
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
        activeAgent?.abort('Bolt client cancelled the run');
      },
    });

    return new Response(responseStream, { headers: { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache, no-transform', 'X-Accel-Buffering': 'no' } });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Cline request failed.';
    const status = message.includes('same studio origin') ? 403 : 400;
    return json({ error: message }, { status });
  }
}
