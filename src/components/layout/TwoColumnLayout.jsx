'use client'
import { useState } from 'react';
import { motion } from 'framer-motion';
import { FileText, MessageCircle } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import ApiKeyRequiredModal from '@/components/modals/ApiKeyRequiredModal';
import { useApiKeyCheck } from '@/hooks/useApiKeyCheck';
import { cn } from '@/lib/utils';

const TwoColumnLayout = ({
  leftColumn,
  rightColumn,
  leftTitle = "Documents",
  rightTitle = "Chat",
  className
}) => {
  const [activeTab, setActiveTab] = useState('documents'); // For mobile view
  const { hasApiKey, isLoading, refreshApiKeyStatus } = useApiKeyCheck();

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
        <div className="lg:hidden mb-4">
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

      {/* Desktop Two-Column Layout */}
      <div className="hidden lg:flex h-full w-full space-x-6">
        {/* Left Column - Documents */}
        <motion.div
          initial={{ opacity: 0, x: -20 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.5 }}
          className="flex-1 min-w-0" // min-w-0 prevents flex item from overflowing
          style={{ flexBasis: '50%' }}
        >
          <div className="h-full">
            {leftColumn}
          </div>
        </motion.div>

        {/* Divider */}
        <div className="w-px bg-gray-200 dark:bg-gray-700 flex-shrink-0"></div>

        {/* Right Column - Chat */}
        <motion.div
          initial={{ opacity: 0, x: 20 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.5, delay: 0.1 }}
          className="flex-1 min-w-0"
          style={{ flexBasis: '50%' }}
        >
          <div className="h-full">
            {rightColumn}
          </div>
        </motion.div>
      </div>

      {/* Mobile Single Column Layout */}
      <div className="lg:hidden h-full">
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
    </div>
    </>
  );
};

export default TwoColumnLayout;
