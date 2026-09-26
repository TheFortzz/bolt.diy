import { createTwoFilesPatch } from 'diff';
import type { FileMap } from '~/lib/stores/files';
import { MODIFICATIONS_TAG_NAME, WORK_DIR } from './constants';

export const modificationsRegex = new RegExp(
  `^<${MODIFICATIONS_TAG_NAME}>[\\s\\S]*?<\\/${MODIFICATIONS_TAG_NAME}>\\s+`,
  'g',
);

interface ModifiedFile {
  type: 'diff' | 'file';
  content: string;
}

type FileModifications = Record<string, ModifiedFile>;

export function computeFileModifications(files: FileMap, modifiedFiles: Map<string, string>) {
  const modifications: FileModifications = {};

  let hasModifiedFiles = false;

  for (const [filePath, originalContent] of modifiedFiles) {
    const file = files[filePath];

    if (file?.type !== 'file') {
      continue;
    }

    const unifiedDiff = diffFiles(filePath, originalContent, file.content);

    if (!unifiedDiff) {
      // files are identical
      continue;
    }

    hasModifiedFiles = true;

    if (unifiedDiff.length > file.content.length) {
      // if there are lots of changes we simply grab the current file content since it's smaller than the diff
      modifications[filePath] = { type: 'file', content: file.content };
    } else {
      // otherwise we use the diff since it's smaller
      modifications[filePath] = { type: 'diff', content: unifiedDiff };
    }
  }

  if (!hasModifiedFiles) {
    return undefined;
  }

  return modifications;
}

/**
 * Computes a diff in the unified format. The only difference is that the header is omitted
 * because it will always assume that you're comparing two versions of the same file and
 * it allows us to avoid the extra characters we send back to the llm.
 *
 * @see https://www.gnu.org/software/diffutils/manual/html_node/Unified-Format.html
 */
export function diffFiles(fileName: string, oldFileContent: string, newFileContent: string) {
  let unifiedDiff = createTwoFilesPatch(fileName, fileName, oldFileContent, newFileContent);

  const patchHeaderEnd = `--- ${fileName}\n+++ ${fileName}\n`;
  const headerEndIndex = unifiedDiff.indexOf(patchHeaderEnd);

  if (headerEndIndex >= 0) {
    unifiedDiff = unifiedDiff.slice(headerEndIndex + patchHeaderEnd.length);
  }

  if (unifiedDiff === '') {
    return undefined;
  }

  return unifiedDiff;
}

const regex = new RegExp(`^${WORK_DIR}\/`);

/**
 * Strips out the work directory from the file path.
 */
export function extractRelativePath(filePath: string) {
  return cleanWorkDirRelativePath(filePath);
}

/**
 * Normalizes all path variants (/project, project/, home/project, /home/project)
 * into a clean relative path inside WORK_DIR.
 */
export function cleanWorkDirRelativePath(filePath: string): string {
  let clean = filePath.trim().replace(/\\/g, '/');
  clean = clean.replace(/^(\.\/)+/, '');

  if (clean.startsWith(`${WORK_DIR}/`)) {
    clean = clean.slice(WORK_DIR.length + 1);
  } else if (clean === WORK_DIR) {
    clean = '';
  } else if (clean.startsWith('home/project/')) {
    clean = clean.slice('home/project/'.length);
  } else if (clean === 'home/project') {
    clean = '';
  } else if (clean.startsWith('/project/')) {
    clean = clean.slice('/project/'.length);
  } else if (clean === '/project') {
    clean = '';
  } else if (clean.startsWith('project/')) {
    clean = clean.slice('project/'.length);
  } else if (clean === 'project') {
    clean = '';
  }

  return clean.replace(/^\/+/, '');
}

/**
 * Converts the unified diff to HTML.
 *
 * Example:
 *
 * ```html
 * <bolt_file_modifications>
 * <diff path="/home/project/index.js">
 * - console.log('Hello, World!');
 * + console.log('Hello, Bolt!');
 * </diff>
 * </bolt_file_modifications>
 * ```
 */
export function fileModificationsToHTML(modifications: FileModifications) {
  const entries = Object.entries(modifications);

  if (entries.length === 0) {
    return undefined;
  }

  const result: string[] = [`<${MODIFICATIONS_TAG_NAME}>`];

  for (const [filePath, { type, content }] of entries) {
    result.push(`<${type} path=${JSON.stringify(filePath)}>`, content, `</${type}>`);
  }

  result.push(`</${MODIFICATIONS_TAG_NAME}>`);

  return result.join('\n');
}
