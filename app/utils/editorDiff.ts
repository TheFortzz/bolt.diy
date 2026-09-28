import { diffLines } from 'diff';

export const DIFF_CONTEXT_LINES = 3;
export const MAX_LIVE_DIFF_LENGTH = 250_000;

export interface DiffLineInfo {
  text: string;
  type: 'unchanged' | 'added' | 'deleted' | 'separator';
}

export interface DiffResult {
  combinedText: string;
  lines: DiffLineInfo[];
  addedCount: number;
  deletedCount: number;
}

/** Presentation only. The document's `value` remains the actual source. */
export function computeDiffDocument(
  originalContent: string,
  newContent: string,
  context = DIFF_CONTEXT_LINES,
): DiffResult {
  const lines: DiffLineInfo[] = [];
  let addedCount = 0;
  let deletedCount = 0;

  for (const part of diffLines(originalContent, newContent)) {
    const rawLines = part.value.split('\n');

    if (rawLines.length > 1 && rawLines[rawLines.length - 1] === '') {
      rawLines.pop();
    }

    const type: DiffLineInfo['type'] = part.added ? 'added' : part.removed ? 'deleted' : 'unchanged';

    if (part.added) {
      addedCount += rawLines.length;
    }

    if (part.removed) {
      deletedCount += rawLines.length;
    }

    for (const text of rawLines) {
      lines.push({ text, type });
    }
  }

  if (addedCount === 0 && deletedCount === 0) {
    return { combinedText: '', lines: [], addedCount, deletedCount };
  }

  const visible = new Uint8Array(lines.length);

  for (let i = 0; i < lines.length; i++) {
    if (lines[i].type === 'unchanged') {
      continue;
    }

    for (let j = Math.max(0, i - context); j <= Math.min(lines.length - 1, i + context); j++) {
      visible[j] = 1;
    }
  }

  const compact: DiffLineInfo[] = [];

  for (let i = 0; i < lines.length; ) {
    if (visible[i]) {
      compact.push(lines[i]);
      i++;
      continue;
    }

    let end = i;

    while (end < lines.length && !visible[end]) {
      end++;
    }
    compact.push({ text: `⋯ ${end - i} unchanged line${end - i === 1 ? '' : 's'} ⋯`, type: 'separator' });
    i = end;
  }

  return {
    combinedText: compact.map((line) => line.text).join('\n'),
    lines: compact,
    addedCount,
    deletedCount,
  };
}

/** Only a prefix of the replacement exists until the file action closes. */
export function computeStreamingDiffDocument(originalContent: string, streamedPrefix: string): DiffResult {
  if (!streamedPrefix) {
    const placeholder = { text: '⋯ Waiting for changed lines ⋯', type: 'separator' as const };

    return { combinedText: placeholder.text, lines: [placeholder], addedCount: 0, deletedCount: 0 };
  }

  const originalLines = originalContent.split('\n');
  const completeLines = (streamedPrefix.match(/\n/g) ?? []).length;
  const consumedLines = Math.min(originalLines.length, completeLines + Number(!streamedPrefix.endsWith('\n')));
  const untouchedTail = originalLines.slice(consumedLines).join('\n');
  const projected = untouchedTail
    ? `${streamedPrefix}${streamedPrefix.endsWith('\n') ? '' : '\n'}${untouchedTail}`
    : streamedPrefix;
  const diff = computeDiffDocument(originalContent, projected);

  if (diff.lines.length === 0) {
    const placeholder = { text: '⋯ Waiting for changed lines ⋯', type: 'separator' as const };

    return { ...diff, combinedText: placeholder.text, lines: [placeholder] };
  }

  return diff;
}

export function minimalTextChange(previous: string, next: string) {
  let from = 0;
  const limit = Math.min(previous.length, next.length);

  while (from < limit && previous[from] === next[from]) {
    from++;
  }

  let oldEnd = previous.length;
  let newEnd = next.length;

  while (oldEnd > from && newEnd > from && previous[oldEnd - 1] === next[newEnd - 1]) {
    oldEnd--;
    newEnd--;
  }

  return { from, to: oldEnd, insert: next.slice(from, newEnd) };
}
