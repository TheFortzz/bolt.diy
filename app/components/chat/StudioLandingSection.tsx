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
    id: 'motorcycle-rush', image: 'motergame.png', title: 'Motorcycle Rush', genre: 'RACING',
    description: 'Race a superbike through neon streets, drift past traffic, and hit every checkpoint.',
    prompt: `Create a substantial, polished HTML5 motorcycle racing game inspired by the supplied motorcycle artwork. The player rides a blue superbike through a neon city at night. Build responsive acceleration, braking, steering, readable drift traction, near-miss boost, fair traffic patterns, road hazards, collectible boost cells, checkpoint gates, and several difficulty stages with a finish and replay loop. Use a convincing side/rear chase perspective or a polished pseudo-3D road that clearly communicates speed; the bike must remain the recognizable player vehicle. Add animated city lights, wheel effects, sparks, tire smoke, a speedometer, distance, boost and stage HUD, a brief controls overlay, start/pause/resume/crash/restart states, and satisfying safe synthesized engine audio. Support keyboard and touch, resize cleanly, clamp frame delta, prevent NaN audio values, and avoid unfair unavoidable collisions. Build and wire complete HTML, CSS, and JavaScript files; test starting, steering, drifting, boosts, collisions, checkpoints, game over, and restart in the preview.`,
  },
  {
    id: 'football-fire', image: 'footballgame.png', title: 'Football Fire', genre: 'SPORTS',
    description: 'Bend a blazing ball past defenders, score from the spot, and win the tournament.',
    prompt: `Build Football Fire, a complete arcade soccer challenge based on the supplied flaming-football image. Create a playable striker-versus-goalkeeper loop: aim with mouse or touch, set shot power, curve the kick, and score past a goalkeeper whose position and reactions vary fairly. Progress through a tournament of increasingly tricky shot scenarios with moving walls/defenders, target zones, limited attempts, bonus streaks, and a clear final result. Make ball flight, spin, net impact, fire trail, and goalkeeper saves visually satisfying and readable. Include an opening screen with controls, score/attempts/stage HUD, pause/resume, restart, victory and game-over states, responsive full-window canvas, keyboard/touch input, clamped delta time, and safe synthesized kick/crowd audio. Implement actual aiming, trajectory, collision, scoring, and progression—no decorative-only goals. Wire complete HTML/CSS/JS modules and verify scoring, misses, saves, progression, resize, and restart.`,
  },
  {
    id: 'neon-car-rally', image: 'cargame.png', title: 'Neon Car Rally', genre: 'RACING',
    description: 'Throw a blue supercar into city-circuit corners, chase boost, and beat the clock.',
    prompt: `Create a polished, complete browser game called Neon Car Rally, taking its blue futuristic race car and glowing night-city palette from the supplied image. Make the player car the actual controllable vehicle, with smooth steering, acceleration/braking, readable grip and drift, a short boost with cooldown, and forgiving wall collisions. Build a looping neon circuit with lane markings, barriers, traffic or rival cars, boost pickups, timed checkpoints, lap timing, and escalating race goals. Add a stable chase or clean top-down camera, reflections/glow, tire smoke and sparks, a clear speed/lap/boost HUD, start instructions, pause/resume, race-finish, crash recovery, and restart. Use a cohesive visual style, full-viewport responsive rendering, keyboard and touch controls, capped frame delta, and safe synthesized engine/impact audio with finite AudioParam values. Implement real track boundaries, collision, checkpoint order, and lap logic. Write complete HTML/CSS/JS with valid module wiring and verify the whole race loop in the preview.`,
  },
  {
    id: 'space-odyssey', image: 'spacegame.png', title: 'Space Odyssey', genre: 'SPACE ACTION',
    description: 'Pilot a starship between worlds, dodge asteroids, and outfly an alien squadron.',
    prompt: `Build Space Odyssey as a polished 2D space-action game inspired by the supplied starship, ringed planet, and alien artwork. Let the player steer a nimble ship, aim and fire, dodge asteroids, collect energy, and survive increasingly dense enemy waves. Create distinct alien attack patterns with clear telegraphs, several planets/sector backgrounds, weapon upgrades, a charged special ability, and a multi-phase boss with fair openings. Include responsive movement, readable hitboxes, projectile and thruster trails, explosion particles, tasteful impact shake, health/energy/score HUD, short control hints, title/start, pause/resume, game over, and instant restart. Support keyboard, mouse and touch, scale to the viewport, cap dt, guard audio against non-finite values, and degrade to silence if Web Audio fails. Implement actual health, collisions, waves, pickups, and boss progression. Deliver connected HTML/CSS/JavaScript and verify movement, firing, enemy hits, upgrades, defeat, and restart.`,
  },
  {
    id: 'sky-runner', image: 'rungame.png', title: 'Sky Runner', genre: 'PLATFORMER',
    description: 'Sprint, double-jump, and dash across floating cloud platforms to gather golden coins.',
    prompt: `Create Sky Runner, a complete joyful side-scrolling platform game inspired by the supplied blue-sky runner image. The hero must run smoothly, jump with variable height, double-jump, and dash; build a long scrolling course of cloud platforms, safe gaps, moving platforms, gentle hazards, and collectible gold coins. Add coyote time and forgiving collision so the course feels responsive, checkpoints, a finish portal, and a scoring/streak reward for collecting coin trails. Use layered clouds, clear silhouettes, landing dust, bright pickup effects, a compact coin/progress HUD, a quick control hint, start/pause/resume, fall recovery, victory, and restart. Support keyboard and touch, resize the canvas, cap frame delta, and keep sound optional and safely guarded. Implement real platform collision, scrolling, collectibles, checkpoints, and restart rather than a static mockup. Deliver full connected HTML/CSS/JavaScript and verify jumping, dash, coin collection, hazards, checkpoint, completion, and restart.`,
  },
  {
    id: 'tank-assault', image: 'tankgame.png', title: 'Tank Assault', genre: 'ACTION',
    description: 'Drive an armored tank across a burning battlefield, destroy targets, and survive waves.',
    prompt: `Build Tank Assault, a complete top-down armored combat game inspired by the supplied olive tank, battlefield, and explosive arrows. Give the tank independent hull movement and turret aiming, satisfying but controlled shell fire, reload timing, and readable damage. Create several battlefield arenas with cover, destructible obstacles, enemy tanks with distinct behaviors, incoming-fire warnings, ammo/repair pickups, and a final heavy boss. Let players learn controls immediately; include WASD/arrows drive, mouse/touch aim, fire, a dodge/boost, health/ammo/wave HUD, title/start, pause/resume, defeat and restart. Add dust tracks, muzzle flash, sparks and explosions while keeping projectiles and danger zones clear. Implement collision, line-of-fire, enemy AI, damage, pickups and wave progression. Scale the canvas to the window, cap dt, ensure all audio values are finite, and provide complete connected files that pass live preview checks.`,
  },
  {
    id: 'funhouse', image: 'fungame.png', title: 'Funhouse Frenzy', genre: 'ARCADE',
    description: 'Play a colorful mini-game mashup: dodge, aim, collect, and beat the high score.',
    prompt: `Create Funhouse Frenzy, a polished colorful arcade game inspired by the supplied mix of playful characters, ducks, stars, and bowling pins. Build a cohesive round-based mini-game mashup with three short skill challenges: dodge moving obstacles, aim and launch a ball at targets, and collect falling stars before time runs out. Give each round distinct controls, an escalating but fair pattern, clear instructions, readable scoring, a combo/streak system, and a final medal/high-score screen. Add cheerful animated characters, juicy hit/pickup effects, accessible color contrast, a shared score/lives HUD, title/start, pause/resume, retry, and a way to choose a round. Support touch and keyboard, full-screen responsive canvas, clamped dt, and safe optional synthesized sounds. Implement real hit detection and round transitions; do not make the challenges decorative. Deliver complete HTML/CSS/JS modules and verify each mini-game, scoring, transitions, and restart.`,
  },
  {
    id: 'castle-quest', image: 'castlegame.png', title: 'Castle Quest', genre: 'ADVENTURE',
    description: 'Swing through a jungle-temple world, find the relic, and reach the castle sanctuary.',
    prompt: `Build Castle Quest as a substantial side-scrolling adventure inspired by the supplied explorer, jungle ruins, birds, and castle sanctuary artwork. The player explores a vivid jungle-temple route with precise run/jump controls, a short rope-swing or climb mechanic, collectible relic fragments, hidden treasure, safe checkpoints, and a final castle goal. Add layered forest scenery, friendly wildlife, readable hazards, a small number of clever environmental puzzles, and a guardian encounter with telegraphed moves. Include a clear map/progress and health/relic HUD, concise controls, title/start, pause/resume, checkpoint recovery, victory and restart. Keep movement forgiving and responsive, support touch, scale to the viewport, clamp dt, and make audio fail silently. Implement actual platform collisions, pickups, checkpoint/door progression, and a reachable ending. Write complete wired HTML/CSS/JS and verify the full path from start to finish.`,
  },
  {
    id: 'treasure-claim', image: 'claimgame.png', title: 'Treasure Claim', genre: 'EXPLORATION',
    description: 'Explore the island, uncover treasure caches, and claim the lost jungle temple.',
    prompt: `Create Treasure Claim, a complete top-down island exploration and treasure-hunt game based on the supplied explorer and tropical temple image. Guide the player through a readable island map with dense but traversable jungle paths, landmarks, bridges, hidden caches, clue markers, and a central ancient temple. Core loop: explore, find clues, solve a few simple environmental puzzles, collect keys/relic pieces, avoid patrolling wildlife, unlock the temple, and claim the treasure. Add a compact map/compass, inventory and clue log, health, pickup feedback, a short opening tutorial, title/start, pause/resume, discovery/victory, and restart. Use warm lush pixel/illustrated scenery and distinguish interactive objects clearly. Implement actual path boundaries, item state, clue gating and temple unlock. Support keyboard/touch, responsive viewport, capped dt, and safe audio fallback. Deliver complete connected web files and verify exploration, clue collection, puzzle gates, temple access, and the ending.`,
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
  const [selectedGameId, setSelectedGameId] = useState<string | null>(null);

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
    setSelectedGameId(game.id);
    setLoadingGameId(game.id);
    try {
      const reference = await rasterizeStarterImage(
        `/images/game-worlds/${game.image}`,
        `${game.id}-reference.png`,
      );
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

      {/* Five real loading-screen game images per row. Hover shows a gray prompt preview on the image. */}
      {!isWorkbenchActive && (
        <div className="w-full max-w-4xl px-2">
          <div className="grid w-full grid-cols-5 gap-2 sm:gap-2.5">
            {orderedGames.map((item) => {
              const selected = selectedGameId === item.id;

              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => void selectStarterGame(item)}
                  disabled={Boolean(loadingGameId)}
                  aria-label={`Choose ${item.title}. ${item.description}`}
                  aria-pressed={selected}
                  className={`group relative aspect-[4/3] min-w-0 overflow-hidden border bg-[#10132d] shadow-lg shadow-black/25 transition duration-200 hover:-translate-y-0.5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-200 disabled:cursor-wait disabled:opacity-70 ${
                    selected
                      ? 'border-cyan-100 ring-2 ring-cyan-300 shadow-[0_0_28px_rgba(34,211,238,0.55)]'
                      : 'border-white/20 hover:border-cyan-200/80'
                  }`}
                >
                  <img
                    src={`/images/game-worlds/${item.image}`}
                    alt={item.title}
                    className="absolute inset-0 h-full w-full object-cover transition duration-300 group-hover:scale-[1.03]"
                    loading="eager"
                  />
                  <span className="pointer-events-none absolute inset-x-1 bottom-1 rounded-sm bg-gray-900/90 px-2 py-1.5 text-left text-[9px] leading-tight text-gray-200 opacity-0 shadow-lg backdrop-blur-sm transition-opacity duration-150 group-hover:opacity-100 group-focus-visible:opacity-100">
                    <span className="block truncate font-bold text-gray-100">{item.title}</span>
                    <span className="mt-0.5 block line-clamp-2 text-gray-300">{item.description}</span>
                  </span>
                  {selected && (
                    <span className="absolute right-1 top-1 grid h-5 w-5 place-items-center rounded-full bg-cyan-200 text-slate-950 shadow-md">
                      <span className="i-ph:check-bold text-xs" aria-hidden="true" />
                    </span>
                  )}
                  {loadingGameId === item.id && (
                    <span className="absolute inset-0 grid place-items-center bg-black/35">
                      <span className="i-svg-spinners:90-ring-with-bg text-2xl text-cyan-100" aria-label="Preparing game prompt" />
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

export function StudioLandingFooter() {
  return null;
}
