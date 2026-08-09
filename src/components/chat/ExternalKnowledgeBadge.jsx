'use client';

import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Globe, ChevronDown, ChevronUp } from 'lucide-react';
import { Button } from '@/components/ui/Button';

// The confirmation bubble shown when the model wants to consult general
// knowledge beyond the document/project context. Yes/No are stacked and
// near-full-width by design, not side-by-side small buttons.
export function GeneralKnowledgePermissionPrompt({ query, onApprove, onDecline }) {
  return (
    <div className="bg-white dark:bg-gray-800 rounded-2xl px-4 py-3 shadow-md border border-gray-200 dark:border-gray-700 max-w-[85%]">
      <div className="flex items-start space-x-2">
        <Globe className="h-4 w-4 text-blue-500 mt-0.5 flex-shrink-0" />
        <p className="text-sm text-gray-700 dark:text-gray-300 leading-relaxed">
          This question needs general knowledge beyond this document — &quot;{query}&quot;. Should I go ahead?
        </p>
      </div>
      <div className="flex flex-col gap-2 mt-3">
        <Button size="sm" onClick={onApprove} className="w-full bg-blue-500 hover:bg-blue-600 text-white border-0">
          Yes, go ahead
        </Button>
        <Button size="sm" variant="outline" onClick={onDecline} className="w-full">
          No, use the document only
        </Button>
      </div>
    </div>
  );
}

// Transient chip shown while the approved general-knowledge lookup is in
// flight, matching the visual weight of the existing typing-indicator bubble.
export function GeneralKnowledgeProgressChip() {
  return (
    <div className="inline-flex items-center space-x-2 bg-white dark:bg-gray-800 rounded-full px-4 py-2 shadow-md border border-gray-200 dark:border-gray-700">
      <Globe className="h-3.5 w-3.5 text-blue-500 animate-pulse" />
      <span className="text-xs text-gray-600 dark:text-gray-400">
        Consulting general knowledge beyond the document…
      </span>
    </div>
  );
}

// Collapsible disclosure shown on a settled assistant message that used the
// general-knowledge tool. Renders nothing when the message has no query.
export function ExternalKnowledgeBadge({ query }) {
  const [expanded, setExpanded] = useState(false);
  if (!query) return null;

  return (
    <div className="mt-2 max-w-full">
      <button
        type="button"
        onClick={() => setExpanded((e) => !e)}
        className="inline-flex items-center space-x-1.5 text-xs text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 transition-colors"
      >
        <Globe className="h-3 w-3" />
        <span>Used general knowledge</span>
        {expanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
      </button>
      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="overflow-hidden"
          >
            <div className="mt-1.5 text-xs text-gray-500 dark:text-gray-400 bg-gray-50 dark:bg-gray-800/50 rounded-lg px-3 py-2 border border-gray-200 dark:border-gray-700">
              <p className="font-medium text-gray-600 dark:text-gray-300 mb-1">Query: {query}</p>
              <p>This may not reflect the most recent information.</p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
