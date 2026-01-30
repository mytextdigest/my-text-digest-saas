import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Grid,
  List,
  SortAsc,
  SortDesc,
  Filter,
  Search,
  Upload,
  FileText,
  Star,
  Trash2,
  CircleOff
} from 'lucide-react';
import DocumentCard from './DocumentCard';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { LoadingSkeleton } from '@/components/ui/LoadingSpinner';
import { cn } from '@/lib/utils';

const DocumentGrid = ({
  documents = [],
  loading = false,
  onUpload,
  onView,
  onEdit,
  onDelete,
  onDownload,
  onToggleStar,
  onToggleSelect,
  activeFilter = 'all',
  onFilterChange,
  className
}) => {
  const [viewMode, setViewMode] = useState('grid');
  const [sortBy, setSortBy] = useState('date');
  const [sortOrder, setSortOrder] = useState('desc');
  const [searchQuery, setSearchQuery] = useState('');
  const [filterType, setFilterType] = useState('all');
  const [visibilityFilter, setVisibilityFilter] = useState('all');

  // Filter and sort documents
  const filteredDocuments = documents
    .filter(doc => {
      const matchesSearch = doc.filename.toLowerCase().includes(searchQuery.toLowerCase()) ||
                           (doc.content && doc.content.toLowerCase().includes(searchQuery.toLowerCase()));
      
      const matchesFilter = filterType === 'all' || 
                           doc.filename.toLowerCase().endsWith(`.${filterType}`);

      const matchesVisibility =
                           visibilityFilter === "all" || doc.visibility === visibilityFilter;
      
      return matchesSearch && matchesFilter && matchesVisibility;
    })
    .sort((a, b) => {
      let comparison = 0;
      
      switch (sortBy) {
        case 'name':
          comparison = a.filename.localeCompare(b.filename);
          break;
        case 'date':
          comparison = new Date(a.created_at) - new Date(b.created_at);
          break;
        case 'size':
          comparison = (a.file_size || 0) - (b.file_size || 0);
          break;
        default:
          comparison = 0;
      }
      
      return sortOrder === 'asc' ? comparison : -comparison;
    });

  const toggleSort = (field) => {
    if (sortBy === field) {
      setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
    } else {
      setSortBy(field);
      setSortOrder('asc');
    }
  };

  const containerVariants = {
    hidden: { opacity: 0 },
    visible: {
      opacity: 1,
      transition: {
        staggerChildren: 0.1
      }
    }
  };

  const itemVariants = {
    hidden: { opacity: 0, y: 20 },
    visible: { opacity: 1, y: 0 }
  };

  if (loading) {
    return (
      <div className={cn("h-full flex flex-col", className)}>
        {/* Toolbar Skeleton */}
        <div className="flex-shrink-0 space-y-4 mb-6">
          <div className="flex items-center justify-between">
            <LoadingSkeleton className="h-10 w-64" />
            <div className="flex items-center space-x-2">
              <LoadingSkeleton className="h-10 w-20" />
              <LoadingSkeleton className="h-10 w-20" />
            </div>
          </div>
          <LoadingSkeleton className="h-4 w-32" />
        </div>

        {/* Scrollable Grid Skeleton */}
        <div className="flex-1 min-h-0 overflow-y-auto document-scroll-container">
          <div className="grid grid-cols-1 gap-4 sm:gap-6 pb-6">
            {Array.from({ length: 8 }).map((_, i) => (
              <LoadingSkeleton key={i} className="h-64 rounded-xl w-full" />
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={cn("h-full flex flex-col", className)}>
      {/* Toolbar - Fixed at top */}
      <div className="flex-shrink-0 space-y-4 mb-6">
        {/* Filter Buttons */}
        <div className="flex flex-wrap gap-2 p-1 bg-gray-100 dark:bg-gray-800 rounded-lg">
          {[
            { id: 'all', label: 'All Documents', icon: FileText },
            { id: 'starred', label: 'Starred', icon: Star },
            { id: 'unselected', label: 'Unselected', icon: CircleOff }
          ].map(filter => {
            const Icon = filter.icon;
            return (
              <Button
                key={filter.id}
                variant={activeFilter === filter.id ? 'default' : 'ghost'}
                size="sm"
                onClick={() => onFilterChange?.(filter.id)}
                className={cn(
                  "flex items-center space-x-2 text-xs sm:text-sm",
                  activeFilter === filter.id
                    ? "text-white dark:text-gray-200" // Lighter text for active buttons
                    : "text-gray-600 dark:text-gray-400"
                )}
              >
                <Icon className="h-3 w-3 sm:h-4 sm:w-4" />
                <span className="hidden sm:inline">{filter.label}</span>
                <span className="sm:hidden">{filter.label.split(' ')[0]}</span>
              </Button>
            );
          })}
        </div>

        {/* Mobile-first layout */}
        <div className="flex flex-col space-y-4 sm:flex-row sm:items-center sm:justify-between sm:space-y-0 sm:gap-4">
          {/* Search and Filter */}
          <div className="flex flex-col space-y-3 sm:flex-row sm:items-center sm:space-y-0 sm:space-x-4 flex-1">
            <Input
              placeholder="Search documents..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              leftIcon={<Search className="h-4 w-4" />}
              className="w-full"
            />

            <select
              value={filterType}
              onChange={(e) => setFilterType(e.target.value)}
              className="px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-md bg-white dark:bg-gray-900 text-sm focus:outline-none focus:ring-2 focus:ring-primary-600 w-full sm:w-auto"
            >
              <option value="all">All Types</option>
              <option value="pdf">PDF</option>
              <option value="docx">Word</option>
              <option value="txt">Text</option>
            </select>

            <select
              value={visibilityFilter}
              onChange={(e) => setVisibilityFilter(e.target.value)}
              className="px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-md bg-white dark:bg-gray-900 text-sm focus:outline-none focus:ring-2 focus:ring-primary-600 w-full sm:w-auto"
            >
              <option value="all">All Visibility</option>
              <option value="private">Private</option>
              <option value="public">Public</option>
            </select>
            
          </div>

          {/* Upload Button - Hidden on starred tab */}
          {activeFilter !== 'starred' && (
            <Button onClick={onUpload} className="w-full sm:w-auto">
              <Upload className="mr-2 h-4 w-4" />
              Upload
            </Button>
          )}
        </div>

        {/* Sort and View Controls */}
        <div className="flex items-center justify-between">
          {/* Sort Options */}
          <div className="flex items-center space-x-1 border border-gray-300 dark:border-gray-700 rounded-md p-1">
            <Button
              variant={sortBy === 'name' ? 'default' : 'ghost'}
              size="sm"
              onClick={() => toggleSort('name')}
              className={cn(
                "text-xs px-2 sm:px-3",
                sortBy === 'name'
                  ? "text-white dark:text-gray-200"
                  : "text-gray-600 dark:text-gray-400"
              )}
            >
              <span className="hidden sm:inline">Name</span>
              <span className="sm:hidden">N</span>
              {sortBy === 'name' && (
                sortOrder === 'asc' ? <SortAsc className="ml-1 h-3 w-3" /> : <SortDesc className="ml-1 h-3 w-3" />
              )}
            </Button>

            <Button
              variant={sortBy === 'date' ? 'default' : 'ghost'}
              size="sm"
              onClick={() => toggleSort('date')}
              className={cn(
                "text-xs px-2 sm:px-3",
                sortBy === 'date'
                  ? "text-white dark:text-gray-200"
                  : "text-gray-600 dark:text-gray-400"
              )}
            >
              <span className="hidden sm:inline">Date</span>
              <span className="sm:hidden">D</span>
              {sortBy === 'date' && (
                sortOrder === 'asc' ? <SortAsc className="ml-1 h-3 w-3" /> : <SortDesc className="ml-1 h-3 w-3" />
              )}
            </Button>
          </div>

          {/* View Mode Toggle */}
          <div className="flex items-center border border-gray-300 dark:border-gray-700 rounded-md p-1">
            <Button
              variant={viewMode === 'grid' ? 'default' : 'ghost'}
              size="icon"
              onClick={() => setViewMode('grid')}
              className={cn(
                "h-8 w-8",
                viewMode === 'grid'
                  ? "text-white dark:text-gray-200"
                  : "text-gray-600 dark:text-gray-400"
              )}
            >
              <Grid className="h-4 w-4" />
            </Button>

            <Button
              variant={viewMode === 'list' ? 'default' : 'ghost'}
              size="icon"
              onClick={() => setViewMode('list')}
              className={cn(
                "h-8 w-8",
                viewMode === 'list'
                  ? "text-white dark:text-gray-200"
                  : "text-gray-600 dark:text-gray-400"
              )}
            >
              <List className="h-4 w-4" />
            </Button>
          </div>

          
        </div>

        {/* Results Count */}
        <div className="flex items-center justify-between text-sm text-gray-600 dark:text-gray-300">
          <span>
            {filteredDocuments.length} document{filteredDocuments.length !== 1 ? 's' : ''} found
          </span>
        </div>
      </div>

      {/* Scrollable Document Grid/List Container */}
      <div className="flex-1 min-h-0 overflow-y-auto document-scroll-container custom-scrollbar">
        <AnimatePresence mode="wait">
          {filteredDocuments.length === 0 ? (
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="text-center py-12"
            >
              {/* --- Icon --- */}
              <div className="w-24 h-24 mx-auto mb-4 bg-gray-100 dark:bg-gray-800 rounded-full flex items-center justify-center">
                {activeFilter === "starred" ? (
                  <Star className="w-12 h-12 text-gray-400 dark:text-gray-500" />
                ) : activeFilter === "unselected" ? (
                  <FileText className="w-12 h-12 text-gray-400 dark:text-gray-500" />
                ) : (
                  <Search className="w-12 h-12 text-gray-400 dark:text-gray-500" />
                )}
              </div>

              {/* --- Title --- */}
              <h3 className="text-lg font-medium text-gray-900 dark:text-white mb-2">
                {activeFilter === "starred"
                  ? "No starred documents"
                  : activeFilter === "unselected"
                  ? "No unselected documents"
                  : "No documents found"}
              </h3>

              {/* --- Description --- */}
              <p className="text-gray-600 dark:text-gray-300 mb-6">
                {activeFilter === "starred"
                  ? "Star documents to see them here."
                  : activeFilter === "unselected"
                  ? "All your documents are currently selected for Q&A."
                  : searchQuery
                  ? "Try adjusting your search terms."
                  : "Upload your first document to get started."}
              </p>

              {/* --- Upload Button --- */}
              {activeFilter !== "starred" && activeFilter !== "unselected" && (
                <Button onClick={onUpload}>
                  <Upload className="mr-2 h-4 w-4" />
                  Upload Document
                </Button>
              )}
            </motion.div>
          ) : (
            <motion.div
              key={viewMode}
              variants={containerVariants}
              initial="hidden"
              animate="visible"
              className={cn(
                "pb-6 pt-2.5", // Add bottom padding for better scrolling and top margin (10px)
                viewMode === 'grid'
                  ? "grid grid-cols-1 gap-4 sm:gap-6"
                  : "space-y-3"
              )}
            >
              {filteredDocuments.map((document) => (
                <motion.div key={document.id} variants={itemVariants}>
                  <DocumentCard
                    document={document}
                    viewMode={viewMode}
                    onView={onView}
                    onEdit={onEdit}
                    onDelete={onDelete}
                    onDownload={onDownload}
                    onToggleStar={onToggleStar}
                    onToggleSelect={onToggleSelect}
                  />
                </motion.div>
              ))}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
};

export default DocumentGrid;
