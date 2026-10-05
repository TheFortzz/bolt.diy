import { describe, expect, it } from 'vitest';
import { isApprovedEngineMigration } from './source-safety';

describe('approved renderer migrations', () => {
  it('allows a planned Canvas-to-WebGL rewrite without requiring old renderer symbols', () => {
    expect(
      isApprovedEngineMigration(
        'webgl',
        "const ctx = canvas.getContext('2d');\nfunction resize() {}\nconst soundButton = null;",
        'const renderer = new THREE.WebGLRenderer({ canvas });',
      ),
    ).toBe(true);
  });

  it('allows a planned WebGL-to-Canvas rewrite', () => {
    expect(
      isApprovedEngineMigration(
        'canvas2d',
        'const renderer = new THREE.WebGLRenderer({ canvas });',
        "const context = canvas.getContext('2d');",
      ),
    ).toBe(true);
  });

  it('recognizes a Three.js module import even when it uses another local name', () => {
    expect(
      isApprovedEngineMigration(
        'webgl',
        "const ctx = canvas.getContext('2d');",
        "import * as three from 'https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js';",
      ),
    ).toBe(true);
  });

  it('keeps the continuity guard enabled for ordinary edits and unapproved rewrites', () => {
    expect(isApprovedEngineMigration('canvas2d', 'function start() {}', 'function render() {}')).toBe(false);
    expect(isApprovedEngineMigration('webgl', 'function start() {}', 'function render() {}')).toBe(false);
    expect(isApprovedEngineMigration(undefined, 'function start() {}', 'function render() {}')).toBe(false);
  });
});
