import { motion } from 'framer-motion';
import { 
  FileText, 
  Upload, 
  Star, 
  Trash2, 
  Folder,
  Calendar,
  Tag
} from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { cn } from '@/lib/utils';

const Sidebar = ({ 
  isOpen, 
  onToggle,
  activeFilter,
  onFilterChange,
  documentStats,
  className 
}) => {
  const menuItems = [
    {
      id: 'all',
      label: 'All Documents',
      icon: FileText,
      count: documentStats?.total || 0,
    },
    {
      id: 'recent',
      label: 'Recent',
      icon: Calendar,
      count: documentStats?.recent || 0,
    },
    {
      id: 'starred',
      label: 'Starred',
      icon: Star,
      count: documentStats?.starred || 0,
    },
  ];

  const fileTypes = [
    { id: 'pdf', label: 'PDF Files', count: documentStats?.pdf || 0 },
    { id: 'docx', label: 'Word Documents', count: documentStats?.docx || 0 },
    { id: 'txt', label: 'Text Files', count: documentStats?.txt || 0 },
  ];

  return (
    <>
      {/* Mobile Overlay */}
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-20 bg-black/50 lg:hidden"
          onClick={onToggle}
        />
      )}

      {/* Sidebar */}
      <motion.aside
        initial={{ x: -300 }}
        animate={{ x: isOpen ? 0 : -300 }}
        transition={{ type: "spring", stiffness: 300, damping: 30 }}
        className={cn(
          "fixed left-0 top-16 z-30 h-[calc(100vh-4rem)] w-64 border-r border-gray-200 bg-white",
          "dark:border-gray-800 dark:bg-gray-900",
          "lg:relative lg:top-0 lg:h-[calc(100vh-4rem)] lg:translate-x-0",
          className
        )}
      >
        <div className="flex h-full flex-col">
          {/* Quick Actions */}
          <div className="p-4 border-b border-gray-200 dark:border-gray-800">
            <Button className="w-full" size="sm">
              <Upload className="mr-2 h-4 w-4" />
              Upload Document
            </Button>
          </div>

          {/* Navigation */}
          <nav className="flex-1 overflow-y-auto p-4">
            <div className="space-y-1">
              <h3 className="px-2 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                Documents
              </h3>
              {menuItems.map((item) => {
                const Icon = item.icon;
                const isActive = activeFilter === item.id;
                
                return (
                  <motion.button
                    key={item.id}
                    onClick={() => onFilterChange(item.id)}
                    className={cn(
                      "w-full flex items-center justify-between px-3 py-2 text-sm rounded-lg transition-colors",
                      isActive
                        ? "bg-primary-100 text-primary-700 dark:bg-primary-900/50 dark:text-primary-300"
                        : "text-gray-700 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800"
                    )}
                    whileHover={{ scale: 1.02 }}
                    whileTap={{ scale: 0.98 }}
                  >
                    <div className="flex items-center">
                      <Icon className="mr-3 h-4 w-4" />
                      {item.label}
                    </div>
                    {item.count > 0 && (
                      <span className={cn(
                        "px-2 py-0.5 text-xs rounded-full",
                        isActive
                          ? "bg-primary-200 text-primary-800 dark:bg-primary-800 dark:text-primary-200"
                          : "bg-gray-200 text-gray-600 dark:bg-gray-700 dark:text-gray-400"
                      )}>
                        {item.count}
                      </span>
                    )}
                  </motion.button>
                );
              })}
            </div>

            {/* File Types */}
            <div className="mt-6 space-y-1">
              <h3 className="px-2 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                File Types
              </h3>
              {fileTypes.map((type) => (
                <motion.button
                  key={type.id}
                  onClick={() => onFilterChange(`type:${type.id}`)}
                  className="w-full flex items-center justify-between px-3 py-2 text-sm text-gray-700 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800 rounded-lg transition-colors"
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                >
                  <div className="flex items-center">
                    <Folder className="mr-3 h-4 w-4" />
                    {type.label}
                  </div>
                  {type.count > 0 && (
                    <span className="px-2 py-0.5 text-xs bg-gray-200 text-gray-600 dark:bg-gray-700 dark:text-gray-400 rounded-full">
                      {type.count}
                    </span>
                  )}
                </motion.button>
              ))}
            </div>
          </nav>

          {/* Footer */}
          <div className="p-4 border-t border-gray-200 dark:border-gray-800">
            <div className="flex items-center justify-between text-xs text-gray-500 dark:text-gray-400">
              <span>Storage Used</span>
              <span>2.4 GB / 10 GB</span>
            </div>
            <div className="mt-2 w-full bg-gray-200 dark:bg-gray-700 rounded-full h-1.5">
              <div className="bg-primary-600 h-1.5 rounded-full" style={{ width: '24%' }}></div>
            </div>
          </div>
        </div>
      </motion.aside>
    </>
  );
};

export default Sidebar;
