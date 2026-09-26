import { acceptCompletion, autocompletion, closeBrackets } from '@codemirror/autocomplete';
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import { bracketMatching, foldGutter, indentOnInput, indentUnit } from '@codemirror/language';
import { searchKeymap } from '@codemirror/search';
import {
  Annotation,
  Compartment,
  EditorSelection,
  EditorState,
  RangeSetBuilder,
  StateEffect,
  StateField,
  type Extension,
} from '@codemirror/state';
import {
  Decoration,
  drawSelection,
  dropCursor,
  EditorView,
  highlightActiveLine,
  highlightActiveLineGutter,
  keymap,
  lineNumbers,
  showTooltip,
  tooltips,
  type DecorationSet,
  type Tooltip,
} from '@codemirror/view';
import { memo, useEffect, useRef, useState, type MutableRefObject } from 'react';
import { diffLines } from 'diff';
import type { Theme } from '~/types/theme';
import { classNames } from '~/utils/classNames';
import { debounce } from '~/utils/debounce';
import { createScopedLogger, renderLogger } from '~/utils/logger';
import { BinaryContent } from './BinaryContent';
import { getTheme, reconfigureTheme } from './cm-theme';
import { indentKeyBinding } from './indent';
import { getLanguage } from './languages';

const logger = createScopedLogger('CodeMirrorEditor');
const externalUpdate = Annotation.define<boolean>();

export interface EditorDocument {
  value: string;
  isBinary: boolean;
  filePath: string;
  scroll?: ScrollPosition;
  originalContent?: string;
}

export interface EditorSettings {
  fontSize?: string;
  gutterFontSize?: string;
  tabSize?: number;
}

type TextEditorDocument = EditorDocument & {
  value: string;
};

export interface ScrollPosition {
  top: number;
  left: number;
}

export interface EditorUpdate {
  filePath: string;
  selection: EditorSelection;
  content: string;
}

export type OnChangeCallback = (update: EditorUpdate) => void;
export type OnScrollCallback = (position: ScrollPosition) => void;
export type OnSaveCallback = () => void;

interface Props {
  theme: Theme;
  id?: unknown;
  doc?: EditorDocument;
  editable?: boolean;
  debounceChange?: number;
  debounceScroll?: number;
  autoFocusOnDocumentChange?: boolean;
  onChange?: OnChangeCallback;
  onScroll?: OnScrollCallback;
  onSave?: OnSaveCallback;
  className?: string;
  settings?: EditorSettings;
  isStreaming?: boolean;
  showDiff?: boolean;
}

type EditorStates = Map<string, EditorState>;

export const setDiffDecorationsEffect = StateEffect.define<DecorationSet>();

export const diffDecorationsField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(decorations, tr) {
    for (const effect of tr.effects) {
      if (effect.is(setDiffDecorationsEffect)) {
        return effect.value;
      }
    }
    return decorations.map(tr.changes);
  },
  provide: (field) => EditorView.decorations.from(field),
});

export const diffTheme = EditorView.baseTheme({
  '.cm-diff-deleted': {
    backgroundColor: 'rgba(239, 68, 68, 0.16) !important',
  },
  '.cm-diff-deleted-text': {
    textDecoration: 'line-through !important',
    color: '#f87171 !important',
    opacity: '0.85',
  },
  '.cm-diff-added': {
    backgroundColor: 'rgba(16, 185, 129, 0.16) !important',
  },
  '.cm-diff-added-text': {
    color: '#4ade80 !important',
  },
});

export interface DiffLineInfo {
  text: string;
  type: 'unchanged' | 'added' | 'deleted';
}

export interface DiffResult {
  combinedText: string;
  lines: DiffLineInfo[];
  addedCount: number;
  deletedCount: number;
}

export function computeDiffDocument(originalContent: string, newContent: string): DiffResult {
  const parts = diffLines(originalContent, newContent);
  const lines: DiffLineInfo[] = [];
  let addedCount = 0;
  let deletedCount = 0;

  for (const part of parts) {
    const rawLines = part.value.split('\n');
    if (rawLines.length > 1 && rawLines[rawLines.length - 1] === '') {
      rawLines.pop();
    }
    const type: 'unchanged' | 'added' | 'deleted' = part.added ? 'added' : part.removed ? 'deleted' : 'unchanged';
    if (part.added) addedCount += rawLines.length;
    if (part.removed) deletedCount += rawLines.length;

    for (const line of rawLines) {
      lines.push({ text: line, type });
    }
  }

  const combinedText = lines.map((l) => l.text).join('\n');
  return { combinedText, lines, addedCount, deletedCount };
}

