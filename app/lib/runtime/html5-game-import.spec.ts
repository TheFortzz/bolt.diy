import { describe, expect, it } from 'vitest';
import JSZip from 'jszip';
import { prepareHtml5GameImport } from './html5-game-import';

async function zipFile(entries: Record<string, string>) {
  const zip = new JSZip();

  for (const [path, content] of Object.entries(entries)) {
    zip.file(path, content);
  }

  const blob = await zip.generateAsync({ type: 'blob' });
  return new File([blob], 'game.zip', { type: 'application/zip' });
}

function namedFile(name: string, content: string, relativePath = ''): File {
  const file = new File([content], name, { type: '' });
  if (relativePath) Object.defineProperty(file, 'webkitRelativePath', { value: relativePath });
  return file;
}

describe('HTML5 game import validator', () => {
  it('accepts a built ZIP game and strips a single enclosing folder', async () => {
    const archive = await zipFile({
      'NeonGame/index.html':
        '<!doctype html><html><body><canvas></canvas><script src="game.js"></script></body></html>',
      'NeonGame/game.js': 'requestAnimationFrame(() => {});',
      'NeonGame/assets/ship.png': 'not really PNG, but import validates file structure only',
    });

    const result = await prepareHtml5GameImport([archive]);

    expect(result.entryPoint).toBe('index.html');
    expect(result.files.map((file) => file.path)).toEqual(['assets/ship.png', 'game.js', 'index.html']);
    expect(result.files.find((file) => file.path === 'assets/ship.png')?.mimeType).toBe('image/png');
  });

  it('accepts selected browser-ready HTML/JS files and preserves directory paths', async () => {
    const result = await prepareHtml5GameImport([
      namedFile(
        'index.html',
        '<html><body><canvas></canvas><script src="src/game.mjs"></script></body></html>',
        'Build/index.html',
      ),
      namedFile('game.mjs', 'requestAnimationFrame(() => {});', 'Build/src/game.mjs'),
    ]);

    expect(result.entryPoint).toBe('index.html');
    expect(result.files.map((file) => file.path)).toContain('src/game.mjs');
  });

  it('rejects TypeScript files in the archive', async () => {
    const archive = await zipFile({
      'index.html': '<html><body><script src="src/main.ts"></script></body></html>',
      'src/main.ts': 'const game: string = "no";',
    });

    await expect(prepareHtml5GameImport([archive])).rejects.toThrow(/not a browser-ready HTML5 game file|TypeScript/i);
  });

  it('rejects native C++ projects instead of claiming they will run in the browser', async () => {
    const archive = await zipFile({
      'index.html': '<html><body><canvas></canvas></body></html>',
      'src/game.cpp': 'int main() { return 0; }',
    });

    await expect(prepareHtml5GameImport([archive])).rejects.toThrow(/not a browser-ready HTML5 game file/);
  });

  it('rejects a missing entry document', async () => {
    const archive = await zipFile({ 'game.js': 'requestAnimationFrame(() => {});' });

    await expect(prepareHtml5GameImport([archive])).rejects.toThrow(/No index.html/);
  });

  it('rejects a missing local entry script before importing', async () => {
    const archive = await zipFile({
      'index.html': '<html><body><script src="game.js"></script></body></html>',
    });

    await expect(prepareHtml5GameImport([archive])).rejects.toThrow(/game.js.*missing/);
  });

  it('rejects unsafe paths and traversal entries', async () => {
    await expect(
      prepareHtml5GameImport([
        namedFile('index.html', '<html><body><canvas></canvas></body></html>'),
        namedFile('outside.js', 'window.pwned = true;', '../outside.js'),
      ]),
    ).rejects.toThrow(/Unsafe game file path/);
  });

  it('rejects an empty selection', async () => {
    await expect(prepareHtml5GameImport([])).rejects.toThrow(/Choose a ZIP/);
  });
});
