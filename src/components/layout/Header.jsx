import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { FileText, Search, Settings, X, Key, CheckCircle2, XCircle, Loader2, Eye, EyeOff, ExternalLink } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { cn } from '@/lib/utils';
import LogoutButton from '../ui/LogoutButton';

const Header = ({
  onSearch,
  searchValue,
  onSearchChange,
  className
}) => {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [isClient, setIsClient] = useState(false);
  const [activeTab, setActiveTab] = useState('general'); // 'general' or 'apikey'
  const [apiKey, setApiKey] = useState('');
  const [currentApiKey, setCurrentApiKey] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [isVerifying, setIsVerifying] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [verified, setVerified] = useState(false);
  const [status, setStatus] = useState(null);

  useEffect(() => {
    setIsClient(true);
    loadApiKey();
  }, []);

  const loadApiKey = async () => {
    if (typeof window !== 'undefined' && window.api) {
      const key = await window.api.getApiKey();
      if (key) {
        setCurrentApiKey(key);
        setApiKey(key);
      }
    }
  };

  const handleVerifyApiKey = async () => {
    if (!apiKey.trim()) {
      setStatus({ type: 'error', message: 'Please enter an API key' });
      return;
    }

    setIsVerifying(true);
    setStatus({ type: 'loading', message: 'Verifying...' });

    try {
      const result = await window.api.verifyApiKey(apiKey);
      if (result.valid) {
        setVerified(true);
        setStatus({ type: 'success', message: 'API Key is valid!' });
      } else {
        setVerified(false);
        setStatus({ type: 'error', message: result.error || 'Invalid API key' });
      }
    } catch (error) {
      setVerified(false);
      setStatus({ type: 'error', message: 'Failed to verify API key' });
    } finally {
      setIsVerifying(false);
    }
  };

  const handleSaveApiKey = async () => {
    if (!verified) return;

    setIsSaving(true);
    try {
      await window.api.saveApiKey(apiKey);
      setCurrentApiKey(apiKey);
      setStatus({ type: 'success', message: 'API key saved successfully!' });
      setTimeout(() => {
        setStatus(null);
        setVerified(false);
      }, 2000);
    } catch (error) {
      setStatus({ type: 'error', message: 'Failed to save API key' });
    } finally {
      setIsSaving(false);
    }
  };

  const handleRemoveApiKey = async () => {
    setIsSaving(true);
    try {
      await window.api.saveApiKey(''); // Save empty string to remove
      setCurrentApiKey('');
      setApiKey('');
      setVerified(false);
      setStatus({ type: 'success', message: 'API key removed successfully!' });
      setTimeout(() => {
        setStatus(null);
      }, 2000);
    } catch (error) {
      setStatus({ type: 'error', message: 'Failed to remove API key' });
    } finally {
      setIsSaving(false);
    }
  };

  // Check if API key has been changed
  const hasApiKeyChanged = apiKey !== currentApiKey;
  const isApiKeyEmpty = !apiKey.trim();
  const hasCurrentApiKey = currentApiKey && currentApiKey.trim().length > 0;
  return (
    <motion.header
      initial={{ y: -100, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      transition={{ type: "spring", stiffness: 300, damping: 30 }}
      className={cn(
        "sticky top-0 z-40 w-full border-b border-gray-200 bg-white/80 backdrop-blur-md",
        "dark:border-gray-800 dark:bg-gray-900/80",
        className
      )}
    >
      <div className="container mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex h-16 items-center justify-between">
          {/* Logo and Title */}
          <motion.div 
            className="flex items-center space-x-3"
            whileHover={{ scale: 1.02 }}
            transition={{ type: "spring", stiffness: 400, damping: 17 }}
          >
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary-600 text-white shadow-md">
              <FileText className="h-6 w-6" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-gray-900 dark:text-gray-100">
                My Text Digest
              </h1>
              <p className="text-xs text-gray-600 dark:text-gray-400">
                Document Management System
              </p>
            </div>
          </motion.div>

          {/* Actions */}
          <div className="flex items-center space-x-2">

            <Button
              variant="ghost"
              size="icon"
              onClick={() => setSettingsOpen(!settingsOpen)}
              className="hidden sm:flex text-gray-600 hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-100 hover:bg-gray-100 dark:hover:bg-gray-800"
            >
              <Settings className="h-5 w-5 text-gray-600 hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-100" />
            </Button>
          </div>
        </div>
      </div>

      {/* Settings Panel */}
      <AnimatePresence>
        {settingsOpen && (
          <>
            {/* Backdrop */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 bg-black/20 backdrop-blur-sm z-40"
              onClick={() => setSettingsOpen(false)}
            />

            {/* Settings Panel */}
            <motion.div
              initial={{ opacity: 0, y: -20, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -20, scale: 0.95 }}
              transition={{ type: "spring", stiffness: 300, damping: 30 }}
              className="fixed top-20 right-4 z-50 w-80"
            >
              <Card className="shadow-xl border border-gray-200 dark:border-gray-700">
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-lg font-semibold">Settings</CardTitle>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => setSettingsOpen(false)}
                    className="h-6 w-6"
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </CardHeader>
                <CardContent className="space-y-4">
                  {/* Tabs */}
                  <div className="flex space-x-1 border-b border-gray-200 dark:border-gray-700 -mx-6 px-6">
                    <button
                      onClick={() => {
                        setActiveTab('general');
                        setStatus(null);
                        setVerified(false);
                      }}
                      className={cn(
                        "px-4 py-2 text-sm font-medium border-b-2 transition-colors",
                        activeTab === 'general'
                          ? "border-primary-600 text-primary-600 dark:text-primary-400"
                          : "border-transparent text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100"
                      )}
                    >
                      General
                    </button>
                    {/* <button
                      onClick={() => {
                        setActiveTab('apikey');
                        setStatus(null);
                        setVerified(false);
                        setApiKey(currentApiKey);
                      }}
                      className={cn(
                        "px-4 py-2 text-sm font-medium border-b-2 transition-colors flex items-center space-x-1",
                        activeTab === 'apikey'
                          ? "border-primary-600 text-primary-600 dark:text-primary-400"
                          : "border-transparent text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100"
                      )}
                    >
                      <Key className="h-3.5 w-3.5" />
                      <span>API Key</span>
                    </button> */}
                  </div>

                  {/* General Tab */}
                  {activeTab === 'general' && (
                    <motion.div
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: 0.2 }}
                      className="space-y-4"
                    >
                      {/* Theme Info */}
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="font-medium text-gray-900 dark:text-gray-100">Theme</p>
                          <p className="text-sm text-gray-600 dark:text-gray-400">
                            Follows your system preference
                          </p>
                        </div>
                        <div className="px-3 py-1 bg-gray-100 dark:bg-gray-700 rounded-md">
                          <span className="text-sm text-gray-600 dark:text-gray-300">Auto</span>
                        </div>
                      </div>

                      {/* Additional Settings */}
                      <div className="border-t border-gray-200 dark:border-gray-700">
                        {/* <p className="text-sm text-gray-600 dark:text-gray-400">
                          More settings coming soon...
                        </p> */}
                        {/* Logout Button */}
                        <LogoutButton />
                      </div>

                    </motion.div>
                  )}

                  {/* API Key Tab */}
                  {/* {activeTab === 'apikey' && ( */}
                  {activeTab === '' && (
                    <motion.div
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: 0.2 }}
                      className="space-y-4"
                    >
                      {/* Current API Key Status */}
                      {currentApiKey && (
                        <div className="p-3 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg">
                          <div className="flex items-center space-x-2">
                            <CheckCircle2 className="h-4 w-4 text-green-600 dark:text-green-400" />
                            <p className="text-sm font-medium text-green-800 dark:text-green-200">
                              API Key is configured
                            </p>
                          </div>
                        </div>
                      )}

                      {/* API Key Input */}
                      <div className="space-y-2">
                        <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
                          OpenAI API Key
                        </label>
                        <div className="relative">
                          <Input
                            type={showKey ? "text" : "password"}
                            value={apiKey}
                            onChange={(e) => {
                              setApiKey(e.target.value);
                              setVerified(false);
                              setStatus(null);
                            }}
                            placeholder="sk-..."
                            className="pr-10"
                            disabled={isVerifying || isSaving}
                          />
                          <button
                            type="button"
                            onClick={() => setShowKey(!showKey)}
                            className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
                          >
                            {showKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                          </button>
                        </div>
                        <p className="text-xs text-gray-500 dark:text-gray-400">
                          <a
                            href="https://platform.openai.com/api-keys"
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-primary-600 hover:text-primary-700 dark:text-primary-400 inline-flex items-center space-x-1"
                          >
                            <span>Get your API key</span>
                            <ExternalLink className="h-3 w-3" />
                          </a>
                        </p>
                      </div>

                      {/* Status Message */}
                      <AnimatePresence mode="wait">
                        {status && (
                          <motion.div
                            initial={{ opacity: 0, y: -10 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, y: -10 }}
                            className={cn(
                              "p-3 rounded-lg flex items-center space-x-2 text-sm",
                              status.type === 'success' && "bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 text-green-800 dark:text-green-200",
                              status.type === 'error' && "bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-800 dark:text-red-200",
                              status.type === 'loading' && "bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 text-blue-800 dark:text-blue-200"
                            )}
                          >
                            {status.type === 'success' && <CheckCircle2 className="h-4 w-4 flex-shrink-0" />}
                            {status.type === 'error' && <XCircle className="h-4 w-4 flex-shrink-0" />}
                            {status.type === 'loading' && <Loader2 className="h-4 w-4 animate-spin flex-shrink-0" />}
                            <span>{status.message}</span>
                          </motion.div>
                        )}
                      </AnimatePresence>

                      {/* Action Buttons */}
                      <div className="space-y-2 pt-2">
                        {/* Verify and Save buttons for new/changed API keys */}
                        {(hasApiKeyChanged && !isApiKeyEmpty) && (
                          <div className="flex gap-2">
                            <Button
                              onClick={handleVerifyApiKey}
                              disabled={!apiKey.trim() || isVerifying || verified || isSaving}
                              variant={verified ? "outline" : "default"}
                              size="sm"
                              className="flex-1"
                            >
                              {isVerifying ? (
                                <>
                                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                  Verifying...
                                </>
                              ) : verified ? (
                                <>
                                  <CheckCircle2 className="mr-2 h-4 w-4" />
                                  Verified
                                </>
                              ) : (
                                'Verify'
                              )}
                            </Button>

                            <Button
                              onClick={handleSaveApiKey}
                              disabled={!verified || isSaving}
                              size="sm"
                              className="flex-1"
                            >
                              {isSaving ? (
                                <>
                                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                  Saving...
                                </>
                              ) : (
                                'Save Changes'
                              )}
                            </Button>
                          </div>
                        )}

                        {/* Remove button for existing API key */}
                        {hasCurrentApiKey && !hasApiKeyChanged && (
                          <div className="flex gap-2">
                            <Button
                              onClick={() => {
                                setApiKey('');
                                setVerified(false);
                                setStatus(null);
                              }}
                              variant="outline"
                              size="sm"
                              className="flex-1"
                              disabled={isSaving}
                            >
                              Clear API Key
                            </Button>
                          </div>
                        )}

                        {/* Save removal when API key is cleared */}
                        {hasCurrentApiKey && isApiKeyEmpty && hasApiKeyChanged && (
                          <div className="flex gap-2">
                            <Button
                              onClick={() => {
                                setApiKey(currentApiKey);
                                setVerified(false);
                                setStatus(null);
                              }}
                              variant="outline"
                              size="sm"
                              className="flex-1"
                              disabled={isSaving}
                            >
                              Cancel
                            </Button>
                            <Button
                              onClick={handleRemoveApiKey}
                              variant="destructive"
                              size="sm"
                              className="flex-1"
                              disabled={isSaving}
                            >
                              {isSaving ? (
                                <>
                                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                  Removing...
                                </>
                              ) : (
                                'Remove API Key'
                              )}
                            </Button>
                          </div>
                        )}

                        {/* Initial setup buttons for new users */}
                        {!hasCurrentApiKey && !hasApiKeyChanged && (
                          <div className="p-3 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg">
                            <p className="text-sm text-blue-800 dark:text-blue-200">
                              Enter your OpenAI API key above to get started.
                            </p>
                          </div>
                        )}
                      </div>
                    </motion.div>
                  )}
                </CardContent>
              </Card>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </motion.header>
  );
};

export default Header;
