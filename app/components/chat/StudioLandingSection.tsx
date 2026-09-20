import React, { useEffect, useState } from 'react';

interface StudioLandingSectionProps {
  onSelectTemplate: (prompt: string) => void;
  onLaunchTemplate: (event: React.UIEvent, prompt: string) => void;
  onOpenSettings: () => void;
  fortzBalance?: number;
}

export const QUICK_PILLS = [
  { icon: '🕹️', label: 'Platformer', id: 'platformer' },
  { icon: '🚀', label: 'Space Shooter', id: 'space-shooter' },
  { icon: '⚔️', label: 'Dungeon RPG', id: 'metroidvania' },
  { icon: '🧩', label: 'Physics Puzzle', id: 'physics-puzzle' },
];

const ANIMATED_SENTENCES = [
  'What do you want to build?',
  'Your game starts here...',
  'Turn your wildest ideas into playable worlds.',
  'Craft retro arcade adventures in seconds.',
  'Code physics, enemies, and epic boss fights.',
  'Design high-speed drift racers and platformers.',
  'Prompt, build, and play directly in your browser.',
];

export function StudioLandingSection({
  onSelectTemplate,
  onLaunchTemplate,
  onOpenSettings,
  fortzBalance,
}: StudioLandingSectionProps) {
  const [index, setIndex] = useState(0);
  const [isFading, setIsFading] = useState(false);

  useEffect(() => {
    const timer = setInterval(() => {
      setIsFading(true);
      setTimeout(() => {
        setIndex((prev) => (prev + 1) % ANIMATED_SENTENCES.length);
        setIsFading(false);
      }, 350);
    }, 3600);

    return () => clearInterval(timer);
  }, []);

  const currentSentence = ANIMATED_SENTENCES[index];

  return (
    <div className="w-full flex flex-col items-center select-none pt-6 pb-2 px-4">
      {/* ── Dynamic Animated Sentence Hero ── */}
      <div className="text-center max-w-2xl mx-auto min-h-[58px] flex flex-col items-center justify-center">
        <h1
          className="text-xl sm:text-2xl md:text-3xl font-black uppercase tracking-wider text-white font-['Anton',sans-serif] transition-all duration-300 transform flex items-center justify-center gap-1.5"
          style={{
            opacity: isFading ? 0 : 1,
            transform: isFading ? 'translateY(6px)' : 'translateY(0px)',
          }}
        >
          <span>{currentSentence}</span>
          <span className="inline-block w-2 h-5 bg-[#f97316] animate-pulse ml-1" />
        </h1>
      </div>
    </div>
  );
}

export function StudioLandingFooter({
  onSelectTemplate,
  onLaunchTemplate,
}: {
  onSelectTemplate: (prompt: string) => void;
  onLaunchTemplate: (event: React.UIEvent, prompt: string) => void;
}) {
  return null;
}
