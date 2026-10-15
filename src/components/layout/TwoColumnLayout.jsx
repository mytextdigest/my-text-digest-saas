'use client'
import { useState, useRef, useEffect, useCallback } from 'react';
import { motion } from 'framer-motion';
import { FileText, MessageCircle, GripVertical } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import ApiKeyRequiredModal from '@/components/modals/ApiKeyRequiredModal';
import { useApiKeyCheck } from '@/hooks/useApiKeyCheck';
import { cn } from '@/lib/utils';

const MIN_SPLIT = 30;
const MAX_SPLIT = 70;
const clampSplit = (v) => Math.min(MAX_SPLIT, Math.max(MIN_SPLIT, v));
const DESKTOP_QUERY = '(min-width: 1024px)'; // Tailwind's lg breakpoint

// Mount only the layout that matches the screen. Rendering both and hiding one
// with CSS mounted every column twice (two PDF loads, two chat panels).
function useIsDesktop() {
  const [isDesktop, setIsDesktop] = useState(true);
  useEffect(() => {
    const mq = window.matchMedia(DESKTOP_QUERY);
    const update = () => setIsDesktop(mq.matches);
    update();
    mq.addEventListener('change', update);
    return () => mq.removeEventListener('change', update);
  }, []);
  return isDesktop;
}

// resizable: pass a storage key (e.g. "document") to get a draggable divider
// whose position (left column %, clamped 30–70) is remembered per key.
const TwoColumnLayout = ({
  leftColumn,
  rightColumn,
  leftTitle = "Documents",
  rightTitle = "Chat",
  resizable,
  className
}) => {
  const [activeTab, setActiveTab] = useState('documents'); // For mobile view
  const { hasApiKey, isLoading, refreshApiKeyStatus } = useApiKeyCheck();
  const isDesktop = useIsDesktop();
  const storageKey = resizable ? `split:${resizable}` : null;
  const [split, setSplit] = useState(50);
  const [isDragging, setIsDragging] = useState(false);
  const rowRef = useRef(null);

  useEffect(() => {
    if (!storageKey) return;
    try {
      const saved = Number(localStorage.getItem(storageKey));
      if (saved) setSplit(clampSplit(saved));
    } catch {}
  }, [storageKey]);

  const handlePointerDown = useCallback((e) => {
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    setIsDragging(true);
  }, []);

  const handlePointerMove = useCallback((e) => {
    if (!isDragging || !rowRef.current) return;
    const rect = rowRef.current.getBoundingClientRect();
    setSplit(clampSplit(((e.clientX - rect.left) / rect.width) * 100));
  }, [isDragging]);

  const handlePointerUp = useCallback(() => {
    if (!isDragging) return;
    setIsDragging(false);
    try { localStorage.setItem(storageKey, String(Math.round(split * 10) / 10)); } catch {}
  }, [isDragging, storageKey, split]);

  const handleDividerKey = useCallback((e) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    setSplit((s) => {
      const next = clampSplit(s + (e.key === 'ArrowLeft' ? -2 : 2));
      try { localStorage.setItem(storageKey, String(next)); } catch {}
      return next;
    });
  }, [storageKey]);

  // Show loading screen while checking API key
  if (isLoading) {
    return (
      <div className={cn("h-full flex items-center justify-center", className)}>
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600 mx-auto mb-4"></div>
          <p className="text-gray-600 dark:text-gray-400">Loading...</p>
        </div>
      </div>
    );
  }

  return (
    <>
      {/* API Key Required Modal */}
      <ApiKeyRequiredModal
        isOpen={hasApiKey === false}
        onApiKeySet={refreshApiKeyStatus}
      />

      <div className={cn("h-full", hasApiKey === false && "pointer-events-none opacity-50", className)}>
      {/* Mobile Tab Navigation */}
      {!isDesktop && (
      <div className="mb-4">
        <div className="flex space-x-1 bg-gray-100 dark:bg-gray-800 p-1 rounded-lg">
          <Button
            variant={activeTab === 'documents' ? 'default' : 'ghost'}
            size="sm"
            onClick={() => setActiveTab('documents')}
            className={cn(
              "flex-1 flex items-center justify-center space-x-2",
              activeTab === 'documents'
                ? "text-white dark:text-gray-200"
                : "text-gray-600 dark:text-gray-400"
            )}
          >
            <FileText className="h-4 w-4" />
            <span>{leftTitle}</span>
          </Button>
          <Button
            variant={activeTab === 'chat' ? 'default' : 'ghost'}
            size="sm"
            onClick={() => setActiveTab('chat')}
            className={cn(
              "flex-1 flex items-center justify-center space-x-2",
              activeTab === 'chat'
                ? "text-white dark:text-gray-200"
                : "text-gray-600 dark:text-gray-400"
            )}
          >
            <MessageCircle className="h-4 w-4" />
            <span>{rightTitle}</span>
          </Button>
        </div>
      </div>
      )}

      {/* Desktop Two-Column Layout */}
      {isDesktop && (
      <div
        ref={rowRef}
        className={cn("flex h-full w-full", !resizable && "space-x-6", isDragging && "select-none cursor-col-resize")}
      >
        {/* Left Column - Documents */}
        <motion.div
          initial={{ opacity: 0, x: -20 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.5 }}
          className="flex-1 min-w-0" // min-w-0 prevents flex item from overflowing
          style={resizable ? { flex: `0 0 ${split}%` } : { flexBasis: '50%' }}
        >
          <div className="h-full">
            {leftColumn}
          </div>
        </motion.div>

        {/* Divider */}
        {resizable ? (
          // A 1px line (so the columns meet edge to edge) with a wider,
          // invisible hit area for dragging, and a grip in the middle.
          <div
            role="separator"
            aria-orientation="vertical"
            aria-valuenow={Math.round(split)}
            aria-valuemin={MIN_SPLIT}
            aria-valuemax={MAX_SPLIT}
            tabIndex={0}
            title="Drag to resize"
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerUp}
            onKeyDown={handleDividerKey}
            className={cn(
              "group relative z-10 w-px flex-shrink-0 cursor-col-resize focus:outline-none transition-colors",
              isDragging ? "bg-primary-500" : "bg-gray-200 dark:bg-gray-700 hover:bg-primary-300 focus-visible:bg-primary-500"
            )}
          >
            <div className="absolute inset-y-0 -left-2 -right-2" />
            <div className={cn(
              "absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 flex items-center justify-center w-4 h-8 rounded-md border bg-white dark:bg-gray-900 shadow-sm transition-colors",
              isDragging ? "border-primary-500 text-primary-600" : "border-gray-200 dark:border-gray-700 text-gray-400 group-hover:text-gray-600 dark:group-hover:text-gray-300"
            )}>
              <GripVertical className="w-3 h-3" />
            </div>
          </div>
        ) : (
          <div className="w-px bg-gray-200 dark:bg-gray-700 flex-shrink-0"></div>
        )}

        {/* Right Column - Chat */}
        <motion.div
          initial={{ opacity: 0, x: 20 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.5, delay: 0.1 }}
          className="flex-1 min-w-0"
          style={{ flexBasis: resizable ? 0 : '50%' }}
        >
          <div className="h-full">
            {rightColumn}
          </div>
        </motion.div>
      </div>
      )}

      {/* Mobile Single Column Layout */}
      {!isDesktop && (
      <div className="h-full">
        <motion.div
          key={activeTab}
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3 }}
          className="h-full"
        >
          {activeTab === 'documents' ? leftColumn : rightColumn}
        </motion.div>
      </div>
      )}
    </div>
    </>
  );
};

export default TwoColumnLayout;
