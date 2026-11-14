'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useEditor, useEditorState, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Highlight from '@tiptap/extension-highlight';
import {
  Bold, Italic, Underline, Highlighter, Heading3, List, ListOrdered, Undo2, Redo2,
} from 'lucide-react';
import { cn } from '@/lib/utils';

const AUTOSAVE_DELAY_MS = 800;

// Only what src/lib/slides/talkingPoints.js's sanitizer keeps — anything
// else would be silently stripped on save.
const EXTENSIONS = [
  StarterKit.configure({
    heading: { levels: [3] },
    code: false,
    codeBlock: false,
    blockquote: false,
    horizontalRule: false,
    link: false,
  }),
  Highlight,
];

function ToolbarButton({ icon: Icon, label, active, disabled, onClick }) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={active}
      disabled={disabled}
      // mousedown, not click, keeps the editor's selection/focus intact.
      onMouseDown={(e) => { e.preventDefault(); onClick(); }}
      className={cn(
        'w-[26px] h-7 flex items-center justify-center rounded transition-colors disabled:opacity-40 disabled:pointer-events-none',
        active
          ? 'bg-primary-100 text-primary-700 dark:bg-primary-900/40 dark:text-primary-300'
          : 'text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-700'
      )}
    >
      <Icon className="w-3.5 h-3.5" />
    </button>
  );
}

function Toolbar({ editor, className }) {
  const state = useEditorState({
    editor,
    selector: ({ editor: e }) => (e ? {
      bold: e.isActive('bold'),
      italic: e.isActive('italic'),
      underline: e.isActive('underline'),
      highlight: e.isActive('highlight'),
      heading: e.isActive('heading', { level: 3 }),
      bulletList: e.isActive('bulletList'),
      orderedList: e.isActive('orderedList'),
      canUndo: e.can().undo(),
      canRedo: e.can().redo(),
    } : {}),
  }) || {};
  if (!editor) return null;
  const run = (fn) => () => fn(editor.chain().focus()).run();

  return (
    <div className={cn('flex items-center gap-0.5 flex-wrap', className)} role="toolbar" aria-label="Formatting">
      <ToolbarButton icon={Bold} label="Bold (Ctrl+B)" active={state.bold} onClick={run((c) => c.toggleBold())} />
      <ToolbarButton icon={Italic} label="Italic (Ctrl+I)" active={state.italic} onClick={run((c) => c.toggleItalic())} />
      <ToolbarButton icon={Underline} label="Underline (Ctrl+U)" active={state.underline} onClick={run((c) => c.toggleUnderline())} />
      <ToolbarButton icon={Highlighter} label="Highlight" active={state.highlight} onClick={run((c) => c.toggleHighlight())} />
      <span className="w-px h-4 mx-0.5 bg-gray-200 dark:bg-gray-700" />
      <ToolbarButton icon={Heading3} label="Heading" active={state.heading} onClick={run((c) => c.toggleHeading({ level: 3 }))} />
      <ToolbarButton icon={List} label="Bulleted list" active={state.bulletList} onClick={run((c) => c.toggleBulletList())} />
      <ToolbarButton icon={ListOrdered} label="Numbered list" active={state.orderedList} onClick={run((c) => c.toggleOrderedList())} />
      <span className="w-px h-4 mx-0.5 bg-gray-200 dark:bg-gray-700" />
      <ToolbarButton icon={Undo2} label="Undo (Ctrl+Z)" disabled={!state.canUndo} onClick={run((c) => c.undo())} />
      <ToolbarButton icon={Redo2} label="Redo (Ctrl+Shift+Z)" disabled={!state.canRedo} onClick={run((c) => c.redo())} />
    </div>
  );
}

// Rich-text editor for one slide's talking points. Uncontrolled: `initialHtml`
// is read once at mount, so callers remount it (via `key`) when the points are
// replaced from outside (generation, edits in the full-script view). Autosaves
// through `onSave(html)` after a short pause, on blur, and on unmount.
// toolbar: 'always' (side panel) | 'focus' (full-script view, where a toolbar
// on every slide would be noise).
export default function TalkingPointsEditor({
  initialHtml, onSave, toolbar = 'always', disabled = false, autoFocus = false, className, contentClassName, ariaLabel = 'Talking points',
}) {
  const onSaveRef = useRef(onSave);
  onSaveRef.current = onSave;
  const pendingRef = useRef(null);
  const timerRef = useRef(null);
  const lastSavedRef = useRef(initialHtml || '');
  const [focused, setFocused] = useState(false);

  const flush = useCallback(() => {
    clearTimeout(timerRef.current);
    const html = pendingRef.current;
    pendingRef.current = null;
    if (html == null || html === lastSavedRef.current) return;
    lastSavedRef.current = html;
    onSaveRef.current?.(html);
  }, []);

  const editor = useEditor({
    extensions: EXTENSIONS,
    content: initialHtml || '',
    immediatelyRender: false,
    editable: !disabled,
    autofocus: autoFocus ? 'end' : false,
    editorProps: {
      attributes: {
        'aria-label': ariaLabel,
        class: cn('text-sm leading-relaxed text-gray-700 dark:text-gray-300', contentClassName),
      },
    },
    onUpdate: ({ editor: e }) => {
      pendingRef.current = e.isEmpty ? '' : e.getHTML();
      clearTimeout(timerRef.current);
      timerRef.current = setTimeout(flush, AUTOSAVE_DELAY_MS);
    },
    onFocus: () => setFocused(true),
    onBlur: () => { setFocused(false); flush(); },
  });

  useEffect(() => () => flush(), [flush]);
  useEffect(() => { editor?.setEditable(!disabled); }, [editor, disabled]);

  const showToolbar = toolbar === 'always' || (toolbar === 'focus' && focused);

  return (
    <div className={cn('tp-editor relative flex flex-col min-h-0', className)}>
      {showToolbar && (
        <Toolbar
          editor={editor}
          className={cn(
            'shrink-0',
            toolbar === 'always'
              ? 'px-2 py-1 border-b border-gray-200 dark:border-gray-700'
              // Floats above the text instead of pushing it down on focus.
              : 'absolute z-10 bottom-full mb-1.5 -left-1 px-1 py-0.5 rounded-lg border border-gray-200 bg-white shadow-md dark:border-gray-700 dark:bg-gray-800'
          )}
        />
      )}
      <EditorContent
        editor={editor}
        className={cn('flex-1 min-h-0', toolbar === 'always' && 'overflow-y-auto custom-scrollbar px-3 py-2.5')}
        onClick={() => editor && !editor.isFocused && editor.commands.focus()}
      />
    </div>
  );
}
