import { memo, useMemo, useState } from 'react';
import styles from '~/components/chat/ChatExperience.module.scss';

export interface ClarificationQuestion {
  question: string;
  options: Array<{ label: string; description?: string }>;
}

interface ClarificationCardProps {
  questions: ClarificationQuestion[];
  /** Only the newest unanswered card stays clickable. */
  isInteractive: boolean;
  onSubmit?: (answer: string) => void;
}

/**
 * Choice boxes for the AI's clarifying questions, so the user can answer with
 * taps instead of typing. Answers are sent as a single short message.
 */
export const ClarificationCard = memo(({ questions, isInteractive, onSubmit }: ClarificationCardProps) => {
  const [selected, setSelected] = useState<Record<number, string>>({});
  const [submitted, setSubmitted] = useState(false);

  const safeQuestions = useMemo(
    () =>
      questions
        .filter((entry) => entry && typeof entry.question === 'string' && Array.isArray(entry.options))
        .slice(0, 3)
        .map((entry) => ({
          question: entry.question,
          options: entry.options.filter((option) => option && typeof option.label === 'string').slice(0, 4),
        }))
        .filter((entry) => entry.options.length > 0),
    [questions],
  );

  const allAnswered = safeQuestions.length > 0 && safeQuestions.every((_, index) => Boolean(selected[index]));

  const answerText = useMemo(
    () => safeQuestions.map((_, index) => selected[index] || 'any').join(' / '),
    [safeQuestions, selected],
  );

  if (safeQuestions.length === 0) {
    return null;
  }

  const interactive = isInteractive && !submitted;
  const locked = !interactive;

  return (
    <section className={styles.Clarify} aria-label="Quick choices">
      <div className={styles.ClarifyHeader}>
        <span className="i-ph:sparkle text-base text-violet-200" aria-hidden="true" />
        <span>Quick choices</span>
      </div>
      <div className={styles.ClarifyBody}>
        {safeQuestions.map((entry, index) => (
          <div key={`${index}-${entry.question.slice(0, 24)}`}>
            <p className={styles.ClarifyQuestion}>{entry.question}</p>
            <div className={styles.ClarifyOptions}>
              {entry.options.map((option) => {
                const isSelected = selected[index] === option.label;

                return (
                  <button
                    key={option.label}
                    type="button"
                    data-selected={isSelected ? 'true' : 'false'}
                    disabled={locked}
                    aria-pressed={isSelected}
                    className={styles.ClarifyOption}
                    onClick={() => setSelected((previous) => ({ ...previous, [index]: option.label }))}
                  >
                    <span className={styles.ClarifyOptionLabel}>{option.label}</span>
                    {option.description ? <span className={styles.ClarifyOptionHint}>{option.description}</span> : null}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>
      {interactive ? (
        <div className={styles.ClarifyActions}>
          <button
            type="button"
            data-variant="primary"
            disabled={!allAnswered}
            onClick={() => {
              setSubmitted(true);
              onSubmit?.(answerText);
            }}
          >
            <span className="i-ph:play-fill" aria-hidden="true" />
            {allAnswered ? 'Build my game' : 'Pick one option per box'}
          </button>
        </div>
      ) : (
        <p className={styles.ClarifyDone}>{submitted ? 'Choices sent — building next.' : 'Answered.'}</p>
      )}
    </section>
  );
});
