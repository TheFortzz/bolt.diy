import { memo, useEffect, useState } from 'react';
import { classNames } from '~/utils/classNames';
import { GAME_WORLD_ART } from '~/utils/game-world-art';
import { MatrixRain } from './MatrixRain';

/** Named, text-free game art used both in the starter gallery and while building. */
interface AiWorkingGifProps {
  visible: boolean;
  className?: string;
}

/**
 * Text-free game artwork shown while the agent builds. Chooses a different
 * named local game-world image for each build, so the illustration is not a
 * stale screenshot from the old font-generation GIF.
 */
export const AiWorkingGif = memo(({ visible, className }: AiWorkingGifProps) => {
  const [gifMissing, setGifMissing] = useState(false);
  const [artSrc, setArtSrc] = useState<string>(GAME_WORLD_ART[0]);

  useEffect(() => {
    if (!visible) return;

    const choices = GAME_WORLD_ART.filter((image) => image !== artSrc);
    setArtSrc(choices[Math.floor(Math.random() * choices.length)] || GAME_WORLD_ART[0]);
    setGifMissing(false);
  }, [visible]);

  if (!visible) {
    return null;
  }

  return (
    <div
      className={classNames('w-full overflow-hidden rounded-2xl border border-white/10 bg-black/40', className)}
      aria-hidden="true"
    >
      {gifMissing ? (
        <MatrixRain />
      ) : (
        <img
          src={artSrc}
          alt=""
          draggable={false}
          className="block h-auto max-h-44 w-full object-cover"
          onError={() => setGifMissing(true)}
        />
      )}
    </div>
  );
});
