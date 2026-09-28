import { describe, expect, it } from 'vitest';
import { computeDiffDocument, computeStreamingDiffDocument, minimalTextChange } from './editorDiff';

describe('live editor diff presentation', () => {
  it('shows only changed lines and nearby context, with red/green replacements', () => {
    const original = Array.from({ length: 40 }, (_, i) => `line ${i}`).join('\n');
    const edited = original.replace('line 20', 'edited line 20');
    const diff = computeDiffDocument(original, edited);

    expect(diff.addedCount).toBe(1);
    expect(diff.deletedCount).toBe(1);
    expect(diff.lines.some((line) => line.type === 'deleted' && line.text === 'line 20')).toBe(true);
    expect(diff.lines.some((line) => line.type === 'added' && line.text === 'edited line 20')).toBe(true);
    expect(diff.lines.filter((line) => line.type === 'separator')).toHaveLength(2);
    expect(diff.combinedText).not.toContain('line 0\n');
    expect(diff.lines.length).toBeLessThan(15);
  });

  it('supports empty originals and deleting all content without changing the actual source', () => {
    expect(computeDiffDocument('', 'hello').lines).toEqual([{ text: 'hello', type: 'added' }]);
    expect(computeDiffDocument('goodbye', '').lines).toEqual([{ text: 'goodbye', type: 'deleted' }]);
    expect(computeDiffDocument('same', 'same').lines).toEqual([]);
  });

  it('keeps large mostly-unchanged files compact', () => {
    const original = Array.from({ length: 3000 }, (_, i) => `const n${i} = ${i};`).join('\n');
    const diff = computeDiffDocument(original, original.replace('const n1500 = 1500;', 'const n1500 = 42;'));

    expect(diff.lines.length).toBeLessThan(20);
  });

  it('does not claim unseen lines were deleted while the replacement is still streaming', () => {
    const original = 'start\nold middle\nuntouched tail\n';
    const partial = computeStreamingDiffDocument(original, 'start\nnew middle');
    const finished = computeDiffDocument(original, 'start\nnew middle');

    expect(partial.lines.some((line) => line.type === 'deleted' && line.text === 'untouched tail')).toBe(false);
    expect(finished.lines.some((line) => line.type === 'deleted' && line.text === 'untouched tail')).toBe(true);
    expect(computeStreamingDiffDocument(original, 'start\n').combinedText).toContain('Waiting for changed lines');
  });

  it('updates only the changed slice instead of replacing the whole editor document', () => {
    const before = 'start\n-old line\nend';
    const after = 'start\n+new line\nend';
    const change = minimalTextChange(before, after);

    expect(change.from).toBeGreaterThan(0);
    expect(change.to).toBeLessThan(before.length);
    expect(before.slice(0, change.from) + change.insert + before.slice(change.to)).toBe(after);
    expect(minimalTextChange('', 'new')).toEqual({ from: 0, to: 0, insert: 'new' });
  });
});
