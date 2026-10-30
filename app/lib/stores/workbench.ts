import { atom, map, type MapStore, type ReadableAtom, type WritableAtom } from 'nanostores';
import type { WebContainerProcess } from '@webcontainer/api';
import type { EditorDocument, ScrollPosition } from '~/components/editor/codemirror/CodeMirrorEditor';
import { ActionRunner } from '~/lib/runtime/action-runner';
import type { ActionCallbackData, ArtifactCallbackData } from '~/lib/runtime/message-parser';
import { getWebContainer, webcontainer } from '~/lib/webcontainer';
import type { ITerminal } from '~/types/terminal';
import { unreachable } from '~/utils/unreachable';
import { EditorStore } from './editor';
import { FilesStore, type FileMap } from './files';
import { PreviewsStore } from './previews';
import { TerminalStore } from './terminal';
import JSZip from 'jszip';
import { saveAs } from 'file-saver';
import { Octokit, type RestEndpointMethodTypes } from '@octokit/rest';
import * as nodePath from 'node:path';
import { extractRelativePath, cleanWorkDirRelativePath } from '~/utils/diff';
import { WORK_DIR } from '~/utils/constants';
import { description } from '~/lib/persistence';
import Cookies from 'js-cookie';
import { actionStepId, startActionActivity, updateActivity } from '~/lib/stores/activity';
import {
  isFortzStaticPreviewPort,
  normalizeServerPreviewHtml,
  staticPreviewModuleHintsHelperSource,
} from '~/lib/runtime/static-preview';
import { executionPolicy } from '~/lib/harness/execution-policy';
import { formatWorkspaceSource } from '~/lib/runtime/source-format';
import { repairImportedGameSource } from '~/lib/runtime/source-splice-repair';
import type { Html5GameFile } from '~/lib/runtime/html5-game-import';
import { generatedAssets } from '~/lib/stores/generated-assets';

export interface ArtifactState {
  id: string;
  title: string;
  type?: string;
  closed: boolean;
  runner: ActionRunner;
}

export type ArtifactUpdateState = Pick<ArtifactState, 'title' | 'closed'>;

type Artifacts = MapStore<Record<string, ArtifactState>>;

export type WorkbenchViewType = 'code' | 'preview';
const IMPORTED_HTML5_MODE_KEY = 'fortz_imported_html5_game';

function readImportedHtml5Mode() {
  try {
    return typeof localStorage !== 'undefined' && localStorage.getItem(IMPORTED_HTML5_MODE_KEY) === '1';
  } catch {
    return false;
  }
}

function resolveWorkDirPath(filePath: string) {
  const relativePath = cleanWorkDirRelativePath(filePath);
  const resolvedPath = nodePath.posix.normalize(nodePath.posix.join(WORK_DIR, relativePath));

  if (resolvedPath !== WORK_DIR && !resolvedPath.startsWith(`${WORK_DIR}/`)) {
    console.warn(`Blocked file path outside the project: ${filePath}`);
    return nodePath.posix.join(WORK_DIR, '__blocked__', 'invalid-file');
  }

  return resolvedPath;
}

function normalizeActionData(data: ActionCallbackData): ActionCallbackData {
  if (data.action.type !== 'file') {
    return data;
  }

  return {
    ...data,
    action: {
      ...data.action,
      filePath: resolveWorkDirPath(data.action.filePath),
    },
  };
}

export class WorkbenchStore {
  #previewsStore = new PreviewsStore(webcontainer);
  #filesStore = new FilesStore(webcontainer);
  #editorStore = new EditorStore(this.#filesStore);
  #terminalStore = new TerminalStore(webcontainer);

  artifacts: Artifacts = import.meta.hot?.data.artifacts ?? map({});

  showWorkbench: WritableAtom<boolean> = import.meta.hot?.data.showWorkbench ?? atom(false);
  currentView: WritableAtom<WorkbenchViewType> = import.meta.hot?.data.currentView ?? atom('preview');
  isImportedHtml5Game: WritableAtom<boolean> = import.meta.hot?.data.isImportedHtml5Game ?? atom(readImportedHtml5Mode());

  /** File currently receiving streamed content, if any. */
  streamingFile: WritableAtom<string | undefined> = import.meta.hot?.data.streamingFile ?? atom(undefined);

  /** When true, file-write actions must not yank the user off the Play tab. */
  preferPlayView: WritableAtom<boolean> = import.meta.hot?.data.preferPlayView ?? atom(false);
  unsavedFiles: WritableAtom<Set<string>> = import.meta.hot?.data.unsavedFiles ?? atom(new Set<string>());
  completedFiles: WritableAtom<Set<string>> = import.meta.hot?.data.completedFiles ?? atom(new Set<string>());
  modifiedFiles = new Set<string>();
  artifactIdList: string[] = [];
  #globalExecutionQueue = Promise.resolve();
  #staticServerStarted = false;
  constructor() {
    if (import.meta.hot) {
      import.meta.hot.data.artifacts = this.artifacts;
      import.meta.hot.data.unsavedFiles = this.unsavedFiles;
      import.meta.hot.data.completedFiles = this.completedFiles;
      import.meta.hot.data.showWorkbench = this.showWorkbench;
      import.meta.hot.data.currentView = this.currentView;
      import.meta.hot.data.isImportedHtml5Game = this.isImportedHtml5Game;
      import.meta.hot.data.streamingFile = this.streamingFile;
      import.meta.hot.data.preferPlayView = this.preferPlayView;
    }
  }

  #focusCodeUnlessPlayPinned() {
    if (this.preferPlayView.get()) {
      return;
    }

