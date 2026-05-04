import { useRef, useEffect, memo } from "react";
import { EditorState, type ChangeSet } from "@codemirror/state";
import { EditorView, keymap, lineNumbers, highlightActiveLine, highlightActiveLineGutter } from "@codemirror/view";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { syntaxHighlighting, defaultHighlightStyle, bracketMatching, indentOnInput } from "@codemirror/language";
import { oneDark } from "@codemirror/theme-one-dark";
import { typst } from "codemirror-lang-typst";

interface EditorPanelProps {
  initialContent: string;
  onChange: (content: string, changes: ChangeSet) => void;
  readOnly?: boolean;
}

// React.memo prevents this component from re-rendering when parent state
// changes (e.g. compiler results, pages, artifactContent). Only re-renders
// when initialContent or onChange identity changes. Since onChange uses the
// onChangeRef pattern, it stays stable — so the editor is fully isolated
// from compilation/preview updates.
export const EditorPanel = memo(function EditorPanel({ initialContent, onChange, readOnly = false }: EditorPanelProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  useEffect(() => {
    if (!containerRef.current) return;

    const updateListener = EditorView.updateListener.of((update) => {
      if (update.docChanged) {
        onChangeRef.current(update.state.doc.toString(), update.changes);
      }
    });

    const state = EditorState.create({
      doc: initialContent,
      extensions: [
        lineNumbers(),
        highlightActiveLine(),
        highlightActiveLineGutter(),
        history(),
        bracketMatching(),
        indentOnInput(),
        syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
        oneDark,
        typst(),
        keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab]),
        updateListener,
        EditorState.readOnly.of(readOnly),
        EditorView.editable.of(!readOnly),
        EditorView.theme({
          "&": { height: "100%" },
          ".cm-scroller": { overflow: "auto" },
        }),
      ],
    });

    const view = new EditorView({
      state,
      parent: containerRef.current,
    });

    viewRef.current = view;

    return () => {
      view.destroy();
      viewRef.current = null;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return <div ref={containerRef} className="h-full w-full" />;
});
