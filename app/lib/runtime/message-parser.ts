import type { ActionType, BoltAction, BoltActionData, FileAction } from '~/types/actions';
import type { BoltArtifactData } from '~/types/artifact';
import { createScopedLogger } from '~/utils/logger';
import { unreachable } from '~/utils/unreachable';

const ARTIFACT_TAG_OPEN = '<boltArtifact';
const ARTIFACT_TAG_CLOSE = '</boltArtifact>';
const ARTIFACT_ACTION_TAG_OPEN = '<boltAction';
const ARTIFACT_ACTION_TAG_CLOSE = '</boltAction>';

const logger = createScopedLogger('MessageParser');

function indexOfIgnoreCase(source: string, search: string, fromIndex: number = 0): number {
  return source.toLowerCase().indexOf(search.toLowerCase(), fromIndex);
}

export interface ArtifactCallbackData extends BoltArtifactData {
  messageId: string;
}

export interface ActionCallbackData {
  artifactId: string;
  messageId: string;
  actionId: string;
  action: BoltAction;
}

export type ArtifactCallback = (data: ArtifactCallbackData) => void;
export type ActionCallback = (data: ActionCallbackData) => void;

export interface ParserCallbacks {
  onArtifactOpen?: ArtifactCallback;
  onArtifactClose?: ArtifactCallback;
  onActionOpen?: ActionCallback;
  onActionStream?: ActionCallback;
  onActionClose?: ActionCallback;
}

interface ElementFactoryProps {
  messageId: string;
}

type ElementFactory = (props: ElementFactoryProps) => string;

export interface StreamingMessageParserOptions {
  callbacks?: ParserCallbacks;
  artifactElement?: ElementFactory;
}

interface MessageState {
  position: number;
  insideArtifact: boolean;
  insideAction: boolean;
  currentArtifact?: BoltArtifactData;
  currentAction: BoltActionData;
  actionId: number;
}

export class StreamingMessageParser {
  #messages = new Map<string, MessageState>();

  constructor(private _options: StreamingMessageParserOptions = {}) {}