const readOnlyTooltipStateEffect = StateEffect.define<boolean>();

const editableTooltipField = StateField.define<readonly Tooltip[]>({
  create: () => [],
  update(_tooltips, transaction) {
    if (!transaction.state.readOnly) {
      return [];
    }

    for (const effect of transaction.effects) {
      if (effect.is(readOnlyTooltipStateEffect) && effect.value) {
        return getReadOnlyTooltip(transaction.state);
      }
    }

    return [];
  },
  provide: (field) => {
    return showTooltip.computeN([field], (state) => state.field(field));
  },
});

const editableStateEffect = StateEffect.define<boolean>();

const editableStateField = StateField.define<boolean>({
  create() {
    return true;
  },
  update(value, transaction) {
    for (const effect of transaction.effects) {
      if (effect.is(editableStateEffect)) {
        return effect.value;
      }
    }

    return value;
  },
});

export const CodeMirrorEditor = memo(
  ({
    id,
    doc,
    debounceScroll = 100,
    debounceChange = 150,
    autoFocusOnDocumentChange = false,
    editable = true,
    onScroll,
    onChange,
    onSave,
    theme,
    settings,
    className = '',
    isStreaming = false,
    showDiff = true,
  }: Props) => {
    renderLogger.trace('CodeMirrorEditor');

    const [languageCompartment] = useState(new Compartment());

    const containerRef = useRef<HTMLDivElement | null>(null);
    const viewRef = useRef<EditorView>();
    const themeRef = useRef<Theme>();
    const docRef = useRef<EditorDocument>();
    const editorStatesRef = useRef<EditorStates>();
    const activeFilePathRef = useRef<string | undefined>();
    const languageRequestRef = useRef(0);
    const onScrollRef = useRef(onScroll);
    const onChangeRef = useRef(onChange);
    const onSaveRef = useRef(onSave);

    /**
     * This effect is used to avoid side effects directly in the render function
     * and instead the refs are updated after each render.
     */
    useEffect(() => {
      onScrollRef.current = onScroll;
      onChangeRef.current = onChange;
      onSaveRef.current = onSave;
      docRef.current = doc;
      themeRef.current = theme;
    });

    useEffect(() => {
      const onUpdate = debounce((update: EditorUpdate) => {
        onChangeRef.current?.(update);
      }, debounceChange);

      const view = new EditorView({
        parent: containerRef.current!,
        dispatchTransactions(transactions) {
          const previousSelection = view.state.selection;
          const isExternalUpdate = transactions.some((transaction) => transaction.annotation(externalUpdate));

          view.update(transactions);

          const newSelection = view.state.selection;
          const selectionChanged =
            newSelection !== previousSelection &&
            (newSelection === undefined || previousSelection === undefined || !newSelection.eq(previousSelection));

          if (docRef.current) {
            // Keep the cached state current even for theme/language/read-only
            // transactions. This prevents a later file switch from restoring
            // an outdated viewport configuration.
            editorStatesRef.current?.set(docRef.current.filePath, view.state);
          }

          if (
            !isExternalUpdate &&
            docRef.current &&
            (transactions.some((transaction) => transaction.docChanged) || selectionChanged)
          ) {
            onUpdate({
              filePath: docRef.current.filePath,
              selection: view.state.selection,
              content: view.state.doc.toString(),
            });
          }
        },
      });

      viewRef.current = view;

      return () => {
        onUpdate.cancel();
        viewRef.current?.destroy();
        viewRef.current = undefined;
      };
    }, []);

    useEffect(() => {
      if (!viewRef.current) {
        return;
      }

      viewRef.current.dispatch({
        effects: [reconfigureTheme(theme)],
      });
    }, [theme]);

    useEffect(() => {
      editorStatesRef.current = new Map<string, EditorState>();
      activeFilePathRef.current = undefined;
      languageRequestRef.current += 1;
    }, [id]);

    useEffect(() => {
      const editorStates = editorStatesRef.current ?? new Map<string, EditorState>();
      editorStatesRef.current = editorStates;
      const view = viewRef.current!;
      const theme = themeRef.current!;

      if (!doc) {
        if (activeFilePathRef.current !== undefined) {
          const state = newEditorState('', theme, settings, onScrollRef, debounceScroll, onSaveRef, [
            languageCompartment.of([]),
          ]);

          view.setState(state);
          setNoDocument(view);
          activeFilePathRef.current = undefined;
        }
        languageRequestRef.current += 1;
        return;
      }

      if (doc.isBinary) {
        return;
      }

      if (doc.filePath === '') {
        logger.warn('File path should not be empty');
      }

      const fileChanged = activeFilePathRef.current !== doc.filePath;
      let state = editorStates.get(doc.filePath);

      if (!state) {
        state = newEditorState(doc.value, theme, settings, onScrollRef, debounceScroll, onSaveRef, [
          languageCompartment.of([]),
        ]);

        editorStates.set(doc.filePath, state);
      }

      if (fileChanged) {
        view.setState(state);
        activeFilePathRef.current = doc.filePath;
      }

      const languageRequestId = ++languageRequestRef.current;
      setEditorDocument(
        view,
        theme,
        editable,
        languageCompartment,
        autoFocusOnDocumentChange,
        doc as TextEditorDocument,
        isStreaming,
        () => languageRequestId === languageRequestRef.current && activeFilePathRef.current === doc.filePath,
        showDiff,
      );
    }, [doc?.value, doc?.originalContent, editable, doc?.filePath, autoFocusOnDocumentChange, isStreaming, showDiff]);

    return (
      <div className={classNames('relative h-full', className)}>
        {doc?.isBinary && <BinaryContent />}
        <div className="h-full overflow-hidden" ref={containerRef} />
      </div>
    );
  },
);

