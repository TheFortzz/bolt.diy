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

function sanitizeConversationalText(rawText: string): string {
  let cleaned = rawText;

  // 1. Strip markdown code fences (both complete and streaming/unclosed)
  cleaned = cleaned.replace(/```(?:[a-zA-Z0-9_-]+)?[\s\S]*?(?:```|$)/gi, '');

  // 2. Strip HTML shell and script/style blocks
  cleaned = cleaned.replace(/<!DOCTYPE[\s\S]*?>/gi, '');
  cleaned = cleaned.replace(
    /<(?:canvas|script|style|html|body|head|meta|link)\b[^>]*>[\s\S]*?(?:<\/(?:canvas|script|style|html|body|head|meta|link)>|$)/gi,
    '',
  );

  // 3. Filter line-by-line: drop lines containing leaked JavaScript/CSS/WebGL code statements
  const lines = cleaned.split('\n');
  const filteredLines: string[] = [];

  const codeLinePatterns = [
    /window\.__GAME_DIAGNOSTICS__\b/i,
    /^\s*(?:const|let|var)\s+[a-zA-Z0-9_$]+\s*=/i,
    /^\s*(?:const|let|var)\s+[\{\[][^=\n]+\]?\s*=/i,
    /^\s*function\s+[a-zA-Z0-9_$]*\s*\(/i,
    /^\s*(?:async\s+)?(?:function|\([a-zA-Z0-9_$,\s]*\)\s*=>)/i,
    /^\s*class\s+[a-zA-Z0-9_$]+/i,
    /^\s*import\s+.*from\s+/i,
    /^\s*export\s+(?:default\s+)?(?:const|let|var|function|class)\b/i,
    /(?:document|window)\.(?:getElementById|querySelector|addEventListener|removeEventListener)\b/i,
    /(?:ctx|renderer|camera|scene|gl)\.[a-zA-Z0-9_$]+\b/i,
    /requestAnimationFrame\s*\(/i,
    /Math\.(?:max|min|sin|cos|sqrt|floor|ceil|hypot|random|atan2)\b/i,
    /^\s*(?:if|for|while|switch)\s*\(.*\{\s*$/i,
    /^\s*\}\s*(?:else\b|catch\b|\)|;)?\s*$/i,
    /^\s*return\s+[\w\d\(\{\[\+\-\*\/]/i,
    /^\s*(?:KEEP|NEW|CHANGED|STATE)\s*:/i,
    /^\s*[{}\[\];,]\s*$/,
    /\b(?:innerWidth|innerHeight|clientWidth|clientHeight)\b/i,
  ];

  for (const line of lines) {
    const isCode = codeLinePatterns.some((pattern) => pattern.test(line));
    if (!isCode) {
      filteredLines.push(line);
    }
  }

  return filteredLines.join('\n').trim();
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

  // 3. Extract /* DESIGN PLAN: ... */ or /* KEEP: ... */ block comments (even if unclosed while streaming)
  const designPlanMatch = /\/\*\s*(?:DESIGN PLAN|KEEP)[\s\S]*?(?:\*\/|$)/i.exec(text);
  if (designPlanMatch) {
    if (thought) thought += '\n\n';
    thought += designPlanMatch[0].trim();
    text = text.replace(/\/\*\s*(?:DESIGN PLAN|KEEP)[\s\S]*?(?:\*\/|$)/i, '');
  }

  // 4. Strip any other multiline comment blocks
  text = text.replace(/\/\*[\s\S]*?(?:\*\/|$)/g, '');

  // 5. Strip all boltArtifact blocks (and any internal code or unclosed tags)
  text = text
    .replace(/<boltArtifact[^>]*>[\s\S]*?(?:<\/boltArtifact>|$)/gi, '')
    .replace(/\[boltArtifact[^\]]*\][\s\S]*?(?:\[\/boltArtifact\]|$)/gi, '')
    .replace(/<boltAction[^>]*>[\s\S]*?(?:<\/boltAction>|$)/gi, '')
    .replace(/\[boltAction[^\]]*\][\s\S]*?(?:\[\/boltAction\]|$)/gi, '')
    .replace(/<\/?bolt(?:Artifact|Action)[^>]*>/gi, '')
    .replace(/\[\/?bolt(?:Artifact|Action)[^\]]*\]/gi, '');

  // 6. Aggressively sanitize any leaked code statements, fences, or shell tags
  const cleanText = sanitizeConversationalText(text);

  return {
    thought: thought.trim(),
    isThinkingActive,
    cleanText,
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
