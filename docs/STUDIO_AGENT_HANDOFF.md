# Studio reliability handoff

The Studio at `thefortz.me/studio` uses this `bolt.diy` fork, embedded by the separate `TheFortzz.github.io-1` site. The user approved a four-phase reliability plan and asked to implement **one phase at a time**, verify it, then stop. Phases 1 and 2 were implemented; do **not** proceed to Phase 3 or 4 without a new instruction.

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

## Remaining, only with user approval

**Phase 3 — granular activity feed.** The fork already has `app/components/chat/ActivityTimeline.tsx`, rendered by `Messages.client.tsx`, but it infers status from action types and only shows a bottom-of-chat timeline. Add real per-build/per-message events from `useMessageParser.ts`, `action-runner.ts`, the Phase 1 validator, and checkpoint operations. Show actual reading/editing/checking/retrying states without fabricating read events. Avoid duplicate events when old messages replay; test status transitions.

**Phase 4 — diff instead of full retyping.** The fork already has opt-in red/green diff logic in `app/components/editor/codemirror/CodeMirrorEditor.tsx`, `app/components/workbench/EditorPanel.tsx`, and `app/lib/stores/editor.ts`. Existing-file edits still default to Code and stream the replacement file. Preserve a stable pre-edit baseline, default existing-file edits to a compact contextual red/green diff, update changed hunks during streaming, and leave new files in normal code mode. Never save diff presentation text into the real file. Add tests for empty files, repeated edits, large files, and editor scroll/selection.

Additional known limits to evaluate separately: true Git commit semantics are **not** implemented; WebContainer dev-server console errors are not captured cross-origin; checkpoints are local-only and exclude `.env` files and dependency directories. Keep later work scoped to the phase the user selects.
