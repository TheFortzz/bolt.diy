import { memo, useState } from 'react';
import { classNames } from '~/utils/classNames';

/** Drop the "AI working" animation here: public/ai-working.gif (exact name, no spaces). */
export const AI_WORKING_GIF_SRC = '/ai-working.gif';

interface AiWorkingGifProps {
  visible: boolean;
  className?: string;
}

/**
 * "AI working" banner shown between the chat and the composer while the agent
 * builds (after planning, until the run settles). Renders nothing when hidden
 * or when the gif file is missing, so it can never break the layout.
 */
export const AiWorkingGif = memo(({ visible, className }: AiWorkingGifProps) => {
  const [failed, setFailed] = useState(false);

  if (!visible || failed) {
    return null;
  }

  return (
    <div
      className={classNames('w-full overflow-hidden rounded-2xl border border-white/10 bg-black/40', className)}
      aria-hidden="true"
    >
      <img
        src={AI_WORKING_GIF_SRC}
        alt=""
        draggable={false}
        className="block h-auto max-h-44 w-full object-cover"
        onError={() => setFailed(true)}
      />
    </div>
  );
});
