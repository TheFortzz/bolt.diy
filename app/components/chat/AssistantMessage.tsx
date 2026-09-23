import { memo } from 'react';
import { Markdown } from './Markdown';

interface AssistantMessageProps {
  content: string;
}

export const AssistantMessage = memo(({ content }: AssistantMessageProps) => {
  return (
    <div className="overflow-hidden w-full space-y-2">
      {/* Compact Structured AI Header */}
      <div className="flex items-center justify-between pb-1.5 mb-1.5 border-b border-white/10 select-none">
        <div className="flex items-center gap-1.5">
          <div
            className="w-5 h-5 bg-[#7c3aed]/25 border border-purple-400/40 flex items-center justify-center"
            style={{ borderRadius: 0 }}
          >
            <div className="i-ph:sparkle-fill text-xs text-amber-300" />
          </div>
          <span className="text-[11px] font-bold uppercase tracking-wider text-purple-200 font-mono">gpt 6 luna</span>
          <span className="text-[10px] text-slate-400 font-mono hidden sm:inline">• Studio Architect</span>
        </div>
        <div className="flex items-center gap-1.5 text-[10px] text-emerald-400 font-mono">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
          <span>Active</span>
        </div>
      </div>

      {/* Structured Content Container */}
      <div className="text-[13px] leading-relaxed text-slate-100 font-normal">
        <Markdown html>{content}</Markdown>
      </div>
    </div>
  );
});
