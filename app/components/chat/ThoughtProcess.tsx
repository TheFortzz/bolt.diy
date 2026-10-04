import { memo, useState } from 'react';
import { classNames } from '~/utils/classNames';

interface ThoughtProcessProps {
  thought: string;
  isStreaming?: boolean;
}

export const ThoughtProcess = memo(({ thought, isStreaming = false }: ThoughtProcessProps) => {
  const [expanded, setExpanded] = useState(false);

  const trimmed = thought.trim();
  if (!trimmed) {
    return null;
  }

  const lines = trimmed.split('\n');
  const lineCount = lines.length;

  return (
    <div className="w-full my-2 select-none">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className={classNames(
          'flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium transition-all duration-150',
          'bg-slate-900/60 hover:bg-slate-900 border border-purple-500/25 text-purple-300 hover:text-purple-200',
          'shadow-sm group cursor-pointer',
        )}
        aria-expanded={expanded}
        title={expanded ? 'Click to collapse thoughts' : 'Click to inspect thought process'}
      >
        <span className="flex items-center justify-center shrink-0 text-purple-400">
          {isStreaming ? (
            <span className="i-svg-spinners:90-ring-with-bg text-sm text-purple-400" />
          ) : (
            <span className="i-ph:brain text-sm text-purple-400 group-hover:scale-110 transition-transform" />
          )}
        </span>
        <span className="font-semibold text-slate-200">
          {isStreaming ? 'Thinking…' : 'Thought process'}
        </span>
        {!isStreaming && (
          <span className="text-[11px] text-slate-400 font-mono">
            ({lineCount} {lineCount === 1 ? 'line' : 'lines'})
          </span>
        )}
        <span
          className={classNames(
            'text-xs text-purple-400/80 ml-auto transition-transform duration-200',
            expanded ? 'i-ph:caret-up-bold' : 'i-ph:caret-down-bold',
          )}
          aria-hidden="true"
        />
      </button>

      {expanded && (
        <div className="mt-1.5 p-3 rounded-lg bg-slate-950/80 border border-purple-500/20 border-l-2 border-l-purple-500 text-xs font-mono text-slate-300 whitespace-pre-wrap leading-relaxed max-h-72 overflow-y-auto select-text shadow-inner">
          {trimmed}
        </div>
      )}
    </div>
  );
});
