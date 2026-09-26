import { atom, computed, map, type MapStore, type WritableAtom } from 'nanostores';
import type { EditorDocument, ScrollPosition } from '~/components/editor/codemirror/CodeMirrorEditor';
import type { FileMap, FilesStore } from './files';

export type EditorDocuments = Record<string, EditorDocument>;

type SelectedFile = WritableAtom<string | undefined>;

export class EditorStore {
  #filesStore: FilesStore;

  selectedFile: SelectedFile = import.meta.hot?.data.selectedFile ?? atom<string | undefined>();
  documents: MapStore<EditorDocuments> = import.meta.hot?.data.documents ?? map({});

  currentDocument = computed([this.documents, this.selectedFile], (documents, selectedFile) => {
    if (!selectedFile) {
      return undefined;
    }

    return documents[selectedFile];
  });

  constructor(filesStore: FilesStore) {
    this.#filesStore = filesStore;

    if (import.meta.hot) {
      import.meta.hot.data.documents = this.documents;
      import.meta.hot.data.selectedFile = this.selectedFile;
    }
  }

  setDocuments(files: FileMap) {
    const previousDocuments = this.documents.value;

    const nextDocuments = Object.fromEntries<EditorDocument>(
      Object.entries(files)
        .map(([filePath, dirent]) => {
          if (dirent === undefined || dirent.type === 'folder') {
            return undefined;
          }

          const previousDocument = previousDocuments?.[filePath];

          return [
            filePath,
            {
              value: dirent.content,
              filePath,
              isBinary: dirent.isBinary,
              scroll: previousDocument?.scroll,
              originalContent: previousDocument?.originalContent,
            },
          ] as [string, EditorDocument];
        })
        .filter(Boolean) as Array<[string, EditorDocument]>,
    );

    // Keep soft streaming documents that aren't in the WebContainer file map yet.
    for (const [filePath, doc] of Object.entries(previousDocuments || {})) {
      if (!nextDocuments[filePath] && doc && !doc.isBinary) {
        nextDocuments[filePath] = doc;
      }
    }

    this.documents.set(nextDocuments);
  }

  setSelectedFile(filePath: string | undefined) {
    this.selectedFile.set(filePath);
  }

  updateScrollPosition(filePath: string, position: ScrollPosition) {
    const documents = this.documents.get();
    const documentState = documents[filePath];

    if (!documentState) {
      return;
    }

    this.documents.setKey(filePath, {
      ...documentState,
      scroll: position,
    });
  }

  updateFile(filePath: string, newContent: string) {
    const documents = this.documents.get();
    const documentState = documents[filePath];

    if (!documentState) {
      // Create a soft document during streaming so the editor can show progress
      // without waiting for WebContainer file-watcher roundtrips.
      this.documents.setKey(filePath, {
        value: newContent,
        filePath,
        isBinary: false,
      });
      return;
    }

    const currentContent = documentState.value;
    const contentChanged = currentContent !== newContent;

    if (contentChanged) {
      const originalContent = documentState.originalContent ?? (currentContent || undefined);

      this.documents.setKey(filePath, {
        ...documentState,
        originalContent,
        value: newContent,
      });
    }
  }

  acceptDiff(filePath: string) {
    const documents = this.documents.get();
    const documentState = documents[filePath];

    if (documentState && documentState.originalContent !== undefined) {
      this.documents.setKey(filePath, {
        ...documentState,
        originalContent: undefined,
      });
    }
  }

  revertDiff(filePath: string) {
    const documents = this.documents.get();
    const documentState = documents[filePath];

    if (documentState && documentState.originalContent !== undefined) {
      this.documents.setKey(filePath, {
        ...documentState,
        value: documentState.originalContent,
        originalContent: undefined,
      });
    }
  }
}
