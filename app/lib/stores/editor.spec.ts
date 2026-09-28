import { beforeEach, describe, expect, it } from 'vitest';
import { EditorStore } from './editor';
import type { FilesStore } from './files';

describe('AI edit baselines', () => {
  let editor: EditorStore;

  beforeEach(() => {
    editor = new EditorStore({} as FilesStore);
    editor.documents.set({});
  });

  it('keeps the original source stable across partial and repeated edits in one turn', () => {
    const path = '/home/project/game.js';
    editor.documents.setKey(path, { value: 'old source', filePath: path, isBinary: false });
    editor.beginAIEdit(path, 'first-turn', 'old source');
    editor.updateFile(path, 'partial', true);
    editor.beginAIEdit(path, 'first-turn', 'partial');
    editor.updateFile(path, 'new source', true);
    editor.setDocuments({ [path]: { type: 'file', content: 'new source', isBinary: false } });

    expect(editor.documents.get()[path].originalContent).toBe('old source');
    expect(editor.documents.get()[path].value).toBe('new source');

    editor.beginAIEdit(path, 'second-turn', 'new source');
    expect(editor.documents.get()[path].originalContent).toBe('new source');
    expect(editor.documents.get()[path].aiEditMessageId).toBe('second-turn');
  });

  it('treats a newly created file as code, not a diff against a partial stream', () => {
    const path = '/home/project/new.js';
    editor.beginAIEdit(path, 'turn', undefined);
    editor.updateFile(path, 'half', true);
    editor.updateFile(path, 'complete', true);

    expect(editor.documents.get()[path].aiCreated).toBe(true);
    expect(editor.documents.get()[path].originalContent).toBeUndefined();
  });

  it('retains a valid empty baseline for edits to an existing empty file', () => {
    const path = '/home/project/empty.js';
    editor.beginAIEdit(path, 'turn', '');
    editor.updateFile(path, 'new code', true);

    expect(editor.documents.get()[path].aiCreated).toBe(false);
    expect(editor.documents.get()[path].originalContent).toBe('');
  });
});
