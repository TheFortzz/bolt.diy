import { memo, useState } from 'react';
import { classNames } from '~/utils/classNames';
import { MatrixRain } from './MatrixRain';

/** Drop the "AI working" animation here: public/ai-working.gif (exact name, no spaces). */
export const AI_WORKING_GIF_SRC = '/ai-working.gif';

interface AiWorkingGifProps {
  visible: boolean;
  className?: string;
}

/**
 * "AI working" banner shown between the chat and the composer while the agent
 * builds (after planning, until the run settles). Uses the uploaded gif when
 * present, otherwise the built-in Matrix rain animation — so it always
 * appears and renders nothing only when hidden.
 */
export const AiWorkingGif = memo(({ visible, className }: AiWorkingGifProps) => {
  const [gifMissing, setGifMissing] = useState(false);

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
          src={AI_WORKING_GIF_SRC}
          alt=""
          draggable={false}
          className="block h-auto max-h-44 w-full object-cover"
          onError={() => setGifMissing(true)}
        />
      )}
    </div>
  );
});
