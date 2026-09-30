import { memo } from 'react';
import { Markdown } from './Markdown';
import styles from '~/components/chat/ChatExperience.module.scss';

interface AssistantMessageProps {
  content: string;
}

export const AssistantMessage = memo(({ content }: AssistantMessageProps) => {
  return (
    <div className="w-full min-w-0">
      <div className={styles.AssistantContent}>
        <Markdown html>{content}</Markdown>
      </div>
    </div>
  );
});
