import { describe, it, expect } from 'vitest';
import {
  verifyJavaScriptSyntax,
  generateAssetLoaderSnippet,
} from './code-updater';
import type { VisualElement } from './asset-selector';

describe('code-updater', () => {
  describe('verifyJavaScriptSyntax', () => {
    it('approves balanced JavaScript code', () => {
      const code = `
        function draw(ctx, x, y) {
          if (x > 0) {
            ctx.fillRect(x, y, 32, 32);
          }
        }
      `;
      expect(verifyJavaScriptSyntax(code)).toBe(true);
    });

    it('rejects code with unbalanced braces or parentheses', () => {
      const broken1 = 'function test() { if (true) { }';
      const broken2 = 'function test() { return (5 + 2; }';
      expect(verifyJavaScriptSyntax(broken1)).toBe(false);
      expect(verifyJavaScriptSyntax(broken2)).toBe(false);
    });

    it('correctly ignores braces inside strings and comments', () => {
      const code = `
        // { this is a comment }
        /* { multi-line } */
        const str = "hello { world }";
        function run() { return str; }
      `;
      expect(verifyJavaScriptSyntax(code)).toBe(true);
    });
  });

  describe('generateAssetLoaderSnippet', () => {
    it('generates asset loader with shape fallback execution', () => {
      const elements: VisualElement[] = [
        {
          id: 'player',
          fileName: 'assets/player.png',
          description: 'Player hero',
          prompt: 'hero sprite',
          isSprite: true,
        },
        {
          id: 'enemy',
          fileName: 'assets/enemy.png',
          description: 'Enemy alien',
          prompt: 'alien sprite',
          isSprite: true,
        },
      ];

      const snippet = generateAssetLoaderSnippet(elements);

      expect(snippet).toContain('GameAssets');
      expect(snippet).toContain('"assets/player.png"');
      expect(snippet).toContain('"assets/enemy.png"');
      expect(snippet).toContain('ctx.drawImage(img, x, y, width, height)');
      expect(snippet).toContain('shapeFallback()');
      expect(verifyJavaScriptSyntax(snippet)).toBe(true);
    });
  });
});