    if (this.currentView.value !== 'code') {
      this.currentView.set('code');
    }
  }

  addToExecutionQueue(callback: () => Promise<void>) {
    const next = this.#globalExecutionQueue.then(() => callback());
    this.#globalExecutionQueue = next.catch(() => {});

    return next;
  }

  async waitForExecutionQueue() {
    await this.#globalExecutionQueue;
  }

  get previews() {
    return this.#previewsStore.previews;
  }

  get files() {
    return this.#filesStore.files;
  }

  get currentDocument(): ReadableAtom<EditorDocument | undefined> {
    return this.#editorStore.currentDocument;
  }

  get selectedFile(): ReadableAtom<string | undefined> {
    return this.#editorStore.selectedFile;
  }

  get firstArtifact(): ArtifactState | undefined {
    return this.#getArtifact(this.artifactIdList[0]);
  }

  get filesCount(): number {
    return this.#filesStore.filesCount;
  }

  get showTerminal() {
    return this.#terminalStore.showTerminal;
  }
  get boltTerminal() {
    return this.#terminalStore.boltTerminal;
  }

  toggleTerminal(value?: boolean) {
    this.#terminalStore.toggleTerminal(value);
  }

  attachTerminal(terminal: ITerminal) {
    this.#terminalStore.attachTerminal(terminal);
  }
  attachBoltTerminal(terminal: ITerminal) {
    this.#terminalStore.attachBoltTerminal(terminal);
  }

  onTerminalResize(cols: number, rows: number) {
    this.#terminalStore.onTerminalResize(cols, rows);
  }

  setDocuments(files: FileMap) {
    this.#editorStore.setDocuments(files);

    if (this.#filesStore.filesCount > 0 && this.currentDocument.get() === undefined) {
      // we find the first file and select it
      for (const [filePath, dirent] of Object.entries(files)) {
        if (dirent?.type === 'file') {
          this.setSelectedFile(filePath);
          break;
        }
      }
    }
  }

  setShowWorkbench(show: boolean) {
    this.showWorkbench.set(show);
  }

  setCurrentDocumentContent(newContent: string, filePath = this.currentDocument.get()?.filePath) {
    if (!filePath) {
      return;
    }

    const originalContent = this.#filesStore.getFile(filePath)?.content;
    const unsavedChanges = originalContent !== undefined && originalContent !== newContent;

    this.#editorStore.updateFile(filePath, newContent);

    /*
     * A debounced edit can finish after the user selected another file. Keep
     * the write attached to its source path and only update the visible file's
     * unsaved marker when it is still selected.
     */
    const currentDocument = this.currentDocument.get();

    if (!currentDocument || currentDocument.filePath !== filePath) {
      return;
    }

    const previousUnsavedFiles = this.unsavedFiles.get();

    if (unsavedChanges && previousUnsavedFiles.has(filePath)) {
      return;
    }

    const newUnsavedFiles = new Set(previousUnsavedFiles);

    if (unsavedChanges) {
      newUnsavedFiles.add(filePath);
    } else {
      newUnsavedFiles.delete(filePath);
    }

    this.unsavedFiles.set(newUnsavedFiles);
  }

  setCurrentDocumentScrollPosition(position: ScrollPosition) {
    const editorDocument = this.currentDocument.get();

    if (!editorDocument) {
      return;
    }

    const { filePath } = editorDocument;

    this.#editorStore.updateScrollPosition(filePath, position);
  }

  setSelectedFile(filePath: string | undefined) {
    this.#editorStore.setSelectedFile(filePath);
  }

  async createFile(filePath: string, content = '') {
    const absolutePath = await this.#filesStore.createFile(filePath, content);
    this.setSelectedFile(absolutePath);

    return absolutePath;
  }

  async createFolder(folderPath: string) {
    return this.#filesStore.createFolder(folderPath);
  }

  async uploadFiles(fileList: FileList | globalThis.File[], targetFolder?: string) {
    const created = await this.#filesStore.uploadFiles(fileList, targetFolder);

    if (created.length > 0) {
      this.setSelectedFile(created[0]);
    }

    return created;
  }

  async duplicateWorkspaceFile(filePath: string): Promise<string> {
    const relativePath = cleanWorkDirRelativePath(filePath);
    const absolutePath = nodePath.posix.join(WORK_DIR, relativePath);
    const source = this.files.get()[absolutePath];
    if (!relativePath || source?.type !== 'file') throw new Error('Select a file to duplicate.');

    const directory = nodePath.posix.dirname(relativePath);
    const filename = nodePath.posix.basename(relativePath);
    const extension = nodePath.posix.extname(filename);
    const stem = extension ? filename.slice(0, -extension.length) : filename;
    const existing = new Set(Object.keys(this.files.get()));
    let suffix = 1;
    let targetRelative = '';
    do {
      const copyName = suffix === 1 ? `${stem} copy${extension}` : `${stem} copy ${suffix}${extension}`;
      targetRelative = directory === '.' ? copyName : nodePath.posix.join(directory, copyName);
      suffix++;
    } while (existing.has(nodePath.posix.join(WORK_DIR, targetRelative)));

    const container = await getWebContainer();
    if (source.isBinary) {
      const bytes = await container.fs.readFile(relativePath);
      await this.#filesStore.createBinaryFile(targetRelative, bytes);
    } else {
      const content = await container.fs.readFile(relativePath, 'utf-8');
      await this.#filesStore.createFile(targetRelative, content);
    }

    this.setDocuments(this.files.get());
    const duplicatedPath = nodePath.posix.join(WORK_DIR, targetRelative);
    this.setSelectedFile(duplicatedPath);
    this.currentView.set('code');
    this.preferPlayView.set(false);
    return duplicatedPath;
  }

  async deleteWorkspaceFile(filePath: string): Promise<void> {
    const deletedPath = await this.#filesStore.deleteFile(filePath);
    this.unsavedFiles.set(new Set([...this.unsavedFiles.get()].filter((path) => path !== deletedPath)));
    this.completedFiles.set(new Set([...this.completedFiles.get()].filter((path) => path !== deletedPath)));
    this.setDocuments(this.files.get());
    if (this.selectedFile.get() === deletedPath) {
      const nextFile = Object.entries(this.files.get()).find(([, entry]) => entry?.type === 'file')?.[0];
      this.setSelectedFile(nextFile);
    }
    this.currentView.set('code');
    this.preferPlayView.set(false);
    if (typeof window !== 'undefined') window.dispatchEvent(new Event('thefortz-build-finished'));
  }

  async saveFile(filePath: string) {
    const documents = this.#editorStore.documents.get();
    const document = documents[filePath];

    if (document === undefined) {
      return;
    }

    await this.#filesStore.saveFile(filePath, document.value);
    this.#editorStore.acceptDiff(filePath);

    const newUnsavedFiles = new Set(this.unsavedFiles.get());
    newUnsavedFiles.delete(filePath);

    this.unsavedFiles.set(newUnsavedFiles);
  }

  acceptDiff(filePath: string) {
    this.#editorStore.acceptDiff(filePath);
  }

  revertDiff(filePath: string) {
    this.#editorStore.revertDiff(filePath);
  }

  async saveCurrentDocument() {
    const currentDocument = this.currentDocument.get();

    if (currentDocument === undefined) {
      return;
    }

    await this.saveFile(currentDocument.filePath);
  }

  resetCurrentDocument() {
    const currentDocument = this.currentDocument.get();

    if (currentDocument === undefined) {
      return;
    }

    const { filePath } = currentDocument;
    const file = this.#filesStore.getFile(filePath);

    if (!file) {
      return;
    }

    this.setCurrentDocumentContent(file.content);
  }

  async saveAllFiles() {
    for (const filePath of this.unsavedFiles.get()) {
      await this.saveFile(filePath);
    }
  }

  getFileModifcations() {
    return this.#filesStore.getFileModifications();
  }

  resetAllFileModifications() {
    this.#filesStore.resetFileModifications();
  }

  showRestoredCheckpoint(files: Record<string, Uint8Array>) {
    this.#editorStore.documents.set({});
    this.#editorStore.selectedFile.set(undefined);
    this.#filesStore.replaceFromCheckpoint(files);
    this.setDocuments(this.files.get());
    this.unsavedFiles.set(new Set());
    this.completedFiles.set(new Set());
    this.streamingFile.set(undefined);
    this.showWorkbench.set(true);
    this.currentView.set('preview');
  }

  abortAllActions() {
    const artifacts = this.artifacts.get();

    for (const artifact of Object.values(artifacts)) {
      const actions = artifact.runner?.actions?.get();

      if (!actions) {
        continue;
      }

      for (const action of Object.values(actions)) {
        if (action.status === 'pending' || action.status === 'running') {
          action.abort?.();
        }
      }
    }
  }

  finishPendingActions() {
    const artifacts = this.artifacts.get();

    for (const [messageId, artifact] of Object.entries(artifacts)) {
      const runner = artifact.runner;

      if (!runner) {
        continue;
      }

      for (const [actionId, action] of Object.entries(runner.actions.get())) {
        /*
         * A streamed action without a close callback is incomplete. Do not
         * claim that its partial file was written or mark it executable.
         */
        if ((action.status === 'pending' || action.status === 'running') && !action.executed) {
          runner.actions.setKey(actionId, { ...action, status: 'aborted', executed: false });
          updateActivity(messageId, actionStepId(actionId), 'aborted');
        }
      }
    }

    this.streamingFile.set(undefined);
  }

  async startStaticPreviewServer() {
    if (this.#staticServerStarted) {
      return;
    }

    this.#staticServerStarted = true;

    try {
      const wc = await Promise.race([
        getWebContainer(),
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error('WC timeout')), 15000)),
      ]);
      const serveCode = `
const http = require('http');
const fs = require('fs');
const path = require('path');
const mimes = {
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.avif': 'image/avif',
  '.mp3': 'audio/mpeg',
  '.m4a': 'audio/mp4',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.glb': 'model/gltf-binary',
  '.gltf': 'model/gltf+json',
  '.bin': 'application/octet-stream',
  '.wasm': 'application/wasm',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf'
};

const baseDir = path.resolve(fs.existsSync('/home/project') ? '/home/project' : process.cwd());
const normalizeServerPreviewHtml = (${normalizeServerPreviewHtml.toString()});

/*
 * Bare module specifiers ("three") usually import from EXTERNAL module files,
 * not from the HTML itself. The shared helper (defined in static-preview.ts)
 * walks the module scripts the HTML references (plus their relative-import
 * closure) so the injected import map covers the real dependency graph.
 */
${staticPreviewModuleHintsHelperSource}
const handler = function (req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
  res.setHeader('Access-Control-Expose-Headers', 'X-Fortz-Static-Preview');
  res.setHeader('X-Fortz-Static-Preview', '1');
  let cleanUrl = (req.url || '/').split('?')[0].replace(/^\\/+/, '');
  if (!cleanUrl) cleanUrl = 'index.html';

  const requestExt = path.extname('/' + cleanUrl).toLowerCase();
  const isHtmlRequest = !requestExt || requestExt === '.html' || requestExt === '.htm';
  if (isHtmlRequest) {
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
  } else {
    // Models, sprites, sounds: brief browser caching keeps the next Play
    // instant instead of re-downloading megabytes through WebContainer.
    res.setHeader('Cache-Control', 'public, max-age=60, must-revalidate');
  }

  const requestedPath = path.resolve(baseDir, cleanUrl);
  if (requestedPath !== baseDir && !requestedPath.startsWith(baseDir + path.sep)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  const candidates = [
    requestedPath,
    path.resolve(baseDir, 'src', cleanUrl),
    path.resolve(baseDir, 'public', cleanUrl),
    path.resolve(baseDir, 'dist', cleanUrl),
  ].map((candidate) => path.resolve(candidate));

  let file = candidates.find((candidate) => {
    if (candidate !== baseDir && !candidate.startsWith(baseDir + path.sep)) return false;
    try { return fs.existsSync(candidate) && fs.statSync(candidate).isFile(); } catch (e) { return false; }
  });

  if (!file) {
    try {
      var wantBase = cleanUrl.split('/').pop().toLowerCase();
      var wantExt = path.extname(cleanUrl).toLowerCase();
      var baseDepth = baseDir.split(path.sep).length;
      var stack = [baseDir];
      var found = null;
      while (stack.length && !found) {
        var dir = stack.pop();
        var entries = [];
        try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { continue; }
        for (var k = 0; k < entries.length; k++) {
          var ent = entries[k];
          if (!ent || !ent.name || ent.name.charAt(0) === '.' || ent.name === 'node_modules') continue;
          var full = path.join(dir, ent.name);
          if (ent.isDirectory()) {
            if (full.split(path.sep).length - baseDepth < 4) stack.push(full);
          } else if (ent.isFile() && ent.name.toLowerCase() === wantBase && path.extname(ent.name).toLowerCase() === wantExt) {
            found = full;
            break;
          }
        }
      }
      if (found) file = found;
    } catch (e) {}
  }

  if (!file && (cleanUrl.endsWith('.html') || !path.extname(cleanUrl))) {
    const defaultIndex = path.join(baseDir, 'index.html');
    if (fs.existsSync(defaultIndex)) file = defaultIndex;
  }

  if (file) {
    const ext = path.extname(file).toLowerCase();
    res.writeHead(200, { 'Content-Type': mimes[ext] || 'application/octet-stream' });
    if (ext === '.html') {
      try {
        var servedHtml = fs.readFileSync(file, 'utf8');
        res.end(normalizeServerPreviewHtml(servedHtml, fortzCollectModuleHints(servedHtml, file)));
      } catch (e) {
        fs.createReadStream(file).pipe(res);
      }
    } else {
      fs.createReadStream(file).pipe(res);
    }
  } else {
    res.writeHead(404);
    res.end('Not Found');
  }
};

const previewPorts = [4173, 4174, 4175, 4176, 4177];
let activeServer = null;
function listenOn(index) {
  if (index >= previewPorts.length) {
    console.error('[fortz-static] no free preview port');
    process.exit(1);
    return;
  }
  if (activeServer) { try { activeServer.close(); } catch (e) {} }
  activeServer = http.createServer(handler);
  activeServer.on('error', function (err) {
    if (err && err.code === 'EADDRINUSE') { listenOn(index + 1); return; }
    console.error('[fortz-static] server error', err);
    process.exit(1);
  });
  activeServer.listen(previewPorts[index], __FORTZ_BIND__, function () {
    console.log('[fortz-static] listening on ' + previewPorts[index]);
  });
}
listenOn(0);
`;
      /*
       * WebContainer only hands out a preview URL for ports its runtime
       * actually observes. A bind the runtime misses (some wildcard binds
       * never surface) produces NO `port` event at all: the server runs, yet
       * the game looks dead. Run all three bind styles at once, each on its
       * own port file, mirror their stdout into the browser console, and keep
       * only the bind the runtime acknowledges — killing the losers.
       */
      const bindStrategies = ['127.0.0.1', '0.0.0.0', '::'];
      const attempts: Array<{
        bind: string;
        process: WebContainerProcess;
        port: number | undefined;
        dead: boolean;
      }> = [];

      for (const [bindIndex, bind] of bindStrategies.entries()) {
        const attemptCode = serveCode.split('__FORTZ_BIND__').join(JSON.stringify(bind));
        /*
         * WebContainer fs paths resolve relative to the project directory, so
         * an absolute-looking "/.static_server" path silently lands inside
         * /home/project while `node /…` looks at the real filesystem root and
         * fails with MODULE_NOT_FOUND. Write and spawn BOTH relative to the
         * workdir so they always agree.
         */
        const attemptPath = `.static_server_${bindIndex}.cjs`;
        await wc.fs.writeFile(attemptPath, attemptCode);

        let probe: Uint8Array | undefined;

        try {
          probe = await wc.fs.readFile(attemptPath);
        } catch {
          probe = undefined;
        }

        if (!probe?.length) {
          throw new Error(`Static server script missing after write: ${attemptPath}`);
        }

        const serverProcess = await wc.spawn('node', [attemptPath]);
        const attempt = { bind, process: serverProcess, port: undefined as number | undefined, dead: false };
        attempts.push(attempt);

        void serverProcess.exit.then(
          () => {
            attempt.dead = true;
          },
          () => {
            attempt.dead = true;
          },
        );
        void this.#awaitStaticServerListenPort(serverProcess).then((port) => {
          attempt.port = port;
        });
      }

      /*
       * 20s (was 7s): after a large (tens-of-MB) import, WebContainer is still
       * materialising the workspace while the server is already listening;
       * preview-URL exposure can legitimately lag past 7s and every retry of
       * the import then reboots the whole workspace. Waiting longer only
       * delays the fallback for genuinely dead servers.
       */
      const deadline = Date.now() + 20_000;
      let exposedPort: number | undefined;

      while (Date.now() < deadline && exposedPort === undefined) {
        for (const attempt of attempts) {
          if (
            attempt.port !== undefined &&
            this.previews.get().some((preview) => preview.port === attempt.port && preview.ready)
          ) {
            exposedPort = attempt.port;
            break;
          }
        }

        if (exposedPort === undefined && attempts.every((attempt) => attempt.dead)) {
          break;
        }

        await new Promise((resolve) => setTimeout(resolve, 200));
      }

      for (const attempt of attempts) {
        if (exposedPort === undefined || attempt.port !== exposedPort) {
          try {
            attempt.process.kill();
          } catch {
            // Process already gone.
          }

          continue;
        }

        console.log(`[fortz-static] serving game previews on port ${exposedPort} (bind ${attempt.bind})`);

        void attempt.process.exit.then(
          () => {
            this.#staticServerStarted = false;
          },
          () => {
            this.#staticServerStarted = false;
          },
        );
      }

      if (exposedPort === undefined) {
        throw new Error(
          'Static preview server started but WebContainer never exposed a preview URL for any bind address.',
        );
      }
    } catch (e) {
      this.#staticServerStarted = false;
      throw e;
    }
  }

  /**
   * Mirror the in-container server's stdout into the browser console so a
   * crashed or blocked preview server is diagnosable instead of failing
   * silently. Resolves with the listen port once the server confirms it, or
   * undefined when the process dies or never answers.
   */
  async #awaitStaticServerListenPort(serverProcess: WebContainerProcess): Promise<number | undefined> {
    return new Promise<number | undefined>((resolve) => {
      let settled = false;
      const settle = (value: number | undefined) => {
        if (!settled) {
          settled = true;
          resolve(value);
        }
      };

      void (async () => {
        try {
          const reader = serverProcess.output.getReader();
          const decoder = new TextDecoder();
          let buffer = '';

          for (;;) {
            const { done, value } = await reader.read();

            if (done) {
              break;
            }

            const text = typeof value === 'string' ? value : decoder.decode(value as Uint8Array, { stream: true });
            console.log('[fortz-static]', text.trimEnd());
            buffer += text;

            const match = /listening on (\d+)/.exec(buffer);

            if (match?.[1]) {
              settle(Number(match[1]));
            }
          }
        } catch {
          // Output stream closes together with the process.
        }

        settle(undefined);
      })();

      void serverProcess.exit.then(
        () => settle(undefined),
        () => settle(undefined),
      );
      setTimeout(() => settle(undefined), 8000);
    });
  }

  /**
   * Wait for the WebContainer port-ready event. Do not fetch the preview URL
   * from the Studio origin: WebContainer preview hosts are cross-origin and
   * intentionally omit Access-Control-Allow-Origin, so browser fetches only
   * produce noisy CORS failures (and used to delay HTML imports for 15s).
   */
  async waitForPreviewReady(timeoutMs = 12_000): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;

    while (Date.now() < deadline) {
      const previews = this.previews.get();
      const fortzServerExists = previews.some((preview) => isFortzStaticPreviewPort(preview.port));
      if (previews.some((preview) => preview.ready && isFortzStaticPreviewPort(preview.port))) return true;
      // If this workspace has no Fortz static server, an open dev-server port
      // is the best available signal. Otherwise wait for the preferred port.
      if (!fortzServerExists && previews.some((preview) => preview.ready)) return true;
      await new Promise((resolve) => setTimeout(resolve, 150));
    }

    return this.previews.get().some((preview) => preview.ready);
  }

  async clearProjectFiles() {
    this.#editorStore.documents.set({});
    this.#editorStore.selectedFile.set(undefined);
    this.#filesStore.files.set({});
    this.isImportedHtml5Game.set(false);
    try {
      localStorage.removeItem(IMPORTED_HTML5_MODE_KEY);
    } catch {}
    generatedAssets.set({});
    this.unsavedFiles.set(new Set());
    this.completedFiles.set(new Set());
    this.streamingFile.set(undefined);
    this.#filesStore.resetFileModifications();

    try {
      const wc = await getWebContainer();
      const entries = await wc.fs.readdir('.', { withFileTypes: true });

      for (const entry of entries) {
        if (entry.name === '.static_server.cjs' || entry.name.startsWith('.static_server_')) {
          continue;
        }

        try {
          await wc.fs.rm(entry.name, { recursive: true });
        } catch {}
      }
    } catch (e) {
      console.warn('Could not clear WebContainer files for new project:', e);
    }
  }

  /** Replace the workspace with a validated, browser-ready HTML5 game. */
  async importHtml5Game(files: Html5GameFile[]) {
    if (!files.length) {
      throw new Error('There are no validated game files to import.');
    }

    await this.waitForExecutionQueue();
    await this.clearProjectFiles();

    const wc = await getWebContainer();
    const snapshot: Record<string, Uint8Array> = {};

    for (const file of files) {
      const path = cleanWorkDirRelativePath(file.path);

      if (!path || path.startsWith('../') || path.includes('/../')) {
        throw new Error(`Unsafe imported game path: ${file.path}`);
      }

      const parent = nodePath.posix.dirname(path);

      if (parent !== '.') {
        await wc.fs.mkdir(parent, { recursive: true });
      }

      // Imported zips can carry the legacy mid-document splice corruption in
      // their text sources; repair on the way in so the preview and every
      // later publish start from clean sources.
      let bytes = file.bytes;
      if (/\.(?:html?|xhtml|mjs|jsx|tsx?|js|txt)$/i.test(path)) {
        try {
          const text = new TextDecoder().decode(bytes);
          const repaired = repairImportedGameSource(path, text);
          if (repaired !== text) {
            bytes = new TextEncoder().encode(repaired) as Uint8Array;
          }
        } catch {
          // Non-UTF8 payload: leave the bytes untouched.
        }
      }

      await wc.fs.writeFile(path, bytes);
      snapshot[path] = bytes;
    }

    this.#filesStore.replaceFromCheckpoint(snapshot);
    this.setDocuments(this.files.get());
    generatedAssets.set({});
    this.isImportedHtml5Game.set(true);
    try {
      localStorage.setItem(IMPORTED_HTML5_MODE_KEY, '1');
    } catch {}
    this.currentView.set('preview');
    this.preferPlayView.set(true);
    this.showWorkbench.set(true);

    try {
      await this.startStaticPreviewServer();
    } catch (error) {
      console.warn('Static preview server could not start yet:', error);
    }

    const previewReady = await this.waitForPreviewReady(15_000);

    if (!previewReady) {
      // Never fail a valid upload on a slow server: the files are already in
      // the workspace and the Game tab falls back to the inlined HTML preview.
      console.warn('Uploaded game files are ready, but the HTTP preview did not answer in time.');
    } else if (typeof window !== 'undefined') {
      // Reload the iframe so it picks up the live server URL immediately.
      window.dispatchEvent(new Event('thefortz-build-finished'));
    }
  }

  addArtifact({ messageId, title, id, type }: ArtifactCallbackData) {
    const artifact = this.#getArtifact(messageId);

    if (artifact) {
      return;
    }

    if (!this.artifactIdList.includes(messageId)) {
      this.artifactIdList.push(messageId);
    }

    this.artifacts.setKey(messageId, {
      id,
      title,
      closed: false,
      type,
      runner: new ActionRunner(
        webcontainer,
        () => this.boltTerminal,
        () => this.startStaticPreviewServer(),
        messageId,
      ),
    });
  }

  updateArtifact({ messageId }: ArtifactCallbackData, state: Partial<ArtifactUpdateState>) {
    const artifact = this.#getArtifact(messageId);

    if (!artifact) {
      return;
    }

    this.artifacts.setKey(messageId, { ...artifact, ...state });
  }

  closeArtifact(messageId: string) {
    const artifact = this.#getArtifact(messageId);

    if (artifact) {
      this.artifacts.setKey(messageId, { ...artifact, closed: true });
    }
  }

  /** Apply a Cline tool write directly to Bolt's real editor and WebContainer. */
  async applyClineFileWrite(
    messageId: string,
    artifactId: string,
    actionId: string,
    filePath: string,
    content: string,
    signal?: AbortSignal,
    onProgress?: (progress: number) => void,
  ): Promise<{ characters: number }> {
    const operation = executionPolicy.plan?.fileOperations.find((file) => file.path === filePath);

    if (!operation) {
      throw new Error(`Cline file write was not approved or exceeded the file limit: ${filePath}`);
    }

    const formattedContent = await formatWorkspaceSource(filePath, content);

    if (formattedContent.length > 2_000_000) {
      throw new Error(`Formatted file exceeds the 2 MB limit: ${filePath}`);
    }

    this.showWorkbench.set(true);
    this.currentView.set('code');

    if (!this.#getArtifact(messageId)) {
      this.addArtifact({ messageId, id: artifactId, title: 'Cline Game Build', type: 'bundled' });
    }

    const data: ActionCallbackData = {
      artifactId,
      messageId,
      actionId,
      action: { type: 'file', filePath, content: formattedContent },
    };
    const editorPath = resolveWorkDirPath(filePath);
    const revealData: ActionCallbackData = {
      ...data,
      action: { ...data.action, content: '' },
    };
    this.addAction(revealData);

    const artifact = this.#getArtifact(messageId);
    const registeredAction = artifact?.runner.actions.get()[actionId];

    if (!artifact || registeredAction?.status === 'failed') {
      throw new Error(registeredAction?.status === 'failed' ? registeredAction.error : 'Could not open the game workspace.');
    }

    const lineEnds: number[] = [];
    for (let index = 0; index < formattedContent.length; index++) {
      if (formattedContent[index] === '\n') lineEnds.push(index + 1);
    }
    if (lineEnds.at(-1) !== formattedContent.length) lineEnds.push(formattedContent.length);
    const lineCount = Math.max(1, lineEnds.length);
    const revealDuration = Math.min(2400, Math.max(500, lineCount * 14));
    const startTime = performance.now();
    let lastRevealedLine = 0;
    let lastReportedProgress = -5;

    await new Promise<void>((resolve, reject) => {
      if (signal?.aborted) {
        reject(new DOMException('File reveal cancelled.', 'AbortError'));
        return;
      }

      const onAbort = () => reject(new DOMException('File reveal cancelled.', 'AbortError'));
      signal?.addEventListener('abort', onAbort, { once: true });
      const revealFrame = (time: number) => {
        if (signal?.aborted) {
          signal.removeEventListener('abort', onAbort);
          reject(new DOMException('File reveal cancelled.', 'AbortError'));
          return;
        }

        const progress = Math.min(1, (time - startTime) / revealDuration);
        const revealedLine = Math.min(
          lineCount,
          progress >= 1 ? lineCount : Math.max(1, Math.floor(progress * lineCount)),
        );

        if (revealedLine > lastRevealedLine) {
          lastRevealedLine = revealedLine;
          const visibleCharacters = lineEnds[revealedLine - 1] ?? formattedContent.length;
          this.#editorStore.updateFile(editorPath, formattedContent.slice(0, visibleCharacters), true);
        }

        const progressPercent = Math.floor(progress * 100);
        if (progressPercent >= lastReportedProgress + 5 || progress >= 1) {
          lastReportedProgress = progressPercent;
          onProgress?.(progressPercent);
        }

        if (progress >= 1) {
          signal?.removeEventListener('abort', onAbort);
          resolve();
        }
        else requestAnimationFrame(revealFrame);
      };

      requestAnimationFrame(revealFrame);
    });

    this.runAction(data);
    await this.waitForExecutionQueue();

    const completedAction = artifact.runner.actions.get()[actionId];

    if (completedAction?.status !== 'complete' || !completedAction.executed) {
      throw new Error(completedAction?.status === 'failed' ? completedAction.error : `Bolt did not finish writing ${filePath}.`);
    }

    return { characters: formattedContent.length };
  }

  addAction(data: ActionCallbackData) {
    const normalizedData = normalizeActionData(data);
    const isExisting =
      normalizedData.action.type === 'file' && Boolean(this.#filesStore.getFile(normalizedData.action.filePath));

    startActionActivity(normalizedData.messageId, normalizedData.actionId, normalizedData.action, isExisting);

    try {
      executionPolicy.authorize(normalizedData.messageId, normalizedData.actionId, normalizedData.action, 'reserve');
    } catch (error) {
      const artifact = this.#getArtifact(normalizedData.messageId);

      if (!artifact) {
        unreachable('Artifact not found');
      }

      artifact.runner.addRejectedAction(normalizedData, (error as Error).message || 'Action is not approved.');
      updateActivity(normalizedData.messageId, actionStepId(normalizedData.actionId), 'failed');

      return;
    }

    if (normalizedData.action.type === 'file') {
      const fullPath = normalizedData.action.filePath;
      this.streamingFile.set(fullPath);

      if (this.selectedFile.value !== fullPath) {
        this.setSelectedFile(fullPath);
      }

      this.#focusCodeUnlessPlayPinned();

      this.#editorStore.beginAIEdit(fullPath, normalizedData.messageId, this.#filesStore.getFile(fullPath)?.content);
      this.#editorStore.updateFile(fullPath, normalizedData.action.content || '', true);
    }

    this._addAction(normalizedData);
  }
  async _addAction(data: ActionCallbackData) {
    const { messageId } = data;

    const artifact = this.#getArtifact(messageId);

    if (!artifact) {
      unreachable('Artifact not found');
    }

    return artifact.runner.addAction(data);
  }

  runAction(data: ActionCallbackData, isStreaming: boolean = false) {
    const normalizedData = normalizeActionData(data);
    const artifact = this.#getArtifact(normalizedData.messageId);
    const registeredAction = artifact?.runner.actions.get()[normalizedData.actionId];

    if (registeredAction?.status === 'failed' || registeredAction?.status === 'aborted') {
      updateActivity(
        normalizedData.messageId,
        actionStepId(normalizedData.actionId),
        registeredAction.status === 'failed' ? 'failed' : 'aborted',
      );

      return;
    }

    if (!isStreaming && normalizedData.action.type === 'file') {
      try {
        executionPolicy.authorize(normalizedData.messageId, normalizedData.actionId, normalizedData.action, 'complete');
      } catch (error) {
        artifact?.runner.rejectAction(
          normalizedData.actionId,
          (error as Error).message || 'File action is not approved.',
        );
        updateActivity(normalizedData.messageId, actionStepId(normalizedData.actionId), 'failed');

        return;
      }
    }

    if (isStreaming) {
      if (normalizedData.action.type === 'file') {
        updateActivity(normalizedData.messageId, actionStepId(normalizedData.actionId), 'running');
      }

      this._runAction(normalizedData, true);

      return;
    }

    /*
     * Keep the editor and virtual file map current immediately. Only the
     * WebContainer write is queued behind earlier shell/file actions.
     */
    if (normalizedData.action.type === 'file') {
      this.#commitFileState(normalizedData);
    }

    this.addToExecutionQueue(() => this._runAction(normalizedData, false, true));
  }

  #commitFileState(data: ActionCallbackData) {
    if (data.action.type !== 'file') {
      return;
    }

    const fullPath = data.action.filePath;
    this.streamingFile.set(fullPath);

    if (this.selectedFile.value !== fullPath) {
      this.setSelectedFile(fullPath);
    }

    this.#focusCodeUnlessPlayPinned();
    this.#editorStore.updateFile(fullPath, data.action.content || '', true);
    this.#filesStore.files.setKey(fullPath, {
      type: 'file',
      content: data.action.content || '',
      isBinary: false,
    });
  }

  async _runAction(data: ActionCallbackData, isStreaming: boolean = false, fileStateCommitted = false) {
    const normalizedData = normalizeActionData(data);
    const { messageId } = normalizedData;

    const artifact = this.#getArtifact(messageId);

    if (!artifact) {
      unreachable('Artifact not found');
    }

    if (normalizedData.action.type === 'file') {
      if (!fileStateCommitted) {
        this.#commitFileState(normalizedData);
      }

      if (isStreaming) {
        return;
      }

      // Wait for the real write before reporting the file as completed.
      await artifact.runner.runAction(normalizedData);

      const actionState = artifact.runner.actions.get()[normalizedData.actionId];

      if (this.streamingFile.get() === normalizedData.action.filePath) {
        this.streamingFile.set(undefined);
      }

      if (!actionState || actionState.status === 'failed' || actionState.status === 'aborted') {
        return;
      }

      const completedFiles = new Set(this.completedFiles.get());
      completedFiles.add(normalizedData.action.filePath);
      this.completedFiles.set(completedFiles);
      this.resetAllFileModifications();
    } else {
      await artifact.runner.runAction(normalizedData);
    }
  }

  #getArtifact(id: string) {
    const artifacts = this.artifacts.get();
    return artifacts[id];
  }

  async downloadZip() {
    const zip = new JSZip();
    const files = this.files.get();

    // Get the project name from the description input, or use a default name
    const projectName = (description.value ?? 'project').toLocaleLowerCase().split(' ').join('_');

    // Generate a simple 6-character hash based on the current timestamp
    const timestampHash = Date.now().toString(36).slice(-6);
    const uniqueProjectName = `${projectName}_${timestampHash}`;

    for (const [filePath, dirent] of Object.entries(files)) {
      if (dirent?.type === 'file' && !dirent.isBinary) {
        const relativePath = extractRelativePath(filePath);

        // split the path into segments
        const pathSegments = relativePath.split('/');

        // if there's more than one segment, we need to create folders
        if (pathSegments.length > 1) {
          let currentFolder = zip;

          for (let i = 0; i < pathSegments.length - 1; i++) {
            currentFolder = currentFolder.folder(pathSegments[i])!;
          }
          currentFolder.file(pathSegments[pathSegments.length - 1], dirent.content);
        } else {
          // if there's only one segment, it's a file in the root
          zip.file(relativePath, dirent.content);
        }
      }
    }

    // Generate the zip file and save it
    const content = await zip.generateAsync({ type: 'blob' });
    saveAs(content, `${uniqueProjectName}.zip`);
  }

  async syncFiles(targetHandle: FileSystemDirectoryHandle) {
    const files = this.files.get();
    const syncedFiles = [];

    for (const [filePath, dirent] of Object.entries(files)) {
      if (dirent?.type === 'file' && !dirent.isBinary) {
        const relativePath = extractRelativePath(filePath);
        const pathSegments = relativePath.split('/');
        let currentHandle = targetHandle;

        for (let i = 0; i < pathSegments.length - 1; i++) {
          currentHandle = await currentHandle.getDirectoryHandle(pathSegments[i], { create: true });
        }

        // create or get the file
        const fileHandle = await currentHandle.getFileHandle(pathSegments[pathSegments.length - 1], {
          create: true,
        });

        // write the file content
        const writable = await fileHandle.createWritable();
        await writable.write(dirent.content);
        await writable.close();

        syncedFiles.push(relativePath);
      }
    }

    return syncedFiles;
  }

  async pushToGitHub(repoName: string, githubUsername?: string, ghToken?: string) {
    try {
      // Use cookies if username and token are not provided
      const githubToken = ghToken || Cookies.get('githubToken');
      const owner = githubUsername || Cookies.get('githubUsername');

      if (!githubToken || !owner) {
        throw new Error('GitHub token or username is not set in cookies or provided.');
      }

      // Initialize Octokit with the auth token
      const octokit = new Octokit({ auth: githubToken });

      // Check if the repository already exists before creating it
      let repo: RestEndpointMethodTypes['repos']['get']['response']['data'];

      try {
        const resp = await octokit.repos.get({ owner, repo: repoName });
        repo = resp.data;
      } catch (error) {
        if (error instanceof Error && 'status' in error && error.status === 404) {
          // Repository doesn't exist, so create a new one
          const { data: newRepo } = await octokit.repos.createForAuthenticatedUser({
            name: repoName,
            private: false,
            auto_init: true,
          });
          repo = newRepo;
        } else {
          console.log('cannot create repo!');
          throw error; // Some other error occurred
        }
      }

      // Get all files
      const files = this.files.get();

      if (!files || Object.keys(files).length === 0) {
        throw new Error('No files found to push');
      }

      // Create blobs for each file
      const blobs = await Promise.all(
        Object.entries(files).map(async ([filePath, dirent]) => {
          if (dirent?.type === 'file' && dirent.content) {
            const { data: blob } = await octokit.git.createBlob({
              owner: repo.owner.login,
              repo: repo.name,
              content: Buffer.from(dirent.content).toString('base64'),
              encoding: 'base64',
            });
            return { path: extractRelativePath(filePath), sha: blob.sha };
          }

          return null;
        }),
      );

      const validBlobs = blobs.filter(Boolean); // Filter out any undefined blobs

      if (validBlobs.length === 0) {
        throw new Error('No valid files to push');
      }

      // Get the latest commit SHA (assuming main branch, update dynamically if needed)
      const { data: ref } = await octokit.git.getRef({
        owner: repo.owner.login,
        repo: repo.name,
        ref: `heads/${repo.default_branch || 'main'}`, // Handle dynamic branch
      });
      const latestCommitSha = ref.object.sha;

      // Create a new tree
      const { data: newTree } = await octokit.git.createTree({
        owner: repo.owner.login,
        repo: repo.name,
        base_tree: latestCommitSha,
        tree: validBlobs.map((blob) => ({
          path: blob!.path,
          mode: '100644',
          type: 'blob',
          sha: blob!.sha,
        })),
      });

      // Create a new commit
      const { data: newCommit } = await octokit.git.createCommit({
        owner: repo.owner.login,
        repo: repo.name,
        message: 'Initial commit from your app',
        tree: newTree.sha,
        parents: [latestCommitSha],
      });

      // Update the reference
      await octokit.git.updateRef({
        owner: repo.owner.login,
        repo: repo.name,
        ref: `heads/${repo.default_branch || 'main'}`, // Handle dynamic branch
        sha: newCommit.sha,
      });

      alert(`Repository created and code pushed: ${repo.html_url}`);
    } catch (error) {
      console.error('Error pushing to GitHub:', error);
      throw error; // Rethrow the error for further handling
    }
  }
}

export const workbenchStore = new WorkbenchStore();