  parse(messageId: string, input: string) {
    // Normalise common model hallucinations before doing anything else.
    // 1. Strip ``` fences around boltArtifact blocks.
    // 2. Convert square-bracket tag variants the model sometimes emits:
    //    [boltArtifact ...] → <boltArtifact ...>
    //    [boltAction ...] → <boltAction ...>
    //    [/boltArtifact] → </boltArtifact>
    //    [/boltAction] → </boltAction>
    // 3. Fix type=file (no quotes) → type="file", filePath=foo → filePath="foo"
    const cleaned = input
      .replace(/```(?:xml|html|bolt|tsx?|jsx?|javascript|typescript)?\s*(?=<boltArtifact\b)/gi, '')
      .replace(/(<\/boltArtifact>)\s*```/gi, '$1')
      // square-bracket open tags: [boltArtifact ...] and [boltAction ...]
      .replace(/\[boltArtifact(\s[^\]]*?)?\]/gi, (_, attrs = '') => `<boltArtifact${attrs}>`)
      .replace(/\[boltAction(\s[^\]]*?)?\]/gi, (_, attrs = '') => `<boltAction${attrs}>`)
      // square-bracket close tags
      .replace(/\[\/boltArtifact\]/gi, '</boltArtifact>')
      .replace(/\[\/boltAction\]/gi, '</boltAction>')
      // unquoted attribute values: type=file → type="file", filePath=foo.js → filePath="foo.js"
      .replace(/\b(type|filePath|id|title)=([^\s"'>]+)/gi, (_, k, v) => `${k}="${v}"`);

    let state = this.#messages.get(messageId);

    // If cleaning shortened content behind our cursor, reparse this message cleanly.
    if (state && cleaned.length < state.position) {
      this.#messages.delete(messageId);
      state = undefined;
    }

    input = cleaned;

    if (!state) {
      state = {
        position: 0,
        insideAction: false,
        insideArtifact: false,
        currentAction: { content: '' },
        actionId: 0,
      };

      this.#messages.set(messageId, state);
    }

    let output = '';
    let i = state.position;
    let earlyBreak = false;

    while (i < input.length) {
      if (state.insideArtifact) {
        const currentArtifact = state.currentArtifact;

        if (currentArtifact === undefined) {
          unreachable('Artifact not initialized');
        }

        if (state.insideAction) {
          const closeIndex = indexOfIgnoreCase(input, ARTIFACT_ACTION_TAG_CLOSE, i);

          const currentAction = state.currentAction;

          if (closeIndex !== -1) {
            currentAction.content += input.slice(i, closeIndex);

            let content = currentAction.content.trim();

            if (content.startsWith('<![CDATA[')) {
              content = content.slice(9);
              if (content.endsWith(']]>')) {
                content = content.slice(0, -3);
              }
              content = content.trim();
            }

            if ('type' in currentAction && currentAction.type === 'file') {
              content += '\n';
            }

            currentAction.content = content;

            this._options.callbacks?.onActionClose?.({
              artifactId: currentArtifact.id,
              messageId,

              /**
               * We decrement the id because it's been incremented already
               * when `onActionOpen` was emitted to make sure the ids are
               * the same.
               */
              actionId: String(state.actionId - 1),

              action: currentAction as BoltAction,
            });

            state.insideAction = false;
            state.currentAction = { content: '' };

            i = closeIndex + ARTIFACT_ACTION_TAG_CLOSE.length;
          } else {
            if ('type' in currentAction && currentAction.type === 'file') {
              // The action position is not advanced until the close tag lands,
              // so slicing from i already yields the full cumulative file.
              const content = input.slice(i);

              this._options.callbacks?.onActionStream?.({
                artifactId: currentArtifact.id,
                messageId,
                actionId: String(state.actionId - 1),
                action: {
                  ...(currentAction as FileAction),
                  content,
                  filePath: currentAction.filePath,
                },
              });
            }

            break;
          }
        } else {
          const actionOpenIndex = indexOfIgnoreCase(input, ARTIFACT_ACTION_TAG_OPEN, i);
          const artifactCloseIndex = indexOfIgnoreCase(input, ARTIFACT_TAG_CLOSE, i);

          if (actionOpenIndex !== -1 && (artifactCloseIndex === -1 || actionOpenIndex < artifactCloseIndex)) {
            const actionEndIndex = input.indexOf('>', actionOpenIndex);

            if (actionEndIndex !== -1) {
              state.insideAction = true;

              state.currentAction = this.#parseActionTag(input, actionOpenIndex, actionEndIndex);

              this._options.callbacks?.onActionOpen?.({
                artifactId: currentArtifact.id,
                messageId,
                actionId: String(state.actionId++),
                action: state.currentAction as BoltAction,
              });

              i = actionEndIndex + 1;
            } else {
              break;
            }
          } else if (artifactCloseIndex !== -1) {
            this._options.callbacks?.onArtifactClose?.({ messageId, ...currentArtifact });

            state.insideArtifact = false;
            state.currentArtifact = undefined;

            i = artifactCloseIndex + ARTIFACT_TAG_CLOSE.length;
          } else {
            break;
          }
        }
      } else if (input[i] === '<' && input[i + 1] !== '/') {
        let j = i;
        let potentialTag = '';

        while (j < input.length && potentialTag.length < ARTIFACT_TAG_OPEN.length) {
          potentialTag += input[j];

          if (potentialTag === ARTIFACT_TAG_OPEN) {
            const nextChar = input[j + 1];

            if (nextChar && nextChar !== '>' && nextChar !== ' ' && nextChar !== '\n' && nextChar !== '\r') {
              output += input.slice(i, j + 1);
              i = j + 1;
              break;
            }

            const openTagEnd = input.indexOf('>', j);

            if (openTagEnd !== -1) {
              const artifactTag = input.slice(i, openTagEnd + 1);

              const rawTitle = this.#extractAttribute(artifactTag, 'title');
              const rawId = this.#extractAttribute(artifactTag, 'id');
              const artifactTitle = rawTitle || 'Game Project';
              const type = (this.#extractAttribute(artifactTag, 'type') as string) || 'bundled';
              const artifactId = rawId || `project-${messageId}`;

              state.insideArtifact = true;

              const currentArtifact = {
                id: artifactId,
                title: artifactTitle,
                type,
              } satisfies BoltArtifactData;

              state.currentArtifact = currentArtifact;

              this._options.callbacks?.onArtifactOpen?.({ messageId, ...currentArtifact });

              const artifactFactory = this._options.artifactElement ?? createArtifactElement;

              output += artifactFactory({ messageId });

              i = openTagEnd + 1;
            } else {
              earlyBreak = true;
            }

            break;
          } else if (!ARTIFACT_TAG_OPEN.startsWith(potentialTag)) {
            output += input.slice(i, j + 1);
            i = j + 1;
            break;
          }

          j++;
        }

        if (j === input.length && ARTIFACT_TAG_OPEN.startsWith(potentialTag)) {
          break;
        }
      } else {
        output += input[i];
        i++;
      }

      if (earlyBreak) {
        break;
      }
    }

    state.position = i;

    return output;
  }

  reset() {
    this.#messages.clear();
  }

  #parseActionTag(input: string, actionOpenIndex: number, actionEndIndex: number) {
    const actionTag = input.slice(actionOpenIndex, actionEndIndex + 1);

    const rawType = this.#extractAttribute(actionTag, 'type')?.toLowerCase();
    const actionType: ActionType = rawType === 'shell' || rawType === 'start' || rawType === 'file' ? rawType : 'file';

    if (rawType && !['file', 'shell', 'start'].includes(rawType)) {
      logger.warn(`Unknown action type '${rawType}'; treating it as a file action`);
    }

    const actionAttributes = {
      type: actionType,
      content: '',
    };

    if (actionType === 'file') {
      let filePath =
        this.#extractAttribute(actionTag, 'filePath') ||
        this.#extractAttribute(actionTag, 'path') ||
        (this.#extractAttribute(actionTag, 'filepath') as string);

      if (!filePath) {
        logger.debug('File path not specified, defaulting to index.html');
        filePath = 'index.html';
      }

      (actionAttributes as FileAction).filePath = filePath;
    } else if (!['shell', 'start'].includes(actionType)) {
      logger.warn(`Unknown action type '${actionType}'`);
    }

    return actionAttributes as BoltAction;
  }

  #extractAttribute(tag: string, attributeName: string): string | undefined {
    const match =
      tag.match(new RegExp(`${attributeName}\\s*=\\s*["']([^"']*)["']`, 'i')) ||
      tag.match(new RegExp(`${attributeName}\\s*=\\s*([^\\s>]+)`, 'i'));
    return match ? match[1] : undefined;
  }
}

const createArtifactElement: ElementFactory = (props) => {
  const elementProps = [
    'class="__boltArtifact__"',
    ...Object.entries(props).map(([key, value]) => {
      return `data-${camelToDashCase(key)}=${JSON.stringify(value)}`;
    }),
  ];

  return `<div ${elementProps.join(' ')}></div>`;
};

function camelToDashCase(input: string) {
  return input.replace(/([a-z])([A-Z])/g, '$1-$2').toLowerCase();
}
