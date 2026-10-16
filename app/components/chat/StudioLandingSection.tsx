import React, { useEffect, useState } from 'react';

interface StudioLandingSectionProps {
  onSelectTemplate?: (prompt: string, reference?: { dataUrl: string; file: File }) => void;
  onLaunchTemplate?: (event: React.UIEvent, prompt: string) => void;
  onOpenSettings?: () => void;
  fortzBalance?: number;
  isWorkbenchActive?: boolean;
}

const ANIMATED_SENTENCES = [
  'What do you want to build?',
  'Your game starts here...',
  'Turn your wildest ideas into playable worlds.',
  'Craft retro arcade adventures in seconds.',
  'Code physics, enemies, and epic boss fights.',
  'Design high-speed drift racers and platformers.',
  'Prompt, build, and play directly in your browser.',
];

const STARTER_GAMES = [
  {
    id: 'neon-racer',
    title: 'Neon Rush',
    genre: '3D RACING',
    description: 'Thread through neon traffic, drift around highway bends, and spend boost at the perfect moment.',
    prompt: `Create a complete, polished browser game called Neon Rush: a fast 3D arcade highway racer with a night-city neon atmosphere. Build real Three.js 0.160 geometry and lighting, not a flat image pretending to be 3D. The player drives from a clear chase camera, steers responsively, accelerates and brakes, drifts with readable traction, and earns boost by clean near-misses. Create looping road scenery, lane markings, varied traffic with fair collision avoidance, glowing boost pickups, checkpoint gates, a lap/time score HUD, and a satisfying crash/recovery state. Include a title/start screen, pause/resume, restart, keyboard and touch controls, resize support, and a visible tutorial hint. Tune handling so it is fun immediately, keep the camera stable, clamp frame delta, prevent repeated crashes, and use concise synthesized audio that safely falls back to silence. Provide complete working index.html, CSS, and JavaScript modules, load each module once in order, and verify that the game starts, renders, accepts steering, and restarts without console errors.`,
  },
  {
    id: 'starfall',
    title: 'Starfall Arena',
    genre: 'SPACE ACTION',
    description: 'Pilot a nimble starfighter through escalating enemy formations and asteroid fields.',
    prompt: `Build Starfall Arena as a complete, polished 2D space-survival arcade game. The player pilots a responsive ship with smooth acceleration, mouse/touch aim, and satisfying primary fire; survive escalating waves of distinct enemies and drifting asteroids, collect energy shards, and spend charge on a short dash or screen-clearing pulse. Add readable enemy telegraphs, fair hitboxes, bright projectile trails, impact sparks, controlled screen shake, and a boss with at least two clearly signaled attack patterns. Include a title screen, concise control hints, score/high score, health/energy HUD, pause/resume, game-over and one-click restart. Scale the canvas to the full viewport, clamp frame delta, make keyboard and touch play usable, and add safe procedural synth effects that degrade to silence. Write complete, connected HTML/CSS/JS files with no missing imports or duplicate script tags; test startup, movement, firing, collecting, pause, defeat, and restart in the live preview.`,
  },
  {
    id: 'skybound',
    title: 'Skybound Sprint',
    genre: 'PLATFORMER',
    description: 'Leap across a sunset skyline, dash past hazards, and race for every energy shard.',
    prompt: `Create Skybound Sprint, a polished side-scrolling 2D platform adventure with a vivid sunset-skyline world. Give the hero precise acceleration, variable-height jumping, coyote time, a responsive midair dash, and forgiving landings. Build several connected screen-length sections with distinct moving platforms, gaps, readable hazards, collectible energy shards, one checkpoint, and a finish gate; difficulty should ramp fairly and never require pixel-perfect jumps. Add layered parallax scenery, squash-and-stretch, dust trails, landing sparks, a clean progress/energy HUD, and clear controls shown briefly at the start. Provide a title/start state, pause/resume, checkpoint respawn, finish state, and reliable restart. Use a full-window responsive canvas, clamp frame delta, support keyboard and touch input, and guard synthesized audio so it can never interrupt gameplay. Deliver complete runnable HTML, CSS, and JavaScript, wire every module exactly once, and test jumping, dashing, collectibles, hazards, checkpoint, resize, and restart.`,
  },
  {
    id: 'prism-lab',
    title: 'Prism Lab',
    genre: 'PUZZLE',
    description: 'Rotate mirrors to route a beam through prisms, activate the exit, and solve each room.',
    prompt: `Build Prism Lab as a complete, elegant 2D light-routing puzzle game. Each room has a light emitter, an exit receiver, walls, and a small set of rotatable or movable mirrors/prisms. Let players rotate selected mirrors with click/tap or keyboard, trace the beam visibly with animated glow, and win only when the intended receiver is energized. Include at least six handcrafted levels that introduce one rule at a time, then combine them into clever solutions; avoid random levels or unwinnable layouts. Add a readable objective panel, level selector/progress, undo, reset, next-room transition, satisfying solved animation, pause, and restart. Use a refined dark laboratory visual style, color-safe beam effects, responsive full-screen layout, and short safe synthesized feedback. Implement real collision/reflection logic rather than decorative lines. Deliver complete HTML/CSS/JS with correct wiring, no missing files, and verify mirror interaction, beam reflection, receiver activation, undo/reset, level progression, and resize.`,
  },
  {
    id: 'ember-crypt',
    title: 'Ember Crypt',
    genre: 'DUNGEON ACTION',
    description: 'Explore a torchlit crypt, fight skeleton guards, find the key, and escape with the relic.',
    prompt: `Create Ember Crypt, a complete top-down action-adventure in a torchlit ancient dungeon. Give the player smooth eight-direction movement, a short dodge with cooldown, and a responsive sword combo with clear attack timing. Build several connected rooms with readable walls and doors, patrol skeletons with telegraphed attacks, health pickups, one locked door with a key, a treasure relic, and a final guardian encounter. The player must be able to explore, fight, collect the key, unlock the route, and reach a clear victory. Add room transitions, torchlight and ember particles, hit flashes, restrained camera shake, health/key HUD, brief controls, title/start, pause/resume, game-over, and restart. Use a coherent high-contrast pixel-fantasy palette, full-window responsive canvas, clamped delta time, and audio that safely degrades to silence. Implement actual collision, damage, enemy state, key/door progression, and victory checks; do not substitute decorative objects for mechanics. Write complete connected HTML/CSS/JS and verify movement, combat, damage, pickup, unlock, boss, pause, and restart.`,
  },
];

