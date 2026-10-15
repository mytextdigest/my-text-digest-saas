'use client';
import { useState } from 'react';
import { Globe, ChevronDown, ChevronUp } from 'lucide-react';
import { motion } from 'framer-motion';
import { Button } from '@/components/ui/Button';

// Claude-style UI for the "Ask Question" general-knowledge tool: a permission prompt
// before the model is allowed to go outside the document, a transient chip while it's
// consulting that knowledge, and a small collapsible badge on the settled message
// noting that it happened.

export function GeneralKnowledgePermissionPrompt({ query, onApprove, onDecline }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="max-w-[85%] rounded-2xl px-4 py-3 bg-blue-50 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-900"
    >
      <div className="flex items-start gap-2">
        <Globe className="w-4 h-4 mt-0.5 shrink-0 text-blue-600 dark:text-blue-400" />
        <div className="text-sm text-gray-800 dark:text-gray-100">
          <p>
            This question needs general knowledge beyond this document
            {query ? <> — <span className="italic">&ldquo;{query}&rdquo;</span></> : null}. Should I go ahead?
          </p>
        </div>
      </div>
      <div className="flex flex-col gap-2 mt-3">
        <Button size="sm" onClick={onApprove} className="w-full bg-blue-500 hover:bg-blue-600 text-white border-0">
          Yes, go ahead
        </Button>
        <Button size="sm" variant="outline" onClick={onDecline} className="w-full">
          No, use the document only
        </Button>
      </div>
    </motion.div>
  );
}

export function GeneralKnowledgeProgressChip() {
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400 px-3 py-1.5 rounded-full bg-gray-100 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 w-fit"
    >
      <Globe className="w-3.5 h-3.5 animate-pulse text-blue-500" />
      <span>Consulting general knowledge beyond the document…</span>
    </motion.div>
  );
}

export function ExternalKnowledgeBadge({ query }) {
  const [expanded, setExpanded] = useState(false);
  if (!query) return null;

  return (
    <div className="mt-1.5 max-w-full">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400 hover:text-blue-600 dark:hover:text-blue-400 transition-colors"
      >
        <Globe className="w-3.5 h-3.5" />
        <span>Used general knowledge beyond the document</span>
        {expanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
      </button>
      {expanded && (
        <div className="mt-1 text-xs text-gray-500 dark:text-gray-400 bg-gray-50 dark:bg-gray-800/60 border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-2">
          <p className="italic">&quot;{query}&quot;</p>
          <p className="mt-1 text-[11px] text-gray-400 dark:text-gray-500">
            This came from the model&apos;s general knowledge, not the document, and may not reflect the most recent information.
          </p>
        </div>
      )}
    </div>
  );
}
