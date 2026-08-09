'use client'
import { useState } from 'react';
import { ZoomIn, ZoomOut, RotateCcw, ChevronDown, ChevronRight, Trash2, RefreshCw, Loader2 } from 'lucide-react';
import { Modal, ModalHeader, ModalTitle, ModalContent, ModalFooter } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import MarkdownLite from './MarkdownLite';

export default function FigureDetailModal({ figure, onClose, onDelete, onRegenerate }) {
  const [zoom, setZoom] = useState(1);
  const [ocrExpanded, setOcrExpanded] = useState(false);
  const [isRegenerating, setIsRegenerating] = useState(false);

  const open = !!figure;

  const handleClose = () => {
    setZoom(1);
    setOcrExpanded(false);
    onClose();
  };

  const handleRegenerate = async () => {
    if (!figure) return;
    setIsRegenerating(true);
    try {
      await onRegenerate(figure.id);
    } finally {
      setIsRegenerating(false);
    }
  };

  return (
    <Modal isOpen={open} onClose={handleClose} size="xl">
      {figure && (
        <>
          <ModalHeader>
            <ModalTitle>
              {figure.pageNumber != null ? `Figure — Page ${figure.pageNumber}` : `Figure ${figure.figureIndex + 1}`}
            </ModalTitle>
          </ModalHeader>

          <ModalContent className="max-h-[calc(100vh-16rem)] overflow-y-auto">
            <div className="relative bg-gray-100 dark:bg-gray-950 rounded-lg flex items-center justify-center min-h-64 overflow-auto">
              <div className="absolute top-3 right-3 z-10 flex items-center gap-1 bg-white/90 dark:bg-gray-800/90 backdrop-blur-sm border border-gray-200 dark:border-gray-700 rounded-lg px-2 py-1 shadow-sm">
                <button
                  onClick={() => setZoom(z => Math.max(0.25, +(z - 0.25).toFixed(2)))}
                  disabled={zoom <= 0.25}
                  className="p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                  title="Zoom out"
                >
                  <ZoomOut className="h-4 w-4 text-gray-600 dark:text-gray-300" />
                </button>
                <span className="text-xs font-medium text-gray-600 dark:text-gray-300 w-10 text-center select-none">
                  {Math.round(zoom * 100)}%
                </span>
                <button
                  onClick={() => setZoom(z => Math.min(4, +(z + 0.25).toFixed(2)))}
                  disabled={zoom >= 4}
                  className="p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                  title="Zoom in"
                >
                  <ZoomIn className="h-4 w-4 text-gray-600 dark:text-gray-300" />
                </button>
                <div className="w-px h-4 bg-gray-200 dark:bg-gray-600 mx-0.5" />
                <button
                  onClick={() => setZoom(1)}
                  disabled={zoom === 1}
                  className="p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                  title="Reset zoom"
                >
                  <RotateCcw className="h-3.5 w-3.5 text-gray-600 dark:text-gray-300" />
                </button>
              </div>

              <div className="p-6 min-w-full min-h-full flex items-center justify-center">
                <img
                  src={figure.imageUrl}
                  alt={figure.caption || 'Figure'}
                  style={{ transform: `scale(${zoom})`, transformOrigin: 'center center', transition: 'transform 0.15s ease' }}
                  className="max-w-none rounded shadow-sm"
                />
              </div>
            </div>

            <div className="mt-4 space-y-3">
              <div>
                <h4 className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-1">
                  Description
                </h4>
                {figure.caption ? (
                  <MarkdownLite text={figure.caption} className="text-sm text-gray-700 dark:text-gray-300 space-y-1" />
                ) : (
                  <p className="text-sm text-gray-700 dark:text-gray-300">No description available yet.</p>
                )}
              </div>

              {figure.ocrText && (
                <div>
                  <button
                    onClick={() => setOcrExpanded(v => !v)}
                    className="flex items-center gap-1 text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
                  >
                    {ocrExpanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                    Extracted text
                  </button>
                  {ocrExpanded && (
                    <p className="mt-1 text-sm text-gray-700 dark:text-gray-300 whitespace-pre-wrap bg-gray-50 dark:bg-gray-800/60 rounded-lg p-3">
                      {figure.ocrText}
                    </p>
                  )}
                </div>
              )}
            </div>
          </ModalContent>

          <ModalFooter>
            <Button
              variant="outline"
              size="sm"
              onClick={handleRegenerate}
              disabled={isRegenerating}
              className="flex items-center gap-2"
            >
              {isRegenerating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
              Regenerate
            </Button>
            <Button
              variant="destructive"
              size="sm"
              onClick={() => onDelete(figure.id)}
              className="flex items-center gap-2"
            >
              <Trash2 className="h-3.5 w-3.5" />
              Delete
            </Button>
          </ModalFooter>
        </>
      )}
    </Modal>
  );
}
