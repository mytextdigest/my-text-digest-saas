'use client'
import { forwardRef, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState } from 'react';
import { Plus, ArrowUp, Square, ImagePlus, Paperclip, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { ComposerAttachments, AttachFileInput } from './ChatImages';
import { MAX_ATTACHMENTS } from './useChatImages';

const MIN_HEIGHT = 44;          // ~2 lines
const MAX_SHARE_OF_PANEL = 0.4; // grows up to 40% of the chat panel, then scrolls

// "+" button (in the chip row) that opens a small menu above it.
// items: [{ label, icon, onClick, disabled?, hint? }].
function ComposerPlusMenu({ items, disabled }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    const close = (e) => { if (!rootRef.current?.contains(e.target)) setOpen(false); };
    const onKey = (e) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('pointerdown', close);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', close);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div ref={rootRef} className="relative shrink-0">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        disabled={disabled}
        title="Add"
        aria-label="Add"
        aria-haspopup="menu"
        aria-expanded={open}
        className={cn(
          'h-8 w-8 inline-flex items-center justify-center rounded-lg border border-gray-200 dark:border-gray-700 text-gray-600 hover:text-gray-900 hover:bg-gray-50 dark:text-gray-300 dark:hover:text-gray-100 dark:hover:bg-gray-800 transition-colors disabled:opacity-40 disabled:pointer-events-none',
          open && 'bg-gray-100 text-gray-900 dark:bg-gray-800 dark:text-gray-100'
        )}
      >
        <Plus className={cn('h-4 w-4 transition-transform', open && 'rotate-45')} />
      </button>
      {open && (
        <div role="menu" className="absolute bottom-full left-0 mb-2 z-30 min-w-52 py-1 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 shadow-lg">
          {items.map((item) => (
            <button
              key={item.label}
              type="button"
              role="menuitem"
              disabled={item.disabled}
              onClick={() => { setOpen(false); item.onClick(); }}
              className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-left text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-40 disabled:pointer-events-none"
            >
              <item.icon className="h-4 w-4 text-gray-500 dark:text-gray-400" />
              <span className="flex-1">{item.label}</span>
              {item.hint && <span className="text-[11px] text-gray-400">{item.hint}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// A removable context chip shown next to "+", e.g. the table a question is pinned to.
function ComposerChip({ icon: Icon, label, title, onRemove }) {
  return (
    <div
      title={title}
      className="min-w-0 max-w-64 h-8 inline-flex items-center gap-1.5 pl-2.5 pr-1 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-xs font-medium text-gray-700 dark:text-gray-200"
    >
      {Icon && <Icon className="h-3.5 w-3.5 shrink-0 text-gray-500 dark:text-gray-400" />}
      <span className="truncate">{label}</span>
      {onRemove && (
        <button
          type="button"
          onClick={onRemove}
          aria-label={`Remove ${label}`}
          className="shrink-0 h-6 w-6 inline-flex items-center justify-center rounded-md text-gray-400 hover:text-gray-700 hover:bg-gray-100 dark:hover:text-gray-200 dark:hover:bg-gray-700"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );
}

function IconAction({ icon: Icon, label, onClick, disabled }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={label}
      aria-label={label}
      className="h-8 w-8 inline-flex items-center justify-center rounded-lg text-gray-500 hover:text-gray-800 hover:bg-gray-100 dark:text-gray-400 dark:hover:text-gray-100 dark:hover:bg-gray-700 transition-colors disabled:opacity-40 disabled:pointer-events-none"
    >
      <Icon className="h-4 w-4" />
    </button>
  );
}

// Chat input.
//   [+] [chip ×] [chip ×]                  ← "+" menu and context chips
//   ┌──────────────────────────────────┐
//   │ (staged image thumbnails)        │
//   │ multi-line text — grows as typed │
//   │ [📎]                         (↑) │
//   └──────────────────────────────────┘
// Enter sends, Shift+Enter adds a line. The text area grows with its content up
// to 40% of the chat panel, then scrolls. chips: [{ key, icon, label, title?, onRemove? }].
const ChatComposer = forwardRef(function ChatComposer(
  { value, onChange, onSubmit, onCancel, isTyping, canSend, composer, placeholder, chips = [], className },
  ref
) {
  const formRef = useRef(null);
  const textareaRef = useRef(null);
  useImperativeHandle(ref, () => textareaRef.current, []);

  // Size the text area to its content, capped at a share of the chat panel.
  const resize = useCallback(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    const panel = formRef.current?.parentElement;
    const max = Math.max(MIN_HEIGHT * 2, (panel?.clientHeight || 600) * MAX_SHARE_OF_PANEL);
    ta.style.height = 'auto';
    const next = Math.min(Math.max(ta.scrollHeight, MIN_HEIGHT), max);
    ta.style.height = `${next}px`;
    ta.style.overflowY = ta.scrollHeight > max ? 'auto' : 'hidden';
  }, []);

  useLayoutEffect(resize, [value, resize]);

  useEffect(() => {
    const panel = formRef.current?.parentElement;
    if (!panel) return;
    const ro = new ResizeObserver(resize);
    ro.observe(panel);
    return () => ro.disconnect();
  }, [resize]);

  const handleKeyDown = (e) => {
    if (e.key !== 'Enter' || e.shiftKey || e.nativeEvent.isComposing) return;
    e.preventDefault();
    if (canSend && !isTyping) formRef.current?.requestSubmit();
  };

  const attachImage = {
    label: composer.isFull ? `Up to ${MAX_ATTACHMENTS} images` : 'Attach image',
    onClick: composer.openFilePicker,
    disabled: composer.isFull || isTyping,
  };

  return (
    <form ref={formRef} onSubmit={onSubmit} className={cn('shrink-0 px-4 pb-4 pt-2', className)}>
      <AttachFileInput composer={composer} />

      <div className="mb-2 flex items-center gap-2 min-w-0">
        <ComposerPlusMenu
          disabled={isTyping}
          items={[{ ...attachImage, label: 'Attach image', icon: ImagePlus, hint: composer.isFull ? `Max ${MAX_ATTACHMENTS}` : null }]}
        />
        {chips.map(({ key, ...chip }) => <ComposerChip key={key} {...chip} />)}
      </div>

      <div className="rounded-2xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 shadow-sm transition-colors focus-within:border-primary-500 focus-within:ring-1 focus-within:ring-primary-500/30">
        {composer.items.length > 0 && (
          <div className="px-3 pt-3">
            <ComposerAttachments items={composer.items} onRemove={composer.removeItem} />
          </div>
        )}
        <textarea
          ref={textareaRef}
          rows={2}
          value={value}
          onChange={onChange}
          onKeyDown={handleKeyDown}
          onPaste={composer.handlePaste}
          placeholder={placeholder}
          disabled={isTyping}
          style={{ minHeight: MIN_HEIGHT }}
          className="block w-full resize-none bg-transparent px-4 pt-3 pb-1 text-sm leading-relaxed text-gray-900 dark:text-gray-100 placeholder:text-gray-400 dark:placeholder:text-gray-500 focus:outline-none disabled:opacity-60 chat-scrollbar"
        />
        <div className="flex items-center justify-between px-2 pb-2">
          <div className="flex items-center gap-0.5">
            <IconAction icon={Paperclip} {...attachImage} />
          </div>
          {isTyping ? (
            <button
              type="button"
              onClick={onCancel}
              title="Stop"
              aria-label="Stop"
              className="h-8 w-8 inline-flex items-center justify-center rounded-full bg-gray-700 hover:bg-gray-800 text-white dark:bg-gray-200 dark:text-gray-900 dark:hover:bg-white transition-colors"
            >
              <Square className="h-3 w-3 fill-current" />
            </button>
          ) : (
            <button
              type="submit"
              disabled={!canSend}
              title="Send (Enter)"
              aria-label="Send"
              className="h-8 w-8 inline-flex items-center justify-center rounded-full bg-primary-600 hover:bg-primary-700 text-white transition-colors disabled:bg-gray-200 disabled:text-gray-400 dark:disabled:bg-gray-700 dark:disabled:text-gray-500"
            >
              <ArrowUp className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>
    </form>
  );
});

export default ChatComposer;
