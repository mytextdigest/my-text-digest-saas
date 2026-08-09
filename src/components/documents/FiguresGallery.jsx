'use client'
import { useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { Image as ImageIcon, Loader2, AlertCircle } from 'lucide-react';
import { cn } from '@/lib/utils';
import FigureDetailModal from './FigureDetailModal';
import { stripMarkdown } from './MarkdownLite';

const POLL_INTERVAL_MS = 3000;
const IN_PROGRESS_STATUSES = ['pending', 'captioning'];

function FigureCard({ figure, onClick }) {
  const inProgress = IN_PROGRESS_STATUSES.includes(figure.status);
  const isError = figure.status === 'error';

  return (
    <motion.button
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2 }}
      onClick={() => onClick(figure)}
      className="group relative rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 overflow-hidden text-left hover:shadow-medium transition-shadow"
    >
      <div className="aspect-video bg-gray-100 dark:bg-gray-900 flex items-center justify-center overflow-hidden">
        <img
          src={figure.imageUrl}
          alt={figure.caption || `Figure ${figure.figureIndex + 1}`}
          className="w-full h-full object-contain"
        />
      </div>

      <div className="absolute top-2 left-2 flex items-center gap-1">
        {figure.pageNumber != null && (
          <span className="text-[10px] px-2 py-0.5 rounded-full font-medium bg-black/60 text-white backdrop-blur-sm">
            Page {figure.pageNumber}
          </span>
        )}
        {inProgress && (
          <span className="text-[10px] px-2 py-0.5 rounded-full font-medium bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300 flex items-center gap-1">
            <Loader2 className="w-2.5 h-2.5 animate-spin" /> Analyzing
          </span>
        )}
        {isError && (
          <span className="text-[10px] px-2 py-0.5 rounded-full font-medium bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300 flex items-center gap-1">
            <AlertCircle className="w-2.5 h-2.5" /> Failed
          </span>
        )}
      </div>

      <div className="p-3">
        <p className="text-xs text-gray-600 dark:text-gray-400 line-clamp-2">
          {figure.caption ? stripMarkdown(figure.caption) : (inProgress ? 'Analyzing figure…' : isError ? 'Could not analyze this figure.' : 'No description available.')}
        </p>
      </div>
    </motion.button>
  );
}

export default function FiguresGallery({ documentId }) {
  const [figures, setFigures] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedFigure, setSelectedFigure] = useState(null);
  const pollRef = useRef(null);

  const fetchFigures = async () => {
    const res = await fetch(`/api/documents/${documentId}/figures`);
    if (res.ok) setFigures(await res.json());
  };

  useEffect(() => {
    if (!documentId) return;
    setLoading(true);
    fetchFigures().finally(() => setLoading(false));
    return () => clearInterval(pollRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [documentId]);

  useEffect(() => {
    const hasInProgress = figures.some((f) => IN_PROGRESS_STATUSES.includes(f.status));
    clearInterval(pollRef.current);
    if (hasInProgress) {
      pollRef.current = setInterval(fetchFigures, POLL_INTERVAL_MS);
    }
    return () => clearInterval(pollRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [figures]);

  const handleDelete = async (figureId) => {
    try {
      await fetch(`/api/documents/${documentId}/figures/${figureId}`, { method: 'DELETE' });
      setSelectedFigure(null);
      await fetchFigures();
    } catch (err) {
      console.error('Failed to delete figure:', err);
    }
  };

  const handleRegenerate = async (figureId) => {
    try {
      await fetch(`/api/documents/${documentId}/figures/${figureId}/regenerate`, { method: 'POST' });
      await fetchFigures();
    } catch (err) {
      console.error('Failed to regenerate figure caption:', err);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full py-12">
        <Loader2 className="w-6 h-6 text-gray-400 animate-spin" />
      </div>
    );
  }

  if (figures.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-center py-12 space-y-3">
        <ImageIcon className="h-10 w-10 text-gray-300 dark:text-gray-600" />
        <p className="text-sm font-medium text-gray-600 dark:text-gray-400">No figures found</p>
        <p className="text-xs text-gray-400 dark:text-gray-500 max-w-64">
          This document doesn't contain any embedded diagrams, charts, or images we could extract.
        </p>
      </div>
    );
  }

  return (
    <>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
        {figures.map((figure) => (
          <FigureCard key={figure.id} figure={figure} onClick={setSelectedFigure} />
        ))}
      </div>

      <FigureDetailModal
        figure={selectedFigure}
        onClose={() => setSelectedFigure(null)}
        onDelete={handleDelete}
        onRegenerate={handleRegenerate}
      />
    </>
  );
}
