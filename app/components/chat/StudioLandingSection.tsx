import React, { useEffect, useState } from 'react';

interface StudioLandingSectionProps {
  onSelectTemplate?: (prompt: string) => void;
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

const STARTER_PROMPTS = [
  {
    icon: '🏎️',
    title: 'Neon Racer',
    desc: 'Top-down arcade racer with boost & traffic',
    prompt: 'Create a high-speed top-down neon arcade racer with drifting, boost pads, oncoming traffic, and a timer checkpoint system.',
  },
  {
    icon: '🚀',
    title: 'Space Survivor',
    desc: 'Arena survival with weapons & upgrades',
    prompt: 'Build a space arena survival game where you steer a nimble ship, dodge asteroids, blast alien waves, and collect upgrade shards.',
  },
  {
    icon: '🏃',
    title: 'Cyber Runner',
    desc: 'Endless runner with double jump & dash',
    prompt: 'Create a fast-paced 2D endless runner with double jump, dash mechanics, neon obstacles, and collecting energy cells.',
  },
  {
    icon: '🧩',
    title: 'Physics Puzzle',
    desc: 'Gravity-flip mechanics & pressure switches',
    prompt: 'Create a physics-based puzzle platformer where you can flip gravity, push interactive blocks onto pressure plates, and open gates.',
  },
  {
    icon: '⚔️',
    title: 'Dungeon Crawler',
    desc: 'Top-down combat, enemies & loot chests',
    prompt: 'Build a top-down pixel dungeon crawler with sword attacks, enemy skeletons, health potions, and room-based dungeon layout.',
  },
];

export function StudioLandingSection({ onSelectTemplate, isWorkbenchActive }: StudioLandingSectionProps) {
  const [sentenceIndex, setSentenceIndex] = useState(0);
  const [charIndex, setCharIndex] = useState(0);
  const [isDeleting, setIsDeleting] = useState(false);

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

  return (
    <div className="w-full flex flex-col items-center select-none p-0 mb-1">
      {/* ── Top Studio Badge ── */}
      <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-purple-900/40 border border-purple-500/30 text-purple-200 text-xs font-medium mb-3 backdrop-blur-md shadow-sm">
        <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping" />
        <span className="font-semibold tracking-wider uppercase text-[11px] text-purple-100">Fortz Game Engine · Studio AI</span>
      </div>

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

      {/* ── Starter Inspiration Chips ── */}
      {!isWorkbenchActive && (
        <div className="w-full flex flex-wrap items-center justify-center gap-2 max-w-2xl px-2">
          {STARTER_PROMPTS.map((item) => (
            <button
              key={item.title}
              type="button"
              onClick={() => onSelectTemplate?.(item.prompt)}
              className="group flex items-center gap-2 px-3 py-1.5 rounded-full bg-purple-950/50 hover:bg-purple-900/70 border border-purple-500/25 hover:border-purple-400/50 text-purple-200 hover:text-white transition-all duration-200 text-xs backdrop-blur-sm shadow-sm hover:shadow-[0_0_12px_rgba(168,85,247,0.25)] hover:scale-[1.02] active:scale-[0.98]"
              title={item.desc}
            >
              <span className="text-sm">{item.icon}</span>
              <span className="font-semibold text-purple-100">{item.title}</span>
              <span className="text-[10px] text-purple-400 group-hover:text-purple-300 hidden sm:inline">
                {item.desc}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function StudioLandingFooter() {
  return null;
}
