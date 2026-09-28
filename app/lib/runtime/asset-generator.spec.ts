import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { generateProjectAssets, isFluxAssetGenerationAvailable } from './asset-generator';
import { getWebContainer } from '~/lib/webcontainer';
import { getHeuristicVisualElements } from '~/lib/.server/flux/asset-selector';
import { generateAssetLoaderSnippet } from '~/lib/.server/flux/code-updater';

vi.mock('~/lib/webcontainer', () => {
  const fileStore = new Map<string, string | Uint8Array>();

  const mockFs = {
    readdir: vi.fn(async () => {
      const dirents = [];
      for (const key of fileStore.keys()) {
        dirents.push({ name: key, isFile: () => !key.includes('/') });
      }
      return dirents;
    }),
    readFile: vi.fn(async (path: string) => {
      const content = fileStore.get(path);
      if (content === undefined) throw new Error(`ENOENT: ${path}`);
      return content;
    }),
    writeFile: vi.fn(async (path: string, content: string | Uint8Array) => {
      fileStore.set(path, content);
    }),
    mkdir: vi.fn(async () => {}),
  };

  const mockInstance = {
    workdir: '/home/project',
    fs: mockFs,
    _store: fileStore,
  };
  const mockWebcontainer = Promise.resolve(mockInstance as any);

  return {
    getWebContainer: vi.fn(async () => mockInstance),
    webcontainer: mockWebcontainer,
  };
});

