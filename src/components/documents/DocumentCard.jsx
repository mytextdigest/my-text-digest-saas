import { motion } from 'framer-motion';
import { 
  FileText, 
  MoreVertical, 
  Star, 
  Download, 
  Trash2, 
  Edit,
  Calendar,
  Eye
} from 'lucide-react';
import { Card, CardContent } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { cn, formatDate, getFileIcon } from '@/lib/utils';

const DocumentCard = ({ 
  document, 
  viewMode = 'grid',
  onView,
  onEdit,
  onDelete,
  onDownload,
  onToggleStar,
  onToggleSelect,
  className 
}) => {
  const { id, filename, created_at, file_size, starred = false } = document;
  
  const fileIcon = getFileIcon(filename);
  const IconComponent = {
    FileText,
    File: FileText,
    Image: FileText,
    Video: FileText,
    Music: FileText,
  }[fileIcon] || FileText;

  const cardVariants = {
    hidden: { opacity: 0, y: 20 },
    visible: { 
      opacity: 1, 
      y: 0,
      transition: { duration: 0.3 }
    },
    hover: { 
      y: -4,
      transition: { duration: 0.2 }
    }
  };


  const getVisibilityBadge = (visibility) => {
    if (visibility === "public") {
      return {
        label: "Public",
        className: "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300"
      };
    }
    return {
      label: "Private",
      className: "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/40 dark:text-yellow-300"
    };
  };

  const visibilityBadge = getVisibilityBadge(document.visibility);

  if (viewMode === 'list') {
    return (
      <motion.div
        variants={cardVariants}
        initial="hidden"
        animate="visible"
        whileHover="hover"
        className={cn(
          "group flex items-center p-4 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-sm hover:shadow-md transition-all card-full-width",
          className
        )}
      >
        <div className="flex items-center flex-1 min-w-0">
          <div className="flex-shrink-0 mr-4">
            <div className="w-10 h-10 bg-primary-100 dark:bg-primary-900/50 rounded-lg flex items-center justify-center">
              <IconComponent className="w-5 h-5 text-primary-600 dark:text-primary-400" />
            </div>
          </div>
          
          <div className="card-content-container">
            <h3 className="text-sm font-medium text-gray-900 dark:text-white truncate-responsive">
              {filename}
            </h3>
            <div className="flex items-center mt-1 text-xs text-gray-500 dark:text-gray-300 overflow-hidden">
              <Calendar className="w-3 h-3 mr-1 flex-shrink-0" />
              <span className="truncate flex-shrink">{formatDate(created_at)}</span>
              {/* Visibility Badge */}
              <span className={cn(
                "text-[10px] px-2 py-0.5 rounded-full font-medium",
                visibilityBadge.className
              )}>
                {visibilityBadge.label}
              </span>
              {file_size && (
                <>
                  <span className="mx-2 flex-shrink-0">•</span>
                  <span className="truncate flex-shrink">{file_size}</span>
                </>
              )}
            </div>
          </div>
        </div>

        <div className="flex items-center space-x-2">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => onToggleStar?.(id)}
            className={cn(
              "h-8 w-8",
              starred ? "text-yellow-500" : "text-gray-400"
            )}
          >
            <Star className={cn("h-4 w-4", starred && "fill-current")} />
          </Button>

          <Button
            variant="ghost"
            size="icon"
            onClick={() => onToggleSelect?.(id)}
            className={cn(
              "h-8 w-8",
              document.selected ? "text-green-500" : "text-gray-400"
            )}
            title={document.selected ? "Deselect Document" : "Select Document"}
          >
            <FileText className={cn("h-4 w-4", document.selected && "fill-current")} />
          </Button>
          
          <Button
            variant="ghost"
            size="icon"
            onClick={() => onView?.(document)}
            className="h-8 w-8 text-gray-400 hover:text-gray-600"
          >
            <Eye className="h-4 w-4" />
          </Button>
          

          
          <Button
            variant="ghost"
            size="icon"
            onClick={() => onDelete?.(id)}
            className="h-8 w-8 text-gray-400 hover:text-red-600"
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      </motion.div>
    );
  }

  return (
    <motion.div
      variants={cardVariants}
      initial="hidden"
      animate="visible"
      whileHover="hover"
      className={cn("card-full-width", className)}
    >
      <Card hover className="group relative overflow-hidden h-full card-full-width document-card">
        <CardContent className="p-6 h-full flex flex-col card-full-width">
          {/* Header */}
          <div className="flex items-start justify-between mb-4">
            <div className="flex items-center space-x-3">
              <div className="w-12 h-12 bg-primary-100 dark:bg-primary-900/50 rounded-xl flex items-center justify-center">
                <IconComponent className="w-6 h-6 text-primary-600 dark:text-primary-400" />
              </div>
              <div className="card-content-container">
                <h3 className="text-sm font-semibold text-gray-900 dark:text-white truncate-responsive">
                  {filename}
                </h3>
                <p className="text-xs text-gray-500 dark:text-gray-300 mt-1 truncate-responsive">
                  {formatDate(created_at)}
                </p>

                <span className={cn(
                  "text-[10px] px-2 py-0.5 rounded-full font-medium",
                  visibilityBadge.className
                )}>
                  {visibilityBadge.label}
                </span>
              </div>
            </div>
            
            <div className="flex items-center space-x-1">
              <Button
                variant="ghost"
                size="icon"
                onClick={() => onToggleStar?.(id)}
                className={cn(
                  "h-8 w-8",
                  starred ? "text-yellow-500" : "text-gray-400"
                )}
              >
                <Star className={cn("h-4 w-4", starred && "fill-current")} />
              </Button>

              <Button
                variant="ghost"
                size="icon"
                onClick={() => onToggleSelect?.(id)}
                className={cn(
                  "h-8 w-8",
                  document.selected ? "text-green-500" : "text-gray-400"
                )}
                title={document.selected ? "Deselect Document" : "Select Document"}
              >
                <FileText className={cn("h-4 w-4", document.selected && "fill-current")} />
              </Button>
            </div>
          </div>

          {/* Content Preview */}
          <div className="mb-4 overflow-hidden flex-1">
            <p className="text-xs text-gray-600 dark:text-gray-300 line-clamp-4 break-words">
              {document.content || 'No preview available'}
            </p>
          </div>

          {/* Actions */}
          <div className="flex items-center justify-between mt-auto gap-2">
            <div className="flex items-center space-x-2 flex-1 min-w-0">
              <Button
                variant="outline"
                size="sm"
                onClick={() => onView?.(document)}
                className="text-xs flex-shrink-0"
              >
                <Eye className="w-3 h-3 mr-1" />
                <span className="hidden sm:inline">View</span>
                <span className="sm:hidden">V</span>
              </Button>



              <Button
                variant="ghost"
                size="icon"
                onClick={() => onDelete?.(id)}
                className="h-8 w-8 text-gray-400 hover:text-red-600"
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>

            {file_size && (
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
