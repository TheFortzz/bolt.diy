import { describe, expect, it } from 'vitest';
import { extractRelativePath } from './diff';
import { WORK_DIR } from './constants';

describe('Diff', () => {
  it('should strip out Work_dir', () => {
    const filePath = `${WORK_DIR}/index.js`;
    const result = extractRelativePath(filePath);
    expect(result).toBe('index.js');
  });

  it('should strip project/, projects/, and home/ variants to flat files', () => {
    expect(extractRelativePath('project/index.js')).toBe('index.js');
    expect(extractRelativePath('/project/index.js')).toBe('index.js');
    expect(extractRelativePath('projects/index.js')).toBe('index.js');
    expect(extractRelativePath('/projects/index.js')).toBe('index.js');
    expect(extractRelativePath('/home/projects/index.js')).toBe('index.js');
    expect(extractRelativePath('/home/project/index.js')).toBe('index.js');
    expect(extractRelativePath('/home/project/project/index.js')).toBe('index.js');
    expect(extractRelativePath('/home/project/projects/index.js')).toBe('index.js');
    expect(extractRelativePath('home/index.js')).toBe('index.js');
  });
});