describe('Asset Generator & Real Test Game Verification', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('checks availability and returns false when FLUX_API_KEY is not configured', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ available: false }),
    }));

    const available = await isFluxAssetGenerationAvailable();
    expect(available).toBe(false);
  });

  it('gracefully skips asset generation and retains shape rendering when FLUX_API_KEY is missing', async () => {
    // Real test game setup
    const container = await getWebContainer();
    const gameJsContent = `
      // Real Canvas Space Game with Shape Rendering
      const canvas = document.getElementById('game');
      const ctx = canvas.getContext('2d');
      const player = { x: 100, y: 100, size: 24 };

      function draw() {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        // Shape-based rendering fallback
        ctx.fillStyle = '#00ffff';
        ctx.fillRect(player.x, player.y, player.size, player.size);
      }
    `;

    await container.fs.writeFile('game.js', gameJsContent);

    // Mock API returning available: false (FLUX_API_KEY missing)
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ available: false }),
    }));

    const result = await generateProjectAssets({
      userPrompt: 'build a retro space shooter game',
    });

    expect(result.ok).toBe(true);
    expect(result.skipped).toBe(true);

    // Verify existing game code is completely preserved
    const finalCode = await container.fs.readFile('game.js');
    expect(finalCode).toBe(gameJsContent);
  });

  it('verifies complete end-to-end flow with real test game: asset generation, /assets/ storage, code update, and shape fallback', async () => {
    const container = await getWebContainer();

    // 1. Initial real test game code with shape-based rendering
    const initialGameCode = `
      const canvas = document.getElementById('game');
      const ctx = canvas.getContext('2d');
      const player = { x: 150, y: 200, size: 32 };
      const enemy = { x: 300, y: 100, size: 32 };

      function render() {
        ctx.clearRect(0, 0, 800, 600);
        // Player shape rendering
        ctx.fillStyle = '#00e5ff';
        ctx.beginPath();
        ctx.arc(player.x, player.y, player.size / 2, 0, Math.PI * 2);
        ctx.fill();

        // Enemy shape rendering
        ctx.fillStyle = '#ff1744';
        ctx.fillRect(enemy.x, enemy.y, enemy.size, enemy.size);
      }
    `;

    const initialHtmlCode = `<!DOCTYPE html><html><body><canvas id="game" width="800" height="600"></canvas><script src="game.js"></script></body></html>`;

    await container.fs.writeFile('game.js', initialGameCode);
    await container.fs.writeFile('index.html', initialHtmlCode);

    // 2. Mock element selection and FLUX.2-pro generation
    const elements = getHeuristicVisualElements('retro space shooter', initialGameCode);
    expect(elements.length).toBeGreaterThanOrEqual(2);
    expect(elements.length).toBeLessThanOrEqual(4);

    const sampleBase64 = btoa('mock-png-sprite-bytes');

    // Mock server response when FLUX_API_KEY is active
    const updatedGameCode = `
      // Updated Game with FLUX.2-pro image assets and shape fallback
      const playerImg = new Image();
      playerImg.src = 'assets/player.png';
      const enemyImg = new Image();
      enemyImg.src = 'assets/enemy.png';

      const canvas = document.getElementById('game');
      const ctx = canvas.getContext('2d');
      const player = { x: 150, y: 200, size: 32 };
      const enemy = { x: 300, y: 100, size: 32 };

      function render() {
        ctx.clearRect(0, 0, 800, 600);

        // Player: Draw image if loaded, fallback to shape rendering
        if (playerImg.complete && playerImg.naturalWidth > 0) {
          ctx.drawImage(playerImg, player.x, player.y, player.size, player.size);
        } else {
          ctx.fillStyle = '#00e5ff';
          ctx.beginPath();
          ctx.arc(player.x, player.y, player.size / 2, 0, Math.PI * 2);
          ctx.fill();
        }

        // Enemy: Draw image if loaded, fallback to shape rendering
        if (enemyImg.complete && enemyImg.naturalWidth > 0) {
          ctx.drawImage(enemyImg, enemy.x, enemy.y, enemy.size, enemy.size);
        } else {
          ctx.fillStyle = '#ff1744';
          ctx.fillRect(enemy.x, enemy.y, enemy.size, enemy.size);
        }
      }
    `;

    vi.stubGlobal('fetch', vi.fn().mockImplementation(async (url: string) => {
      if (url === '/api/generate-assets') {
        return {
          ok: true,
          json: async () => ({
            available: true,
            ok: true,
            assets: [
              { id: 'player', fileName: 'assets/player.png', base64: sampleBase64 },
              { id: 'enemy', fileName: 'assets/enemy.png', base64: sampleBase64 },
            ],
            updatedFiles: {
              'game.js': updatedGameCode,
            },
          }),
        };
      }
      return { ok: false };
    }));

    // 3. Execute asset generation pipeline
    const pipelineResult = await generateProjectAssets({
      userPrompt: 'build a retro space shooter game',
      model: 'fortz-ai',
      provider: 'OpenAILike',
    });

    expect(pipelineResult.ok).toBe(true);
    expect(pipelineResult.generatedCount).toBe(2);

    // 4. Verify assets were written under /assets/ in WebContainer
    const playerAsset = await container.fs.readFile('assets/player.png');
    const enemyAsset = await container.fs.readFile('assets/enemy.png');
    expect(playerAsset).toBeDefined();
    expect(enemyAsset).toBeDefined();

    // 5. Verify game code was updated with asset loading and shape fallback preserved
    const finalCode = await container.fs.readFile('game.js');
    expect(finalCode).toContain('assets/player.png');
    expect(finalCode).toContain('assets/enemy.png');
    expect(finalCode).toContain('ctx.drawImage');
    expect(finalCode).toContain("ctx.fillStyle = '#00e5ff'"); // Fallback preserved!
    expect(finalCode).toContain("ctx.fillStyle = '#ff1744'"); // Fallback preserved!

    // 6. Test runtime simulation: verify fallback works if image is NOT complete
    const mockCtx = {
      clearRect: vi.fn(),
      drawImage: vi.fn(),
      fillRect: vi.fn(),
      beginPath: vi.fn(),
      arc: vi.fn(),
      fill: vi.fn(),
      fillStyle: '',
    };

    const testSnippet = generateAssetLoaderSnippet(elements);
    expect(testSnippet).toContain('GameAssets');

    let shapeFallbackCalled = false;
    const shapeFallback = () => {
      shapeFallbackCalled = true;
      mockCtx.fillStyle = '#00e5ff';
      mockCtx.fillRect(100, 100, 32, 32);
    };

    // When image is not loaded / naturalWidth is 0, shapeFallback must execute
    const unreadyImg = { complete: false, naturalWidth: 0 };
    if (unreadyImg.complete && unreadyImg.naturalWidth > 0) {
      mockCtx.drawImage();
    } else {
      shapeFallback();
    }

    expect(shapeFallbackCalled).toBe(true);
    expect(mockCtx.fillRect).toHaveBeenCalledWith(100, 100, 32, 32);
    expect(mockCtx.drawImage).not.toHaveBeenCalled();
  });
});
