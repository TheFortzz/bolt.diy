### Current execution path

User request → Manager blueprint → user approval → approved image generation → Editor file actions → source/runtime checks → working checkpoint.

### Implemented in this iteration

- Right-aligned user prompt bubbles and left-aligned assistant responses.
- User prompt annotations keep internal file modifications out of newly created prompt bubbles.
- Expandable observed activity, timestamps, file links, and lazy source-code previews.
- Manual scroll position is respected; a jump-to-latest control resumes following.
- Source-file completion is not presented as game verification.
- Image generation happens before the final verification and checkpoint.
- Generated PNG paths, base64, PNG structure, size, and approved dimensions are validated before writes; failed asset batches roll back newly created files.
- Generated images resolve inside the assembled static preview, including checkpoint reloads.
- Static preview resolves exact or unique relative source paths, injects missing helpers before declared game scripts, and preserves module-script tags; unresolved references fail the iframe probe instead of silently verifying.
- The iframe probe observes application animation callbacks, repeated Canvas/WebGL rendering, image loading, resource failures, console errors, and rejected promises.
- The probe is a bounded startup/rendering smoke test, not proof of simulation correctness or every gameplay scenario.
- Managed static-game verification now exercises Enter, a movement key, restart, and resize, then requires the game diagnostics contract and configured simulation-step threshold before passing. These synthetic events are smoke checks, not proof that every gameplay mechanic is correct.
- Cross-origin dev-server load events no longer count as runtime verification. Such projects need a browser verification worker or authenticated preview bridge.
- A bounded, read-only SYSTEM_CONTEXT.md projection travels with chat requests and continuation segments. It is context data, not an authorization mechanism or a physical project file.
- A separate Manager request returns a schema-validated, revision-hashed blueprint; reference images are passed as vision input when supported.
- The blueprint is shown for review before building. Server-signed review/execution capabilities bind approval to the plan, audience, and reported base revision.
- Managed Editor actions are checked against approved source paths and expected file hashes at write time; shell/start actions and duplicate file actions are rejected, and the source-size budget is checked when a file closes. This parser-side policy is a guardrail, not a trusted server security boundary.
- Failed managed builds are not auto-repaired. A repair request must go through a fresh Manager plan and approval.

### Model and image service configuration

- The default model and legacy `fortz-ai` alias resolve to the Azure `gpt-6-luna` deployment (GPT 6 Luna).
- Managed Manager and Editor calls are pinned to the GPT 6 Luna/OpenAILike deployment and use Azure Chat Completions. They use a saved OpenAILike key when present, otherwise the server-side `OPENAI_LIKE_API_KEY`; the key and endpoint must belong to the same Azure resource.
- GPT-6 Chat Completions calls use low reasoning effort to reduce latency for interactive planning and editing.
- Set server-only `FORTZ_AI_DEPLOYMENT` only if your Luna deployment uses a different Azure identifier.
- `FORTZ_AI_RESPONSES_URL` explicitly overrides the Azure v1 endpoint; otherwise it is derived from `OPENAI_LIKE_API_BASE_URL` (or the built-in Azure default). The app sends Chat Completions requests to the matching `/chat/completions` route.
- Production harness requests also require server-only `FORTZ_HARNESS_SIGNING_KEY` (at least 32 characters).
- Prefer server-side `OPENAI_LIKE_API_KEY`; saved BYOK keys are forwarded only to same-origin model routes. Keep image-service credentials server-side, and never place credentials in generated games or preview messages.
- Existing source contains an embedded credential fallback in `app/lib/.server/llm/api-key.ts`. Rotate that credential and migrate it to secret storage before production deployment. This iteration does not rotate credentials or change authentication.

### Remaining architectural work

- Separate Editor and Verifier model invocations; the Editor currently shares the regular chat model call with a constrained system prompt, while verification is deterministic client/runtime checking.
- Server-trusted workspace snapshots and revision checks. The approval endpoint receives the current revision from the browser because game files live in a client-side WebContainer.
- Server-side validation of every generated action before it reaches the WebContainer; current path enforcement runs in the client parser.
- Immutable candidate revisions and atomic publication of only verified revisions; the current WebContainer is mutable.
- Durable backend workflow persistence, asset-job idempotency, and revision-bound evidence.
- An independent browser-worker watchdog for dev servers/cross-origin previews, plus richer gameplay scenarios and telemetry beyond the current static iframe smoke checks.
- A structured repair-proposal object and server-side approval record; today a repair starts as a new user request and receives a fresh blueprint.

Do not market this iteration as the complete approved multi-agent backend or guaranteed Replit-equivalent one-prompt generation.

### Acceptance testing

- Run `pnpm typecheck` and `pnpm test`.
- Run `pnpm build` for the production bundle.
- With a connected browser and configured model/image services, request a complete game and inspect user/assistant alignment, activity expansion, source previews, scrolling, image rendering, controls, restart, resize, and error states.
- Inject a missing image, console error, stopped animation loop, and failed file write; each must remain unverified.
- Test a dev-server game: without an independent verifier, it must remain explicitly unverified rather than passing on iframe load.
