import { memo, useId, useMemo, useState } from 'react';
import styles from '~/components/chat/ChatExperience.module.scss';

interface FileChangePreviewProps {
  path: string;
  content: string;
  isStreaming: boolean;
}

export const FileChangePreview = memo(({ path, content, isStreaming }: FileChangePreviewProps) => {
  const [expanded, setExpanded] = useState(false);
  const panelId = useId();

  const lineCount = useMemo(() => {
    let count = 1;
    for (let i = 0; i < content.length; i++) {
      if (content.charCodeAt(i) === 10) count++;
    }
    return count;
  }, [content]);

  const { preview, isTruncated } = useMemo(() => {
    if (!expanded) {
      return { preview: '', isTruncated: false };
    }
    const lines = content.split('\n');
    return {
      preview: lines.slice(0, 500).join('\n'),
      isTruncated: lines.length > 500,
    };
  }, [content, expanded]);

  return (
    <div className={styles.CodePreview} onClick={(event) => event.stopPropagation()}>
      <button
        type="button"
        aria-expanded={expanded}
        aria-controls={panelId}
        onClick={() => setExpanded((value) => !value)}
      >
        <span className="i-ph:code" aria-hidden="true" />
        {expanded ? 'Hide code' : 'View code'}
        <span className={styles.CodeMeta}>{isStreaming ? 'Writing…' : `${lineCount} lines`}</span>
        <span className={expanded ? 'i-ph:caret-up' : 'i-ph:caret-down'} aria-hidden="true" />
      </button>
      <div id={panelId} hidden={!expanded}>
        {expanded && (
          <>
            <div className={styles.CodeCaption}>Generated source · {path}</div>
            <pre aria-label={`Source preview for ${path}`} aria-busy={isStreaming}>
              <code>{preview}</code>
            </pre>
            {isTruncated && (
              <div className={styles.CodeCaption}>First 500 lines shown. Open Editor for the complete file.</div>
            )}
          </>
        )}
      </div>
    </div>
  );
});
