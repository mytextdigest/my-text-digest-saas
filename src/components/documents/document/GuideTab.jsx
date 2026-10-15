"use client";
import { useEffect, useRef } from "react";
import { motion } from "framer-motion";
import { BookOpen, ChevronDown, ChevronRight, HelpCircle, Lightbulb } from "lucide-react";

// Pagewise Summary tab: progressive reading insights that unlock as the
// reader scrolls through the document (state lives in the page, which also
// tracks the visible page).
export default function GuideTab({
  totalPages,
  pagesRead,
  readingInsights,
  isLoadingPageInsight,
  expandedInsightIndex,
  setExpandedInsightIndex,
  detectedPage,
}) {
  const insightsEndRef = useRef(null);

  useEffect(() => {
    insightsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [readingInsights]);

  return (
    <div className="chat-container">
      {/* Progress bar */}
      {totalPages > 0 && (
        <div className="shrink-0 px-4 pt-4 pb-3 border-b border-gray-200 dark:border-gray-700">
          <div className="flex justify-between text-xs text-gray-500 dark:text-gray-400 mb-1.5">
            <span>{pagesRead === 0 ? 'Not started' : `Page ${pagesRead} of ${totalPages} read`}</span>
            <span>{Math.round((pagesRead / totalPages) * 100)}%</span>
          </div>
          <div className="h-1.5 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
            <div
              className="h-1.5 bg-primary-600 rounded-full transition-all duration-500"
              style={{ width: `${(pagesRead / totalPages) * 100}%` }}
            />
          </div>
        </div>
      )}

      {/* Insight cards */}
      <div className="chat-messages-area p-4 space-y-3 bg-gray-50 dark:bg-gray-900/50 chat-scrollbar">
        {readingInsights.length === 0 && !isLoadingPageInsight && (
          <div className="flex flex-col items-center justify-center h-full text-center py-12 space-y-3">
            <BookOpen className="h-10 w-10 text-gray-300 dark:text-gray-600" />
            <p className="text-sm font-medium text-gray-600 dark:text-gray-400">Progressive reading mode</p>
            <p className="text-xs text-gray-400 dark:text-gray-500 max-w-55">
              Start reading the document. Insights and reflection questions unlock automatically as you scroll through each page.
            </p>
          </div>
        )}

        {readingInsights.map((insight, idx) => {
          const isExpanded = expandedInsightIndex === idx;
          return (
            <motion.div
              key={idx}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.35 }}
              className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden"
            >
              {/* Card header — always visible */}
              <button
                onClick={() => setExpandedInsightIndex(isExpanded ? null : idx)}
                className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors"
              >
                <span className="text-sm font-semibold text-gray-800 dark:text-gray-200">
                  Page {insight.page}
                </span>
                {isExpanded
                  ? <ChevronDown className="h-4 w-4 text-gray-400 shrink-0" />
                  : <ChevronRight className="h-4 w-4 text-gray-400 shrink-0" />
                }
              </button>

              {/* Expandable body */}
              {isExpanded && (
                <div className="px-4 pb-4 space-y-4 border-t border-gray-100 dark:border-gray-700">
                  {insight.keyPoints.length > 0 && (
                    <div className="pt-3">
                      <div className="flex items-center space-x-1.5 mb-2">
                        <Lightbulb className="h-3.5 w-3.5 text-amber-500" />
                        <span className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">Key Points</span>
                      </div>
                      <ul className="space-y-1.5">
                        {insight.keyPoints.map((point, i) => (
                          <li key={i} className="flex items-start space-x-2">
                            <div className="w-1.5 h-1.5 bg-primary-500 rounded-full mt-1.5 shrink-0" />
                            <span className="text-sm text-gray-700 dark:text-gray-300 leading-relaxed">{point}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {insight.questions.length > 0 && (
                    <div>
                      <div className="flex items-center space-x-1.5 mb-2">
                        <HelpCircle className="h-3.5 w-3.5 text-blue-500" />
                        <span className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">questions to Reflect</span>
                      </div>
                      <ol className="space-y-2">
                        {insight.questions.map((q, i) => (
                          <li key={i} className="text-sm text-gray-700 dark:text-gray-300 leading-relaxed pl-3 border-l-2 border-blue-200 dark:border-blue-800">
                            {q}
                          </li>
                        ))}
                      </ol>
                    </div>
                  )}
                </div>
              )}
            </motion.div>
          );
        })}

        {isLoadingPageInsight && (
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 px-4 py-4 flex items-center space-x-3"
          >
            <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-primary-600 shrink-0" />
            <span className="text-sm text-gray-500 dark:text-gray-400">Generating insights for page {pagesRead + 1}…</span>
          </motion.div>
        )}

        <div ref={insightsEndRef} />
      </div>

      {/* Auto-scroll status */}
      <div className="shrink-0 px-4 py-3 border-t border-gray-200 dark:border-gray-700 text-center">
        {isLoadingPageInsight ? (
          <div className="flex items-center justify-center space-x-2 text-sm text-gray-500 dark:text-gray-400">
            <div className="animate-spin rounded-full h-3.5 w-3.5 border-b-2 border-primary-600" />
            <span>Generating insights for page {pagesRead + 1}…</span>
          </div>
        ) : pagesRead > 0 && pagesRead >= totalPages ? (
          <p className="text-sm text-gray-500 dark:text-gray-400">You&apos;ve finished the document.</p>
        ) : detectedPage > 0 ? (
          <p className="text-xs text-gray-400 dark:text-gray-500">
            On page {detectedPage}{totalPages > 0 ? ` of ${totalPages}` : ''}
          </p>
        ) : (
          <p className="text-xs text-gray-400 dark:text-gray-500">
            Scroll through the document — insights appear automatically.
          </p>
        )}
      </div>
    </div>
  );
}
