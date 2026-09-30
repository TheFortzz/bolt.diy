import { cleanWorkDirRelativePath } from '~/utils/diff';

function insertBeforeBody(html: string, scripts: string) {
  if (!scripts) {
    return html;
  }

  const closingBody = html.toLowerCase().lastIndexOf('</body>');

  if (closingBody === -1) {
    return `${html}\n${scripts}`;
  }

  return `${html.slice(0, closingBody)}\n${scripts}\n${html.slice(closingBody)}`;
}

export type StaticPreviewFile = { path: string; content: string };

/** Resolve local HTML/CSS/JS references without guessing between duplicate basenames. */
export function resolveStaticPreviewFile(files: StaticPreviewFile[], reference: string) {
  const refPath = reference.split(/[?#]/, 1)[0];
  const clean = cleanWorkDirRelativePath(refPath);

  if (!clean || clean.split('/').some((segment) => segment === '..' || segment === '.')) {
    return undefined;
  }

  const exact = files.find((file) => file.path === clean);

  if (exact) {
    return exact;
  }

  const suffixMatches = files.filter((file) => file.path.endsWith(`/${clean}`));

  return suffixMatches.length === 1 ? suffixMatches[0] : undefined;
}

/** Keep injected helpers before all document scripts and append an unlinked entry last. */
export function injectStaticScripts(html: string, dependencies: string[], entries: string[]) {
  let result = html;

  if (dependencies.length) {
    const block = dependencies.join('\n');
    const firstScript = /<script\b/i.exec(result);

    if (firstScript?.index !== undefined) {
      result = `${result.slice(0, firstScript.index)}\n${block}\n${result.slice(firstScript.index)}`;
    } else {
      result = insertBeforeBody(result, block);
    }
  }

  return insertBeforeBody(result, entries.join('\n'));
}
