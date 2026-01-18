'use client'
import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from 'framer-motion';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import {
  Key,
  CheckCircle2,
  XCircle,
  Loader2,
  Eye,
  EyeOff,
  Sparkles,
  Shield,
  Zap,
  ArrowRight,
  ExternalLink,
  Info
} from 'lucide-react';

export default function SetupPage() {
  const [apiKey, setApiKey] = useState("");
  const [status, setStatus] = useState(null);
  const [verified, setVerified] = useState(false);
  const [isVerifying, setIsVerifying] = useState(false);
  const [showKey, setShowKey] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const router = useRouter();

  const handleVerify = async () => {
    if (!apiKey.trim()) {
      setStatus({ type: 'error', message: 'Please enter an API key' });
      return;
    }

    setIsVerifying(true);
    setStatus({ type: 'loading', message: 'Verifying your API key...' });

    try {
      const res = await fetch("/api/settings/verify-openai-key", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apiKey }),
      });
  
      const result = await res.json();

      if (result.valid) {
        setVerified(true);
        setStatus({ type: 'success', message: 'API Key is valid and ready to use!' });
      } else {
        setVerified(false);
        setStatus({ type: 'error', message: result.error || 'Invalid API key. Please check and try again.' });
      }
    } catch (error) {
      setVerified(false);
      setStatus({ type: 'error', message: 'Failed to verify API key. Please try again.' });
    } finally {
      setIsVerifying(false);
    }
  };

  const handleSave = async () => {
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

      setStatus({
        type: "success",
        message: "API key saved successfully! Redirecting...",
      });

      setTimeout(() => {
        router.push("/dashboard");
      }, 1000);
    } catch {
      setStatus({
        type: "error",
        message: "Failed to save API key. Please try again.",
      });
      setIsSaving(false);
    }
  };


  const handleKeyPress = (e) => {
    if (e.key === 'Enter' && !verified && !isVerifying) {
      handleVerify();
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-primary-50 via-white to-blue-50 dark:from-gray-900 dark:via-gray-900 dark:to-gray-800 flex items-center justify-center p-4">
      {/* Background Decorations */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 0.1 }}
          transition={{ duration: 1 }}
          className="absolute top-0 left-0 w-96 h-96 bg-primary-500 rounded-full blur-3xl"
        />
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 0.1 }}
          transition={{ duration: 1, delay: 0.2 }}
          className="absolute bottom-0 right-0 w-96 h-96 bg-blue-500 rounded-full blur-3xl"
        />
      </div>

      {/* Main Content */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="w-full max-w-2xl relative z-10"
      >
        {/* Header Section */}
        <div className="text-center mb-8">
          <motion.div
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            transition={{ type: "spring", stiffness: 200, damping: 15 }}
            className="inline-flex items-center justify-center w-20 h-20 bg-gradient-to-br from-primary-600 to-blue-600 rounded-2xl shadow-lg mb-6"
          >
            <Key className="h-10 w-10 text-white" />
          </motion.div>

          <motion.h1
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 }}
            className="text-4xl font-bold text-gray-900 dark:text-gray-100 mb-3"
          >
            Welcome to My Text Digest
          </motion.h1>

          <motion.p
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3 }}
            className="text-lg text-gray-600 dark:text-gray-400"
          >
            Let's get started by setting up your OpenAI API key
          </motion.p>
        </div>

        {/* Main Card */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.4 }}
        >
          <Card className="shadow-2xl border-0">
            <CardHeader className="text-center pb-6">
              <CardTitle className="text-2xl">Setup OpenAI API Key</CardTitle>
              <CardDescription className="text-base mt-2">
                Your API key is stored and never shared
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
                    className="pr-12 text-base h-12"
                    disabled={isVerifying || isSaving}
                  />
                  <button
                    type="button"
                    onClick={() => setShowKey(!showKey)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 transition-colors"
                  >
                    {showKey ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
                  </button>
                </div>
                <p className="text-xs text-gray-500 dark:text-gray-400 flex items-start space-x-1">
                  <Info className="h-3 w-3 mt-0.5 flex-shrink-0" />
                  <span>
                    Don't have an API key?{' '}
                    <a
                      href="https://platform.openai.com/api-keys"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-primary-600 hover:text-primary-700 dark:text-primary-400 dark:hover:text-primary-300 inline-flex items-center space-x-1"
                    >
                      <span>Get one here</span>
                      <ExternalLink className="h-3 w-3" />
                    </a>
                  </span>
                </p>
              </div>

              {/* Status Message */}
              <AnimatePresence mode="wait">
                {status && (
                  <motion.div
                    initial={{ opacity: 0, y: -10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -10 }}
                    transition={{ duration: 0.3 }}
                    className={`p-4 rounded-lg flex items-center space-x-3 ${
                      status.type === 'success'
                        ? 'bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800'
                        : status.type === 'error'
                        ? 'bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800'
                        : 'bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800'
                    }`}
                  >
                    {status.type === 'success' && (
                      <CheckCircle2 className="h-5 w-5 text-green-600 dark:text-green-400 flex-shrink-0" />
                    )}
                    {status.type === 'error' && (
                      <XCircle className="h-5 w-5 text-red-600 dark:text-red-400 flex-shrink-0" />
                    )}
                    {status.type === 'loading' && (
                      <Loader2 className="h-5 w-5 text-blue-600 dark:text-blue-400 animate-spin flex-shrink-0" />
                    )}
                    <p className={`text-sm font-medium ${
                      status.type === 'success'
                        ? 'text-green-800 dark:text-green-200'
                        : status.type === 'error'
                        ? 'text-red-800 dark:text-red-200'
                        : 'text-blue-800 dark:text-blue-200'
                    }`}>
                      {status.message}
                    </p>
                  </motion.div>
                )}
              </AnimatePresence>

              {/* Action Buttons */}
              <div className="flex flex-col sm:flex-row gap-3 pt-4">
                <Button
                  onClick={handleVerify}
                  disabled={!apiKey.trim() || isVerifying || verified || isSaving}
                  className="flex-1 h-12 text-base font-medium"
                  variant={verified ? "outline" : "default"}
                >
                  {isVerifying ? (
                    <>
                      <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                      Verifying...
                    </>
                  ) : verified ? (
                    <>
                      <CheckCircle2 className="mr-2 h-5 w-5" />
                      Verified
                    </>
                  ) : (
                    <>
                      <Shield className="mr-2 h-5 w-5" />
                      Verify Key
                    </>
                  )}
                </Button>

                <Button
                  onClick={handleSave}
                  disabled={!verified || isSaving}
                  className="flex-1 h-12 text-base font-medium bg-gradient-to-r from-primary-600 to-blue-600 hover:from-primary-700 hover:to-blue-700"
                >
                  {isSaving ? (
                    <>
                      <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                      Saving...
                    </>
                  ) : (
                    <>
                      Save & Continue
                      <ArrowRight className="ml-2 h-5 w-5" />
                    </>
                  )}
                </Button>
              </div>

              {/* Features Section */}
              <div className="pt-6 border-t border-gray-200 dark:border-gray-700">
                <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100 mb-4">
                  What you'll get:
                </h3>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <motion.div
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.5 }}
                    className="flex items-start space-x-3"
                  >
                    <div className="flex-shrink-0 w-8 h-8 bg-primary-100 dark:bg-primary-900/30 rounded-lg flex items-center justify-center">
                      <Sparkles className="h-4 w-4 text-primary-600 dark:text-primary-400" />
                    </div>
                    <div>
                      <h4 className="text-sm font-medium text-gray-900 dark:text-gray-100">AI Summaries</h4>
                      <p className="text-xs text-gray-600 dark:text-gray-400 mt-1">
                        Instant document summaries
                      </p>
                    </div>
                  </motion.div>

                  <motion.div
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.6 }}
                    className="flex items-start space-x-3"
                  >
                    <div className="flex-shrink-0 w-8 h-8 bg-blue-100 dark:bg-blue-900/30 rounded-lg flex items-center justify-center">
                      <Zap className="h-4 w-4 text-blue-600 dark:text-blue-400" />
                    </div>
                    <div>
                      <h4 className="text-sm font-medium text-gray-900 dark:text-gray-100">Smart Chat</h4>
                      <p className="text-xs text-gray-600 dark:text-gray-400 mt-1">
                        Ask questions about docs
                      </p>
                    </div>
                  </motion.div>

                  <motion.div
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.7 }}
                    className="flex items-start space-x-3"
                  >
                    <div className="flex-shrink-0 w-8 h-8 bg-green-100 dark:bg-green-900/30 rounded-lg flex items-center justify-center">
                      <Shield className="h-4 w-4 text-green-600 dark:text-green-400" />
                    </div>
                    <div>
                      <h4 className="text-sm font-medium text-gray-900 dark:text-gray-100">Privacy First</h4>
                      <p className="text-xs text-gray-600 dark:text-gray-400 mt-1">
                        Local storage & processing
                      </p>
                    </div>
                  </motion.div>
                </div>
              </div>
            </CardContent>
          </Card>
        </motion.div>

        {/* Footer Info */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.8 }}
          className="mt-8 text-center"
        >
          <p className="text-sm text-gray-600 dark:text-gray-400">
          Your API key is securely stored and used only to make requests on your behalf.
            <br />
            {/* We never share your key with third parties. */}

          </p>
        </motion.div>
      </motion.div>
    </div>
  );
}
