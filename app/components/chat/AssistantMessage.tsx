import { memo, useMemo } from 'react';
import { useStore } from '@nanostores/react';
import { Markdown } from './Markdown';
import { ThoughtProcess } from './ThoughtProcess';
import { Artifact } from './Artifact';
import { workbenchStore } from '~/lib/stores/workbench';
import styles from '~/components/chat/ChatExperience.module.scss';

interface AssistantMessageProps {
  content: string;
  isStreaming?: boolean;
  messageId?: string;
}

function parseAssistantContent(rawContent: string, isStreaming: boolean) {
  let thought = '';
  let isThinkingActive = false;
  let text = rawContent || '';

  // 1. Extract <think>...</think> or unclosed <think>... during streaming
  const thinkMatch = /<think>([\s\S]*?)(?:<\/think>|$)/i.exec(text);
  if (thinkMatch) {
    thought += thinkMatch[1].trim();
    if (!text.includes('</think>') && isStreaming) {
      isThinkingActive = true;
    }
    text = text.replace(/<think>[\s\S]*?(?:<\/think>|$)/i, '');
  }

  // 2. Extract <thinking>...</thinking> or unclosed <thinking>...
  const thinkingMatch = /<thinking>([\s\S]*?)(?:<\/thinking>|$)/i.exec(text);
  if (thinkingMatch) {
    if (thought) thought += '\n\n';
    thought += thinkingMatch[1].trim();
    if (!text.includes('</thinking>') && isStreaming) {
      isThinkingActive = true;
    }
    text = text.replace(/<thinking>[\s\S]*?(?:<\/thinking>|$)/i, '');
  }

  // 3. Extract /* DESIGN PLAN: ... */ or /* KEEP: ... */ block comments
  const designPlanMatch = /\/\*\s*(?:DESIGN PLAN|KEEP)[\s\S]*?\*\//i.exec(text);
  if (designPlanMatch) {
    if (thought) thought += '\n\n';
    thought += designPlanMatch[0].trim();
    text = text.replace(/\/\*\s*(?:DESIGN PLAN|KEEP)[\s\S]*?\*\//i, '');
  }

  // 4. Strip any leaked raw boltAction or boltArtifact tags to prevent raw code dumps in chat
  text = text
    .replace(/<boltAction[^>]*>[\s\S]*?(?:<\/boltAction>|$)/gi, '')
    .replace(/\[boltAction[^\]]*\][\s\S]*?(?:\[\/boltAction\]|$)/gi, '')
    .replace(/<\/?boltArtifact[^>]*>/gi, '')
    .replace(/\[\/?boltArtifact[^\]]*\]/gi, '');

  return {
    thought: thought.trim(),
    isThinkingActive,
    cleanText: text.trim(),
  };
}

export const AssistantMessage = memo(({ content, isStreaming = false, messageId }: AssistantMessageProps) => {
  const artifacts = useStore(workbenchStore.artifacts);
  const hasStoreArtifact = Boolean(messageId && artifacts[messageId]);

  const { thought, isThinkingActive, cleanText } = useMemo(
    () => parseAssistantContent(content, isStreaming),
    [content, isStreaming],
  );

  const hasEmbeddedArtifact = cleanText.includes('__boltArtifact__');
  const shouldRenderStandaloneArtifact = !hasEmbeddedArtifact && hasStoreArtifact && Boolean(messageId);

  return (
    <div className="w-full min-w-0">
      {thought && (
        <ThoughtProcess thought={thought} isStreaming={isThinkingActive || (isStreaming && !cleanText)} />
      )}

      {cleanText ? (
        <div className={styles.AssistantContent}>
          <Markdown html isStreaming={isStreaming}>
            {cleanText}
          </Markdown>
        </div>
      ) : null}

      {shouldRenderStandaloneArtifact && messageId && (
        <div className="my-2">
          <Artifact messageId={messageId} />
        </div>
      )}
    </div>
  );
});