export default CodeMirrorEditor;

CodeMirrorEditor.displayName = 'CodeMirrorEditor';

function newEditorState(
  content: string,
  theme: Theme,
  settings: EditorSettings | undefined,
  onScrollRef: MutableRefObject<OnScrollCallback | undefined>,
  debounceScroll: number,
  onFileSaveRef: MutableRefObject<OnSaveCallback | undefined>,
  extensions: Extension[],
) {
  return EditorState.create({
    doc: content,
    extensions: [
      EditorView.domEventHandlers({
        scroll: debounce((event, view) => {
          if (event.target !== view.scrollDOM) {
            return;
          }

          onScrollRef.current?.({ left: view.scrollDOM.scrollLeft, top: view.scrollDOM.scrollTop });
        }, debounceScroll),
        keydown: (event, view) => {
          if (view.state.readOnly) {
            view.dispatch({
              effects: [readOnlyTooltipStateEffect.of(event.key !== 'Escape')],
            });

            return true;
          }

          return false;
        },
      }),
      getTheme(theme, settings),
      history(),
      keymap.of([
        ...defaultKeymap,
        ...historyKeymap,
        ...searchKeymap,
        { key: 'Tab', run: acceptCompletion },
        {
          key: 'Mod-s',
          preventDefault: true,
          run: () => {
            onFileSaveRef.current?.();
            return true;
          },
        },
        indentKeyBinding,
      ]),
      indentUnit.of('\t'),
      autocompletion({
        closeOnBlur: false,
      }),
      tooltips({
        position: 'absolute',
        parent: document.body,
        tooltipSpace: (view) => {
          const rect = view.dom.getBoundingClientRect();

          return {
            top: rect.top - 50,
            left: rect.left,
            bottom: rect.bottom,
            right: rect.right + 10,
          };
        },
      }),
      closeBrackets(),
      lineNumbers(),
      dropCursor(),
      drawSelection(),
      bracketMatching(),
      EditorState.tabSize.of(settings?.tabSize ?? 2),
      indentOnInput(),
      editableTooltipField,
      editableStateField,
      diffDecorationsField,
      diffTheme,
      EditorState.readOnly.from(editableStateField, (editable) => !editable),
      highlightActiveLineGutter(),
      highlightActiveLine(),
      foldGutter({
        markerDOM: (open) => {
          const icon = document.createElement('div');

          icon.className = `fold-icon ${open ? 'i-ph-caret-down-bold' : 'i-ph-caret-right-bold'}`;

          return icon;
        },
      }),
      ...extensions,
    ],
  });
}

function setNoDocument(view: EditorView) {
  view.dispatch({
    selection: { anchor: 0 },
    changes: {
      from: 0,
      to: view.state.doc.length,
      insert: '',
    },
    annotations: externalUpdate.of(true),
  });

  view.scrollDOM.scrollTo(0, 0);
}

