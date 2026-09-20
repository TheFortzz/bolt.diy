import React, { useEffect, useState } from 'react';

interface StudioLandingSectionProps {
  onSelectTemplate?: (prompt: string) => void;
  onLaunchTemplate?: (event: React.UIEvent, prompt: string) => void;
  onOpenSettings?: () => void;
  fortzBalance?: number;
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

export function StudioLandingSection({}: StudioLandingSectionProps) {
  const [sentenceIndex, setSentenceIndex] = useState(0);
  const [charIndex, setCharIndex] = useState(0);
  const [isDeleting, setIsDeleting] = useState(false);

  useEffect(() => {
    const currentSentence = ANIMATED_SENTENCES[sentenceIndex];
    let timeout: ReturnType<typeof setTimeout>;

    if (!isDeleting && charIndex < currentSentence.length) {
      // Typing forward (like typing on a keyboard from left to right)
      timeout = setTimeout(() => {
        setCharIndex((prev) => prev + 1);
      }, 55);
    } else if (!isDeleting && charIndex === currentSentence.length) {
      // Pause at full sentence
      timeout = setTimeout(() => {
        setIsDeleting(true);
      }, 2400);
    } else if (isDeleting && charIndex > 0) {
      // Smooth backspace deletion
      timeout = setTimeout(() => {
        setCharIndex((prev) => prev - 1);
      }, 25);
    } else if (isDeleting && charIndex === 0) {
      // Move to next sentence
      setIsDeleting(false);
      setSentenceIndex((prev) => (prev + 1) % ANIMATED_SENTENCES.length);
    }

    return () => clearTimeout(timeout);
  }, [charIndex, isDeleting, sentenceIndex]);

  const currentSentence = ANIMATED_SENTENCES[sentenceIndex];
  const displayedText = currentSentence.slice(0, charIndex);

  return (
    <div className="w-full flex flex-col items-center select-none pt-2 sm:pt-4 pb-1 px-4">
      {/* ── Typewriter Sentence Hero — Single Horizontal Line ── */}
      <div className="text-center w-full max-w-4xl mx-auto min-h-[50px] flex items-center justify-center overflow-hidden">
        <h1 className="text-xl sm:text-2xl md:text-3xl lg:text-4xl font-black uppercase tracking-wider text-white font-['Anton',sans-serif] whitespace-nowrap overflow-hidden text-ellipsis flex items-center justify-center">
          <span className="text-white">
            {displayedText}
          </span>
          <span className="inline-block w-1.5 sm:w-2 h-6 sm:h-8 bg-[#c084fc] ml-1.5 animate-pulse" />
        </h1>
      </div>
    </div>
  );
}

export function StudioLandingFooter() {
  return null;
}
