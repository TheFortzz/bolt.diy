import { memo, useState } from 'react';
import { classNames } from '~/utils/classNames';
import { CookingStatus } from './CookingStatus';

/** Drop the "AI working" animation here: public/ai-working.gif (exact name, no spaces). */
export const AI_WORKING_GIF_SRC = '/ai-working.gif';

interface AiWorkingGifProps {
  visible: boolean;
  className?: string;
}

/**
 * "AI working" banner shown between the chat and the composer while the agent
 * builds (after planning, until the run settles). Uses the uploaded gif when
 * present, otherwise a built-in animated banner — so it always appears and
 * renders nothing only when hidden.
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
        <div className="flex items-center justify-center gap-2 bg-gradient-to-r from-violet-950/80 via-fuchsia-900/60 to-violet-950/80 px-4 py-2.5">
          <span className="inline-block h-2 w-2 animate-ping rounded-full bg-fuchsia-400" />
          <CookingStatus variant="headline" intervalMs={2200} />
        </div>
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
