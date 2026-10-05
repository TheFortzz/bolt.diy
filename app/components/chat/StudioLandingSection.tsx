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
    prompt: 'Build a playable 3D neon highway racer with responsive steering, drift, boost pads, traffic, timed checkpoints, and a working restart.',
    art: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 960 540"><defs><linearGradient id="bg" x2="0" y2="1"><stop stop-color="#21134e"/><stop offset="1" stop-color="#080a1a"/></linearGradient><linearGradient id="road" x2="1"><stop stop-color="#12234a"/><stop offset=".5" stop-color="#26345d"/><stop offset="1" stop-color="#10172f"/></linearGradient><linearGradient id="car" x2="1"><stop stop-color="#40eaff"/><stop offset="1" stop-color="#ff4bd8"/></linearGradient></defs><rect width="960" height="540" fill="url(#bg)"/><circle cx="760" cy="104" r="62" fill="#ff43cb" opacity=".72"/><path d="M0 282 150 200l110 80 150-126 130 117 150-96 270 135v230H0Z" fill="#171d49"/><path d="M0 330 170 248l130 80 150-107 160 95 150-77 200 90v211H0Z" fill="#10172f"/><path d="m352 540 128-264h52l150 264Z" fill="url(#road)"/><path d="m430 540 53-264h15l-20 264Zm101 0-46-264h14l74 264Z" fill="#d9ebff" opacity=".8"/><path d="m357 520 82-184M670 520 568 336" stroke="#39e8ff" stroke-width="8" opacity=".7"/><path d="m450 420 22-39h18l28 39-7 70h-53Z" fill="url(#car)" stroke="#fff" stroke-width="4"/><path d="m455 423 20-24h18l23 24Z" fill="#162244"/><path d="m451 480-37 40m105-40 39 40" stroke="#ff4bd8" stroke-width="9" stroke-linecap="round"/><path d="M60 430h180M700 390h190" stroke="#33eaff" stroke-width="5" opacity=".6"/></svg>`,
  },
  {
    id: 'starfall',
    title: 'Starfall Arena',
    genre: 'SPACE ACTION',
    prompt: 'Create a smooth 2D space survival game with a controllable ship, readable enemy waves, asteroid dodging, collectible energy, and responsive restart and pause buttons.',
    art: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 960 540"><defs><radialGradient id="space"><stop stop-color="#293a79"/><stop offset="1" stop-color="#080b20"/></radialGradient><linearGradient id="ship" x2="0" y2="1"><stop stop-color="#a9f5ff"/><stop offset="1" stop-color="#438dff"/></linearGradient></defs><rect width="960" height="540" fill="url(#space)"/><g fill="#fff"><circle cx="92" cy="83" r="3"/><circle cx="232" cy="161" r="2"/><circle cx="815" cy="65" r="3"/><circle cx="698" cy="190" r="2"/><circle cx="130" cy="360" r="2"/><circle cx="850" cy="414" r="3"/><circle cx="562" cy="82" r="2"/><circle cx="366" cy="431" r="2"/></g><circle cx="760" cy="320" r="120" fill="#8e45d7" opacity=".5"/><circle cx="760" cy="320" r="86" fill="#f080d2" opacity=".52"/><path d="M282 96 353 135 282 173 302 135Z" fill="#fb698f"/><path d="m674 120 39 23-39 24 11-24Z" fill="#ffbb4b"/><path d="m440 236 72 108-72-24-72 24Z" fill="url(#ship)" stroke="#e7fdff" stroke-width="5"/><path d="m410 321-12 79 42-43 42 43-12-79Z" fill="#52d9ff" opacity=".8"/><circle cx="440" cy="316" r="12" fill="#fff"/><path d="M440 396v74" stroke="#ff974f" stroke-width="12" stroke-linecap="round"/><circle cx="177" cy="244" r="34" fill="#6c7291"/><path d="m153 222 48 44m0-44-48 44" stroke="#969bb2" stroke-width="6"/></svg>`,
  },
  {
    id: 'skybound',
    title: 'Skybound Sprint',
    genre: 'PLATFORMER',
    prompt: 'Build a polished 2D platform runner with responsive jump and dash, clear hazards, collectible energy, checkpoint progress, and a reliable retry button.',
    art: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 960 540"><defs><linearGradient id="sky" x2="0" y2="1"><stop stop-color="#f99e78"/><stop offset=".52" stop-color="#754d9d"/><stop offset="1" stop-color="#18244f"/></linearGradient><linearGradient id="platform"><stop stop-color="#3ef1d0"/><stop offset="1" stop-color="#3889e8"/></linearGradient></defs><rect width="960" height="540" fill="url(#sky)"/><circle cx="730" cy="120" r="65" fill="#ffe49a" opacity=".94"/><path d="M0 315 130 250l120 60 150-133 135 125 142-89 132 93 151-85v319H0Z" fill="#473c80" opacity=".82"/><path d="M0 398 130 326l122 73 149-96 151 94 144-72 155 89 109-62v188H0Z" fill="#222653"/><path d="M70 437h210v26H70zm310-77h174v26H380zm282 92h185v26H662z" fill="url(#platform)"/><path d="m286 437 47-35 37 35" fill="none" stroke="#ffca68" stroke-width="10"/><circle cx="366" cy="287" r="23" fill="#fff16b"/><circle cx="424" cy="273" r="23" fill="#fff16b"/><circle cx="481" cy="286" r="23" fill="#fff16b"/><rect x="435" y="318" width="42" height="60" rx="8" fill="#ff4f83"/><circle cx="456" cy="304" r="22" fill="#ffd4a4"/><path d="M440 374 420 420m43-46 22 38" stroke="#26315e" stroke-width="13" stroke-linecap="round"/><path d="M180 421v-36m525 34v-36" stroke="#ff709f" stroke-width="12"/></svg>`,
  },
  {
    id: 'prism-lab',
    title: 'Prism Lab',
    genre: 'PUZZLE',
    prompt: 'Create a clean physics puzzle game about redirecting light beams with movable mirrors to unlock the exit; include clear instructions, undo, reset, and working controls.',
    art: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 960 540"><defs><linearGradient id="lab" x2="1" y2="1"><stop stop-color="#132e60"/><stop offset="1" stop-color="#12132d"/></linearGradient><linearGradient id="beam"><stop stop-color="#4df5ff"/><stop offset=".5" stop-color="#d7ff72"/><stop offset="1" stop-color="#fff"/></linearGradient></defs><rect width="960" height="540" fill="url(#lab)"/><path d="M80 80h800v380H80Z" fill="none" stroke="#4a6b9b" stroke-width="8"/><path d="M145 400 420 190 675 400" fill="none" stroke="url(#beam)" stroke-width="12" opacity=".82"/><path d="m414 181 35 35-35 35-35-35Z" fill="#f2fdff" stroke="#84f7ff" stroke-width="6"/><path d="m670 379 40 40-40 40-40-40Z" fill="#ffdb72" stroke="#fff4c6" stroke-width="6"/><rect x="120" y="360" width="54" height="54" rx="10" fill="#47d1ff"/><rect x="776" y="139" width="62" height="220" rx="18" fill="#6c4ded" opacity=".72"/><path d="M790 162h34m-34 38h34m-34 38h34" stroke="#cfbfff" stroke-width="7"/><circle cx="144" cy="388" r="12" fill="#fff"/><path d="M291 398h95" stroke="#ffba5c" stroke-width="9" stroke-dasharray="18 12"/></svg>`,
  },
  {
    id: 'ember-crypt',
    title: 'Ember Crypt',
    genre: 'DUNGEON ACTION',
    prompt: 'Build a top-down dungeon adventure with a clear room layout, responsive sword combat, one enemy type, health pickups, a treasure goal, and usable restart controls.',
    art: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 960 540"><defs><linearGradient id="crypt" x2="0" y2="1"><stop stop-color="#392744"/><stop offset="1" stop-color="#100f20"/></linearGradient><radialGradient id="torch"><stop stop-color="#ffb74d" stop-opacity=".85"/><stop offset="1" stop-color="#ff702d" stop-opacity="0"/></radialGradient></defs><rect width="960" height="540" fill="url(#crypt)"/><path d="M110 74h740v392H110Z" fill="#282238" stroke="#85718b" stroke-width="12"/><path d="M144 108h672v324H144Z" fill="#342b43"/><path d="M144 216h672M144 324h672M368 108v324M592 108v324" stroke="#51445d" stroke-width="8"/><circle cx="200" cy="162" r="84" fill="url(#torch)"/><circle cx="755" cy="380" r="100" fill="url(#torch)"/><path d="m468 214 30-53 31 53-18 54h-27Z" fill="#f0c48c"/><circle cx="498" cy="197" r="23" fill="#f6d4a5"/><path d="m468 241-25 51m75-51 25 51" stroke="#d7b98e" stroke-width="13" stroke-linecap="round"/><path d="M545 225h92" stroke="#e4e9ff" stroke-width="10"/><path d="m630 212 30 13-30 13" fill="#ffdf8b"/><path d="M260 370h70v54h-70Z" fill="#a34d37" stroke="#f5b354" stroke-width="7"/><path d="M275 370v-27h40v27" fill="none" stroke="#f5b354" stroke-width="7"/><circle cx="290" cy="393" r="8" fill="#ffe28f"/></svg>`,
  },
];

