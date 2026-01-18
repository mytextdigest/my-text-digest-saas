'use client'
import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Key, CheckCircle2, XCircle, Loader2, Eye, EyeOff, ExternalLink, AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/Card';
import { cn } from '@/lib/utils';

const ApiKeyRequiredModal = ({ isOpen, onApiKeySet }) => {
  const [apiKey, setApiKey] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [isVerifying, setIsVerifying] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [verified, setVerified] = useState(false);
  const [status, setStatus] = useState(null);

  const handleVerifyApiKey = async () => {
    if (!apiKey.trim()) {
      setStatus({ type: 'error', message: 'Please enter an API key' });
      return;
    }

    setIsVerifying(true);
    setStatus({ type: 'loading', message: 'Verifying...' });
    
    try {
      const res = await fetch("/api/settings/verify-openai-key", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apiKey }),
      });
      
      const result = await res.json();

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
      const res = await fetch("/api/settings/save-openai-key", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apiKey }),
      });

      if (!res.ok) {
        throw new Error("Failed to save API key");
      }


      setStatus({ type: 'success', message: 'API key saved successfully!' });
      setTimeout(() => {
        onApiKeySet();
      }, 1000);
    } catch (error) {
      setStatus({ type: 'error', message: 'Failed to save API key' });
    } finally {
      setIsSaving(false);
    }
  };

  const handleKeyPress = (e) => {
    if (e.key === 'Enter' && !verified && apiKey.trim()) {
      handleVerifyApiKey();
    } else if (e.key === 'Enter' && verified) {
      handleSaveApiKey();
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 20 }}
        transition={{ type: "spring", stiffness: 300, damping: 30 }}
        className="w-full max-w-md mx-4"
      >
        <Card className="shadow-2xl border-0">
          <CardHeader className="text-center pb-6">
            <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-gradient-to-br from-red-500 to-orange-600 text-white shadow-lg">
              <AlertTriangle className="h-8 w-8" />
            </div>
            <CardTitle className="text-2xl">API Key Required</CardTitle>
            <CardDescription className="text-base mt-2">
              Please configure your OpenAI API key to continue using the application
            </CardDescription>
          </CardHeader>

          <CardContent className="space-y-6">
            {/* API Key Input */}
            <div className="space-y-2">
              <label className="text-sm font-medium text-gray-700 dark:text-gray-300 flex items-center space-x-2">
                <Key className="h-4 w-4" />
                <span>OpenAI API Key</span>
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
                  onKeyPress={handleKeyPress}
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
            <div className="flex gap-2 pt-2">
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
                  'Save & Continue'
                )}
              </Button>
            </div>

            {/* Warning Message */}
            <div className="p-3 bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg">
              <div className="flex items-start space-x-2">
                <AlertTriangle className="h-4 w-4 text-yellow-600 dark:text-yellow-400 mt-0.5 flex-shrink-0" />
                <div className="text-xs text-yellow-700 dark:text-yellow-300">
                  <p className="font-medium mb-1">Privacy Notice</p>
                  <p>Your API key is stored locally and never shared with external services except OpenAI for processing.</p>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      </motion.div>
    </div>
  );
};

export default ApiKeyRequiredModal;