async function rasterizeStarterImage(imagePath: string, fileName: string) {
  const image = new Image();
  image.src = imagePath;
  await new Promise<void>((resolve, reject) => {
    image.onload = () => resolve();
    image.onerror = () => reject(new Error('Could not load starter artwork.'));
  });

  const canvas = document.createElement('canvas');
  canvas.width = 768;
  canvas.height = 432;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Image reference canvas is unavailable.');
  context.drawImage(image, 0, 0, canvas.width, canvas.height);

  const dataUrl = canvas.toDataURL('image/png');
  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (result) => (result ? resolve(result) : reject(new Error('Could not encode starter image.'))),
      'image/png',
    );
  });

  return { dataUrl, file: new File([blob], fileName, { type: 'image/png' }) };
}

export function StudioLandingSection({ onSelectTemplate, isWorkbenchActive }: StudioLandingSectionProps) {
  const [sentenceIndex, setSentenceIndex] = useState(0);
  const [charIndex, setCharIndex] = useState(0);
  const [isDeleting, setIsDeleting] = useState(false);
  const [loadingGameId, setLoadingGameId] = useState<string | null>(null);
  const [orderedGames, setOrderedGames] = useState(STARTER_GAMES);
  const [hoveredGameId, setHoveredGameId] = useState<string | null>(null);

  useEffect(() => {
    const orderKey = 'fortz-game-world-order';
    let previousOrder: string | null = null;

    try {
      previousOrder = sessionStorage.getItem(orderKey);
    } catch {
      // Randomize still works when storage is blocked; it just cannot avoid a repeat.
    }

    let shuffled: typeof STARTER_GAMES = [...STARTER_GAMES];
    let nextOrder = '';

    for (let attempt = 0; attempt < 12; attempt++) {
      shuffled = [...STARTER_GAMES];

      for (let index = shuffled.length - 1; index > 0; index--) {
        const other = Math.floor(Math.random() * (index + 1));
        [shuffled[index], shuffled[other]] = [shuffled[other], shuffled[index]];
      }

      nextOrder = shuffled.map((game) => game.id).join(',');
      if (nextOrder !== previousOrder) break;
    }

    try {
      sessionStorage.setItem(orderKey, nextOrder);
    } catch {
      // The card order remains randomized when storage is unavailable.
    }
    setOrderedGames(shuffled);
    setHoveredGameId(shuffled[0]?.id ?? null);
  }, []);

  useEffect(() => {
    const currentSentence = ANIMATED_SENTENCES[sentenceIndex];
    let timeout: ReturnType<typeof setTimeout>;

    if (!isDeleting && charIndex < currentSentence.length) {
      timeout = setTimeout(() => {
        setCharIndex((prev) => prev + 1);
      }, 55);
    } else if (!isDeleting && charIndex === currentSentence.length) {
      timeout = setTimeout(() => {
        setIsDeleting(true);
      }, 2400);
    } else if (isDeleting && charIndex > 0) {
      timeout = setTimeout(() => {
        setCharIndex((prev) => prev - 1);
      }, 25);
    } else if (isDeleting && charIndex === 0) {
      setIsDeleting(false);
      setSentenceIndex((prev) => (prev + 1) % ANIMATED_SENTENCES.length);
    }

    return () => clearTimeout(timeout);
  }, [charIndex, isDeleting, sentenceIndex]);

  const currentSentence = ANIMATED_SENTENCES[sentenceIndex];
  const displayedText = currentSentence.slice(0, charIndex);

  const selectStarterGame = async (game: (typeof STARTER_GAMES)[number]) => {
    if (!onSelectTemplate || loadingGameId) return;
    setLoadingGameId(game.id);
    try {
      const reference = await rasterizeStarterImage(`/images/game-worlds/${game.id}.svg`, `${game.id}-reference.png`);
      onSelectTemplate(game.prompt, reference);
    } catch {
      onSelectTemplate(game.prompt);
    } finally {
      setLoadingGameId(null);
    }
  };

  return (
    <div className="w-full flex flex-col items-center select-none p-0 mb-1">
      <div className="h-6 mb-3" aria-hidden="true" />

      {/* ── Typewriter Sentence Hero ── */}
      <div className="text-center w-full mx-auto min-h-[32px] sm:min-h-[40px] flex items-center justify-center">
        <h1
          className={`font-black uppercase font-['Anton',sans-serif] flex items-center justify-center transition-all ${
            isWorkbenchActive
              ? 'text-xs sm:text-sm tracking-normal px-2 break-words leading-tight text-center text-purple-100'
              : 'text-lg sm:text-2xl md:text-3xl tracking-wider text-purple-100 drop-shadow-[0_0_16px_rgba(168,85,247,0.35)]'
          }`}
        >
          <span className="bg-gradient-to-r from-purple-100 via-purple-200 to-white bg-clip-text text-transparent">
            {displayedText}
          </span>
          <span
            className={`inline-block bg-purple-400 ml-1.5 shadow-[0_0_8px_#a855f7] animate-pulse ${
              isWorkbenchActive ? 'w-1 h-3.5' : 'w-1.5 h-6 sm:h-7'
            }`}
          />
        </h1>
      </div>

      {/* ── Image-only game starters; hover/focus reveals the description outside the art. ── */}
      {!isWorkbenchActive && (
        <div className="w-full max-w-4xl px-2">
          <div className="grid w-full grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-5">
            {orderedGames.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => void selectStarterGame(item)}
                onMouseEnter={() => setHoveredGameId(item.id)}
                onFocus={() => setHoveredGameId(item.id)}
                disabled={Boolean(loadingGameId)}
                aria-label={`Choose ${item.title}: ${item.description}`}
                className="group relative aspect-[16/10] min-w-0 overflow-hidden border border-purple-300/20 bg-[#10132d] shadow-lg shadow-black/25 transition duration-300 hover:-translate-y-1 hover:border-cyan-200/70 hover:shadow-[0_12px_34px_rgba(56,189,248,0.22)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-200 disabled:cursor-wait disabled:opacity-70"
              >
                <img
                  src={`/images/game-worlds/${item.id}.svg`}
                  alt={item.title}
                  className="absolute inset-0 h-full w-full object-cover transition duration-500 group-hover:scale-105"
                  loading="eager"
                />
                {loadingGameId === item.id && (
                  <span className="absolute inset-0 grid place-items-center bg-black/35">
                    <span
                      className="i-svg-spinners:90-ring-with-bg text-2xl text-cyan-100"
                      aria-label="Preparing game prompt"
                    />
                  </span>
                )}
              </button>
            ))}
          </div>
          {orderedGames.map((item) =>
            item.id === hoveredGameId ? (
              <div
                key={`description-${item.id}`}
                className="mt-3 border border-cyan-100/15 bg-[linear-gradient(110deg,rgba(15,27,48,.9),rgba(25,15,43,.94))] px-4 py-3 text-left shadow-[0_8px_30px_rgba(0,0,0,.22)] animate-in fade-in slide-in-from-bottom-1"
                aria-live="polite"
              >
                <div className="flex items-center gap-2">
                  <span className="text-xs font-black uppercase tracking-[0.15em] text-white">{item.title}</span>
                  <span className="h-px flex-1 bg-gradient-to-r from-cyan-200/35 to-transparent" />
                  <span className="text-[9px] font-bold tracking-[0.14em] text-cyan-200/75">{item.genre}</span>
                </div>
                <p className="mt-1.5 text-xs leading-5 text-slate-300">{item.description}</p>
                <div className="mt-2 flex items-center gap-1.5 text-[10px] font-semibold text-violet-200/80">
                  <span className="i-ph:cursor-click text-sm" aria-hidden="true" />
                  Select image to load the full Grok 4.7 game prompt
                </div>
              </div>
            ) : null,
          )}
        </div>
      )}
    </div>
  );
}

export function StudioLandingFooter() {
  return null;
}
