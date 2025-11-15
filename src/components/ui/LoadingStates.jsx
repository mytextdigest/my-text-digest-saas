import { motion } from 'framer-motion';
import { LoadingSkeleton, LoadingSpinner } from './LoadingSpinner';
import { cn } from '@/lib/utils';

// Page-level loading component
export const PageLoading = ({ message = "Loading..." }) => {
  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950 flex items-center justify-center">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="text-center"
      >
        <LoadingSpinner size="xl" className="mx-auto mb-4" />
        <p className="text-gray-600 dark:text-gray-400">{message}</p>
      </motion.div>
    </div>
  );
};

// Document grid skeleton
export const DocumentGridSkeleton = ({ count = 8 }) => {
  return (
    <div className="space-y-6">
      {/* Toolbar skeleton */}
      <div className="space-y-4">
        <div className="flex flex-col space-y-4 sm:flex-row sm:items-center sm:justify-between sm:space-y-0">
          <div className="flex flex-col space-y-3 sm:flex-row sm:items-center sm:space-y-0 sm:space-x-4 flex-1">
            <LoadingSkeleton className="h-10 w-full sm:w-64" />
            <LoadingSkeleton className="h-10 w-full sm:w-32" />
          </div>
          <LoadingSkeleton className="h-10 w-full sm:w-24" />
        </div>
        
        <div className="flex items-center justify-between">
          <LoadingSkeleton className="h-8 w-32" />
          <LoadingSkeleton className="h-8 w-20" />
        </div>
      </div>
      
      {/* Results count skeleton */}
      <LoadingSkeleton className="h-4 w-32" />
      
      {/* Grid skeleton */}
      <div className="grid grid-cols-1 gap-4 sm:gap-6">
        {Array.from({ length: count }).map((_, i) => (
          <DocumentCardSkeleton key={i} />
        ))}
      </div>
    </div>
  );
};

// Document card skeleton
export const DocumentCardSkeleton = () => {
  return (
    <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-6 shadow-soft w-full">
      <div className="flex items-start justify-between mb-4">
        <div className="flex items-center space-x-3 flex-1 min-w-0">
          <LoadingSkeleton className="w-12 h-12 rounded-xl flex-shrink-0" />
          <div className="space-y-2 flex-1 min-w-0">
            <LoadingSkeleton className="h-4 w-full max-w-xs" />
            <LoadingSkeleton className="h-3 w-20" />
          </div>
        </div>
        <LoadingSkeleton className="w-8 h-8 rounded flex-shrink-0" />
      </div>

      <div className="space-y-2 mb-4">
        <LoadingSkeleton className="h-3 w-full" />
        <LoadingSkeleton className="h-3 w-3/4" />
        <LoadingSkeleton className="h-3 w-1/2" />
      </div>
      
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-2">
          <LoadingSkeleton className="h-8 w-16" />
          <LoadingSkeleton className="h-8 w-20" />
        </div>
        <LoadingSkeleton className="h-4 w-12" />
      </div>
    </div>
  );
};

// List view skeleton
export const DocumentListSkeleton = ({ count = 5 }) => {
  return (
    <div className="space-y-3">
      {Array.from({ length: count }).map((_, i) => (
        <div
          key={i}
          className="flex items-center p-4 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg"
        >
          <LoadingSkeleton className="w-10 h-10 rounded-lg mr-4" />
          <div className="flex-1 space-y-2">
            <LoadingSkeleton className="h-4 w-48" />
            <LoadingSkeleton className="h-3 w-32" />
          </div>
          <div className="flex items-center space-x-2">
            <LoadingSkeleton className="w-8 h-8 rounded" />
            <LoadingSkeleton className="w-8 h-8 rounded" />
            <LoadingSkeleton className="w-8 h-8 rounded" />
          </div>
        </div>
      ))}
    </div>
  );
};

// Upload progress component
export const UploadProgress = ({ 
  files = [], 
  className 
}) => {
  return (
    <div className={cn("space-y-3", className)}>
      {files.map((file) => (
        <motion.div
          key={file.id}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="flex items-center space-x-3 p-3 bg-gray-50 dark:bg-gray-800 rounded-lg"
        >
          <LoadingSpinner size="sm" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">
              {file.name}
            </p>
            <div className="flex items-center space-x-2 mt-1">
              <div className="flex-1 bg-gray-200 dark:bg-gray-700 rounded-full h-1.5">
                <motion.div
                  className="bg-primary-600 h-1.5 rounded-full"
                  initial={{ width: 0 }}
                  animate={{ width: `${file.progress || 0}%` }}
                  transition={{ duration: 0.3 }}
                />
              </div>
              <span className="text-xs text-gray-500 dark:text-gray-400">
                {file.progress || 0}%
              </span>
            </div>
          </div>
        </motion.div>
      ))}
    </div>
  );
};

// Inline loading component
export const InlineLoading = ({ 
  message = "Loading...", 
  size = "default",
  className 
}) => {
  return (
    <div className={cn("flex items-center space-x-2", className)}>
      <LoadingSpinner size={size} />
      <span className="text-sm text-gray-600 dark:text-gray-400">
        {message}
      </span>
    </div>
  );
};

// Empty state component
export const EmptyState = ({ 
  icon: Icon,
  title,
  description,
  action,
  className 
}) => {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className={cn("text-center py-12", className)}
    >
      {Icon && (
        <div className="w-24 h-24 mx-auto mb-4 bg-gray-100 dark:bg-gray-800 rounded-full flex items-center justify-center">
          <Icon className="w-12 h-12 text-gray-400" />
        </div>
      )}
      
      {title && (
        <h3 className="text-lg font-medium text-gray-900 dark:text-gray-100 mb-2">
          {title}
        </h3>
      )}
      
      {description && (
        <p className="text-gray-600 dark:text-gray-400 mb-6 max-w-md mx-auto">
          {description}
        </p>
      )}
      
      {action}
    </motion.div>
  );
};
