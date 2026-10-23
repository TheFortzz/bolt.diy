import React, { useState, useEffect, useRef } from 'react';
import { useStore } from '@nanostores/react';
import { workbenchStore } from '~/lib/stores/workbench';
import { generatedAssets } from '~/lib/stores/generated-assets';
import { bytesToDataUrl } from '~/lib/runtime/html5-game-import';
import { getWebContainer } from '~/lib/webcontainer';
import { chatId } from '~/lib/persistence';
import { toast } from 'react-toastify';

function buildGameVisualContext(files: Record<string, unknown>, assetPaths: string[]) {
  const sourceEntries = Object.entries(files)
    .map(([path, entry]) => {
      const content = typeof entry === 'string'
        ? entry
        : entry && typeof entry === 'object' && 'content' in entry && typeof entry.content === 'string'
          ? entry.content
          : '';
      return [path, content] as const;
    })
    .filter(([path, content]) =>
      Boolean(content) &&
      /\.(?:html?|(?:m|c)?js|tsx?|css|md)$/i.test(path) &&
      !/(?:node_modules|\.min\.|\.env|dist\/|build\/|vendor\/)/i.test(path),
    );

  const sampledContent = sourceEntries
    .slice(0, 12)
    .map(([, content]) => String(content).slice(0, 40_000))
    .join('\n');

  // Mine the real game source for visual facts so the cover shows THIS game:
  // color palette, entity/weapon names, and on-screen title text.
  const palette = Array.from(
    sampledContent.matchAll(/#[0-9a-fA-F]{6}\b/g)
  )
    .map((match) => match[0].toLowerCase())
    .reduce((counts, hex) => {
      counts.set(hex, (counts.get(hex) || 0) + 1);
      return counts;
    }, new Map<string, number>());
  const topPalette = [...palette.entries()]
    .sort((left, right) => right[1] - left[1])
    .filter(([hex]) => hex !== '#ffffff' && hex !== '#000000')
    .slice(0, 8)
    .map(([hex]) => hex);

  const nameMines = Array.from(
    sampledContent.matchAll(
      /\b(?:class|function|const)\s+([A-Z][A-Za-z0-9]{3,24})|\b(?:entity|enemy|boss|weapon|character|ship|tower|hero|player|sprite)\s*[:=]\s*["']([A-Za-z0-9_ -]{4,32})["']/gi,
    )
  )
    .map((match) => (match[1] || match[2] || '').replace(/[_-]+/g, ' ').trim())
    .filter(Boolean);
  const entityNames = [...new Set(nameMines)].slice(0, 12);

  const titleText = [
    ...sampledContent.matchAll(/<title[^>]*>([^<]{4,60})<\/title>/gi),
    ...sampledContent.matchAll(/<h1[^>]*>([^<]{4,60})<\/h1>/gi),
    ...sampledContent.matchAll(/\btitle\s*[:=]\s*["']([A-Za-z0-9 !?&:'-]{4,60})["']/gi),
  ]
    .map((match) => (match[1] || '').trim())
    .filter(Boolean)
    .slice(0, 4);

  const assetList = assetPaths.length
    ? assetPaths
    : sourceEntries.map(([path]) => path);
  const assetNames = assetList
    .map((path) => path.replace(/\\/g, '/').replace(/^(?:\/home\/project\/|\/project\/|home\/project\/|project\/|\/|\.\/)+/, ''))
    .filter(Boolean)
    .slice(0, 48);

  const featuredSources = sourceEntries
    .sort(([left], [right]) => Number(/(?:index|main|game|scene)/i.test(right)) - Number(/(?:index|main|game|scene)/i.test(left)))
    .slice(0, 4)
    .map(([path, content]) => {
      const excerpt = String(content)
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line && !line.startsWith('//') && line.length < 240)
        .slice(0, 26)
        .join(' ')
        .replace(/((?:api[_-]?key|secret|token|password)\s*[:=]\s*)["'][^"']+["']/gi, '$1"[redacted]"')
        .slice(0, 1800);
      return excerpt ? `${path}: ${excerpt}` : '';
    })
    .filter(Boolean);

  const review = [
    assetNames.length ? `Named game art/assets: ${assetNames.join(', ')}.` : '',
    topPalette.length ? `Dominant colors in the game code (hex): ${topPalette.join(', ')}.` : '',
    entityNames.length ? `Characters/entities/weapons named in code: ${entityNames.join(', ')}.` : '',
    titleText.length ? `In-game title text: ${titleText.join(' · ')}.` : '',
    featuredSources.length ? `Game source review: ${featuredSources.join(' ')}` : '',
  ].filter(Boolean).join('\n');

  return review.slice(0, 11_000);
}

/** A quick PNG fallback so an upstream image-provider outage never blocks publishing. */
function createLocalFallbackCover(title: string, genre: string): string {
  const canvas = document.createElement('canvas');
  canvas.width = 1280;
  canvas.height = 720;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('This browser could not create the fallback cover image.');

  const genreKey = genre.toLowerCase();
  const accent = /horror|dark|halloween/.test(genreKey) ? '#fb4668'
    : /race|car|sport/.test(genreKey) ? '#ff9d35'
      : /space|sci|flight/.test(genreKey) ? '#49c9ff'
        : /puzzle|strategy|knowledge/.test(genreKey) ? '#52e0c0' : '#a78bfa';
  const secondary = /race|car|sport/.test(genreKey) ? '#4ddcff' : '#fb5b90';

  const background = ctx.createLinearGradient(0, 0, 1280, 720);
  background.addColorStop(0, '#080d24');
  background.addColorStop(0.52, '#17204a');
  background.addColorStop(1, '#080b1c');
  ctx.fillStyle = background;
  ctx.fillRect(0, 0, 1280, 720);

  const glow = ctx.createRadialGradient(850, 310, 20, 850, 310, 510);
  glow.addColorStop(0, `${accent}99`);
  glow.addColorStop(0.42, `${secondary}36`);
  glow.addColorStop(1, 'transparent');
  ctx.fillStyle = glow;
  ctx.fillRect(280, 0, 1000, 680);

  // Add depth and motion without depending on any remote artwork or fonts.
  ctx.save();
  ctx.translate(850, 305);
  ctx.rotate(-0.24);
  for (let i = 0; i < 9; i++) {
    ctx.strokeStyle = i % 2 ? `${secondary}35` : `${accent}48`;
    ctx.lineWidth = i % 3 === 0 ? 5 : 2;
    ctx.beginPath();
    ctx.ellipse(0, 0, 190 + i * 24, 112 + i * 15, 0, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.restore();

  ctx.save();
  ctx.globalAlpha = 0.28;
  ctx.strokeStyle = '#dbeafe';
  ctx.lineWidth = 1;
  for (let x = 0; x < 1280; x += 56) {
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x - 260, 720); ctx.stroke();
  }
  ctx.restore();

  const lowerShade = ctx.createLinearGradient(0, 300, 0, 720);
  lowerShade.addColorStop(0, 'transparent');
  lowerShade.addColorStop(1, 'rgba(3,6,18,0.96)');
  ctx.fillStyle = lowerShade;
  ctx.fillRect(0, 290, 1280, 430);

  ctx.fillStyle = accent;
  ctx.fillRect(74, 84, 9, 44);
  ctx.font = '800 22px Arial, sans-serif';
  ctx.fillText('THEFORTZ  /  GAME COVER', 102, 115);

  const cleanTitle = title.trim().slice(0, 100) || 'YOUR NEXT GAME';
  const words = cleanTitle.split(/\s+/);
  const titleLines: string[] = [];
  let line = '';
  ctx.font = '900 76px Arial, sans-serif';
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (line && ctx.measureText(candidate).width > 1040) {
      titleLines.push(line);
      line = word;
    } else line = candidate;
  }
  if (line) titleLines.push(line);
  const shownLines = titleLines.slice(0, 2);
  const titleSize = shownLines.some((row) => ctx.measureText(row).width > 1080) ? 58 : 76;
  ctx.font = `900 ${titleSize}px Arial, sans-serif`;
  shownLines.forEach((row, index) => {
    const y = 540 + index * (titleSize + 6);
    ctx.lineWidth = 8;
    ctx.strokeStyle = 'rgba(3,6,18,0.9)';
    ctx.strokeText(row, 78, y, 1100);
    ctx.fillStyle = '#fff';
    ctx.fillText(row, 78, y, 1100);
  });

  const badge = (genre || 'ACTION').toUpperCase().slice(0, 22);
  ctx.font = '700 20px Arial, sans-serif';
  const badgeWidth = Math.max(130, ctx.measureText(badge).width + 42);
  ctx.fillStyle = `${accent}dd`;
  ctx.beginPath();
  if (typeof ctx.roundRect === 'function') ctx.roundRect(80, 618, badgeWidth, 46, 18);
  else ctx.rect(80, 618, badgeWidth, 46);
  ctx.fill();
  ctx.fillStyle = '#07101e';
  ctx.fillText(badge, 101, 648);

  return canvas.toDataURL('image/png');
}

export function PublishButton() {
  const [isOpen, setIsOpen] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [isGeneratingThumbnail, setIsGeneratingThumbnail] = useState(false);
  const [publishStep, setPublishStep] = useState<'details' | 'cover'>('details');
  const [coverStatus, setCoverStatus] = useState<'idle' | 'generating' | 'ready' | 'error'>('idle');
  const [coverError, setCoverError] = useState('');
  const [publishProgress, setPublishProgress] = useState('');
  const [title, setTitle] = useState('');
  const [genre, setGenre] = useState('ACTION');
  const [description, setDescription] = useState('');
  const [previewThumb, setPreviewThumb] = useState<string>('');
  const thumbnailRequestRef = useRef<AbortController | null>(null);
  const files = useStore(workbenchStore.files);
  const currentChatId = useStore(chatId);
  const projectIdentity = currentChatId || workbenchStore.firstArtifact?.id || 'default-project';
  const publishStorageKey = `thefortz:published:${projectIdentity}`;
  const [publishedStorageKey, setPublishedStorageKey] = useState<string | null>(null);
  const isPublished = publishedStorageKey === publishStorageKey;

  const hasFiles = Object.keys(files || {}).length > 0;

  useEffect(() => {
    if (!isOpen) {
      thumbnailRequestRef.current?.abort();
      thumbnailRequestRef.current = null;
      setIsGeneratingThumbnail(false);
      return;
    }
    setPublishStep('details');
    setCoverStatus('idle');
    setCoverError('');
    setPreviewThumb('');
    setPublishProgress('');

    return () => {
      thumbnailRequestRef.current?.abort();
      thumbnailRequestRef.current = null;
    };
  }, [isOpen]);

  useEffect(() => {
    const refreshPublishedState = () => {
      try {
        setPublishedStorageKey(localStorage.getItem(publishStorageKey) ? publishStorageKey : null);
      } catch {
        setPublishedStorageKey(null);
      }
    };
    const onStorage = (event: StorageEvent) => {
      if (event.key === publishStorageKey) {
        refreshPublishedState();
      }
    };

    refreshPublishedState();
    window.addEventListener('storage', onStorage);

    return () => window.removeEventListener('storage', onStorage);
  }, [publishStorageKey]);

  // Auto-detect project title when modal opens or files change
  useEffect(() => {
    try {
      const artifacts = workbenchStore.artifacts.get();
      const latestId = workbenchStore.artifactIdList[workbenchStore.artifactIdList.length - 1];
      const latestArtifact = latestId ? artifacts[latestId] : undefined;

      if (latestArtifact?.title && !title) {
        setTitle(latestArtifact.title);
      }
    } catch (e) {}
  }, [isOpen, files]);

  const generateThumbnail = async () => {
    const finalTitle = title.trim();
    if (!finalTitle) return;

    setPublishStep('cover');
    setCoverStatus('generating');
    setCoverError('');
    setPreviewThumb('');
    setIsGeneratingThumbnail(true);
    thumbnailRequestRef.current?.abort();
    const controller = new AbortController();
    thumbnailRequestRef.current = controller;
    // The server has a 5s art brief and three FLUX attempts under a 45s cap.
    // Keep a small transport margin before switching to the local PNG fallback.
    const timeout = window.setTimeout(() => controller.abort(), 48_000);
    const fallBackToLocalCover = (reason: string) => {
      if (thumbnailRequestRef.current !== controller) return;
      const localCover = createLocalFallbackCover(finalTitle, genre);
      const detail = reason.replace(/\s+/g, ' ').slice(0, 180);
      setPreviewThumb(localCover);
      setCoverStatus('ready');
      setCoverError(
        `AI cover service is temporarily unavailable${detail ? ` (${detail})` : ''}. A local cover is ready, so you can still publish.`,
      );
    };

    try {
      const projectFiles = (workbenchStore as any).files?.get?.() ?? files ?? {};
      const binaryAssetPaths = Object.entries(
        projectFiles as Record<string, unknown>,
      )
        .filter(([, entry]) =>
          Boolean(entry && typeof entry === 'object' && (entry as any).type === 'file' && (entry as any).isBinary),
        )
        .map(([path]) => path.replace(/^(?:\/home\/project\/|\/project\/|home\/project\/|project\/|\/|\.\/)+/, ''));
      const visualContext = buildGameVisualContext(
        projectFiles,
        [...Object.values(generatedAssets.get()).map((asset) => asset.path), ...binaryAssetPaths],
      );
      const response = await fetch('/api/generate-thumbnail', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: finalTitle,
          genre,
          description: description.trim(),
          gameContext: visualContext,
        }),
        signal: controller.signal,
      });
      let result: { dataUrl?: string; error?: string } = {};
      try {
        result = (await response.json()) as { dataUrl?: string; error?: string };
      } catch {
        // The status below is more useful than a JSON parsing exception.
      }

      if (!response.ok || !result.dataUrl?.startsWith('data:image/')) {
        fallBackToLocalCover(result.error || `HTTP ${response.status}`);
        return;
      }

      setPreviewThumb(result.dataUrl);
      setCoverStatus('ready');
    } catch (error) {
      if (thumbnailRequestRef.current !== controller) return;
      try {
        fallBackToLocalCover(error instanceof Error ? error.message : 'AI image generation failed');
      } catch (fallbackError) {
        setCoverStatus('error');
        setCoverError(fallbackError instanceof Error ? fallbackError.message : 'Could not create a fallback cover.');
      }
    } finally {
      window.clearTimeout(timeout);
      if (thumbnailRequestRef.current === controller) {
        thumbnailRequestRef.current = null;
        setIsGeneratingThumbnail(false);
      }
    }
  };

  const handleExportZip = async () => {
    try {
      setIsExporting(true);
      await workbenchStore.downloadZip();
      toast.success('Game package downloaded! Ready to publish.', { autoClose: 6000 });
    } catch (error) {
      toast.error(`Failed to package game files: ${(error as Error)?.message || 'Unknown error'}`);
    } finally {
      setIsExporting(false);
    }
  };

  const executePublish = async () => {
    const finalTitle = title.trim();
    const finalGenre = genre || 'ACTION';

    if (!hasFiles) {
      toast.error('Build a game before publishing it.');
      return;
    }
    if (!finalTitle) {
      setPublishStep('details');
      toast.info('Enter a game name before continuing.');
      return;
    }
    if (coverStatus !== 'ready' || !previewThumb) {
      toast.info('Generate the game cover before publishing.');
      return;
    }

    try {
      if (isPublished || localStorage.getItem(publishStorageKey)) {
        setPublishedStorageKey(publishStorageKey);
        toast.info('This game has already been published.');

        return;
      }
    } catch {
      if (isPublished) {
        toast.info('This game has already been published.');
        return;
      }
    }

    try {
      setIsExporting(true);
      setPublishProgress('Sending your game to thefortz.me…');
      const thumbDataUrl = previewThumb;

      // Collect project files from the workbench store
      const projectFiles = (workbenchStore as any).files?.get?.() ?? files ?? {};

      /*
       * Binary assets (sprites, audio, 3D models) are not project source, so
       * they travel separately as data URLs. Without this a published game
       * keeps its assets/hero.png reference with nothing behind it.
       */
      const activeAssetPaths = new Set(
        Object.keys(projectFiles).map((path) =>
          path.replace(/^(?:\/home\/project\/|\/project\/|home\/project\/|project\/|\/|\.\/)+/, ''),
        ),
      );
      const assetPayloads = Object.fromEntries(
        Object.values(generatedAssets.get())
          .filter((asset) => activeAssetPaths.has(asset.path))
          .map((asset) => [asset.path, asset.dataUrl]),
      );
      /*
       * Collect the ACTUAL bytes for every binary file — regardless of how the
       * game arrived. Restored checkpoints keep binary Dirent entries with an
       * empty string content, so only the WebContainer filesystem (or an
       * in-memory Uint8Array payload) can supply the real data. Without this a
       * published game keeps its assets/hero.png reference with nothing behind
       * it and the Play tab renders a black screen.
       */
      {
        // Publishing source-only games must not depend on WebContainer boot
        // succeeding. Initialize it lazily only when a binary asset really
        // needs bytes from the virtual filesystem.
        let webcontainer: Awaited<ReturnType<typeof getWebContainer>> | undefined;
        const mimeByExtension: Record<string, string> = {
          avif: 'image/avif', bin: 'application/octet-stream', fbx: 'application/octet-stream',
          gif: 'image/gif', glb: 'model/gltf-binary', gltf: 'model/gltf+json',
          ico: 'image/x-icon', jpeg: 'image/jpeg', jpg: 'image/jpeg', m4a: 'audio/mp4', mp3: 'audio/mpeg',
          mtl: 'text/plain', obj: 'model/obj', ogg: 'audio/ogg', otf: 'font/otf',
          png: 'image/png', svg: 'image/svg+xml', ttf: 'font/ttf', wav: 'audio/wav', wasm: 'application/wasm', webm: 'video/webm',
          webp: 'image/webp', woff: 'font/woff', woff2: 'font/woff2',
        };
        for (const [rawPath, rawEntry] of Object.entries(projectFiles as Record<string, unknown>)) {
          const entry = rawEntry as { type?: string; isBinary?: boolean; content?: unknown } | undefined;
          if (entry?.type !== 'file' || !entry.isBinary) continue;
          const assetPath = rawPath.replace(/^(?:\/home\/project\/|\/project\/|home\/project\/|project\/|\/|\.\/)+/, '');
          if (!assetPath) continue;
          // The Studio's own static-server scripts are engine plumbing, not game assets.
          if (assetPath.split('/').some((part) => part.startsWith('.static_server'))) continue;
          if (assetPayloads[assetPath]) continue;

          if (entry.content instanceof Uint8Array) {
            const bytes = entry.content as Uint8Array;
            if (bytes.length > 0) {
              const extension = assetPath.split('.').pop()?.toLowerCase() || '';
              assetPayloads[assetPath] = bytesToDataUrl(bytes, mimeByExtension[extension] || 'application/octet-stream');
            }
            continue;
          }

          try {
            webcontainer ||= await getWebContainer();
            const bytes = await webcontainer.fs.readFile(assetPath);
            if (!bytes || bytes.length === 0) continue;
            const extension = assetPath.split('.').pop()?.toLowerCase() || '';
            assetPayloads[assetPath] = bytesToDataUrl(bytes, mimeByExtension[extension] || 'application/octet-stream');
          } catch (error) {
            const detail = error instanceof Error ? ` ${error.message.slice(0, 180)}` : '';
            throw new Error(`Could not collect binary game asset "${assetPath}".${detail}`);
          }
        }
      }
      let publicationStatus = 'live';

      if (window.parent !== window) {
        let parentOrigin = '';

        try {
          parentOrigin = new URL(document.referrer).origin;
        } catch {
          throw new Error('Could not securely connect to thefortz.me. Open the Studio from the site and try again.');
        }

        if (!parentOrigin || parentOrigin === 'null') {
          throw new Error('Could not securely connect to thefortz.me. Open the Studio from the site and try again.');
        }

        const requestId = crypto.randomUUID();
        publicationStatus = await new Promise<string>((resolve, reject) => {
          const timeout = window.setTimeout(() => {
            window.removeEventListener('message', onResult);
            reject(new Error('Publishing is taking longer than expected. Check the Games tab before retrying to avoid a duplicate.'));
          }, 600_000);
          const onResult = (event: MessageEvent) => {
            if (
              event.source !== window.parent ||
              event.origin !== parentOrigin ||
              event.data?.requestId !== requestId
            ) {
              return;
            }

            if (event.data?.type === 'thefortz-publish-progress') {
              if (typeof event.data.status === 'string') setPublishProgress(event.data.status.slice(0, 180));
              return;
            }
            if (event.data?.type !== 'thefortz-publish-result') return;

            window.clearTimeout(timeout);
            window.removeEventListener('message', onResult);

            if (event.data.success) {
              resolve(typeof event.data.status === 'string' ? event.data.status : 'live');
            } else {
              reject(new Error(event.data.error || 'The site could not publish this game.'));
            }
          };

          window.addEventListener('message', onResult);
          window.parent.postMessage(
            {
              type: 'thefortz-publish-game',
              requestId,
              payload: {
                title: finalTitle,
                genre: finalGenre,
                description: description.trim(),
                thumbDataUrl,
                files: projectFiles,
                assets: assetPayloads,
              },
            },
            parentOrigin,
          );
        });
      } else {
        setPublishProgress('Uploading the cover and game files…');
        const res = await fetch('/api/publish', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title: finalTitle,
            genre: finalGenre,
            description: description.trim(),
            thumbDataUrl,
            files: projectFiles,
            assets: assetPayloads,
          }),
        });
        const data = (await res.json()) as { success?: boolean; status?: string; error?: string };

        if (!res.ok || !data.success) {
          throw new Error(data.error || 'The publish service did not confirm the game was saved.');
        }

        publicationStatus = data.status || 'live';
      }

      try {
        localStorage.setItem(publishStorageKey, JSON.stringify({ title: finalTitle, publishedAt: Date.now() }));
      } catch {
        // Keep the current button locked even if browser storage is unavailable.
      }
      setPublishedStorageKey(publishStorageKey);
      toast.success(`"${finalTitle}" published successfully!`);
      setIsOpen(false);
    } catch (err: any) {
      toast.error('Publish failed: ' + (err?.message || 'Unknown error'));
    } finally {
      setIsExporting(false);
      setPublishProgress('');
    }
  };

  return (
    <>
      <div className="flex items-center gap-1.5 publish-glow-container">
        <button
          type="button"
          onClick={() => !isPublished && setIsOpen(true)}
          className="publish-glow-button"
          disabled={isPublished}
          title={isPublished ? 'This game is already published' : 'Publish your game to thefortz.me'}
        >
          <div
            className={
              isPublished
                ? 'i-ph:check-circle-fill text-emerald-300 text-xs'
                : 'i-ph:rocket-launch text-orange-300 text-xs'
            }
          />
          <span>{isPublished ? 'PUBLISHED' : 'PUBLISH'}</span>
        </button>
      </div>

      {isOpen && (
        <div
          className="fixed inset-0 z-[9999] flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm"
          onClick={() => {
            if (!isExporting) setIsOpen(false);
          }}
        >
          <div
            className="w-full max-w-md rounded-2xl border border-orange-400/60 bg-gradient-to-br from-[#123b72] via-[#102746] to-[#17213a] p-6 text-white relative shadow-[0_24px_90px_rgba(4,13,32,0.72)]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-orange-300/25 pb-3 mb-4">
              <div className="flex items-center gap-2">
                <span className="text-xl">🎮</span>
                <h3 className="font-extrabold text-lg tracking-wider uppercase text-orange-300 font-['Anton',sans-serif]">
                  Publish Game
                </h3>
              </div>
              <button
                onClick={() => setIsOpen(false)}
                disabled={isExporting}
                className="text-white/70 hover:text-white px-2 py-1 text-sm rounded-none border border-transparent hover:border-white/20 transition-all cursor-pointer"
              >
                ✕
              </button>
            </div>

            <div className="mb-4 flex items-center gap-2 text-[10px] font-extrabold uppercase tracking-[0.18em] text-sky-100/65">
              <span className={publishStep === 'details' ? 'text-orange-300' : ''}>1 · Game details</span>
              <span className="text-white/25">—</span>
              <span className={publishStep === 'cover' ? 'text-orange-300' : ''}>2 · AI cover</span>
            </div>

            {publishStep === 'details' ? (
            <div className="flex flex-col gap-4">
              <div>
                <label className="text-[11px] font-bold text-sky-100/80 uppercase tracking-wide mb-1 block">
                  Game name <span className="text-orange-300">*</span>
                </label>
                <input
                  type="text"
                  placeholder="e.g. Cyber Runner"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  maxLength={100}
                  className="w-full p-2 bg-[#0b1c35] border border-orange-300/35 focus:border-orange-300 focus:outline-none rounded-lg text-white text-sm"
                />
              </div>

              <div>
                <label className="text-[11px] font-bold text-sky-100/80 uppercase tracking-wide mb-1 block">
                  Genre
                </label>
                <select
                  value={genre}
                  onChange={(e) => setGenre(e.target.value)}
                  className="w-full p-2 bg-[#0b1c35] border border-orange-300/35 focus:border-orange-300 focus:outline-none rounded-lg text-white text-sm"
                >
                  <option value="ACTION">Action</option>
                  <option value="ADVENTURE">Adventure</option>
                  <option value="PUZZLE">Puzzle</option>
                  <option value="RPG">RPG</option>
                  <option value="RACING">Racing</option>
                </select>
              </div>

              <div>
                <label className="text-[11px] font-bold text-sky-100/80 uppercase tracking-wide mb-1 block">
                  Description (optional)
                </label>
                <textarea
                  placeholder="Tell players about your game..."
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  maxLength={1200}
                  className="w-full p-2 bg-[#0b1c35] border border-orange-300/35 focus:border-orange-300 focus:outline-none rounded-lg text-white text-sm"
                  rows={2}
                />
              </div>

              <div className="mt-1 flex flex-col items-stretch gap-2">
                <span className="text-[10px] text-sky-100/55">The cover will be based on your game files and generated art.</span>
                <button
                  onClick={() => void generateThumbnail()}
                  disabled={isGeneratingThumbnail || isExporting || !title.trim() || !hasFiles || isPublished}
                  className="w-full flex items-center justify-center gap-2 rounded-lg border border-orange-200/60 bg-gradient-to-r from-orange-500 to-amber-400 px-4 py-2.5 text-xs font-extrabold uppercase tracking-wider text-[#1c2230] transition-colors hover:from-orange-400 hover:to-amber-300 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <span>Continue · Create cover</span>
                  <span aria-hidden="true">→</span>
                </button>
                <button
                  onClick={() => void handleExportZip()}
                  disabled={isExporting || !hasFiles}
                  className="self-end rounded-lg border border-sky-300/25 bg-[#12315b]/80 px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider text-sky-100/75 transition-colors hover:bg-[#19447a] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Export ZIP backup
                </button>
              </div>
              {!hasFiles && <div className="text-[11px] text-sky-200/70">Add a game to this workspace before publishing.</div>}
            </div>
            ) : (
              <div className="flex flex-col gap-4">
                <div className="relative flex aspect-video w-full items-center justify-center overflow-hidden rounded-xl border border-orange-200/30 bg-[#06152b] shadow-[0_18px_50px_rgba(0,0,0,0.35)]">
                  {previewThumb ? (
                    <img src={previewThumb} alt={`${title} game cover`} className="absolute inset-0 h-full w-full object-cover" />
                  ) : (
                    <div className="flex flex-col items-center gap-3 px-6 text-center">
                      <span className={isGeneratingThumbnail ? 'i-svg-spinners:90-ring-with-bg text-3xl text-orange-300' : 'i-ph:image-square text-4xl text-sky-200/50'} />
                      <span className="text-sm font-bold text-white/90">
                        {isGeneratingThumbnail ? 'Creating cover art for your game…' : 'Your generated cover will appear here'}
                      </span>
                      {isGeneratingThumbnail && <span className="text-[11px] text-sky-100/60">Using your game description, source files, and generated assets.</span>}
                    </div>
                  )}
                </div>

                {coverError && (
                  <div className="rounded-lg border border-amber-300/25 bg-amber-300/10 px-3 py-2 text-xs leading-relaxed text-amber-100">
                    {coverError}
                  </div>
                )}

                <button
                  onClick={executePublish}
                  disabled={isExporting || isGeneratingThumbnail || coverStatus !== 'ready' || !hasFiles || isPublished}
                  className="w-full flex items-center justify-center gap-2 rounded-xl border border-orange-100/70 bg-gradient-to-r from-orange-500 via-amber-400 to-yellow-300 px-4 py-3.5 text-sm font-black uppercase tracking-wider text-[#1c2230] shadow-[0_8px_24px_rgba(249,115,22,0.25)] transition-all hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <span>{isExporting ? '⏳' : '🚀'}</span>
                  <span>{isExporting ? 'Publishing game and cover…' : 'Publish game'}</span>
                </button>

                {coverError && !isExporting && (
                  <button
                    onClick={() => void generateThumbnail()}
                    className="self-center rounded-lg border border-orange-200/40 bg-orange-400/15 px-4 py-2 text-xs font-extrabold text-orange-100 hover:bg-orange-400/25"
                  >
                    Retry AI cover
                  </button>
                )}

                {isExporting && (
                  <div className="flex items-center justify-center gap-2 text-[11px] font-semibold text-sky-100/75" role="status" aria-live="polite">
                    <span className="i-svg-spinners:90-ring-with-bg text-sky-200" />
                    {publishProgress || 'Publishing your game…'}
                  </div>
                )}
              </div>
            )}

            {publishStep === 'details' && (
              <div className="mt-4 flex items-start gap-1.5 border-t border-sky-200/15 pt-3 text-[11px] leading-normal text-sky-100/75">
                <span>💡</span>
                <span>Your generated game cover and game files are published together to thefortz.me.</span>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
