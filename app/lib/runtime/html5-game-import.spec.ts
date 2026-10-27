import { describe, expect, it } from 'vitest';
import JSZip from 'jszip';
import { MAX_GAME_FILES, MAX_GAME_IMPORT_BYTES, prepareHtml5GameImport } from './html5-game-import';

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
  it('allows up to 100 MiB per complete imported game', () => {
    expect(MAX_GAME_IMPORT_BYTES).toBe(100 * 1024 * 1024);
  });

  it('allows up to 600 files in a game ZIP', async () => {
    const entries: Record<string, string> = {
      'index.html': '<!doctype html><html><body>game</body></html>',
    };
    for (let i = 1; i < MAX_GAME_FILES; i++) {
      entries[`assets/file-${i}.txt`] = 'x';
    }

    const imported = await prepareHtml5GameImport([await zipFile(entries)]);

    expect(imported.files).toHaveLength(600);
  });

  it('rejects a game ZIP with more than 600 files', async () => {
    const entries: Record<string, string> = {
      'index.html': '<!doctype html><html><body>game</body></html>',
    };
    for (let i = 1; i <= MAX_GAME_FILES; i++) {
      entries[`assets/file-${i}.txt`] = 'x';
    }

    await expect(prepareHtml5GameImport([await zipFile(entries)])).rejects.toThrow(/under 600 files/);
  });

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

  it('accepts ZIP archives with 33 MiB of uncompressed game data', async () => {
    const zip = new JSZip();
    zip.file('index.html', '<!doctype html><html><body><canvas></canvas></body></html>');
    zip.file('assets/large.bin', new Uint8Array(33 * 1024 * 1024), { compression: 'DEFLATE', compressionOptions: { level: 1 } });
    const archive = new File([await zip.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 1 } })], 'large-game.zip');

    const imported = await prepareHtml5GameImport([archive]);

    expect(imported.totalBytes).toBeGreaterThan(33 * 1024 * 1024);
    expect(imported.entryPoint).toBe('index.html');
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

  it('renames a valid non-index HTML entry point to index.html', async () => {
    const result = await prepareHtml5GameImport([
      namedFile('racer.html', '<html><body><canvas></canvas><script src="main.js"></script></body></html>'),
      namedFile('main.js', 'requestAnimationFrame(() => {});'),
    ]);

    expect(result.entryPoint).toBe('index.html');
    expect(result.files.map((file) => file.path)).toEqual(['index.html', 'main.js']);
  });

  it('accepts an upload whenever it contains HTML, without pre-screening its other files', async () => {
    const archive = await zipFile({
      'play.html': '<html><body><script src="src/main.ts"></script></body></html>',
      'src/main.ts': 'const game: string = "no";',
      'native/game.cpp': 'int main() { return 0; }',
    });

    const result = await prepareHtml5GameImport([archive]);
    expect(result.entryPoint).toBe('index.html');
    expect(result.files.some((file) => file.path === 'index.html')).toBe(true);
  });

  it('rejects a missing entry document', async () => {
    const archive = await zipFile({ 'game.js': 'requestAnimationFrame(() => {});' });

    await expect(prepareHtml5GameImport([archive])).rejects.toThrow(/No \.html file/);
  });

  it('accepts an HTML page even when a referenced local script is missing', async () => {
    const archive = await zipFile({
      'game.html': '<html><body><script src="game.js"></script></body></html>',
    });

    const result = await prepareHtml5GameImport([archive]);
    expect(result.entryPoint).toBe('index.html');
    expect(result.files).toHaveLength(1);
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
