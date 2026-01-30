'use client'
import { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Send, MessageCircle, Trash2, Bot, User, Square, Copy, CheckCircle2 } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { cn } from '@/lib/utils';
import DeleteConfirmationModal from '@/components/modals/DeleteConfirmationModal';

const ChatInterface = ({ className, projectId }) => {
  const [messages, setMessages] = useState([]);
  const [inputValue, setInputValue] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const [isClient, setIsClient] = useState(false);
  const [inputFocused, setInputFocused] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const messagesEndRef = useRef(null);
  const inputRef = useRef(null);
  const abortControllerRef = useRef(null);
  const currentRequestIdRef = useRef(null);
  const [isCancelling, setIsCancelling] = useState(false);
  const [copiedId, setCopiedId] = useState(null);


  // --- Fetch project messages on mount ---
  useEffect(() => {
    setIsClient(true);
    if (!projectId) return;
  
    async function loadMessages() {
      try {
        const res = await fetch(`/api/projects/messages/${projectId}`, {
          method: "GET",
          credentials: "include"
        }).then(r => r.json());
  
        if (res.success) {
          setMessages(
            res.messages.map(m => ({
              id: m.id,
              type: m.role === "user" ? "user" : "assistant",
              content: m.content,
              timestamp: new Date(m.timestamp)
            }))
          );
        }
      } catch (err) {
        console.error("Error loading project messages:", err);
      }
    }
  
    loadMessages();
  }, [projectId]);
  

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };
  useEffect(() => { scrollToBottom(); }, [messages]);

  // --- Send message ---
  const handleSendMessage = async (e) => {
    e.preventDefault();
    if (!inputValue.trim() || !projectId) return;
  
    const userMessage = {
      id: `user-${Date.now()}`,
      type: 'user',
      content: inputValue,
      timestamp: new Date()
    };
    setMessages(prev => [...prev, userMessage]);
  
    const question = inputValue;
    setInputValue('');
    setIsTyping(true);
  
    // 🟢 Create AbortController + requestId
    const controller = new AbortController();
    const requestId = `req-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    abortControllerRef.current = controller;
    currentRequestIdRef.current = requestId;
  
    try {
      const res = await fetch("/api/projects/ask", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({ projectId, question, requestId })
      }).then(r => r.json());
  
      // ⛔ Ignore stale / cancelled responses
      if (
        controller.signal.aborted ||
        currentRequestIdRef.current !== requestId
      ) {
        return;
      }
  
      if (res.success) {
        setMessages(prev => [
          ...prev,
          {
            id: `ai-${Date.now()}`,
            type: "assistant",
            content: res.answer,
            timestamp: new Date()
          }
        ]);
      } else if (!res.cancelled) {
        setMessages(prev => [
          ...prev,
          {
            id: `ai-${Date.now()}`,
            type: "assistant",
            content: res.error || "Failed to get response.",
            timestamp: new Date()
          }
        ]);
      }
    } catch (err) {
      if (err.name !== "AbortError") {
        setMessages(prev => [
          ...prev,
          {
            id: `ai-${Date.now()}`,
            type: "assistant",
            content: "Error contacting project chat API.",
            timestamp: new Date()
          }
        ]);
      }
    } finally {
      setIsTyping(false);
      setIsCancelling(false);
      abortControllerRef.current = null;
      currentRequestIdRef.current = null;
    }
  };


  // --- Cancle Request ---
  const handleCancelRequest = async () => {
    if (!currentRequestIdRef.current) return;
  
    setIsCancelling(true);
    setIsTyping(false);
  
    // Abort fetch immediately
    abortControllerRef.current?.abort();
  
    // Notify backend (best-effort)
    await fetch("/api/cancel", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ requestId: currentRequestIdRef.current })
    }).catch(() => {});
  
    currentRequestIdRef.current = null;
    abortControllerRef.current = null;
  };
  
  

  // --- Clear project chat ---
  const handleClearChat = () => {
    setShowDeleteModal(true);
  };

  const handleConfirmDelete = async () => {
    if (!projectId) return;
    setIsDeleting(true);
  
    try {
      const res = await fetch("/api/projects/clear", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId })
      }).then(r => r.json());
  
      if (res.success) {
        setMessages([]);
        setShowDeleteModal(false);
      }
    } catch (error) {
      console.error("Error clearing chat:", error);
    } finally {
      setIsDeleting(false);
    }
  };

  const handleCancelDelete = () => {
    setShowDeleteModal(false);
  };

  const formatTime = (timestamp) => {
    if (!isClient) return '';
    return timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  const copyToClipboard = async (text) => {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      return false;
    }
  };

  // Empty state component
  const EmptyState = () => (
    <div className="flex items-center justify-center h-full py-12">
      <div className="text-center">
        <MessageCircle className="w-12 h-12 text-gray-400 dark:text-gray-600 mx-auto mb-4" />
        <p className="text-gray-500 dark:text-gray-400 text-sm">No messages yet</p>
      </div>
    </div>
  );

  return (
    <Card className={cn(
      "chat-container overflow-hidden relative",
      "shadow-lg",
      "border border-gray-200 dark:border-gray-700",
      "bg-white dark:bg-gray-900",
      className
    )}>
      {/* Header */}
      <CardHeader className="border-b border-gray-200 dark:border-gray-700 flex-shrink-0 bg-gray-50 dark:bg-gray-800 flex items-center justify-between">

        <div className="flex justify-between items-center w-full">
          {/* Left Side - Project Chat Info */}
          <div className="flex items-center space-x-3">
            <div className="relative">
              <div className="w-10 h-10 bg-blue-500 rounded-lg flex items-center justify-center">
                <MessageCircle className="h-5 w-5 text-white" />
              </div>
              <div className="absolute -top-1 -right-1 w-3 h-3 bg-green-400 rounded-full border-2 border-white dark:border-gray-800"></div>
            </div>

            <div className="flex flex-col">
              <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
                Project Chat
              </h3>
              <p className="text-xs text-gray-500 dark:text-gray-400 font-normal">
                AI-powered project assistant
              </p>
            </div>
          </div>

          {/* Right Side - Delete Button */}
          <div className="relative">
            <motion.div whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }}>
              <Button
                variant="ghost"
                size="icon"
                onClick={handleClearChat}
                className="hover:bg-red-50 dark:hover:bg-red-900/20 text-gray-600 hover:text-red-600 dark:text-gray-400 dark:hover:text-red-400"
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </motion.div>
          </div>
        </div>

        {/* Left Side - Title and Subtitle */}
        {/* <div className="flex items-center space-x-3">
          <div className="relative">
            <div className="w-10 h-10 bg-blue-500 rounded-lg flex items-center justify-center">
              <MessageCircle className="h-5 w-5 text-white" />
            </div>
            <div className="absolute -top-1 -right-1 w-3 h-3 bg-green-400 rounded-full border-2 border-white dark:border-gray-800"></div>
          </div>
          <div className="flex flex-col items-center space-x-4">
            <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
              Project Chat
            </h3>
            <p className="text-xs text-gray-500 dark:text-gray-400 font-normal">
              AI-powered project assistant
            </p>
          </div>
        </div> */}

        {/* Right Side - Delete Button */}
        {/* <div className="relative">
          <motion.div whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }}>
            <Button
              variant="ghost"
              size="icon"
              onClick={handleClearChat}
              className="hover:bg-red-50 dark:hover:bg-red-900/20 text-gray-600 hover:text-red-600 dark:text-gray-400 dark:hover:text-red-400"
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </motion.div>
        </div> */}



      </CardHeader>

      <CardContent className="chat-card-content p-0">
        {/* Messages Area */}
        <div className="chat-messages-area chat-scrollbar relative">
          {messages.length === 0 ? (
            <EmptyState />
          ) : (
            <div className="p-4 space-y-6">
              <AnimatePresence>
                {messages.map((message) => (
                  <motion.div
                    key={message.id}
                    initial={{ opacity: 0, y: 20, scale: 0.95 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: -20, scale: 0.95 }}
                    transition={{ duration: 0.4, ease: "easeOut" }}
                    className={cn(
                      "flex items-start space-x-3",
                      message.type === 'user' ? 'flex-row-reverse space-x-reverse' : 'flex-row'
                    )}
                  >
                    {/* Avatar */}
                    <motion.div
                      initial={{ scale: 0 }}
                      animate={{ scale: 1 }}
                      transition={{ delay: 0.1 }}
                      className={cn(
                        "flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center shadow-md",
                        message.type === 'user'
                          ? 'bg-gradient-to-br from-blue-500 to-blue-600'
                          : 'bg-gradient-to-br from-purple-500 to-purple-600'
                      )}
                    >
                      {message.type === 'user' ? (
                        <User className="w-4 h-4 text-white" />
                      ) : (
                        <Bot className="w-4 h-4 text-white" />
                      )}
                    </motion.div>

                    {/* Message Bubble + Actions */}
                    <div
                      className={cn(
                        "flex flex-col",
                        message.type === "user" ? "items-end" : "items-start"
                      )}
                    >
                      {/* Bubble */}
                      <div
                        className={cn(
                          "rounded-2xl px-4 py-3",
                          message.type === "user"
                            ? "bg-blue-500 text-white"
                            : "bg-gray-100 dark:bg-gray-800 text-gray-900 dark:text-gray-100 border border-gray-200 dark:border-gray-700"
                        )}
                      >
                        <p className="whitespace-pre-wrap text-sm leading-relaxed break-words overflow-wrap-anywhere">
                          {message.content}
                        </p>
                      </div>

                      {/* Copy action (always visible, space reserved) */}
                      <div className="mt-1 h-7 flex items-center">
                        <button
                          onClick={async () => {
                            const success = await copyToClipboard(message.content);
                            if (success) {
                              setCopiedId(message.id);
                              setTimeout(() => setCopiedId(null), 1500);
                            }
                          }}
                          className={cn(
                            "flex items-center gap-1 text-xs px-2 py-1 rounded-md transition-colors",
                            message.type === "user"
                              ? "bg-blue-500/10 text-blue-100 hover:bg-blue-500/20"
                              : "bg-gray-200 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-300 dark:hover:bg-gray-600"
                          )}
                          aria-label="Copy message"
                        >
                          {copiedId === message.id ? (
                            <>
                              <CheckCircle2 className="w-3.5 h-3.5 text-green-500" />
                              <span>Copied</span>
                            </>
                          ) : (
                            <>
                              <Copy className="w-3.5 h-3.5" />
                              <span>Copy</span>
                            </>
                          )}
                        </button>
                      </div>
                    </div>





                  </motion.div>
                ))}
              </AnimatePresence>

              {/* Typing Indicator */}
              {isTyping && (
                <motion.div
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="flex items-start space-x-3"
                >
                  <div className="flex-shrink-0 w-8 h-8 rounded-full bg-purple-500 flex items-center justify-center">
                    <Bot className="w-4 h-4 text-white" />
                  </div>
                  <div className="bg-white dark:bg-gray-800 rounded-2xl px-4 py-3 shadow-md border border-gray-200 dark:border-gray-700">
                    <div className="flex space-x-1">
                      <motion.div
                        animate={{ y: [0, -4, 0] }}
                        transition={{ duration: 0.6, repeat: Infinity, delay: 0 }}
                        className="w-2 h-2 bg-purple-500 rounded-full"
                      />
                      <motion.div
                        animate={{ y: [0, -4, 0] }}
                        transition={{ duration: 0.6, repeat: Infinity, delay: 0.2 }}
                        className="w-2 h-2 bg-purple-500 rounded-full"
                      />
                      <motion.div
                        animate={{ y: [0, -4, 0] }}
                        transition={{ duration: 0.6, repeat: Infinity, delay: 0.4 }}
                        className="w-2 h-2 bg-purple-500 rounded-full"
                      />
                    </div>
                  </div>
                </motion.div>
              )}
              <div ref={messagesEndRef} />
            </div>
          )}
        </div>

        {/* Input Area */}
        <form
          onSubmit={handleSendMessage}
          className="p-4 border-t border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800"
        >
          <div className="relative">
            <div className={cn(
              "flex items-center space-x-3 p-3 rounded-lg",
              "bg-white dark:bg-gray-700",
              "border border-gray-200 dark:border-gray-600",
              "transition-all duration-300",
              inputFocused && "border-blue-400 dark:border-blue-500"
            )}>
              <Input
                ref={inputRef}
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                onFocus={() => setInputFocused(true)}
                onBlur={() => setInputFocused(false)}
                placeholder="Ask me anything about this project..."
                disabled={isTyping}
                className="flex-1 border-0 bg-transparent focus:ring-0 focus:outline-none text-gray-900 dark:text-gray-100 placeholder-gray-500 dark:placeholder-gray-400"
              />
              <motion.div
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
              >
                {isTyping ? (
                  <Button
                    type="button"
                    size="icon"
                    onClick={handleCancelRequest}
                    className="bg-gray-600 hover:bg-gray-700 text-white"
                  >
                    <Square className="h-4 w-4 fill-current" />
                  </Button>
                ) : (
                  <Button
                    type="submit"
                    size="icon"
                    disabled={!inputValue.trim()}
                    className="bg-blue-500 hover:bg-blue-600 text-white"
                  >
                    <Send className="h-4 w-4" />
                  </Button>
                )}
              </motion.div>
            </div>


          </div>
        </form>
      </CardContent>

      {/* Delete Confirmation Modal */}
      <DeleteConfirmationModal
        isOpen={showDeleteModal}
        onClose={handleCancelDelete}
        onConfirm={handleConfirmDelete}
        title="Clear Chat History"
        message="Are you sure you want to clear all chat messages? This action cannot be undone."
        confirmText="Clear Chat"
        cancelText="Cancel"
        isLoading={isDeleting}
      />
    </Card>
  );
};

export default ChatInterface;
