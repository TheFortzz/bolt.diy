# Studio reliability handoff

The Studio at `thefortz.me/studio` uses this `bolt.diy` fork, embedded by the separate `TheFortzz.github.io-1` site. The user approved a four-phase reliability plan and asked to implement **one phase at a time**, verify it, then stop. All four approved phases are implemented in the `bolt.diy` repository. Phases 1–2 were committed in `dfa5ad1`; Phases 3–4 followed in a later commit. Pushing this repository does **not** by itself verify that the live Studio has been deployed.

## Completed: Phase 1 — validation and bounded repair

- `app/lib/runtime/build-validator.ts`: waits for queued WebContainer actions, rejects incomplete/failed writes, checks generated JS (`node --check`) and JSON, runs project `typecheck` and/or `build` scripts when configured, then checks preview. Unsupported TS/JSX without a build/typecheck script fails closed. Reports progress via `validationState`.
- `app/lib/runtime/preview-validation.ts` and `app/components/workbench/Preview.tsx`: offscreen preview validation. Static previews catch `error` and `unhandledrejection`; dev-server previews check HTTP reachability and iframe load. **Cross-origin dev-server console/runtime errors cannot currently be observed** by the parent iframe.
- `app/components/chat/Chat.client.tsx`: success toast, notification, parent `thefortz-build-finished` message, and preview switch now happen after validation. Errors are sent back through the selected AI model/provider for at most two automatic repair attempts. A failed check does not announce success.
- `app/lib/hooks/useMessageParser.ts`: flushes the final assistant message synchronously before validation and avoids replaying completed actions in development. `app/lib/runtime/action-runner.ts` preserves start-action failure details.
- Tests: `app/lib/runtime/build-validator.spec.ts`, `app/lib/runtime/preview-validation.spec.ts`.

## Completed: Phase 2 — local working checkpoints and restore

- `app/lib/persistence/db.ts` upgrades IndexedDB `boltHistory` to version 2 with a `checkpoints` store indexed by chat and time. `app/lib/persistence/checkpoints.ts` stores immutable byte snapshots of the *actual WebContainer files* only after Phase 1 succeeds, retaining up to ten per chat. The maximum project snapshot is 64 MB. It skips `node_modules`, `.git`, and `.env` secrets; checkpoints are **browser-local**, not cloud-backed.
- **These are IndexedDB checkpoints, not Git commits.** WebContainer's public filesystem API lacks the metadata methods needed by the existing `isomorphic-git` package. Do not describe snapshots as Git commits or claim Git rollback exists.
- `app/components/workbench/Workbench.client.tsx` adds a **Restore working build** control. It confirms that unsaved changes and later chat turns will be discarded, restores changed/binary/added/deleted files, truncates saved chat history to the checkpoint assistant message, then reloads. If restoration fails while applying files, `restoreCheckpoint` attempts to recover the pre-restore workspace.
- `app/lib/stores/files.ts` and `app/lib/stores/workbench.ts` refresh the file map/editor after restore. `app/components/chat/Chat.client.tsx` reapplies the authoritative checkpoint after historical actions replay on reload. `app/lib/persistence/useChatHistory.ts` keeps chat IDs from leaking across route changes; cloud chat backup remains best-effort and nonblocking.
- Tests: `app/lib/persistence/checkpoints.spec.ts` covers byte preservation, file deletion, ignored dependencies/secrets, and unsafe path rejection.

Verification after Phase 2: `pnpm test` (43 tests), `pnpm typecheck`, `pnpm build`, and `git diff --check` passed. Vitest prints an existing Vite shutdown timeout warning **after** reporting passing tests. Interactive browser verification was unavailable because the desktop browser was disconnected; test real authenticated builds, IndexedDB upgrade/persistence, and restore on the live Studio before assuming production behavior.

## Completed: Phase 3 — real per-turn activity feed

- `app/lib/stores/activity.ts` holds keyed, timestamped steps per assistant message. Action steps are registered when the parser observes real file/shell/start actions; `ActionRunner` updates their pending/running/complete/failed/aborted states. Streaming file edits are marked running when their content arrives. No fabricated read events are emitted.
- `app/lib/runtime/build-validator.ts` emits actual file reads, syntax checks, project typecheck/build commands, preview load, and final pass/fail steps. An arbitrary shell action cannot claim a verified build. `Chat.client.tsx` adds bounded repair and checkpoint-save steps; `Workbench.client.tsx` indicates checkpoint restoration.
- `app/components/chat/Messages.client.tsx` renders `ActivityTimeline.tsx` with the corresponding assistant message rather than one generic timeline at the bottom. Only observed steps are shown; a brief Thinking fallback remains before actions start. Long timelines collapse older steps behind a Show earlier steps control. File steps can open that file in the Code tab.
- Tests: `app/lib/stores/activity.spec.ts`, `app/components/chat/ActivityTimeline.spec.tsx`, and validation-event assertions in `app/lib/runtime/build-validator.spec.ts`.
- Activity events are held in memory for the current session; old assistant file actions replay on reload, but previous validation/checkpoint-step history is **not yet durably persisted**. This is a known limitation, not a claim that the full event log survives reload.
- Verification after Phase 3: `pnpm typecheck`, `pnpm test` (48 tests), and `pnpm build` passed. Interactive browser testing was unavailable in this session.

## Completed: Phase 4 — live contextual diffs in Code

- `app/lib/stores/editor.ts` records the pre-edit content once per AI message, including an empty original file, and keeps it stable through multiple streamed edits and file-watcher refreshes. A new AI message starts a fresh baseline. New files stay in normal Code view.
- `app/utils/editorDiff.ts` computes red/green changed lines with three context lines and elision markers. While replacement content is incomplete, its provisional display keeps the as-yet-unemitted original tail instead of falsely marking the entire remainder as deleted. After the file action writes successfully, the final diff compares actual full files. A 250,000-character combined-input limit falls back to normal code for very large files to avoid freezing the editor.
- `app/components/workbench/EditorPanel.tsx` defaults existing AI-edited files to the live diff, with Code/Diff toggle and change counts. `app/components/editor/codemirror/CodeMirrorEditor.tsx` applies minimal document updates, follows the latest changed hunk while streaming, and avoids resetting scroll on every token. The diff is read-only presentation; the actual `EditorDocument.value` and WebContainer files are not replaced by diff text. Accept is disabled while generation/validation is ongoing.
- Tests: `app/utils/editorDiff.spec.ts` and `app/lib/stores/editor.spec.ts`, including empty files, repeated edits, large files, partial streams, and minimal text replacements. Verification after Phase 4: `pnpm typecheck`, `pnpm test` (56 tests), and `pnpm build` passed. Interactive browser verification was unavailable.

## Known limits / follow-up only with user approval

True Git commit semantics are **not** implemented; WebContainer dev-server console errors are not captured cross-origin; checkpoints are local-only and exclude `.env` files and dependency directories. Activity history is in memory, and large files use code view instead of a live diff. Test real authenticated build/edit/restore flows in a connected browser before claiming production UX; do not silently extend the approved scope.
