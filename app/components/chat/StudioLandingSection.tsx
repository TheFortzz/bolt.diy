import React, { useEffect, useRef, useState } from 'react';

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
    id: 'motorcycle-rush',
    image: 'motergame.png',
    title: 'Motorcycle Rush',
    genre: 'RACING',
    description: 'Race a superbike through neon streets, drift past traffic, and hit every checkpoint.',
    prompt: `Create a substantial, polished HTML5 motorcycle racing game inspired by the supplied motorcycle artwork. The player rides a blue superbike through a neon city at night. Build responsive acceleration, braking, steering, readable drift traction, near-miss boost, fair traffic patterns, road hazards, collectible boost cells, checkpoint gates, and several difficulty stages with a finish and replay loop. Use a convincing side/rear chase perspective or a polished pseudo-3D road that clearly communicates speed; the bike must remain the recognizable player vehicle. Add animated city lights, wheel effects, sparks, tire smoke, a speedometer, distance, boost and stage HUD, a brief controls overlay, start/pause/resume/crash/restart states, and satisfying safe synthesized engine audio. Support keyboard and touch, resize cleanly, clamp frame delta, prevent NaN audio values, and avoid unfair unavoidable collisions. Build and wire complete HTML, CSS, and JavaScript files; test starting, steering, drifting, boosts, collisions, checkpoints, game over, and restart in the preview.`,
  },
  {
    id: 'football-fire',
    image: 'footballgame.png',
    title: 'Football Fire',
    genre: 'SPORTS',
    description: 'Bend a blazing ball past defenders, score from the spot, and win the tournament.',
    prompt: `Build Football Fire, a complete arcade soccer challenge based on the supplied flaming-football image. Create a playable striker-versus-goalkeeper loop: aim with mouse or touch, set shot power, curve the kick, and score past a goalkeeper whose position and reactions vary fairly. Progress through a tournament of increasingly tricky shot scenarios with moving walls/defenders, target zones, limited attempts, bonus streaks, and a clear final result. Make ball flight, spin, net impact, fire trail, and goalkeeper saves visually satisfying and readable. Include an opening screen with controls, score/attempts/stage HUD, pause/resume, restart, victory and game-over states, responsive full-window canvas, keyboard/touch input, clamped delta time, and safe synthesized kick/crowd audio. Implement actual aiming, trajectory, collision, scoring, and progression—no decorative-only goals. Wire complete HTML/CSS/JS modules and verify scoring, misses, saves, progression, resize, and restart.`,
  },
  {
    id: 'neon-car-rally',
    image: 'cargame.png',
    title: 'Neon Car Rally',
    genre: 'RACING',
    description: 'Throw a blue supercar into city-circuit corners, chase boost, and beat the clock.',
    prompt: `Create a polished, complete browser game called Neon Car Rally, taking its blue futuristic race car and glowing night-city palette from the supplied image. Make the player car the actual controllable vehicle, with smooth steering, acceleration/braking, readable grip and drift, a short boost with cooldown, and forgiving wall collisions. Build a looping neon circuit with lane markings, barriers, traffic or rival cars, boost pickups, timed checkpoints, lap timing, and escalating race goals. Add a stable chase or clean top-down camera, reflections/glow, tire smoke and sparks, a clear speed/lap/boost HUD, start instructions, pause/resume, race-finish, crash recovery, and restart. Use a cohesive visual style, full-viewport responsive rendering, keyboard and touch controls, capped frame delta, and safe synthesized engine/impact audio with finite AudioParam values. Implement real track boundaries, collision, checkpoint order, and lap logic. Write complete HTML/CSS/JS with valid module wiring and verify the whole race loop in the preview.`,
  },
  {
    id: 'space-odyssey',
    image: 'spacegame.png',
    title: 'Space Odyssey',
    genre: 'SPACE ACTION',
    description: 'Pilot a starship between worlds, dodge asteroids, and outfly an alien squadron.',
    prompt: `Build Space Odyssey as a polished 2D space-action game inspired by the supplied starship, ringed planet, and alien artwork. Let the player steer a nimble ship, aim and fire, dodge asteroids, collect energy, and survive increasingly dense enemy waves. Create distinct alien attack patterns with clear telegraphs, several planets/sector backgrounds, weapon upgrades, a charged special ability, and a multi-phase boss with fair openings. Include responsive movement, readable hitboxes, projectile and thruster trails, explosion particles, tasteful impact shake, health/energy/score HUD, short control hints, title/start, pause/resume, game over, and instant restart. Support keyboard, mouse and touch, scale to the viewport, cap dt, guard audio against non-finite values, and degrade to silence if Web Audio fails. Implement actual health, collisions, waves, pickups, and boss progression. Deliver connected HTML/CSS/JavaScript and verify movement, firing, enemy hits, upgrades, defeat, and restart.`,
  },
  {
    id: 'sky-runner',
    image: 'rungame.png',
    title: 'Sky Runner',
    genre: 'PLATFORMER',
    description: 'Sprint, double-jump, and dash across floating cloud platforms to gather golden coins.',
    prompt: `Create Sky Runner, a complete joyful side-scrolling platform game inspired by the supplied blue-sky runner image. The hero must run smoothly, jump with variable height, double-jump, and dash; build a long scrolling course of cloud platforms, safe gaps, moving platforms, gentle hazards, and collectible gold coins. Add coyote time and forgiving collision so the course feels responsive, checkpoints, a finish portal, and a scoring/streak reward for collecting coin trails. Use layered clouds, clear silhouettes, landing dust, bright pickup effects, a compact coin/progress HUD, a quick control hint, start/pause/resume, fall recovery, victory, and restart. Support keyboard and touch, resize the canvas, cap frame delta, and keep sound optional and safely guarded. Implement real platform collision, scrolling, collectibles, checkpoints, and restart rather than a static mockup. Deliver full connected HTML/CSS/JavaScript and verify jumping, dash, coin collection, hazards, checkpoint, completion, and restart.`,
  },
  {
    id: 'tank-assault',
    image: 'tankgame.png',
    title: 'Tank Assault',
    genre: 'ACTION',
    description: 'Drive an armored tank across a burning battlefield, destroy targets, and survive waves.',
    prompt: `Build Tank Assault, a complete top-down armored combat game inspired by the supplied olive tank, battlefield, and explosive arrows. Give the tank independent hull movement and turret aiming, satisfying but controlled shell fire, reload timing, and readable damage. Create several battlefield arenas with cover, destructible obstacles, enemy tanks with distinct behaviors, incoming-fire warnings, ammo/repair pickups, and a final heavy boss. Let players learn controls immediately; include WASD/arrows drive, mouse/touch aim, fire, a dodge/boost, health/ammo/wave HUD, title/start, pause/resume, defeat and restart. Add dust tracks, muzzle flash, sparks and explosions while keeping projectiles and danger zones clear. Implement collision, line-of-fire, enemy AI, damage, pickups and wave progression. Scale the canvas to the window, cap dt, ensure all audio values are finite, and provide complete connected files that pass live preview checks.`,
  },
  {
    id: 'funhouse',
    image: 'fungame.png',
    title: 'Funhouse Frenzy',
    genre: 'ARCADE',
    description: 'Play a colorful mini-game mashup: dodge, aim, collect, and beat the high score.',
    prompt: `Create Funhouse Frenzy, a polished colorful arcade game inspired by the supplied mix of playful characters, ducks, stars, and bowling pins. Build a cohesive round-based mini-game mashup with three short skill challenges: dodge moving obstacles, aim and launch a ball at targets, and collect falling stars before time runs out. Give each round distinct controls, an escalating but fair pattern, clear instructions, readable scoring, a combo/streak system, and a final medal/high-score screen. Add cheerful animated characters, juicy hit/pickup effects, accessible color contrast, a shared score/lives HUD, title/start, pause/resume, retry, and a way to choose a round. Support touch and keyboard, full-screen responsive canvas, clamped dt, and safe optional synthesized sounds. Implement real hit detection and round transitions; do not make the challenges decorative. Deliver complete HTML/CSS/JS modules and verify each mini-game, scoring, transitions, and restart.`,
  },
  {
    id: 'castle-quest',
    image: 'castlegame.png',
    title: 'Castle Quest',
    genre: 'ADVENTURE',
    description: 'Swing through a jungle-temple world, find the relic, and reach the castle sanctuary.',
    prompt: `Build Castle Quest as a substantial side-scrolling adventure inspired by the supplied explorer, jungle ruins, birds, and castle sanctuary artwork. The player explores a vivid jungle-temple route with precise run/jump controls, a short rope-swing or climb mechanic, collectible relic fragments, hidden treasure, safe checkpoints, and a final castle goal. Add layered forest scenery, friendly wildlife, readable hazards, a small number of clever environmental puzzles, and a guardian encounter with telegraphed moves. Include a clear map/progress and health/relic HUD, concise controls, title/start, pause/resume, checkpoint recovery, victory and restart. Keep movement forgiving and responsive, support touch, scale to the viewport, clamp dt, and make audio fail silently. Implement actual platform collisions, pickups, checkpoint/door progression, and a reachable ending. Write complete wired HTML/CSS/JS and verify the full path from start to finish.`,
  },
  {
    id: 'treasure-claim',
    image: 'claimgame.png',
    title: 'Treasure Claim',
    genre: 'EXPLORATION',
    description: 'Explore the island, uncover treasure caches, and claim the lost jungle temple.',
    prompt: `Create Treasure Claim, a complete top-down island exploration and treasure-hunt game based on the supplied explorer and tropical temple image. Guide the player through a readable island map with dense but traversable jungle paths, landmarks, bridges, hidden caches, clue markers, and a central ancient temple. Core loop: explore, find clues, solve a few simple environmental puzzles, collect keys/relic pieces, avoid patrolling wildlife, unlock the temple, and claim the treasure. Add a compact map/compass, inventory and clue log, health, pickup feedback, a short opening tutorial, title/start, pause/resume, discovery/victory, and restart. Use warm lush pixel/illustrated scenery and distinguish interactive objects clearly. Implement actual path boundaries, item state, clue gating and temple unlock. Support keyboard/touch, responsive viewport, capped dt, and safe audio fallback. Deliver complete connected web files and verify exploration, clue collection, puzzle gates, temple access, and the ending.`,
  },
];

