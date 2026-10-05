import { describe, expect, it } from 'vitest';
import { formatWorkspaceSource } from './source-format';

describe('workspace source formatting', () => {
  it('formats dense JavaScript into readable, indented lines', async () => {
    const formatted = await formatWorkspaceSource(
      'game.js',
      'const start=()=>{const speed=10;requestAnimationFrame(()=>update(speed));};start();',
    );

    expect(formatted).toContain('\n  const speed = 10;');
    expect(formatted.split('\n').every((line) => line.length <= 100)).toBe(true);
  });

  it('preserves supported files with unknown extensions', async () => {
    const source = 'const value=1';
    await expect(formatWorkspaceSource('notes.txt', source)).resolves.toBe(source);
  });

  it('formats HTML, CSS, and JSON using their matching parsers', async () => {
    const html = await formatWorkspaceSource('index.html', '<!doctype html><html><body><main id="game"></main></body></html>');
    const css = await formatWorkspaceSource('style.css', 'body{margin:0;color:#fff}');
    const json = await formatWorkspaceSource(
      'package.json',
      '{"scripts":{"start":"vite","build":"vite build","test":"vitest --run"},"description":"A deliberately long project description that is used to verify readable JSON formatting in the generated workspace."}',
    );

    expect(html).toContain('\n  <body>');
    expect(css).toContain('body {');
    expect(json).toContain('\n  "scripts"');
  });

  it('rejects syntactically invalid JavaScript instead of writing it silently', async () => {
    await expect(formatWorkspaceSource('game.js', 'function start( {')).rejects.toThrow();
  });
});
