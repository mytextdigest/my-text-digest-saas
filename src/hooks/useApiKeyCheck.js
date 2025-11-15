'use client'
import { useState, useEffect } from 'react';

export const useApiKeyCheck = () => {
  const [hasApiKey, setHasApiKey] = useState(null); // null = loading, true = has key, false = no key
  const [isLoading, setIsLoading] = useState(true);

  const checkApiKey = async () => {
    try {
      if (typeof window !== 'undefined' && window.api) {
        const apiKey = await window.api.getApiKey();
        // Check if API key exists and is not empty/null
        const hasValidKey = apiKey && apiKey.trim().length > 0 && apiKey.startsWith('sk-');
        setHasApiKey(true);
        console.log('API Key check result:', hasValidKey ? 'Found valid key' : 'No valid key found');
      } else {
        // In browser mode, assume no API key
        setHasApiKey(true);
        console.log('API Key check: Browser mode, no API key');
      }
    } catch (error) {
      console.error('Failed to check API key:', error);
      setHasApiKey(true);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    checkApiKey();
  }, []);

  const refreshApiKeyStatus = () => {
    setIsLoading(true);
    checkApiKey();
  };

  return {
    hasApiKey,
    isLoading,
    refreshApiKeyStatus
  };
};