type StudioCreatedGame = {
  id: string;
  title: string;
  genre: string;
  description: string;
  status: 'pending' | 'live' | 'hidden' | 'rejected' | string;
  thumbnailUrl: string;
  reviewReason: string;
  reviewMessages: Array<{
    id: string;
    authorId: string;
    authorName: string;
    authorRole: 'admin' | 'creator';
    text: string;
    createdAt: number;
  }>;
};

function isStudioCreatedGame(value: unknown): value is StudioCreatedGame {
  if (!value || typeof value !== 'object') return false;
  const game = value as Record<string, unknown>;

  return (
    typeof game.id === 'string' &&
    typeof game.title === 'string' &&
    typeof game.genre === 'string' &&
    Array.isArray(game.reviewMessages)
  );
}

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
  const [orderedGames, setOrderedGames] = useState(STARTER_GAMES.slice(0, 5));
  const [selectedGameId, setSelectedGameId] = useState<string | null>(null);
  const [createdGames, setCreatedGames] = useState<StudioCreatedGame[]>([]);
  const [editingGame, setEditingGame] = useState<StudioCreatedGame | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [editGenre, setEditGenre] = useState('ACTION');
  const [editDescription, setEditDescription] = useState('');
  const [editBusy, setEditBusy] = useState(false);
  const [editError, setEditError] = useState('');
  const [expandedReviewId, setExpandedReviewId] = useState<string | null>(null);
  const [replyText, setReplyText] = useState('');
  const [replyBusy, setReplyBusy] = useState(false);
  const [replyError, setReplyError] = useState('');
  const nextRequestId = useRef(0);
  const editRequestRef = useRef<string | null>(null);
  const replyRequestRef = useRef<string | null>(null);

  const requestCreatedGames = () => {
    try {
      if (window.parent !== window) {
        window.parent.postMessage({ type: 'thefortz-studio-games-request' }, '*');
      }
    } catch {
      // A standalone Studio preview simply has no parent game catalog.
    }
  };

  useEffect(() => {
    const handleParentMessage = (event: MessageEvent) => {
      if (event.source !== window.parent || !event.data || typeof event.data !== 'object') return;
      if (event.data.type === 'thefortz-studio-games-sync' && Array.isArray(event.data.games)) {
        const games: StudioCreatedGame[] = event.data.games.filter(isStudioCreatedGame);

        setCreatedGames(games);

        try {
          const rejectedTitles = games
            .filter((game) => game.status === 'rejected')
            .map((game) => game.title.trim().toLowerCase())
            .filter(Boolean);

          localStorage.setItem('thefortz:studio-rejected-titles', JSON.stringify(rejectedTitles));
          window.dispatchEvent(new Event('thefortz-publish-unlocked'));
        } catch {
          // Publishing still works when browser storage is unavailable.
        }
      } else if (event.data.type === 'thefortz-studio-game-update-result') {
        if (!editRequestRef.current || event.data.requestId !== editRequestRef.current) return;
        editRequestRef.current = null;
        setEditBusy(false);
        if (event.data.success) {
          setEditingGame(null);
          setEditError('');
          requestCreatedGames();
        } else {
          setEditError(String(event.data.error || 'Could not update this game.'));
        }
      } else if (event.data.type === 'thefortz-review-reply-result') {
        if (!replyRequestRef.current || event.data.requestId !== replyRequestRef.current) return;
        replyRequestRef.current = null;
        setReplyBusy(false);
        if (event.data.success) {
          setReplyText('');
          setReplyError('');
          requestCreatedGames();
        } else {
          setReplyError(String(event.data.error || 'Could not send your reply.'));
        }
      }
    };

    window.addEventListener('message', handleParentMessage);
    requestCreatedGames();
    return () => window.removeEventListener('message', handleParentMessage);
  }, []);

  const saveGameDetails = (event: React.FormEvent) => {
    event.preventDefault();
    if (!editingGame || editBusy) return;
    const title = editTitle.trim();
    if (!title) {
      setEditError('Game title cannot be empty.');
      return;
    }
    const requestId = `studio-edit-${Date.now()}-${++nextRequestId.current}`;
    editRequestRef.current = requestId;
    setEditBusy(true);
    setEditError('');
    try {
      window.parent.postMessage(
        {
          type: 'thefortz-studio-game-update',
          requestId,
          gameId: editingGame.id,
          patch: { title, genre: editGenre.trim(), description: editDescription.trim() },
        },
        '*',
      );
    } catch {
      editRequestRef.current = null;
      setEditBusy(false);
      setEditError('Could not contact TheFortz. Keep this tab open and try again.');
    }
  };

  const sendReviewReply = (event: React.FormEvent) => {
    event.preventDefault();
    if (!expandedReviewId || !replyText.trim() || replyBusy) return;
    const requestId = `review-reply-${Date.now()}-${++nextRequestId.current}`;
    replyRequestRef.current = requestId;
    setReplyBusy(true);
    setReplyError('');
    try {
      window.parent.postMessage(
        {
          type: 'thefortz-review-reply',
          requestId,
          gameId: expandedReviewId,
          text: replyText.trim(),
        },
        '*',
      );
    } catch {
      replyRequestRef.current = null;
      setReplyBusy(false);
      setReplyError('Could not contact TheFortz. Keep this tab open and try again.');
    }
  };

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

      nextOrder = shuffled
        .slice(0, 5)
        .map((game) => game.id)
        .join(',');
      if (nextOrder !== previousOrder) break;
    }

    try {
      sessionStorage.setItem(orderKey, nextOrder);
    } catch {
      // The card order remains randomized when storage is unavailable.
    }
    setOrderedGames(shuffled.slice(0, 5));
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
      const reference = await rasterizeStarterImage(`/images/game-worlds/${game.image}`, `${game.id}-reference.png`);
      onSelectTemplate(game.prompt, reference);
    } catch {
      onSelectTemplate(game.prompt);
    } finally {
      setLoadingGameId(null);
    }
  };

  return (
    <div className="w-full flex flex-col items-center select-none p-0 mb-1">
      {!isWorkbenchActive && createdGames.length > 0 && (
        <section className="mb-6 w-full max-w-5xl px-2 text-left" aria-label="Your published games">
          <div className="mb-2 flex items-center justify-between gap-3">
            <div>
              <h2 className="m-0 text-sm font-black tracking-[0.12em] text-purple-100">YOUR GAMES</h2>
              <p className="m-0 text-[11px] text-purple-200/70">Published games and their review status</p>
            </div>
            <button
              type="button"
              onClick={requestCreatedGames}
              className="shrink-0 rounded-md border border-purple-300/30 bg-purple-950/40 px-2.5 py-1.5 text-[10px] font-bold text-purple-100 hover:bg-purple-900/60"
            >
              REFRESH
            </button>
          </div>
          <div className="flex w-full gap-3 overflow-x-auto pb-2" style={{ scrollbarWidth: 'thin' }}>
            {createdGames.map((game) => {
              const rejected = game.status === 'rejected';
              const pending = game.status === 'pending' || game.status === 'hidden';
              const statusLabel = rejected ? 'CHANGES REQUESTED' : pending ? 'WAITING FOR APPROVAL' : 'APPROVED';
              const statusTone = rejected ? 'text-red-200' : pending ? 'text-amber-200' : 'text-emerald-200';
              return (
                <article
                  key={game.id}
                  className="relative w-[clamp(180px,22vw,236px)] min-w-[180px] shrink-0 overflow-hidden rounded-sm border-2 border-white/70 bg-[#0b1433] shadow-lg shadow-black/30"
                >
                  <div className="relative aspect-video overflow-hidden bg-slate-900">
                    {game.thumbnailUrl ? (
                      <img
                        src={game.thumbnailUrl}
                        alt={game.title}
                        className="h-full w-full object-cover"
                        loading="lazy"
                      />
                    ) : (
                      <div
                        className="grid h-full w-full place-items-center bg-gradient-to-br from-slate-900 via-purple-950 to-blue-950 text-3xl"
                        aria-hidden="true"
                      >
                        🎮
                      </div>
                    )}
                    <span className="absolute bottom-1 left-1 rounded-sm bg-black/70 px-1.5 py-0.5 text-[9px] font-bold tracking-wide text-white">
                      {game.genre || 'GAME'}
                    </span>
                  </div>
                  <div className="flex min-h-[46px] items-center gap-2 bg-gradient-to-r from-emerald-900 to-emerald-950 px-2.5 py-2">
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-xs font-bold text-white" title={game.title}>
                        {game.title}
                      </div>
                      <div className={`mt-0.5 truncate text-[9px] font-extrabold tracking-[0.06em] ${statusTone}`}>
                        {statusLabel}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setEditingGame(game);
                        setEditTitle(game.title);
                        setEditGenre(game.genre || 'ACTION');
                        setEditDescription(game.description || '');
                        setEditError('');
                      }}
                      aria-label={`Edit ${game.title}`}
                      title="Edit game details"
                      className="grid h-8 w-8 shrink-0 place-items-center rounded-md border border-white/20 bg-white/10 text-white hover:bg-white/20"
                    >
                      <span className="i-ph:pencil-simple text-base" aria-hidden="true" />
                    </button>
                  </div>
                  {rejected && (
                    <div className="border-t border-red-300/15 bg-red-950/50 px-2.5 py-2">
                      <p className="m-0 line-clamp-2 text-[10px] leading-4 text-red-100">
                        {game.reviewReason || 'Please open the review conversation for details.'}
                      </p>
                      <button
                        type="button"
                        onClick={() => {
                          setExpandedReviewId((current) => (current === game.id ? null : game.id));
                          setReplyError('');
                        }}
                        className="mt-1 text-[10px] font-bold text-cyan-200 underline underline-offset-2"
                      >
                        {expandedReviewId === game.id ? 'Close review conversation' : 'Open review conversation'}
                      </button>
                      {expandedReviewId === game.id && (
                        <div className="mt-2 border-t border-red-200/15 pt-2">
                          <div className="flex max-h-40 flex-col gap-2 overflow-y-auto pr-1">
                            {game.reviewMessages.map((message) => (
                              <div
                                key={message.id}
                                className={`max-w-[94%] rounded-md px-2 py-1.5 text-[10px] ${message.authorRole === 'creator' ? 'ml-auto bg-cyan-900/70 text-cyan-50' : 'mr-auto bg-slate-800 text-slate-100'}`}
                              >
                                <div className="mb-0.5 font-bold">{message.authorName}</div>
                                <div className="whitespace-pre-wrap">{message.text}</div>
                              </div>
                            ))}
                            {!game.reviewMessages.length && game.reviewReason && (
                              <div className="mr-auto max-w-[94%] rounded-md bg-slate-800 px-2 py-1.5 text-[10px] text-slate-100">
                                <div className="mb-0.5 font-bold">@thefortz</div>
                                <div className="whitespace-pre-wrap">{game.reviewReason}</div>
                              </div>
                            )}
                          </div>
                          <form onSubmit={sendReviewReply} className="mt-2 flex flex-col gap-1.5">
                            <textarea
                              value={replyText}
                              onChange={(event) => setReplyText(event.target.value)}
                              rows={2}
                              maxLength={3000}
                              placeholder="Reply about the requested changes…"
                              className="w-full resize-y rounded-md border border-white/15 bg-slate-950/80 px-2 py-1.5 text-[11px] text-white placeholder:text-slate-400 focus:border-cyan-300 focus:outline-none"
                            />
                            {replyError && <span className="text-[10px] text-red-200">{replyError}</span>}
                            <button
                              type="submit"
                              disabled={replyBusy || !replyText.trim()}
                              className="self-end rounded-md bg-cyan-700 px-2.5 py-1.5 text-[10px] font-bold text-white disabled:opacity-50"
                            >
                              {replyBusy ? 'SENDING…' : 'SEND REPLY'}
                            </button>
                          </form>
                        </div>
                      )}
                    </div>
                  )}
                </article>
              );
            })}
          </div>
        </section>
      )}

      <div className="h-8 mb-4" aria-hidden="true" />

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
                      <span
                        className="i-svg-spinners:90-ring-with-bg text-2xl text-cyan-100"
                        aria-label="Preparing game prompt"
                      />
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {editingGame && (
        <div
          className="fixed inset-0 z-[100000] grid place-items-center bg-black/70 p-4"
          onClick={() => !editBusy && setEditingGame(null)}
        >
          <form
            onSubmit={saveGameDetails}
            onClick={(event) => event.stopPropagation()}
            className="w-full max-w-md rounded-xl border border-purple-300/30 bg-[#111635] p-5 text-left shadow-2xl"
          >
            <h2 className="m-0 text-lg font-bold text-white">Edit published game</h2>
            <p className="mt-1 text-xs text-purple-200/70">
              Changes update the existing listing without changing its review status.
            </p>
            <label className="mt-4 block text-xs font-bold text-purple-100">
              GAME TITLE
              <input
                value={editTitle}
                onChange={(event) => setEditTitle(event.target.value)}
                maxLength={48}
                className="mt-1 w-full rounded-md border border-white/15 bg-slate-950 px-3 py-2 text-sm text-white focus:border-cyan-300 focus:outline-none"
              />
            </label>
            <label className="mt-3 block text-xs font-bold text-purple-100">
              GENRE
              <input
                value={editGenre}
                onChange={(event) => setEditGenre(event.target.value)}
                maxLength={40}
                className="mt-1 w-full rounded-md border border-white/15 bg-slate-950 px-3 py-2 text-sm text-white focus:border-cyan-300 focus:outline-none"
              />
            </label>
            <label className="mt-3 block text-xs font-bold text-purple-100">
              DESCRIPTION
              <textarea
                value={editDescription}
                onChange={(event) => setEditDescription(event.target.value)}
                maxLength={400}
                rows={4}
                className="mt-1 w-full resize-y rounded-md border border-white/15 bg-slate-950 px-3 py-2 text-sm text-white focus:border-cyan-300 focus:outline-none"
              />
            </label>
            {editError && <div className="mt-3 text-xs text-red-200">{editError}</div>}
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                disabled={editBusy}
                onClick={() => setEditingGame(null)}
                className="rounded-md border border-white/20 px-3 py-2 text-xs text-white disabled:opacity-50"
              >
                CANCEL
              </button>
              <button
                type="submit"
                disabled={editBusy}
                className="rounded-md bg-emerald-700 px-3 py-2 text-xs font-bold text-white disabled:opacity-50"
              >
                {editBusy ? 'UPDATING…' : 'UPDATE GAME'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}

export function StudioLandingFooter() {
  return null;
}
