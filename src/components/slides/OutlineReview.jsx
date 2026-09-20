'use client';
import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, Image as ImageIcon, Loader2, Sparkles, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { cn } from '@/lib/utils';

// Replaces BrandKitModal's old generateImages checkbox. This is the right
// place to ask, not the modal — by now the user can see the actual slide
// list to judge which ones would benefit from an image. "Important" is the
// default. "All slides" is deliberately NOT offered yet — with only 4 slide
// types (title/section_header/closing/quote) currently having any free
// space for an image, "All" would silently behave identically to
// "Important" until per-layout image slots exist; offering it now would be
// misleading.
const IMAGE_MODES = [
  { key: 'important', label: 'Important slides' },
  { key: 'none', label: 'No images' },
  { key: 'manual', label: 'Choose slides' },
];

// --- Minimal Markdown <-> HTML, scoped to exactly what the outline prompt
// produces and what this editor supports: paragraphs, "- " bullet lists, and
// "**bold**" emphasis. No library in this project renders/edits markdown
// today, and the full CommonMark surface (tables, links, code, nesting)
// isn't needed here — a slide body is a handful of short lines.

function escapeHtml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function inlineMarkdownToHtml(text) {
  return escapeHtml(text).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
}

// Renders once into a contentEditable's innerHTML (see BodyEditor) — never
// re-applied while the user is editing, so this only needs to handle the
// LLM's initial output, not arbitrary intermediate states.
function markdownToHtml(markdown) {
  const lines = (markdown || '').split('\n');
  const blocks = [];
  let currentList = null;
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (line === '') {
      currentList = null;
      continue;
    }
    const bulletMatch = line.match(/^[-*]\s+(.*)$/);
    if (bulletMatch) {
      if (!currentList) {
        currentList = [];
        blocks.push({ type: 'ul', items: currentList });
      }
      currentList.push(bulletMatch[1]);
    } else {
      currentList = null;
      blocks.push({ type: 'p', text: line });
    }
  }
  const html = blocks
    .map((b) =>
      b.type === 'ul'
        ? `<ul>${b.items.map((i) => `<li>${inlineMarkdownToHtml(i)}</li>`).join('')}</ul>`
        : `<p>${inlineMarkdownToHtml(b.text)}</p>`
    )
    .join('');
  return html || '<p><br></p>';
}

// Walks the edited contentEditable DOM back into markdown. Handles both
// <p> and <div> as paragraph-level blocks since Chromium's default
// contentEditable paragraph separator is <div>, not <p>, once the user
// starts pressing Enter.
function inlineNodeToMarkdown(node) {
  let out = '';
  node.childNodes.forEach((child) => {
    if (child.nodeType === Node.TEXT_NODE) {
      out += child.textContent;
    } else if (child.nodeType === Node.ELEMENT_NODE) {
      const tag = child.tagName.toLowerCase();
      if (tag === 'b' || tag === 'strong') {
        const inner = inlineNodeToMarkdown(child).trim();
        out += inner ? `**${inner}**` : '';
      } else if (tag === 'br') {
        out += '\n';
      } else {
        out += inlineNodeToMarkdown(child);
      }
    }
  });
  return out;
}

function htmlNodeToMarkdown(root) {
  const lines = [];
  root.childNodes.forEach((node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      const t = node.textContent.trim();
      if (t) lines.push(t);
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    const tag = node.tagName.toLowerCase();
    if (tag === 'ul' || tag === 'ol') {
      node.querySelectorAll(':scope > li').forEach((li) => {
        const text = inlineNodeToMarkdown(li).trim();
        if (text) lines.push(`- ${text}`);
      });
    } else if (tag === 'br') {
      // skip stray top-level <br>
    } else {
      const text = inlineNodeToMarkdown(node).trim();
      if (text) lines.push(text);
    }
  });
  return lines.join('\n');
}

