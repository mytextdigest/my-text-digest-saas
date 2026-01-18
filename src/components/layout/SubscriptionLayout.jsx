import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Menu } from 'lucide-react';
import Header from './Header';
import Sidebar from './Sidebar';
import { Button } from '@/components/ui/Button';
import { ToastProvider } from '@/components/ui/Toast';
import ApiKeyRequiredModal from '@/components/modals/ApiKeyRequiredModal';
import { useApiKeyCheck } from '@/hooks/useApiKeyCheck';
import { cn } from '@/lib/utils';

const SubscriptionLayout = ({ children, className }) => {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [searchValue, setSearchValue] = useState('');
  const [activeFilter, setActiveFilter] = useState('all');
  const { hasApiKey, isLoading, refreshApiKeyStatus } = useApiKeyCheck();

  // Initialize theme based on system preference only
  useEffect(() => {
    if (typeof window !== 'undefined') {
      // Clean up any old localStorage theme settings
      localStorage.removeItem('darkMode');

      const systemDarkMode = window.matchMedia('(prefers-color-scheme: dark)').matches;

      // Apply dark mode class to both html and body based on system preference
      const htmlElement = document.documentElement;
      const bodyElement = document.body;

      if (systemDarkMode) {
        htmlElement.classList.add('dark');
        htmlElement.classList.remove('light');
        bodyElement.classList.add('dark');
        bodyElement.classList.remove('light');
      } else {
        htmlElement.classList.remove('dark');
        htmlElement.classList.add('light');
        bodyElement.classList.remove('dark');
        bodyElement.classList.add('light');
      }

      // Listen for system theme changes
      const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
      const handleChange = (e) => {
        if (e.matches) {
          htmlElement.classList.add('dark');
          htmlElement.classList.remove('light');
          bodyElement.classList.add('dark');
          bodyElement.classList.remove('light');
        } else {
          htmlElement.classList.remove('dark');
          htmlElement.classList.add('light');
          bodyElement.classList.remove('dark');
          bodyElement.classList.add('light');
        }
      };

      mediaQuery.addEventListener('change', handleChange);

      // Cleanup listener on unmount
      return () => mediaQuery.removeEventListener('change', handleChange);
    }
  }, []);

  const toggleSidebar = () => {
    setSidebarOpen(!sidebarOpen);
  };

  const handleSearchChange = (e) => {
    setSearchValue(e.target.value);
  };

  const handleFilterChange = (filter) => {
    setActiveFilter(filter);
    // Close sidebar on mobile after selection
    if (window.innerWidth < 1024) {
      setSidebarOpen(false);
    }
  };

  // Mock document stats - replace with real data
  const documentStats = {
    total: 24,
    recent: 8,
    starred: 3,
    archived: 2,
    pdf: 12,
    docx: 8,
    txt: 4,
  };

  // Show loading screen while checking API key
//   if (isLoading) {
//     return (
//       <ToastProvider>
//         <div className="min-h-screen bg-gray-50 dark:bg-gray-900 flex items-center justify-center">
//           <div className="text-center">
//             <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600 mx-auto mb-4"></div>
//             <p className="text-gray-600 dark:text-gray-400">Loading...</p>
//           </div>
//         </div>
//       </ToastProvider>
//     );
//   }

  return (
    <ToastProvider>
      {/* API Key Required Modal */}
      {/* <ApiKeyRequiredModal
        isOpen={hasApiKey === false}
        onApiKeySet={refreshApiKeyStatus}
      /> */}

      <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
        {/* Header */}
        <Header
          onSearch={() => {}}
          searchValue={searchValue}
          onSearchChange={handleSearchChange}
        />

        <div className="flex">
          {/* Mobile Menu Button */}
          <Button
            variant="ghost"
            size="icon"
            className="fixed top-4 left-4 z-50 lg:hidden"
            onClick={toggleSidebar}
          >
            <Menu className="h-5 w-5" />
          </Button>

          {/* Sidebar - Hidden on desktop for centered layout */}
          <div className="lg:hidden">
            <Sidebar
              isOpen={sidebarOpen}
              onToggle={toggleSidebar}
              activeFilter={activeFilter}
              onFilterChange={handleFilterChange}
              documentStats={documentStats}
            />
          </div>

          {/* Main Content - Full width and centered */}
          <motion.main
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.3 }}
            className={cn(
              "w-full min-h-[calc(100vh-4rem)] flex justify-center",
              // hasApiKey === false && "pointer-events-none opacity-50", // Disable interaction when API key is missing
              className
            )}
            // className={cn(
            //   "w-full min-h-[calc(100vh-4rem)] flex justify-center",
            //   className
            // )}
          >
            <div className="w-full max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 h-full">
              {children}
            </div>
          </motion.main>
        </div>


      </div>
    </ToastProvider>
  );
};

export default SubscriptionLayout;