function svgDataUrl(svg: string) {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

async function rasterizeStarterImage(svg: string, fileName: string) {
  const image = new Image();
  image.src = svgDataUrl(svg);
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
    canvas.toBlob((result) => result ? resolve(result) : reject(new Error('Could not encode starter image.')), 'image/png');
  });

  return { dataUrl, file: new File([blob], fileName, { type: 'image/png' }) };
}

export function StudioLandingSection({ onSelectTemplate, isWorkbenchActive }: StudioLandingSectionProps) {
  const [sentenceIndex, setSentenceIndex] = useState(0);
  const [charIndex, setCharIndex] = useState(0);
  const [isDeleting, setIsDeleting] = useState(false);
  const [loadingGameId, setLoadingGameId] = useState<string | null>(null);

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
      const reference = await rasterizeStarterImage(game.art, `${game.id}-reference.png`);
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

      <p className="text-xs sm:text-sm text-purple-300/70 text-center mt-1.5 mb-4 max-w-md">
        Describe any mechanic, genre, or visual style. FortzAI will architect and build your playable game live.
      </p>

      {/* ── Clickable visual game starters ── */}
      {!isWorkbenchActive && (
        <div className="w-full max-w-4xl px-2">
          <p className="mb-2 text-center text-[11px] font-semibold uppercase tracking-[0.16em] text-purple-300/75">
            Pick a game world — its prompt and reference art will be attached
          </p>
          <div className="flex w-full snap-x items-center gap-3 overflow-x-auto px-1 pb-2 sm:justify-center">
            {STARTER_GAMES.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => void selectStarterGame(item)}
              disabled={Boolean(loadingGameId)}
              className="group relative aspect-[16/10] w-[148px] flex-shrink-0 snap-start overflow-hidden rounded-xl border border-purple-300/20 bg-[#10132d] text-left shadow-lg shadow-black/25 transition duration-300 hover:-translate-y-1 hover:border-cyan-200/70 hover:shadow-[0_12px_34px_rgba(56,189,248,0.22)] disabled:cursor-wait disabled:opacity-70 sm:w-[154px]"
              title={`Use ${item.title} prompt and attach its reference image`}
            >
              <img
                src={svgDataUrl(item.art)}
                alt={`${item.title} game concept art`}
                className="absolute inset-0 h-full w-full object-cover transition duration-500 group-hover:scale-105"
                loading="eager"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-[#080a18] via-[#080a18]/10 to-transparent" />
              <span className="absolute left-2 top-2 rounded-full border border-white/20 bg-black/45 px-2 py-1 text-[9px] font-black tracking-wider text-cyan-100 backdrop-blur-sm">
                {item.genre}
              </span>
              <span className="absolute inset-x-3 bottom-3 flex items-end justify-between gap-2">
                <span className="font-['Anton',sans-serif] text-sm uppercase tracking-wider text-white drop-shadow sm:text-base">
                  {item.title}
                </span>
                {loadingGameId === item.id ? (
                  <span className="i-svg-spinners:90-ring-with-bg mb-0.5 text-lg text-cyan-100" aria-label="Attaching reference image" />
                ) : (
                  <span className="i-ph:arrow-up-right-bold mb-0.5 text-lg text-cyan-100 opacity-0 transition group-hover:opacity-100" aria-hidden="true" />
                )}
              </span>
            </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export function StudioLandingFooter() {
  return null;
}