// Uncontrolled by design: innerHTML is seeded ONCE on mount from the LLM's
// markdown, then the browser owns the DOM for the rest of the edit session.
// A React-controlled contentEditable (re-applying innerHTML from state on
// every render) resets the caret and can wipe in-progress edits — the
// standard contentEditable+React pitfall. The parent reads the live DOM via
// `onRegisterRef` only when it actually needs the content (on confirm).
function BodyEditor({ initialMarkdown, onRegisterRef, disabled }) {
  const ref = useRef(null);

  useEffect(() => {
    if (ref.current) ref.current.innerHTML = markdownToHtml(initialMarkdown);
    onRegisterRef(ref.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div
      ref={ref}
      contentEditable={!disabled}
      suppressContentEditableWarning
      data-placeholder="Slide content — one point per line."
      className="outline-review-body w-full text-sm text-gray-700 dark:text-gray-300 leading-relaxed focus:outline-none"
    />
  );
}

function SlideCard({ index, initialTitle, initialBody, onRegisterTitleRef, onRegisterBodyRef, disabled, showImageToggle, imageSelected, onToggleImage }) {
  return (
    <div
      className={cn(
        'rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-4 flex gap-3',
        disabled && 'opacity-60 pointer-events-none'
      )}
    >
      <div className="shrink-0 w-7 h-7 rounded-full bg-primary-50 dark:bg-primary-900/30 text-primary-600 dark:text-primary-400 flex items-center justify-center text-xs font-semibold">
        {index + 1}
      </div>
      <div className="min-w-0 flex-1 space-y-1.5">
        <input
          defaultValue={initialTitle}
          ref={onRegisterTitleRef}
          disabled={disabled}
          placeholder="Title"
          className="w-full bg-transparent text-base font-semibold text-gray-900 dark:text-white placeholder:text-gray-400 dark:placeholder:text-gray-600 focus:outline-none"
        />
        <BodyEditor initialMarkdown={initialBody} onRegisterRef={onRegisterBodyRef} disabled={disabled} />
      </div>
      {showImageToggle && (
        <button
          type="button"
          onClick={onToggleImage}
          disabled={disabled}
          title={imageSelected ? 'Image requested for this slide — click to remove' : 'Add an image to this slide, if it ends up an eligible type'}
          className={cn(
            'shrink-0 h-7 w-7 rounded-full flex items-center justify-center transition-colors self-start',
            imageSelected
              ? 'bg-primary-100 text-primary-600 dark:bg-primary-900/40 dark:text-primary-400'
              : 'text-gray-300 hover:text-gray-400 dark:text-gray-600 dark:hover:text-gray-500'
          )}
        >
          <ImageIcon className="w-4 h-4" />
        </button>
      )}
    </div>
  );
}

// Ported from electron/slides/OutlineReview.jsx — `window.api.*` IPC calls
// replaced with fetch() against this port's API routes. Everything else
// (the uncontrolled-contentEditable pattern, the markdown<->HTML dialect,
// the manual-image-index remapping on confirm) is unchanged, since none of
// it ever touched an Electron API.
export default function OutlineReview({ deckId, onDone }) {
  const [deck, setDeck] = useState(null);
  const [deckTitle, setDeckTitle] = useState('');
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [isConfirming, setIsConfirming] = useState(false);
  const [isDiscarding, setIsDiscarding] = useState(false);
  const [imageMode, setImageMode] = useState('important');
  const [manualImageIndices, setManualImageIndices] = useState(() => new Set());
  const titleRefs = useRef({});
  const bodyRefs = useRef({});

  useEffect(() => {
    if (!deckId) return;
    let cancelled = false;
    (async () => {
      const res = await fetch(`/api/slide-decks/${deckId}`).then((r) => r.json()).catch(() => null);
      if (cancelled) return;
      if (res?.deck) {
        setDeck(res.deck);
        setDeckTitle(res.deck.outlineJson?.title || res.deck.title || '');
        const slides = res.deck.outlineJson?.slides || [];
        setEntries(slides.map((s, i) => ({ key: `${deckId}-${i}`, title: s.title || '', body: s.body || '' })));
      } else {
        setError(res?.error || 'Could not load this outline.');
      }
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [deckId]);

  // First switch to "manual" seeds a reasonable starting point (the first
  // and last slide — the ones most likely to end up title/closing, exactly
  // what "important" mode already targets) rather than an empty selection,
  // which would silently mean "no images" until the user notices and picks
  // something. Only seeds once — re-clicking "Choose slides" after the user
  // has already edited the selection (including clearing it entirely) must
  // not stomp their edits.
  const hasSeededManual = useRef(false);
  const handleSelectImageMode = (mode) => {
    setImageMode(mode);
    if (mode === 'manual' && !hasSeededManual.current) {
      hasSeededManual.current = true;
      setManualImageIndices((prev) => (prev.size > 0 ? prev : new Set([0, entries.length - 1])));
    }
  };

  const handleToggleImageIndex = (index) => {
    setManualImageIndices((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  };

  const handleConfirm = async () => {
    setIsConfirming(true);
    try {
      const rawSlides = entries.map((entry) => {
        const titleEl = titleRefs.current[entry.key];
        const bodyEl = bodyRefs.current[entry.key];
        const title = (titleEl?.value || '').trim();
        const body = bodyEl ? htmlNodeToMarkdown(bodyEl).trim() : '';
        return { title, body };
      });
      // A slide with a now-empty title gets dropped below — its ORIGINAL
      // index (what manualImageIndices was tracking) no longer matches its
      // position in the filtered array, so the selection has to be remapped
      // onto post-filter indices, not sent as-is.
      const slides = [];
      const keptOriginalIndices = [];
      rawSlides.forEach((s, i) => {
        if (!s.title) return;
        keptOriginalIndices.push(i);
        slides.push(s);
      });
      const imageSlideIndices = imageMode === 'manual'
        ? keptOriginalIndices
            .map((origIndex, newIndex) => (manualImageIndices.has(origIndex) ? newIndex : -1))
            .filter((i) => i !== -1)
        : undefined;
      const res = await fetch(`/api/slide-decks/${deckId}/confirm-outline`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: deckTitle.trim(), slides, imageMode, imageSlideIndices }),
      }).then((r) => r.json());
      if (res?.success) {
        onDone();
      } else {
        setError(res?.error || 'Could not build the deck from this outline.');
        setIsConfirming(false);
      }
    } catch (err) {
      setError('Could not build the deck from this outline.');
      setIsConfirming(false);
    }
  };

  const handleDiscard = async () => {
    setIsDiscarding(true);
    try {
      await fetch(`/api/slide-decks/${deckId}`, { method: 'DELETE' });
    } finally {
      onDone();
    }
  };

  if (loading) {
    return (
      <div className="h-screen w-full flex items-center justify-center bg-white dark:bg-gray-900">
        <Loader2 className="w-6 h-6 text-gray-400 animate-spin" />
      </div>
    );
  }

  if (error && !deck) {
    return (
      <div className="h-screen w-full flex flex-col items-center justify-center gap-4 bg-white dark:bg-gray-900">
        <p className="text-sm text-red-500">{error}</p>
        <Button variant="outline" onClick={onDone}>
          <ArrowLeft className="w-4 h-4 mr-2" /> Back
        </Button>
      </div>
    );
  }

  if (deck && deck.status !== 'outline_review') {
    return (
      <div className="h-screen w-full flex flex-col items-center justify-center gap-4 bg-white dark:bg-gray-900">
        <p className="text-sm text-gray-500 dark:text-gray-400">This outline has already been processed.</p>
        <Button variant="outline" onClick={onDone}>
          <ArrowLeft className="w-4 h-4 mr-2" /> Back
        </Button>
      </div>
    );
  }

  return (
    <div className="min-h-screen w-full bg-gray-50 dark:bg-gray-950">
      <style>{`
        .outline-review-body ul { list-style: disc; padding-left: 1.25rem; margin: 0.25rem 0; }
        .outline-review-body p { margin: 0.25rem 0; }
        .outline-review-body li { margin: 0.15rem 0; }
        .outline-review-body:empty:before {
          content: attr(data-placeholder);
          color: rgb(156 163 175);
        }
        .dark .outline-review-body:empty:before {
          color: rgb(75 85 99);
        }
      `}</style>
      <div className="sticky top-0 z-10 bg-white/90 dark:bg-gray-900/90 backdrop-blur border-b border-gray-200 dark:border-gray-800">
        <div className="max-w-3xl mx-auto px-4 py-3 flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={onDone} className="h-9 w-9 shrink-0" title="Back">
            <ArrowLeft className="w-4 h-4" />
          </Button>
          <div className="min-w-0 flex-1">
            <input
              value={deckTitle}
              onChange={(e) => setDeckTitle(e.target.value)}
              placeholder="Deck title"
              className="w-full bg-transparent text-sm font-semibold text-gray-900 dark:text-white placeholder:text-gray-400 dark:placeholder:text-gray-600 focus:outline-none truncate"
            />
            <p className="text-xs text-gray-500 dark:text-gray-400">
              {entries.length} slide{entries.length === 1 ? '' : 's'} — edit the text, then generate the real deck.
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={handleDiscard}
            disabled={isConfirming || isDiscarding}
            className="text-xs h-8 px-3 text-red-600 border-red-200 hover:bg-red-50 dark:border-red-900/50 dark:hover:bg-red-900/20"
          >
            {isDiscarding ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5 mr-1.5" />}
            Discard
          </Button>
          <Button size="sm" onClick={handleConfirm} disabled={isConfirming || isDiscarding} className="text-xs h-8 px-3">
            {isConfirming ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5 mr-1.5" />}
            Generate Slides
          </Button>
        </div>
      </div>

      {error && (
        <div className="max-w-3xl mx-auto px-4 pt-3">
          <p className="text-xs text-red-500">{error}</p>
        </div>
      )}

      <div className="max-w-3xl mx-auto px-4 pt-4">
        <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-3">
          <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-2">AI Images</label>
          <div className="flex flex-wrap gap-2">
            {IMAGE_MODES.map((m) => (
              <button
                key={m.key}
                type="button"
                onClick={() => handleSelectImageMode(m.key)}
                disabled={isConfirming}
                className={cn(
                  'rounded-full border px-3 py-1 text-xs font-medium transition-colors',
                  imageMode === m.key
                    ? 'border-primary-500 bg-primary-100 text-primary-700 dark:bg-primary-900/40 dark:text-primary-300'
                    : 'border-gray-300 dark:border-gray-700 text-gray-600 dark:text-gray-400 hover:border-gray-400 dark:hover:border-gray-600'
                )}
              >
                {m.label}
              </button>
            ))}
          </div>
          <p className="text-xs text-gray-400 dark:text-gray-500 mt-2">
            {imageMode === 'none' && 'No images will be generated for this deck.'}
            {imageMode === 'important' && 'Adds an image to opening, section divider, closing, and quote slides — other slide types don\'t have room for one yet.'}
            {imageMode === 'manual' && 'Click the image icon on any slide below to request one. Only slides that end up as an opening, section divider, closing, or quote slide can actually get one — other layouts don\'t have room for an image yet.'}
          </p>
        </div>
      </div>

      <div className="max-w-3xl mx-auto px-4 py-6 space-y-3">
        {entries.map((entry, i) => (
          <SlideCard
            key={entry.key}
            index={i}
            initialTitle={entry.title}
            initialBody={entry.body}
            onRegisterTitleRef={(el) => { titleRefs.current[entry.key] = el; }}
            onRegisterBodyRef={(el) => { bodyRefs.current[entry.key] = el; }}
            disabled={isConfirming}
            showImageToggle={imageMode === 'manual'}
            imageSelected={manualImageIndices.has(i)}
            onToggleImage={() => handleToggleImageIndex(i)}
          />
        ))}
      </div>
    </div>
  );
}
