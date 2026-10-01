import { memo } from 'react';
import { Markdown } from './Markdown';
import styles from '~/components/chat/ChatExperience.module.scss';

interface AssistantMessageProps {
  content: string;
  isStreaming?: boolean;
}

export const AssistantMessage = memo(({ content, isStreaming = false }: AssistantMessageProps) => {
  return (
    <div className="w-full min-w-0">
      <div className={styles.AssistantContent}>
        <Markdown html isStreaming={isStreaming}>
          {content}
        </Markdown>
      </div>
    </div>
  );
});
