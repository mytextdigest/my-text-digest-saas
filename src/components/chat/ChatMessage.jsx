'use client'
import { useRouter } from 'next/navigation';
import { motion } from 'framer-motion';
import { Bot, User, GitCompare, ArrowRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import MessageActions from './MessageActions';
import MessageFeedback from './MessageFeedback';
import ChartMessage from './ChartMessage';
import MarkdownMessage from './MarkdownMessage';
import { ExternalKnowledgeBadge } from './ExternalKnowledgeBadge';
import { MessageImageThumbs, GeneratedImage } from './ChatImages';
import { InsightView } from '@/components/insights/InsightView';
import DerivedTableCard, { TableCitationChips } from '@/components/tables/DerivedTableCard';

// One chat message, shared by document chat and project chat.
// User messages: light bubble on the right with the send time underneath.
// Assistant (and system welcome) messages: plain text beside a neutral avatar —
// no bubble — followed by any images, tables, chart, badges and the action row.

export function AssistantAvatar() {
  return (
    <div className="shrink-0 w-8 h-8 rounded-full flex items-center justify-center bg-violet-50 text-violet-600 ring-1 ring-violet-200 dark:bg-violet-500/10 dark:text-violet-300 dark:ring-violet-500/30">
      <Bot className="w-4 h-4" />
    </div>
  );
}

function UserAvatar() {
  return (
    <div className="shrink-0 w-8 h-8 rounded-full flex items-center justify-center bg-primary-600 text-white">
      <User className="w-4 h-4" />
    </div>
  );
}

const formatTime = (t) => {
  const d = t instanceof Date ? t : t ? new Date(t) : null;
  return d && !Number.isNaN(d.getTime()) ? d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : '';
};

const rowMotion = {
  initial: { opacity: 0, y: 12 },
  animate: { opacity: 1, y: 0 },
  transition: { duration: 0.3, ease: 'easeOut' },
};

// feedbackTable: 'document' | 'project' — enables 👍/👎 on saved assistant answers
// (message.saved: the message is a stored row, so message.id is its id).
export default function ChatMessage({ message, feedbackTable, imageActions, onExpand, onCitationClick }) {
  const router = useRouter();

  if (message.role === 'user') {
    const time = formatTime(message.timestamp);
    return (
      <motion.div {...rowMotion} className="group flex items-start justify-end gap-3">
        <div className="flex flex-col items-end min-w-0 max-w-[85%]">
          <MessageImageThumbs
            images={message.attachments}
            onOpen={(i) => imageActions?.openViewer(message.attachments, i)}
          />
          {message.content && (
            <div className="rounded-2xl rounded-tr-md px-4 py-2.5 bg-primary-50 text-gray-900 dark:bg-primary-500/15 dark:text-gray-100 overflow-hidden">
              <MarkdownMessage content={message.content} />
            </div>
          )}
          {/* Time, with the actions appearing beside it on hover — no extra row in the thread. */}
          <div className="mt-1 flex items-center gap-2 h-8">
            {message.content && (
              <MessageActions
                content={message.content}
                onExpand={onExpand}
                align="right"
                className="mt-0 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity"
              />
            )}
            {time && <span className="text-[11px] text-gray-400 dark:text-gray-500">{time}</span>}
          </div>
        </div>
        <UserAvatar />
      </motion.div>
    );
  }

  const isSystem = message.role === 'system';
  return (
    <motion.div {...rowMotion} className="flex items-start gap-3">
      <AssistantAvatar />
      <div className="flex-1 min-w-0 flex flex-col items-start pt-1 text-gray-800 dark:text-gray-100">
        {message.insight ? (
          <div className="w-full rounded-xl border border-gray-200 dark:border-gray-700 px-4 py-3">
            <InsightView insight={message.insight} columns={["Score", "Notes"]} dividers={false} />
          </div>
        ) : (
          <MarkdownMessage
            variant="rich"
            content={message.content}
            citations={message.citations}
            onCitationClick={onCitationClick}
            className={cn('w-full text-[15px]', isSystem && 'text-gray-500 dark:text-gray-400')}
          />
        )}

        {message.attachments?.map((img) => (
          <GeneratedImage key={img.id} {...imageActions.generatedImageProps(img)} />
        ))}

        {message.derivedTableId
          ? <DerivedTableCard derivedTableId={message.derivedTableId} />
          : <TableCitationChips citations={message.tableCitations} />}

        {message.chart && <ChartMessage spec={message.chart} />}

        <ExternalKnowledgeBadge query={message.externalKnowledgeQuery} />

        {message.comparisonId && (
          <button
            onClick={() => router.push(`/compare?id=${message.comparisonId}`)}
            className="mt-2 flex items-center gap-2 text-xs font-medium px-3 py-2 rounded-lg border border-primary-200 dark:border-primary-800 bg-primary-50 dark:bg-primary-900/20 text-primary-700 dark:text-primary-300 hover:bg-primary-100 dark:hover:bg-primary-900/40 transition-colors"
          >
            <GitCompare className="h-3.5 w-3.5" />
            View full comparison
            <ArrowRight className="h-3 w-3" />
          </button>
        )}

        {message.content && !isSystem && (
          <MessageActions
            content={message.content}
            onExpand={onExpand}
            className="mt-3"
            trailing={feedbackTable && message.saved && (
              <MessageFeedback table={feedbackTable} messageId={message.id} initial={message.feedback ?? null} />
            )}
          />
        )}
      </div>
    </motion.div>
  );
}

// Assistant-side row for transient states (typing dots, permission prompt, image progress).
export function AssistantPendingRow({ children }) {
  return (
    <motion.div {...rowMotion} className="flex items-start gap-3">
      <AssistantAvatar />
      <div className="flex-1 min-w-0 flex flex-col items-start pt-1">{children}</div>
    </motion.div>
  );
}

export function TypingDots() {
  return (
    <div className="flex items-center gap-1 h-6" aria-label="Assistant is typing">
      {[0, 0.15, 0.3].map((delay) => (
        <motion.span
          key={delay}
          animate={{ opacity: [0.3, 1, 0.3] }}
          transition={{ duration: 1, repeat: Infinity, delay }}
          className="w-2 h-2 rounded-full bg-gray-400 dark:bg-gray-500"
        />
      ))}
    </div>
  );
}
