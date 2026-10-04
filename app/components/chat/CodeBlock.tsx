import { memo, useEffect, useMemo, useState } from 'react';
import { bundledLanguages, codeToHtml, isSpecialLang, type BundledLanguage, type SpecialLanguage } from 'shiki';
import { classNames } from '~/utils/classNames';
import { createScopedLogger } from '~/utils/logger';

const logger = createScopedLogger('CodeBlock');

interface CodeBlockProps {
  className?: string;
  code: string;
  language?: BundledLanguage | SpecialLanguage;
  theme?: 'light-plus' | 'dark-plus';
  disableCopy?: boolean;
}

const COLLAPSE_LINE_THRESHOLD = 16;

export const CodeBlock = memo(
  ({ className, code, language = 'plaintext', theme = 'dark-plus', disableCopy = false }: CodeBlockProps) => {
    const [html, setHTML] = useState<string | undefined>(undefined);
    const [copied, setCopied] = useState(false);
    const [isExpanded, setIsExpanded] = useState(false);

    const lineCount = useMemo(() => {
      return (code || '').split('\n').length;
    }, [code]);

    const isLongCode = lineCount > COLLAPSE_LINE_THRESHOLD;

    const copyToClipboard = () => {
      if (copied) {
        return;
      }

      navigator.clipboard.writeText(code);
      setCopied(true);

      setTimeout(() => {
        setCopied(false);
      }, 2000);
    };

    useEffect(() => {
      if (language && !isSpecialLang(language) && !(language in bundledLanguages)) {
        logger.warn(`Unsupported language '${language}'`);
      }

      logger.trace(`Language = ${language}`);

      const processCode = async () => {
        setHTML(await codeToHtml(code, { lang: language, theme }));
      };

      processCode();
    }, [code, language, theme]);

    return (
      <div className={classNames('relative my-3 rounded-lg overflow-hidden border border-slate-800 bg-slate-950 text-left shadow-sm', className)}>
        {/* Header Bar */}
        <div className="flex items-center justify-between px-3 py-1.5 bg-slate-900/90 border-b border-slate-800/80 text-xs text-slate-400 select-none">
          <div className="flex items-center gap-2">
            <span className="font-mono text-[11px] font-semibold text-slate-300 uppercase tracking-wider">
              {language}
            </span>
            <span className="text-slate-500">•</span>
            <span className="text-[11px] font-mono text-slate-400">
              {lineCount} {lineCount === 1 ? 'line' : 'lines'}
            </span>
          </div>

          <div className="flex items-center gap-2">
            {!disableCopy && (
              <button
                type="button"
                className="flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium text-slate-300 hover:text-white bg-slate-800 hover:bg-slate-700 transition-colors"
                title="Copy Code"
                onClick={copyToClipboard}
              >
                {copied ? (
                  <>
                    <span className="i-ph:check-bold text-emerald-400 text-xs" />
                    <span className="text-emerald-300">Copied</span>
                  </>
                ) : (
                  <>
                    <span className="i-ph:clipboard-text-duotone text-xs" />
                    <span>Copy</span>
                  </>
                )}
              </button>
            )}
          </div>
        </div>

        {/* Code Content */}
        <div
          className={classNames(
            'overflow-x-auto text-xs p-1 font-mono transition-all duration-200',
            isLongCode && !isExpanded ? 'max-h-56 overflow-hidden relative' : 'max-h-[500px] overflow-y-auto',
          )}
        >
          <div dangerouslySetInnerHTML={{ __html: html ?? '' }} />

          {/* Fade gradient when collapsed */}
          {isLongCode && !isExpanded && (
            <div className="absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-slate-950 via-slate-950/80 to-transparent pointer-events-none" />
          )}
        </div>

        {/* Expand / Collapse Toggle Bar */}
        {isLongCode && (
          <button
            type="button"
            onClick={() => setIsExpanded((prev) => !prev)}
            className="w-full flex items-center justify-center gap-1.5 py-1.5 px-3 bg-slate-900/80 hover:bg-slate-900 border-t border-slate-800/80 text-xs font-medium text-slate-300 hover:text-white transition-colors cursor-pointer select-none"
          >
            <span
              className={classNames('text-xs text-slate-400', isExpanded ? 'i-ph:caret-up-bold' : 'i-ph:caret-down-bold')}
              aria-hidden="true"
            />
            <span>{isExpanded ? 'Collapse code' : `Expand full code (${lineCount} lines)`}</span>
          </button>
        )}
      </div>
    );
  },
);