function setEditorDocument(
  view: EditorView,
  theme: Theme,
  editable: boolean,
  languageCompartment: Compartment,
  autoFocus: boolean,
  doc: TextEditorDocument,
  isStreaming: boolean = false,
  isCurrent: () => boolean = () => true,
  showDiff: boolean = true,
) {
  const isDiffMode = Boolean(showDiff && doc.originalContent && doc.originalContent !== doc.value);
  let textToDisplay = doc.value;
  let diffResult: DiffResult | undefined;

  if (isDiffMode && doc.originalContent) {
    diffResult = computeDiffDocument(doc.originalContent, doc.value);
    textToDisplay = diffResult.combinedText;
  }

  const shouldFollowStream = isStreaming && !isDiffMode;
  const docLength = textToDisplay.length;

  if (textToDisplay !== view.state.doc.toString()) {
    view.dispatch({
      selection: shouldFollowStream ? { anchor: docLength } : { anchor: 0 },
      changes: {
        from: 0,
        to: view.state.doc.length,
        insert: textToDisplay,
      },
      effects: shouldFollowStream ? [EditorView.scrollIntoView(docLength, { y: 'end' })] : [],
      annotations: externalUpdate.of(true),
    });
  }

  if (isDiffMode && diffResult) {
    const builder = new RangeSetBuilder<Decoration>();
    for (let i = 0; i < diffResult.lines.length; i++) {
      const lineInfo = diffResult.lines[i];
      if (lineInfo.type === 'unchanged') continue;

      const cmLine = view.state.doc.line(i + 1);
      if (lineInfo.type === 'deleted') {
        builder.add(cmLine.from, cmLine.from, Decoration.line({ attributes: { class: 'cm-diff-deleted' } }));
        if (cmLine.to > cmLine.from) {
          builder.add(cmLine.from, cmLine.to, Decoration.mark({ attributes: { class: 'cm-diff-deleted-text' } }));
        }
      } else if (lineInfo.type === 'added') {
        builder.add(cmLine.from, cmLine.from, Decoration.line({ attributes: { class: 'cm-diff-added' } }));
        if (cmLine.to > cmLine.from) {
          builder.add(cmLine.from, cmLine.to, Decoration.mark({ attributes: { class: 'cm-diff-added-text' } }));
        }
      }
    }

    view.dispatch({
      effects: [
        setDiffDecorationsEffect.of(builder.finish()),
        editableStateEffect.of(false),
      ],
    });
  } else {
    view.dispatch({
      effects: [
        setDiffDecorationsEffect.of(Decoration.none),
        editableStateEffect.of(editable && !doc.isBinary),
      ],
    });
  }

  getLanguage(doc.filePath).then((languageSupport) => {
    if (!isCurrent()) {
      return;
    }

    view.dispatch({
      effects: [languageCompartment.reconfigure(languageSupport ? [languageSupport] : []), reconfigureTheme(theme)],
    });

    requestAnimationFrame(() => {
      if (!isCurrent()) {
        return;
      }

      if (shouldFollowStream) {
        const end = view.state.doc.length;
        view.dispatch({
          effects: [EditorView.scrollIntoView(end, { y: 'end' })],
        });
        return;
      }

      const currentLeft = view.scrollDOM.scrollLeft;
      const currentTop = view.scrollDOM.scrollTop;
      const newLeft = doc.scroll?.left ?? 0;
      const newTop = doc.scroll?.top ?? 0;
      const needsScrolling = currentLeft !== newLeft || currentTop !== newTop;

      if (autoFocus && editable) {
        if (needsScrolling) {
          // Wait until the scroll position was changed before focusing.
          view.scrollDOM.addEventListener(
            'scroll',
            () => {
              view.focus();
            },
            { once: true },
          );
        } else {
          view.focus();
        }
      }

      view.scrollDOM.scrollTo(newLeft, newTop);
    });
  });
}

function getReadOnlyTooltip(state: EditorState) {
  if (!state.readOnly) {
    return [];
  }

  return state.selection.ranges
    .filter((range) => {
      return range.empty;
    })
    .map((range) => {
      return {
        pos: range.head,
        above: true,
        strictSide: true,
        arrow: true,
        create: () => {
          const divElement = document.createElement('div');
          divElement.className = 'cm-readonly-tooltip';
          divElement.textContent = 'Cannot edit file while AI response is being generated';

          return { dom: divElement };
        },
      };
    });
}
