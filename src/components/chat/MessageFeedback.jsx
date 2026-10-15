'use client'
import { useState } from 'react';
import { ThumbsUp, ThumbsDown } from 'lucide-react';
import { cn } from '@/lib/utils';

// 👍 / 👎 for an assistant answer, saved on the message row (document or
// project chat). Clicking the selected thumb again clears it. Updates
// optimistically and rolls back if the save fails.
async function saveFeedback({ table, messageId, value }) {
  const res = await fetch('/api/chat/feedback', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ kind: table, messageId, value }),
  });
  return res.json().catch(() => ({ success: false }));
}

export default function MessageFeedback({ table, messageId, initial = null }) {
  const [value, setValue] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [thanked, setThanked] = useState(false);

  const choose = async (next) => {
    if (saving) return;
    const target = value === next ? null : next;
    const previous = value;
    setValue(target);
    setSaving(true);
    setError(null);
    try {
      const res = await saveFeedback({ table, messageId, value: target });
      if (!res?.success) throw new Error(res?.error);
      if (target != null) {
        setThanked(true);
        setTimeout(() => setThanked(false), 2500);
      }
    } catch {
      setValue(previous);
      setError('Couldn’t save feedback');
      setTimeout(() => setError(null), 3000);
    } finally {
      setSaving(false);
    }
  };

  const button = (kind, Icon, label, activeClass) => {
    const active = value === kind;
    return (
      <button
        type="button"
        onClick={() => choose(kind)}
        title={active ? `${label} (click to undo)` : label}
        aria-label={label}
        aria-pressed={active}
        className={cn(
          'h-7 w-7 inline-flex items-center justify-center rounded-md transition-colors',
          active
            ? activeClass
            : 'text-gray-400 hover:text-gray-700 hover:bg-gray-100 dark:text-gray-500 dark:hover:text-gray-200 dark:hover:bg-gray-800'
        )}
      >
        <Icon className="w-4 h-4" fill={active ? 'currentColor' : 'none'} />
      </button>
    );
  };

  return (
    <div className="flex items-center gap-1">
      {error && <span className="text-[11px] text-red-600 dark:text-red-400 mr-1">{error}</span>}
      {!error && thanked && (
        <span className="text-[11px] text-gray-400 dark:text-gray-500 mr-1">Thanks for the feedback</span>
      )}
      {button(1, ThumbsUp, 'Helpful', 'text-primary-600 bg-primary-50 dark:text-primary-300 dark:bg-primary-500/15')}
      {button(-1, ThumbsDown, 'Not helpful', 'text-red-600 bg-red-50 dark:text-red-400 dark:bg-red-500/15')}
    </div>
  );
}
