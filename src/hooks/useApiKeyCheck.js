'use client'
import { useState, useEffect } from 'react';

export const useApiKeyCheck = () => {
  const [hasApiKey, setHasApiKey] = useState(null); // null = loading
  const [isLoading, setIsLoading] = useState(true);

  const checkApiKey = async () => {
    try {
      const res = await fetch("/api/settings/get-openai-key");

      if (!res.ok) {
        // Unauthorized or server error → treat as no key
        setHasApiKey(false);
        return;
      }

      const data = await res.json();

      const apiKey = data?.key;
      const hasValidKey =
        typeof apiKey === "string" &&
        apiKey.trim().length > 0;

      setHasApiKey(hasValidKey);

      console.log(
        "API Key check result:",
        hasValidKey ? "Found key" : "No key found"
      );
    } catch (error) {
      console.error("Failed to check API key:", error);
      setHasApiKey(false);
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
    refreshApiKeyStatus,
  };
};
