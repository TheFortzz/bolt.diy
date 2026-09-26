import { atom, map, type MapStore, type ReadableAtom, type WritableAtom } from 'nanostores';
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
import { extractRelativePath } from '~/utils/diff';
import { WORK_DIR } from '~/utils/constants';
import { description } from '~/lib/persistence';
import Cookies from 'js-cookie';

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

function resolveWorkDirPath(filePath: string) {
  const isWorkDirPath = filePath === WORK_DIR || filePath.startsWith(`${WORK_DIR}/`);
  const relativePath = (isWorkDirPath ? filePath.slice(WORK_DIR.length) : filePath).replace(/^\/+/, '');
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

    // A debounced edit can finish after the user selected another file. Keep
    // the write attached to its source path and only update the visible file's
    // unsaved marker when it is still selected.
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

  async saveFile(filePath: string) {
    const documents = this.#editorStore.documents.get();
    const document = documents[filePath];

    if (document === undefined) {
      return;
    }

    await this.#filesStore.saveFile(filePath, document.value);

    const newUnsavedFiles = new Set(this.unsavedFiles.get());
    newUnsavedFiles.delete(filePath);

    this.unsavedFiles.set(newUnsavedFiles);
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

  abortAllActions() {
    const artifacts = this.artifacts.get();
    for (const artifact of Object.values(artifacts)) {
      const actions = artifact.runner?.actions?.get();
      if (!actions) continue;
      for (const action of Object.values(actions)) {
        if (action.status === 'pending' || action.status === 'running') {
          action.abort?.();
        }
      }
    }
  }

  finishPendingActions() {
    const artifacts = this.artifacts.get();
    for (const artifact of Object.values(artifacts)) {
      const runner = artifact.runner;
      if (!runner) continue;

      for (const [actionId, action] of Object.entries(runner.actions.get())) {
        // A streamed action without a close callback is incomplete. Do not
        // claim that its partial file was written or mark it executable.
        if ((action.status === 'pending' || action.status === 'running') && !action.executed) {
          runner.actions.setKey(actionId, { ...action, status: 'aborted', executed: false });
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
  '.wasm': 'application/wasm',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2'
};

const baseDir = path.resolve(fs.existsSync('/home/project') ? '/home/project' : process.cwd());

http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
  let cleanUrl = (req.url || '/').split('?')[0].replace(/^\\/+/, '');
  if (!cleanUrl) cleanUrl = 'index.html';

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

  if (!file && (cleanUrl.endsWith('.html') || !path.extname(cleanUrl))) {
    const defaultIndex = path.join(baseDir, 'index.html');
    if (fs.existsSync(defaultIndex)) file = defaultIndex;
  }

  if (file) {
    const ext = path.extname(file).toLowerCase();
    res.writeHead(200, { 'Content-Type': mimes[ext] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  } else {
    res.writeHead(404);
    res.end('Not Found');
  }
}).listen(0, '0.0.0.0');
`;
      await wc.fs.writeFile('/.static_server.cjs', serveCode);
      const process = await wc.spawn('node', ['/.static_server.cjs']);
      void process.exit.then(
        () => {
          this.#staticServerStarted = false;
        },
        () => {
          this.#staticServerStarted = false;
        },
      );
    } catch (e) {
      this.#staticServerStarted = false;
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
  addAction(data: ActionCallbackData) {
    const normalizedData = normalizeActionData(data);

    if (normalizedData.action.type === 'file') {
      const fullPath = normalizedData.action.filePath;
      this.streamingFile.set(fullPath);

      if (this.selectedFile.value !== fullPath) {
        this.setSelectedFile(fullPath);
      }

      this.#focusCodeUnlessPlayPinned();

      this.#editorStore.updateFile(fullPath, normalizedData.action.content || '');
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

    if (isStreaming) {
      this._runAction(normalizedData, true);
      return;
    }

    // Keep the editor and virtual file map current immediately. Only the
    // WebContainer write is queued behind earlier shell/file actions.
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
    this.#editorStore.updateFile(fullPath, data.action.content || '');
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
