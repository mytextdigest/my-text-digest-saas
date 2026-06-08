import { motion } from 'framer-motion';
import {
  FileText,
  Star,
  Trash2,
  Edit,
  Calendar,
  Eye,
  Loader2,
  AlertCircle,
  ScanLine,
  Sheet,
} from 'lucide-react';
import { Card, CardContent } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { cn, formatDate, getFileIcon } from '@/lib/utils';

const PROCESSING_STATUSES = new Set([
  'queued', 'extracting', 'running_ocr', 'chunked', 'embedding', 'embedded', 'summarizing', 'clustering',
]);

const DocumentCard = ({
  document,
  viewMode = 'grid',
  onView,
  onDelete,
  onToggleStar,
  onToggleSelect,
  onRename,
  className,
}) => {
  const { id, filename, created_at, file_size, starred = false } = document;

  const isProcessing = PROCESSING_STATUSES.has(document.status);

  const fileIcon = getFileIcon(filename);
  const IconComponent = {
    FileText,
    File: FileText,
    Image: FileText,
    Video: FileText,
    Music: FileText,
    Sheet,
  }[fileIcon] || FileText;

  const cardVariants = {
    hidden: { opacity: 0, y: 20 },
    visible: { opacity: 1, y: 0, transition: { duration: 0.3 } },
    hover:  { y: -4, transition: { duration: 0.2 } },
  };

  const getVisibilityBadge = (visibility) => {
    if (visibility === 'public') {
      return { label: 'Public', className: 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300' };
    }
    return { label: 'Private', className: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/40 dark:text-yellow-300' };
  };

  const getStatusBadge = (status) => {
    switch (status) {
      case 'queued':
        return { label: 'Queued', icon: Loader2, spin: true, className: 'text-gray-500 dark:text-gray-400' };
      case 'extracting':
        return { label: 'Extracting text…', icon: Loader2, spin: true, className: 'text-blue-500 dark:text-blue-400' };
      case 'running_ocr':
        return { label: 'Running OCR…', icon: ScanLine, spin: false, className: 'text-purple-600 dark:text-purple-400' };
      case 'chunked':
      case 'embedding':
      case 'embedded':
        return { label: 'Generating embeddings…', icon: Loader2, spin: true, className: 'text-blue-500 dark:text-blue-400' };
      case 'summarizing':
        return { label: 'Generating summary…', icon: Loader2, spin: true, className: 'text-blue-500 dark:text-blue-400' };
      case 'clustering':
        return { label: 'Matching topic…', icon: Loader2, spin: true, className: 'text-purple-600 dark:text-purple-400' };
      case 'ocr_failed':
        return { label: 'OCR failed', icon: AlertCircle, spin: false, className: 'text-red-600 dark:text-red-400' };
      case 'chunk_failed':
      case 'error':
        return { label: 'Processing failed', icon: AlertCircle, spin: false, className: 'text-red-600 dark:text-red-400' };
      default:
        return null;
    }
  };

  const visibilityBadge = getVisibilityBadge(document.visibility);
  const statusBadge = getStatusBadge(document.status);

  // ─── LIST VIEW ──────────────────────────────────────────────────────────────
  if (viewMode === 'list') {
    return (
      <motion.div
        variants={cardVariants}
        initial="hidden"
        animate="visible"
        {...(!isProcessing && { whileHover: 'hover' })}
        className={cn(
          'group flex items-center p-4 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-sm transition-all card-full-width',
          isProcessing ? 'opacity-60 cursor-default' : 'hover:shadow-md',
          className
        )}
      >
        {/* Icon + meta */}
        <div className="flex items-center flex-1 min-w-0">
          <div className="flex-shrink-0 mr-4">
            <div className="w-10 h-10 bg-primary-100 dark:bg-primary-900/50 rounded-lg flex items-center justify-center">
              {isProcessing
                ? <Loader2 className="w-5 h-5 text-primary-400 animate-spin" />
                : <IconComponent className="w-5 h-5 text-primary-600 dark:text-primary-400" />
              }
            </div>
          </div>

          <div className="card-content-container">
            <h3 className="text-sm font-medium text-gray-900 dark:text-white truncate-responsive">
              {filename}
            </h3>
            <div className="flex items-center flex-wrap mt-1 text-xs text-gray-500 dark:text-gray-300 gap-2">
              <div className="flex items-center">
                <Calendar className="w-3 h-3 mr-1 flex-shrink-0" />
                <span className="truncate">{formatDate(created_at)}</span>
              </div>
              {isProcessing ? (
                <span className="text-[10px] px-2 py-0.5 rounded-full font-medium bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300">
                  Processing…
                </span>
              ) : (
                <span className={cn('text-[10px] px-2 py-0.5 rounded-full font-medium', visibilityBadge.className)}>
                  {visibilityBadge.label}
                </span>
              )}
              {file_size && <span className="truncate">{file_size}</span>}
            </div>
            {statusBadge && (
              <div className={cn('flex items-center gap-1 mt-1 text-xs font-medium', statusBadge.className)}>
                <statusBadge.icon className={cn('w-3 h-3', statusBadge.spin && 'animate-spin')} />
                <span>{statusBadge.label}</span>
              </div>
            )}
          </div>
        </div>

        {/* Action buttons */}
        {isProcessing ? (
          <span className="text-xs text-gray-400 dark:text-gray-500 italic">Processing…</span>
        ) : (
          <div className="flex items-center space-x-1">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => onToggleStar?.(id)}
              className={cn('h-8 w-8', starred ? 'text-yellow-500' : 'text-gray-400')}
              title={starred ? 'Unstar' : 'Star'}
            >
              <Star className={cn('h-4 w-4', starred && 'fill-current')} />
            </Button>

            <Button
              variant="ghost"
              size="icon"
              onClick={() => onToggleSelect?.(id)}
              className={cn('h-8 w-8', document.selected ? 'text-green-500' : 'text-gray-400')}
              title={document.selected ? 'Deselect' : 'Select'}
            >
              <FileText className={cn('h-4 w-4', document.selected && 'fill-current')} />
            </Button>

            <Button
              variant="ghost"
              size="icon"
              onClick={() => onView?.(document)}
              className="h-8 w-8 text-gray-400 hover:text-blue-600"
              title="View"
            >
              <Eye className="h-4 w-4" />
            </Button>

            <Button
              variant="ghost"
              size="icon"
              onClick={() => onRename?.(document)}
              className="h-8 w-8 text-gray-400 hover:text-yellow-600"
              title="Rename"
            >
              <Edit className="h-4 w-4" />
            </Button>

            <Button
              variant="ghost"
              size="icon"
              onClick={() => onDelete?.(id)}
              className="h-8 w-8 text-gray-400 hover:text-red-600"
              title="Delete"
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        )}
      </motion.div>
    );
  }

  // ─── GRID VIEW ──────────────────────────────────────────────────────────────
  return (
    <motion.div
      variants={cardVariants}
      initial="hidden"
      animate="visible"
      {...(!isProcessing && { whileHover: 'hover' })}
      className={cn('card-full-width', isProcessing && 'opacity-60 cursor-default', className)}
    >
      <Card hover={!isProcessing} className="group relative overflow-hidden h-full card-full-width document-card">
        <CardContent className="p-6 h-full flex flex-col card-full-width">

          {/* Header */}
          <div className="flex items-start justify-between mb-4">
            <div className="flex items-center space-x-3">
              <div className="w-12 h-12 bg-primary-100 dark:bg-primary-900/50 rounded-xl flex items-center justify-center">
                {isProcessing
                  ? <Loader2 className="w-6 h-6 text-primary-400 animate-spin" />
                  : <IconComponent className="w-6 h-6 text-primary-600 dark:text-primary-400" />
                }
              </div>
              <div className="card-content-container">
                <h3 className="text-sm font-semibold text-gray-900 dark:text-white truncate-responsive">
                  {filename}
                </h3>
                <div className="flex items-center flex-wrap gap-2 mt-1 text-xs text-gray-500 dark:text-gray-300">
                  <div className="flex items-center">
                    <Calendar className="w-3 h-3 mr-1" />
                    {formatDate(created_at)}
                  </div>
                  {isProcessing ? (
                    <span className="text-[10px] px-2 py-0.5 rounded-full font-medium bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300">
                      Processing…
                    </span>
                  ) : (
                    <span className={cn('text-[10px] px-2 py-0.5 rounded-full font-medium', visibilityBadge.className)}>
                      {visibilityBadge.label}
                    </span>
                  )}
                  {statusBadge && (
                    <div className={cn('flex items-center gap-1 text-[11px] font-medium', statusBadge.className)}>
                      <statusBadge.icon className={cn('w-3 h-3', statusBadge.spin && 'animate-spin')} />
                      <span>{statusBadge.label}</span>
                    </div>
                  )}
                </div>
              </div>
            </div>

            {!isProcessing && (
              <Button
                variant="ghost"
                size="icon"
                onClick={() => onToggleStar?.(id)}
                className={cn('h-8 w-8 flex-shrink-0', starred ? 'text-yellow-500' : 'text-gray-400')}
                title={starred ? 'Unstar' : 'Star'}
              >
                <Star className={cn('h-4 w-4', starred && 'fill-current')} />
              </Button>
            )}
          </div>

          {/* Content Preview */}
          {/* <div className="mb-4 overflow-hidden flex-1">
            <p className="text-xs text-gray-600 dark:text-gray-300 line-clamp-4 break-words">
              {isProcessing
                ? 'Extracting text and generating summary…'
                : document.content || 'No preview available'
              }
            </p>
          </div> */}

          <div className="mb-4 overflow-hidden flex-1">
            <p className="text-xs text-gray-600 dark:text-gray-300 line-clamp-4 break-words">
              {isProcessing
                ? 'Extracting text and generating summary…'
                :''
              }
            </p>
          </div>

          {/* Action buttons */}
          <div className="flex items-center justify-between mt-auto gap-2">
            {isProcessing ? (
              <span className="text-xs text-gray-400 dark:text-gray-500 italic">
                Available once processing is complete
              </span>
            ) : (
              <div className="flex items-center flex-wrap gap-2 flex-1 min-w-0">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => onView?.(document)}
                  className="text-xs h-8 px-3 bg-white text-gray-800 border-gray-300
                             hover:bg-blue-50 hover:text-blue-700 hover:border-blue-300
                             dark:bg-gray-900 dark:text-gray-100 dark:border-gray-700
                             dark:hover:bg-blue-900/30 dark:hover:text-blue-300 dark:hover:border-blue-700"
                  title="View Document"
                >
                  <Eye className="w-3 h-3 mr-1" />
                  View
                </Button>

                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => onToggleSelect?.(id)}
                  className={cn(
                    'text-xs h-8 px-3 bg-white text-gray-800 border-gray-300 dark:bg-gray-900 dark:text-gray-100 dark:border-gray-700',
                    document.selected
                      ? 'bg-green-50 text-green-700 border-green-300 dark:bg-green-900/30 dark:text-green-300 dark:border-green-700'
                      : 'hover:bg-green-50 hover:text-green-700 hover:border-green-300 dark:hover:bg-green-900/30 dark:hover:text-green-300 dark:hover:border-green-700'
                  )}
                  title={document.selected ? 'Deselect Document' : 'Select Document'}
                >
                  <FileText className="w-3 h-3 mr-1" />
                  {document.selected ? 'Selected' : 'Select'}
                </Button>

                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => onRename?.(document)}
                  className="text-xs h-8 px-3 bg-white text-gray-800 border-gray-300
                             hover:bg-yellow-50 hover:text-yellow-700 hover:border-yellow-300
                             dark:bg-gray-900 dark:text-gray-100 dark:border-gray-700
                             dark:hover:bg-yellow-900/30 dark:hover:text-yellow-300 dark:hover:border-yellow-700"
                  title="Rename Document"
                >
                  <Edit className="w-3 h-3 mr-1" />
                  Rename
                </Button>

                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => onDelete?.(id)}
                  className="text-xs h-8 px-3 bg-white text-gray-800 border-gray-300
                             hover:bg-red-50 hover:text-red-700 hover:border-red-300
                             dark:bg-gray-900 dark:text-gray-100 dark:border-gray-700
                             dark:hover:bg-red-900/30 dark:hover:text-red-300 dark:hover:border-red-700"
                  title="Delete Document"
                >
                  <Trash2 className="w-3 h-3 mr-1" />
                  Delete
                </Button>
              </div>
            )}

            {!isProcessing && file_size && (
              <span className="text-xs text-gray-500 dark:text-gray-300 flex-shrink-0 truncate-responsive max-w-20">
                {file_size}
              </span>
            )}
          </div>

        </CardContent>
      </Card>
    </motion.div>
  );
};

export default DocumentCard;
