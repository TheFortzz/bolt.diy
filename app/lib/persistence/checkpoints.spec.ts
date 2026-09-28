import type { WebContainer } from '@webcontainer/api';
import { describe, expect, it } from 'vitest';
import { applyProjectSnapshot, captureProject } from './checkpoints';

const encoder = new TextEncoder();

function project(initial: Record<string, Uint8Array>) {
  const files = new Map(Object.entries(initial).map(([path, content]) => [`/home/project/${path}`, content]));
  const directories = new Set(['/home/project']);

  for (const path of files.keys()) {
    const parts = path.split('/');

    for (let i = 4; i < parts.length; i++) {
      directories.add(parts.slice(0, i).join('/'));
    }
  }

  const fs = {
    readdir: async (directory: string) => {
      const names = new Map<string, 'file' | 'directory'>();

      for (const path of directories) {
        if (path !== directory && path.substring(0, path.lastIndexOf('/')) === directory) {
          names.set(path.substring(directory.length + 1), 'directory');
        }
      }

      for (const path of files.keys()) {
        if (path.substring(0, path.lastIndexOf('/')) === directory) {
          names.set(path.substring(directory.length + 1), 'file');
        }
      }

      return [...names].map(([name, type]) => ({
        name,
        isDirectory: () => type === 'directory',
        isFile: () => type === 'file',
      }));
    },
    readFile: async (path: string) => {
      const value = files.get(path);

      if (!value) {
        throw new Error(`Missing file: ${path}`);
      }

      return value;
    },
    rm: async (path: string) => {
      files.delete(path);
    },
    mkdir: async (path: string) => {
      directories.add(path);
    },
    writeFile: async (path: string, content: Uint8Array) => {
      files.set(path, content);
    },
  };

  return { wc: { fs } as unknown as WebContainer, files };
}

describe('project checkpoints', () => {
  it('captures source and binary files without dependencies or secrets', async () => {
    const binary = new Uint8Array([0, 255, 12]);
    const { wc } = project({
      'index.html': encoder.encode('<html></html>'),
      'assets/icon.png': binary,
      'node_modules/pkg/index.js': encoder.encode('not a source file'),
      '.env': encoder.encode('SECRET'),
    });

    expect(await captureProject(wc)).toEqual({
      'index.html': encoder.encode('<html></html>'),
      'assets/icon.png': binary,
    });
  });

  it('reverts edited files and removes files added after the checkpoint', async () => {
    const { wc, files } = project({
      'index.html': encoder.encode('broken'),
      'extra.js': encoder.encode('new'),
      'node_modules/pkg/index.js': encoder.encode('dependency'),
    });

    await applyProjectSnapshot(wc, {
      'index.html': encoder.encode('working'),
      'assets/icon.png': new Uint8Array([1, 2]),
    });

    expect(files.get('/home/project/index.html')).toEqual(encoder.encode('working'));
    expect(files.get('/home/project/extra.js')).toBeUndefined();
    expect(files.get('/home/project/assets/icon.png')).toEqual(new Uint8Array([1, 2]));
    expect(files.get('/home/project/node_modules/pkg/index.js')).toEqual(encoder.encode('dependency'));
  });

  it('rejects unsafe paths before deleting any files', async () => {
    const { wc, files } = project({ 'index.html': encoder.encode('working') });

    await expect(applyProjectSnapshot(wc, { '../escape.js': encoder.encode('x') })).rejects.toThrow(
      'Invalid checkpoint path',
    );
    expect(files.get('/home/project/index.html')).toEqual(encoder.encode('working'));
  });
});
