import { memo, useEffect, useState } from 'react';
import styles from '~/components/chat/CookingStatus.module.scss';
import { classNames } from '~/utils/classNames';

const GENERAL_PHRASES = [
  'Preheating the arcade',
  'Cooking up your game',
  'Chopping sprites, dicing pixels',
  'Simmering game logic',
  'Seasoning the physics',
  'Kneading the level dough',
  'Plating power-ups',
  'Garnishing with particles',
  'Whisking shaders',
  'Marinating mechanics',
  'Reducing bugs to a glaze',
  'Taste-testing the fun',
];

const PHASE_PHRASES: Record<string, string[]> = {
  planning: [
    'Sketching the recipe',
    'Writing the menu of systems',
    'Measuring out mechanics',
    'Plating the game design',
  ],
  'preparing-assets': ['Painting fresh sprites', 'Baking pixel art', 'Frosting the visuals', 'Sourcing crunchy pixels'],
  editing: [
    'Folding in new features',
    'Stirring the code pot',
    'Dicing collision boxes',
    'Simmering game logic',
    'Seasoning the physics',
  ],
  verifying: ['Checking the oven', 'Sniffing out bugs', 'Taste-testing the build', 'Quality-checking every bite'],
};

const HEADLINES = [
  'FortzAI is cooking',
  'Back in a sec, plating pixels',
  'The kitchen is hot',
  'Something tasty is loading',
  'FortzAI is in the kitchen',
];

interface CookingStatusProps {
  phase?: string;
  variant?: 'line' | 'headline' | 'compact';
  intervalMs?: number;
  className?: string;
}

/**
 * Rotating "cooking" status line shown while FortzAI works. Phrases are
 * decorative (aria-hidden); surrounding cards already expose a live region.
 */
export const CookingStatus = memo(({ phase, variant = 'line', intervalMs = 2800, className }: CookingStatusProps) => {
  const pool = variant === 'headline' ? HEADLINES : (phase && PHASE_PHRASES[phase]) || GENERAL_PHRASES;
  const [index, setIndex] = useState(0);

  useEffect(() => {
    setIndex(0);
  }, [phase, variant]);

  useEffect(() => {
    if (pool.length < 2) {
      return undefined;
    }

    const timer = setInterval(() => {
      setIndex((i) => (i + 1) % pool.length);
    }, intervalMs);

    return () => clearInterval(timer);
  }, [pool, intervalMs]);

  const phrase = pool[index % pool.length];

  return (
    <span className={classNames(styles.Cooking, className)} aria-hidden="true">
      <span key={`${variant}-${index}`} className={styles.Shimmer}>
        {phrase}
      </span>
      <span className={styles.Dots} aria-hidden="true">
        <i />
        <i />
        <i />
      </span>
    </span>
  );
});
