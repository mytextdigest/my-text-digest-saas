"use client";
import { useEffect, useState, useRef, Suspense } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { AnimatePresence, motion } from 'framer-motion';
import Layout from '@/components/layout/Layout';
import TwoColumnLayout from '@/components/layout/TwoColumnLayout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { ArrowLeft, Send, FileText, MessageCircle, AlertCircle, BarChart3, Clock, FileType, Calendar, Square, Trash2, CheckCircle2, Copy } from 'lucide-react';
import mammoth from "mammoth";
import ClearChatDialog from "@/components/documents/ClearChatDialog";
import { cn } from '@/lib/utils';
import DocViewer, { DocViewerRenderers } from "react-doc-viewer";
import MessageActions from "@/components/chat/MessageActions";
import ExpandedMessageModal from "@/components/chat/ExpandedMessageModal";



function DocumentContent() {
  const searchParams = useSearchParams();
  const router = useRouter();

  const id = searchParams.get('id');


  const [doc, setDoc] = useState(null);
  const [chat, setChat] = useState([]);
  const [question, setQuestion] = useState("");
  const [isTyping, setIsTyping] = useState(false);
  const [activeTab, setActiveTab] = useState('chat'); // 'chat' or 'summary'
  const [summary, setSummary] = useState(null);
  const [isGeneratingSummary, setIsGeneratingSummary] = useState(false);
  const chatEndRef = useRef(null);
  const inputRef = useRef(null);

  const [docxHtml, setDocxHtml] = useState(null);
  const [conversationId, setConversationId] = useState(null);
  const [showClearDialog, setShowClearDialog] = useState(false);

  const abortControllerRef = useRef(null);
  const currentRequestIdRef = useRef(null);
  const [isCancelling, setIsCancelling] = useState(false);
  const [copiedId, setCopiedId] = useState(null);

  const [expandedMessage, setExpandedMessage] = useState(null);

  const openExpanded = (message) => {
    setExpandedMessage(message);
  };
  
  const closeExpanded = () => {
    setExpandedMessage(null);
  };





  useEffect(() => {
    if (!id) {
      router.push('/');
    }
  }, [id, router]);

  const getS3Url = (filePath) => {
    if (!filePath) return null;
    return `${process.env.NEXT_PUBLIC_S3_PUBLIC_URL}/${filePath}`;
  };



  // Load document
  useEffect(() => {
    if (!id) return;
  
    const loadDoc = async () => {
      try {
        const data = await fetch(`/api/documents/${id}`, {
          method: "GET",
          credentials: "include",
        }).then(r => r.json());
  
        console.log("📄 Loaded document:", data);
  
        // // Attach S3 URL so UI can load file
        // if (data?.filePath) {
        //   data.fileUrl = getS3Url(data.filePath);
        // }
  
        setDoc(data);
  
      } catch (error) {
        console.error("Error loading document:", error);
      }
    };
  
    loadDoc();
  }, [id]);

  // Extract DOCX -> HTML
  useEffect(() => {
    if (doc?.filename?.endsWith(".docx") && doc?.fileUrl) {
      fetch(doc.fileUrl)
        .then(res => res.arrayBuffer())
        .then(buffer => mammoth.convertToHtml({ arrayBuffer: buffer }))
        .then(result => setDocxHtml(result.value))
        .catch(err => console.error("DOCX render error:", err));
    }
  }, [doc]);

  // Initialize chat with welcome message
  useEffect(() => {
    if (doc) {
      setChat([
        {
          id: `system-${Date.now()}`, // Use unique timestamp-based ID
          role: 'system',
          content: `Welcome! You can now chat about "${doc.filename}". Ask questions about the document content and I'll help you understand it better.`,
          timestamp: new Date()
        }
      ]);
    }

    if (doc && doc.summary) {
      let parsedSummary;
      try {
        parsedSummary = JSON.parse(doc.summary);
      } catch {
        parsedSummary = { overview: doc.summary, keyPoints: [] };
      }

      setSummary({
        title: doc.filename,
        overview: parsedSummary.overview,
        keyPoints: parsedSummary.keyPoints || [],
        wordCount: doc.content ? doc.content.split(" ").length : "N/A",
        estimatedReadTime: doc.content ? Math.ceil(doc.content.split(" ").length / 200) : "N/A",
        documentType: doc.filename.split(".").pop().toUpperCase(),
        lastModified: new Date().toLocaleDateString(),
      });
    }

  }, [doc]);

  useEffect(() => {
    let interval = null;
  
    const pollSummary = async () => {
      try {
        const data = await fetch(`/api/documents/${id}`, {
          method: "GET",
          credentials: "include"
        }).then(r => r.json());
  
        setDoc(data);
  
        if (data?.summary) {
          let parsed;
          try {
            parsed = JSON.parse(data.summary);
          } catch {
            parsed = { overview: data.summary, keyPoints: [] };
          }
  
          setSummary({
            title: data.filename,
            overview: parsed.overview,
            keyPoints: parsed.keyPoints || [],
            wordCount: data.content ? data.content.split(" ").length : "N/A",
            estimatedReadTime: data.content ? Math.ceil(data.content.split(" ").length / 200) : "N/A",
            documentType: data.filename.split(".").pop().toUpperCase(),
            lastModified: new Date(data.created_at).toLocaleDateString(),
          });
  
          clearInterval(interval);
        }
      } catch (err) {
        console.error("Error polling summary:", err);
      }
    };
  
    if (doc && !doc.summary) {
      interval = setInterval(pollSummary, 3000);
    }
  
    return () => clearInterval(interval);
  }, [id, doc]);


  useEffect(() => {
    if (!doc) return;
  
    (async () => {
      try {
        // start / reuse conversation

        const startConvDocId = doc.id
        const res = await fetch(`/api/documents/${startConvDocId}/start-conversation`, {
          method: "POST",
          credentials: "include",
        }).then(r => r.json());
  
        if (res?.success) {
          setConversationId(res.conversationId);

          const convId = res.conversationId
  
          // load previous messages
          const msgsRes = await fetch(`/api/documents/messages/${convId}`, {
            method: "GET",
            credentials: "include"
          }).then(r => r.json());
  
          if (msgsRes?.success) {
            const mapped = msgsRes.messages.map((m) => ({
              id: m.id,
              role: m.role,
              content: m.content,
              timestamp: new Date(m.createdAt || m.created_at)
            }));
  
            // preserve system welcome message
            setChat((prev) => {
              const systemMsg = prev.find((p) => p.role === "system") || null;
              return systemMsg ? [systemMsg, ...mapped] : mapped;
            });
          }
        }
      } catch (e) {
        console.error("Failed to start/load conversation:", e);
      }
    })();
  }, [doc]);

  // regenerate document summary
  // Generate summary when user clicks "Regenerate summary"
  const generateSummary = async () => {
    if (!doc) return;

    setIsGeneratingSummary(true);

    try {

      const docId = doc.id 
      const res = await fetch(`/api/documents/${docId}/regenerate`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" }
      }).then(r => r.json());

      if (!res?.success) {
        throw new Error(res?.error || "Failed to queue regenerate summary");
      }

      // Immediately re-fetch the doc once to get updated status
      const fresh = await fetch(`/api/documents/${doc.id}`, {
        method: "GET",
        credentials: "include"
      }).then(r => r.json());

      // if (fresh?.filePath) fresh.fileUrl = getS3Url(fresh.filePath);
      setDoc(fresh);

      // If summary already present (rare), update UI immediately
      if (fresh?.summary) {
        let parsedSummary;
        try {
          parsedSummary = JSON.parse(fresh.summary);
        } catch {
          parsedSummary = { overview: fresh.summary, keyPoints: [] };
        }

        setSummary({
          title: fresh.filename,
          overview: parsedSummary.overview,
          keyPoints: parsedSummary.keyPoints || [],
          wordCount: fresh.content ? fresh.content.split(" ").length : "N/A",
          estimatedReadTime: fresh.content ? Math.ceil(fresh.content.split(" ").length / 200) : "N/A",
          documentType: fresh.filename.split(".").pop().toUpperCase(),
          lastModified: new Date().toLocaleDateString(),
        });

        setIsGeneratingSummary(false);
        return;
      }

      // Otherwise poll until summary appears or timeout
      const pollIntervalMs = 3000;
      const maxPollSeconds = 120; // 2 minutes
      const start = Date.now();
      let summaryFound = false;

      while ((Date.now() - start) / 1000 < maxPollSeconds) {
        await new Promise((r) => setTimeout(r, pollIntervalMs));

        const polled = await fetch(`/api/documents/${doc.id}`, {
          method: "GET",
          credentials: "include"
        }).then(r => r.json());

        // if (polled?.filePath) polled.fileUrl = getS3Url(polled.filePath);
        setDoc(polled);

        if (polled?.summary) {
          let parsedSummary;
          try {
            parsedSummary = JSON.parse(polled.summary);
          } catch {
            parsedSummary = { overview: polled.summary, keyPoints: [] };
          }

          setSummary({
            title: polled.filename,
            overview: parsedSummary.overview,
            keyPoints: parsedSummary.keyPoints || [],
            wordCount: polled.content ? polled.content.split(" ").length : "N/A",
            estimatedReadTime: polled.content ? Math.ceil(polled.content.split(" ").length / 200) : "N/A",
            documentType: polled.filename.split(".").pop().toUpperCase(),
            lastModified: new Date().toLocaleDateString(),
          });

          summaryFound = true;
          break;
        }
      }

      if (!summaryFound) {
        // timed out
        setSummary({
          title: doc.filename,
          overview: "Summary generation is still in progress. Please check back in a few moments.",
          keyPoints: [],
          wordCount: doc.content ? doc.content.split(" ").length : "N/A",
          estimatedReadTime: doc.content ? Math.ceil(doc.content.split(" ").length / 200) : "N/A",
          documentType: doc.filename.split(".").pop().toUpperCase(),
          lastModified: new Date().toLocaleDateString(),
        });
      }
    } catch (error) {
      console.error("Error generating summary:", error);
      setSummary({
        title: doc.filename,
        overview: "Unable to regenerate summary at this time. Please try again later.",
        keyPoints: [],
        wordCount: "N/A",
        estimatedReadTime: "N/A",
        documentType: doc.filename.split(".").pop().toUpperCase(),
        lastModified: new Date().toLocaleDateString(),
      });
    } finally {
      setIsGeneratingSummary(false);
    }
  };


  // Generate summary when switching to summary tab
  useEffect(() => {
    if (
      activeTab === "summary" &&
      doc &&
      !summary &&
      doc.status === "ready" &&
      !isGeneratingSummary
    ) {
      fetch(`/api/documents/${id}`, {
        method: "GET",
        credentials: "include"
      })
        .then(r => r.json())
        .then(data => {
          // if (data?.filePath) data.fileUrl = getS3Url(data.filePath);
          setDoc(data);
        });
    }
  }, [activeTab, doc, summary, isGeneratingSummary, id]);


  //  --- Asking document queries ----
  const handleAsk = async (e) => {
    e.preventDefault();
    if (!question.trim()) return;
  
    const userMessage = {
      id: `user-${Date.now()}-${Math.random()}`,
      role: "user",
      content: question,
      timestamp: new Date()
    };
    setChat(prev => [...prev, userMessage]);
    setQuestion("");
    setIsTyping(true);
  
    const controller = new AbortController();
    const requestId = `req-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  
    abortControllerRef.current = controller;
    currentRequestIdRef.current = requestId;
  
    try {
      const res = await fetch(`/api/documents/${id}/ask`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          question,
          conversationId,
          requestId
        })
      }).then(r => r.json());
  
      // ignore cancelled / stale responses
      if (
        controller.signal.aborted ||
        currentRequestIdRef.current !== requestId
      ) {
        return;
      }
  
      if (res?.success) {
        setChat(prev => [
          ...prev,
          {
            id: `assistant-${Date.now()}-${Math.random()}`,
            role: "assistant",
            content: res.answer,
            timestamp: new Date()
          }
        ]);
  
        if (res.conversationId && res.conversationId !== conversationId) {
          setConversationId(res.conversationId);
        }
      } else if (!res?.cancelled) {
        setChat(prev => [
          ...prev,
          {
            id: Date.now(),
            role: "assistant",
            content: `Sorry, I couldn't answer right now: ${res?.error || "unknown error"}`,
            timestamp: new Date()
          }
        ]);
      }
    } catch (err) {
      if (err.name !== "AbortError") {
        setChat(prev => [
          ...prev,
          {
            id: Date.now(),
            role: "assistant",
            content: "Sorry, I encountered an error while processing your question.",
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

  const handleCancelRequest = async () => {
    if (!currentRequestIdRef.current) return;
  
    setIsCancelling(true);
    setIsTyping(false);
  
    abortControllerRef.current?.abort();
  
    await fetch("/api/cancel", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        requestId: currentRequestIdRef.current
      })
    }).catch(() => {});
  
    abortControllerRef.current = null;
    currentRequestIdRef.current = null;
  };
  



  const onConfirmClearChat = async () => {
    try {
      const res = await fetch(`/api/documents/${doc.id}/clear-conversation`, {
        method: "POST",
        credentials: "include"
      }).then(r => r.json());
  
      if (res?.success) {
        setConversationId(res.conversationId);
  
        setIsTyping(false);
        setQuestion("");
  
        setChat([
          {
            id: 1,
            role: "system",
            content: `Welcome! You can now chat about "${doc.filename}". Ask questions about the document content and I'll help you understand it better.`,
            timestamp: new Date(),
          },
        ]);
  
        setTimeout(() => {
          inputRef.current?.focus();
        }, 0);
      }
    } catch (e) {
      console.error("Failed to clear chat:", e);
    } finally {
      setShowClearDialog(false);
    }
  };
  

  const handleClearChat = () => {
    setShowClearDialog(true);
  };


  const copyToClipboard = async (text) => {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      return false;
    }
  };




  const renderDocument = () => {
    if (!doc) return null;

    const ext = doc.filename.split(".").pop().toLowerCase();

    if (ext === "txt") {
      return (
        <div className="w-full h-full bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-700 overflow-auto">
          <pre className="whitespace-pre-wrap text-gray-900 dark:text-gray-100 p-6 font-mono text-sm leading-relaxed max-w-5xl mx-auto">
            {doc.content}
          </pre>
        </div>
      );
    }

    if (ext === "pdf") {
      return (
        <div className="w-full h-full bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden">
          <iframe
            src={doc.fileUrl}
            title="PDF Preview"
            className="w-full h-full"
            style={{ minHeight: "100%", border: "none" }}
          />
        </div>
      );
    }

   

    // if (ext === "docx") {
    //   return (
    //     <div className="w-full h-full bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-700 overflow-auto">
    //       <div
    //         className="prose prose-gray dark:prose-invert max-w-none p-6"
    //         dangerouslySetInnerHTML={{ __html: docxHtml || "<p>Loading...</p>" }}
    //       />
    //     </div>
    //   );
    // }

    if (ext === "docx") {
      return (
        <div className="w-full h-full bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden">
          <DocViewer
            documents={[
              {
                uri: doc.fileUrl,
                fileType: "docx",
                fileName: doc.filename,
              },
            ]}
            pluginRenderers={DocViewerRenderers}
            style={{ height: "100%" }}
          />
        </div>
      );
    }

    return (
      <div className="w-full h-full bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-700 flex items-center justify-center">
        <p className="text-gray-500 dark:text-gray-400">Unsupported file type: {ext}</p>
      </div>
    );
  };

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chat]);

  if (!doc) {
    return (
      <Layout>
        <div className="h-[calc(100vh-8rem)] flex items-center justify-center">
          <div className="text-center">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-600 mx-auto mb-4"></div>
            <p className="text-gray-600 dark:text-gray-400">Loading document...</p>
          </div>
        </div>
      </Layout>
    );
  }

  // Document Preview Panel (Left Column)
  const documentPanel = (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5 }}
      className="h-full flex flex-col space-y-4 pt-2.5"
    >
      {/* Header with Back Button */}
      <div className="flex items-center justify-between">
        <Button
          variant="ghost"
          onClick={() => {
            if (doc?.projectId) {
              router.push(`/project?id=${doc.projectId}`);
            } else {
              router.push("/dashboard/");
            }
          }}
          className="flex items-center space-x-2 text-gray-600 dark:text-gray-400"
          style={{
            '--hover-text-color': '#000000',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.color = '#000000';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.color = '';
          }}
        >
          <ArrowLeft className="h-4 w-4" />
          <span>Back to Documents</span>
        </Button>
      </div>

      {/* Document Info */}
      <div className="text-center">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100 mb-2">
          {doc.filename}
        </h1>
        <p className="text-gray-600 dark:text-gray-400">
          Document Preview
        </p>
      </div>

      {/* Document Content */}
      <div className="flex-1 min-h-0">
        <Card className="h-full">
          <CardContent className="p-0 h-full">
            <div className="h-full overflow-hidden">
              {renderDocument()}
            </div>
          </CardContent>
        </Card>
      </div>
    </motion.div>
  );

  // Chat Interface Panel (Right Column)
  const chatPanel = (
    <div className="chat-container">
      <Card className="chat-container">
        <CardHeader className="flex-shrink-0 pb-2">
        <div className="flex items-center justify-between w-full mb-4">
            <CardTitle className="flex items-center space-x-2">
              <MessageCircle className="h-5 w-5 text-primary-600" />
              <span>Document Analysis</span>
            </CardTitle>
            
            {/* Clear Chat Button - Only show when chat has messages */}
            {chat.some(msg => msg.role !== "system") && (
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
            )}
          </div>

          {/* Tab Navigation */}
          <div className="flex space-x-1 mt-4">
            <Button
              variant={activeTab === 'chat' ? 'default' : 'ghost'}
              size="sm"
              onClick={() => setActiveTab('chat')}
              className={cn(
                "flex items-center space-x-2",
                activeTab === 'chat'
                  ? "text-white dark:text-gray-200"
                  : "text-gray-600 dark:text-gray-400"
              )}
            >
              <MessageCircle className="h-4 w-4" />
              <span>Chat</span>
            </Button>
            <Button
              variant={activeTab === 'summary' ? 'default' : 'ghost'}
              size="sm"
              onClick={() => setActiveTab('summary')}
              className={cn(
                "flex items-center space-x-2",
                activeTab === 'summary'
                  ? "text-white dark:text-gray-200"
                  : "text-gray-600 dark:text-gray-400"
              )}
            >
              <BarChart3 className="h-4 w-4" />
              <span>Summary</span>
            </Button>
          </div>
        </CardHeader>

        <CardContent className="chat-card-content p-0">
          {/* Content Area - Chat or Summary */}
          {activeTab === 'chat' ? (
            <div className="chat-container">
              <div className="chat-messages-area p-4 space-y-4 bg-gray-50 dark:bg-gray-900/50 chat-scrollbar">
                {chat.map((message) => (
                  <motion.div
                    key={message.id}
                    initial={{ opacity: 0, y: 20, scale: 0.95 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: -20, scale: 0.95 }}
                    transition={{ duration: 0.4, ease: "easeOut" }}
                    className={cn(
                      "flex items-start space-x-3",
                      message.role === 'user' ? 'flex-row-reverse space-x-reverse' : 'flex-row'
                    )}
                  >
                    {/* Avatar */}
                    <motion.div
                      initial={{ scale: 0 }}
                      animate={{ scale: 1 }}
                      transition={{ delay: 0.1 }}
                      className={cn(
                        "flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center shadow-md",
                        message.role === 'user'
                          ? 'bg-gradient-to-br from-blue-500 to-blue-600'
                          : 'bg-gradient-to-br from-purple-500 to-purple-600'
                      )}
                    >
                      {message.role === 'user' ? (
                        <User className="w-4 h-4 text-white" />
                      ) : (
                        <Bot className="w-4 h-4 text-white" />
                      )}
                    </motion.div>

                    {/* Message Bubble */}
                    <div
                      className={cn(
                        "flex flex-col max-w-[85%]",
                        message.role === 'user' ? 'items-end' : 'items-start'
                      )}
                    >

                      {/* MESSAGE BUBBLE */}
                      <div
                        className={cn(
                          "rounded-2xl px-4 py-3 overflow-hidden",
                          message.role === 'user'
                            ? 'bg-blue-500 text-white'
                            : 'bg-gray-100 dark:bg-gray-800 text-gray-900 dark:text-gray-100 border border-gray-200 dark:border-gray-700'
                        )}
                      >
                        <p className="whitespace-pre-wrap text-sm leading-relaxed break-words overflow-wrap-anywhere">
                          {message.content}
                        </p>
                      </div>

                      {/* ACTION BUTTONS BELOW */}
                      <MessageActions
                        content={message.content}
                        onExpand={() => openExpanded(message)}
                        align={message.role === 'user' ? "right" : "left"}
                      />

                    </div>


                  </motion.div>
                ))}

                {isTyping && (
                  <motion.div
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="flex justify-start"
                  >
                    <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 p-3 rounded-lg">
                      <div className="flex space-x-1">
                        <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce"></div>
                        <div
                          className="w-2 h-2 bg-gray-400 rounded-full animate-bounce"
                          style={{ animationDelay: "0.1s" }}
                        ></div>
                        <div
                          className="w-2 h-2 bg-gray-400 rounded-full animate-bounce"
                          style={{ animationDelay: "0.2s" }}
                        ></div>
                      </div>
                    </div>
                  </motion.div>
                )}

                <div ref={chatEndRef} />
              </div>

              {/* Chat-specific footer - Fixed at bottom */}
              {/* {chat.some(msg => msg.role !== "system") && (
                <div className="flex-shrink-0 p-4 border-t border-gray-200 dark:border-gray-700 bg-yellow-50 dark:bg-yellow-950/30 flex justify-between items-center">
                  <div className="flex items-center space-x-2 text-yellow-700 dark:text-yellow-300">
                    <AlertCircle className="h-4 w-4" />
                    <p className="text-sm font-medium">You can clear this chat to start fresh.</p>
                  </div>
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={handleClearChat}
                  >
                    Clear Chat
                  </Button>
                </div>
              )} */}

              {/* Input Area - Fixed at bottom */}
              <form onSubmit={handleAsk} className="flex-shrink-0 p-4 border-t border-gray-200 dark:border-gray-700">
                <div className="flex space-x-2">
                  <Input
                    ref={inputRef}
                    value={question}
                    onChange={(e) => setQuestion(e.target.value)}
                    placeholder="Ask about this document..."
                    className="flex-1"
                    disabled={isTyping}
                  />
                  {isTyping ? (
                    <Button
                      type="button"
                      size="icon"
                      onClick={handleCancelRequest}
                      className="flex-shrink-0 bg-gray-600 hover:bg-gray-700 text-white"
                    >
                      <Square className="h-4 w-4 fill-current" />
                    </Button>
                  ) : (
                    <Button
                      type="submit"
                      size="icon"
                      disabled={!question.trim()}
                      className="flex-shrink-0"
                    >
                      <Send className="h-4 w-4" />
                    </Button>
                  )}
                </div>
              </form>
            </div>
          ) : (
            /* Summary Area */
            <div className="flex-1 overflow-y-auto p-4 bg-gray-50 dark:bg-gray-900/50 custom-scrollbar">
              {/* CASE 1: Generating */}
              {doc?.status === "summarizing" || isGeneratingSummary ? (
                <div className="flex items-center justify-center h-full">
                  <div className="text-center">
                    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600 mx-auto mb-4"></div>
                    <p className="text-gray-600 dark:text-gray-400">
                      Generating summary please wait
                      {/* Generating summary in background... */}
                    </p>
                  </div>
                </div>
              ) : /* CASE 2: Ready */ summary ? (
                <motion.div
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.5 }}
                  className="space-y-6"
                >
                  {/* Document Info */}
                  <div className="bg-white dark:bg-gray-800 rounded-lg p-4 border border-gray-200 dark:border-gray-700">
                    <h3 className="font-semibold text-gray-900 dark:text-gray-100 mb-3">
                      Document Information
                    </h3>
                    <div className="grid grid-cols-2 gap-4 text-sm">
                      <div className="flex items-center space-x-2">
                        <FileType className="h-4 w-4 text-gray-500" />
                        <span className="text-gray-600 dark:text-gray-400">
                          Type:
                        </span>
                        <span className="font-medium">
                          {summary.documentType}
                        </span>
                      </div>
                      <div className="flex items-center space-x-2">
                        <BarChart3 className="h-4 w-4 text-gray-500" />
                        <span className="text-gray-600 dark:text-gray-400">
                          Words:
                        </span>
                        <span className="font-medium">{summary.wordCount}</span>
                      </div>
                      <div className="flex items-center space-x-2">
                        <Clock className="h-4 w-4 text-gray-500" />
                        <span className="text-gray-600 dark:text-gray-400">
                          Read Time:
                        </span>
                        <span className="font-medium">
                          {summary.estimatedReadTime} min
                        </span>
                      </div>
                      <div className="flex items-center space-x-2">
                        <Calendar className="h-4 w-4 text-gray-500" />
                        <span className="text-gray-600 dark:text-gray-400">
                          Modified:
                        </span>
                        <span className="font-medium">
                          {summary.lastModified}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Overview */}
                  <div className="bg-white dark:bg-gray-800 rounded-lg p-4 border border-gray-200 dark:border-gray-700">
                    <h3 className="font-semibold text-gray-900 dark:text-gray-100 mb-3">
                      Summary
                    </h3>
                    <p className="text-gray-700 dark:text-gray-300 leading-relaxed">
                      {summary.overview}
                    </p>
                  </div>

                  {/* Key Points */}
                  {summary.keyPoints.length > 0 && (
                    <div className="bg-white dark:bg-gray-800 rounded-lg p-4 border border-gray-200 dark:border-gray-700">
                      <h3 className="font-semibold text-gray-900 dark:text-gray-100 mb-3">
                        Key Points
                      </h3>
                      <ul className="space-y-2">
                        {summary.keyPoints.map((point, index) => (
                          <li
                            key={index}
                            className="flex items-start space-x-2"
                          >
                            <div className="w-2 h-2 bg-primary-600 rounded-full mt-2 flex-shrink-0"></div>
                            <span className="text-gray-700 dark:text-gray-300 text-sm">
                              {point}
                            </span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {/* Regenerate Button */}
                  <div className="text-center">
                    <Button
                      variant="outline"
                      onClick={generateSummary}
                      className="flex items-center space-x-2"
                    >
                      <BarChart3 className="h-4 w-4" />
                      <span>Regenerate Summary</span>
                    </Button>
                  </div>
                </motion.div>
              ) : /* CASE 3: Error */ doc?.status === "error" ? (
                <div className="flex items-center justify-center h-full">
                  <div className="text-center">
                    <AlertCircle className="h-12 w-12 text-red-500 mx-auto mb-4" />
                    <p className="text-gray-600 dark:text-gray-400 mb-4">
                      Failed to generate summary
                    </p>
                    <Button
                      onClick={generateSummary}
                      className="flex items-center space-x-2"
                    >
                      <BarChart3 className="h-4 w-4" />
                      <span>Try Again</span>
                    </Button>
                  </div>
                </div>
              ) : (
                /* CASE 4: No summary yet */
                <div className="flex items-center justify-center h-full">
                  <div className="text-center">
                    <BarChart3 className="h-12 w-12 text-gray-400 mx-auto mb-4" />
                    <p className="text-gray-600 dark:text-gray-400 mb-4">
                      No summary available
                    </p>
                    <Button
                      onClick={generateSummary}
                      className="flex items-center space-x-2"
                    >
                      <BarChart3 className="h-4 w-4" />
                      <span>Generate Summary</span>
                    </Button>
                  </div>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );

  return (
    <Layout>
      <div className="h-[calc(100vh-8rem)]">
        <TwoColumnLayout
          leftColumn={documentPanel}
          rightColumn={chatPanel}
          leftTitle="Document Preview"
          rightTitle="Chat"
        />
      </div>
      {showClearDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <ClearChatDialog
            open={showClearDialog}
            onConfirm={onConfirmClearChat}
            onClose={() => setShowClearDialog(false)}
          />
        </div>
      )}

      <ExpandedMessageModal
        open={!!expandedMessage}
        message={expandedMessage}
        onClose={closeExpanded}
      />
    </Layout>
  );
}


export default function DocumentPage() {
  return (
    <Suspense fallback={<div>Loading document...</div>}>
      <DocumentContent />
    </Suspense>
  );
}