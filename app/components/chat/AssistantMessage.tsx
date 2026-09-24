import { memo } from 'react';
import { Markdown } from './Markdown';

interface AssistantMessageProps {
  content: string;
}

export const AssistantMessage = memo(({ content }: AssistantMessageProps) => {
  return (
    <div className="overflow-hidden w-full space-y-2 bg-transparent">
      <div className="flex items-center gap-2 select-none">
        <div className="i-ph:sparkle-fill text-sm text-amber-300" />
        <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-300 font-mono">
          FortzAI
        </span>
      </div>

      <div className="text-[13.5px] leading-relaxed text-slate-100 font-normal bg-transparent">
        <Markdown html>{content}</Markdown>
      </div>
    </div>
  );
});
