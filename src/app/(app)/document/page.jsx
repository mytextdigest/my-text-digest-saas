"use client";
import { useEffect, useState, useRef, useCallback, useMemo, Suspense } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { AnimatePresence, motion } from 'framer-motion';
import Layout from '@/components/layout/Layout';
import TwoColumnLayout from '@/components/layout/TwoColumnLayout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { ArrowLeft, Send, FileText, MessageCircle, AlertCircle, BarChart3, Clock, FileType, Calendar, Square, Trash2, CheckCircle2, Copy, Bot, User, BookOpen, ChevronDown, ChevronRight, HelpCircle, Lightbulb, Sheet } from 'lucide-react';
import mammoth from "mammoth";
import ClearChatDialog from "@/components/documents/ClearChatDialog";
import PdfViewer from "@/components/documents/PdfViewer";
import { cn } from '@/lib/utils';
import DocViewer, { DocViewerRenderers } from "react-doc-viewer";
import MessageActions from "@/components/chat/MessageActions";
import ExpandedMessageModal from "@/components/chat/ExpandedMessageModal";



const WORDS_PER_PAGE = 400;

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

  // Reading Guide state
  const [pagesRead, setPagesRead] = useState(0);
  const [readingInsights, setReadingInsights] = useState([]);
  const [isLoadingPageInsight, setIsLoadingPageInsight] = useState(false);
  const [expandedInsightIndex, setExpandedInsightIndex] = useState(null);
  const [detectedPage, setDetectedPage] = useState(0);
  const [pdfTotalPages, setPdfTotalPages] = useState(0);
  const insightsEndRef = useRef(null);
  const docScrollRef = useRef(null);
  const scrollDebounceRef = useRef(null);

  const ext = doc?.filename?.split('.').pop().toLowerCase() ?? '';
  const isSpreadsheet = ['csv', 'xlsx', 'xls'].includes(ext);

  // Derive a per-sheet breakdown from chunk metadata stored during ingestion
  // (workbookName, sheetName, rowRange, columnHeaders — see worker/extractSpreadsheet.js)
  const sheets = useMemo(() => {
    if (!isSpreadsheet || !doc?.chunks?.length) return [];

    const bySheet = new Map();
    for (const chunk of doc.chunks) {
      const meta = chunk?.metadata;
      if (!meta?.sheetName) continue;

      const existing = bySheet.get(meta.sheetName);
      if (!existing) {
        bySheet.set(meta.sheetName, {
          sheetName: meta.sheetName,
          columnHeaders: meta.columnHeaders || [],
          rowRanges: meta.rowRange ? [meta.rowRange] : [],
        });
      } else if (meta.rowRange) {
        existing.rowRanges.push(meta.rowRange);
      }
    }

    return Array.from(bySheet.values()).map((sheet) => {
      const allRows = sheet.rowRanges
        .flatMap((range) => range.split('-').map(Number))
        .filter((n) => !Number.isNaN(n));
      const rowSpan = allRows.length
        ? `${Math.min(...allRows)}-${Math.max(...allRows)}`
        : null;
      return { ...sheet, rowSpan };
    });
  }, [isSpreadsheet, doc?.chunks]);

  const totalPages = ext === 'pdf'
    ? pdfTotalPages
    : doc?.content
      ? Math.max(1, Math.ceil(doc.content.split(/\s+/).filter(Boolean).length / WORDS_PER_PAGE))
      : 0;

  const openExpanded = (message) => {
    setExpandedMessage(message);
  };
  
  const closeExpanded = () => {
    setExpandedMessage(null);
  };

  // Reading Guide helpers
  const getContentUpToPage = useCallback((pageNumber) => {
    if (!doc?.content) return '';
    const words = doc.content.split(/\s+/).filter(Boolean);
    if (ext === 'pdf') {
      const fraction = pageNumber / Math.max(1, pdfTotalPages);
      return words.slice(0, Math.ceil(words.length * fraction)).join(' ');
    }
    return words.slice(0, pageNumber * WORDS_PER_PAGE).join(' ');
  }, [doc?.content, ext, pdfTotalPages]);

  const handleMarkPageRead = useCallback(async () => {
    if (isLoadingPageInsight || pagesRead >= totalPages) return;
    const nextPage = pagesRead + 1;
    setIsLoadingPageInsight(true);
    try {
      const content = getContentUpToPage(nextPage);
      const res = await fetch('/api/page-insight', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pageContent: content, pageNumber: nextPage }),
      }).then(r => r.json());

      if (res?.success) {
        setReadingInsights(prev => [...prev, { page: nextPage, keyPoints: res.keyPoints, questions: res.questions }]);
        setExpandedInsightIndex(nextPage - 1);
        setPagesRead(nextPage);
      }
    } catch (err) {
      console.error('Failed to get page insight:', err);
    } finally {
      setIsLoadingPageInsight(false);
    }
  }, [isLoadingPageInsight, pagesRead, totalPages, getContentUpToPage]);

  // Auto-trigger chain when reading guide tab is active
  useEffect(() => {
    if (activeTab !== 'guide') return;
    if (detectedPage > pagesRead && !isLoadingPageInsight && totalPages > 0) {
      handleMarkPageRead();
    }
  }, [detectedPage, pagesRead, isLoadingPageInsight, totalPages, activeTab, handleMarkPageRead]);

  const handleDocPageChange = useCallback((pageNum) => {
    setDetectedPage(pageNum);
  }, []);

  const handleDocScroll = useCallback((e) => {
    if (scrollDebounceRef.current) clearTimeout(scrollDebounceRef.current);
    const el = e.currentTarget;
    scrollDebounceRef.current = setTimeout(() => {
      const pct = el.scrollTop / Math.max(1, el.scrollHeight - el.clientHeight);
      const page = Math.max(1, Math.ceil(pct * Math.max(1, totalPages)));
      setDetectedPage(page);
    }, 800);
  }, [totalPages]);

  useEffect(() => {
    insightsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [readingInsights]);



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
        <div ref={docScrollRef} onScroll={handleDocScroll} className="w-full h-full bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-700 overflow-auto">
          <pre className="whitespace-pre-wrap text-gray-900 dark:text-gray-100 p-6 font-mono text-sm leading-relaxed max-w-5xl mx-auto">
            {doc.content}
          </pre>
        </div>
      );
    }

    if (ext === "pdf") {
      return (
        <div className="w-full h-full bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden">
          <PdfViewer fileUrl={doc.fileUrl} onPageChange={handleDocPageChange} onTotalPages={setPdfTotalPages} />
        </div>
      );
    }

    if (ext === "docx") {
      return (
        <div ref={docScrollRef} onScroll={handleDocScroll} className="w-full h-full bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-700 overflow-auto">
          <div
            className="prose prose-gray dark:prose-invert max-w-none p-6"
            dangerouslySetInnerHTML={{ __html: docxHtml || "<p>Loading...</p>" }}
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
            <Button
              variant={activeTab === 'guide' ? 'default' : 'ghost'}
              size="sm"
              onClick={() => setActiveTab('guide')}
              className={cn(
                "flex items-center space-x-2",
                activeTab === 'guide'
                  ? "text-white dark:text-gray-200"
                  : "text-gray-600 dark:text-gray-400"
              )}
            >
              <BookOpen className="h-4 w-4" />
              <span>Pagewise Summary</span>
            </Button>
          </div>
        </CardHeader>

        <CardContent className="chat-card-content p-0">
          {/* Content Area - Chat, Summary, or Reading Guide */}
          {activeTab === 'guide' ? (
            <div className="flex flex-col h-full">
              {/* Progress bar */}
              {totalPages > 0 && (
                <div className="shrink-0 px-4 pt-4 pb-3 border-b border-gray-200 dark:border-gray-700">
                  <div className="flex justify-between text-xs text-gray-500 mb-1.5">
                    <span>{pagesRead === 0 ? 'Not started' : `Page ${pagesRead} of ${totalPages} read`}</span>
                    <span>{Math.round((pagesRead / totalPages) * 100)}%</span>
                  </div>
                  <div className="h-1.5 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
                    <div
                      className="h-1.5 bg-primary-600 rounded-full transition-all duration-500"
                      style={{ width: `${(pagesRead / totalPages) * 100}%` }}
                    />
                  </div>
                </div>
              )}

              {/* Scrollable insight cards */}
              <div className="flex-1 overflow-y-auto p-4 space-y-3 bg-gray-50 dark:bg-gray-900/50">
                {readingInsights.length === 0 && !isLoadingPageInsight && (
                  <div className="flex flex-col items-center justify-center h-full text-center py-12 space-y-3">
                    <BookOpen className="h-10 w-10 text-gray-300 dark:text-gray-600" />
                    <p className="text-sm font-medium text-gray-600 dark:text-gray-400">Progressive reading mode</p>
                    <p className="text-xs text-gray-400 dark:text-gray-500 max-w-[220px]">
                      Start reading the document. Insights and reflection questions unlock automatically as you scroll through each page.
                    </p>
                  </div>
                )}

                {readingInsights.map((insight, idx) => {
                  const isExpanded = expandedInsightIndex === idx;
                  return (
                    <div key={idx} className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
                      <button
                        onClick={() => setExpandedInsightIndex(isExpanded ? null : idx)}
                        className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors"
                      >
                        <span className="text-sm font-semibold text-gray-800 dark:text-gray-200">Page {insight.page}</span>
                        {isExpanded
                          ? <ChevronDown className="h-4 w-4 text-gray-400 shrink-0" />
                          : <ChevronRight className="h-4 w-4 text-gray-400 shrink-0" />}
                      </button>

                      {isExpanded && (
                        <div className="px-4 pb-4 space-y-4 border-t border-gray-100 dark:border-gray-700">
                          {insight.keyPoints.length > 0 && (
                            <div className="pt-3">
                              <div className="flex items-center space-x-1.5 mb-2">
                                <Lightbulb className="h-3.5 w-3.5 text-amber-500" />
                                <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Key Points</span>
                              </div>
                              <ul className="space-y-1.5">
                                {insight.keyPoints.map((point, i) => (
                                  <li key={i} className="flex items-start space-x-2">
                                    <div className="w-1.5 h-1.5 bg-primary-500 rounded-full mt-1.5 shrink-0" />
                                    <span className="text-sm text-gray-700 dark:text-gray-300 leading-relaxed">{point}</span>
                                  </li>
                                ))}
                              </ul>
                            </div>
                          )}
                          {insight.questions.length > 0 && (
                            <div>
                              <div className="flex items-center space-x-1.5 mb-2">
                                <HelpCircle className="h-3.5 w-3.5 text-blue-500" />
                                <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">questions to Reflect</span>
                              </div>
                              <ol className="space-y-2">
                                {insight.questions.map((q, i) => (
                                  <li key={i} className="text-sm text-gray-700 dark:text-gray-300 leading-relaxed pl-3 border-l-2 border-blue-200 dark:border-blue-800">{q}</li>
                                ))}
                              </ol>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}

                {isLoadingPageInsight && (
                  <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 px-4 py-4 flex items-center space-x-3">
                    <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-primary-600 shrink-0" />
                    <span className="text-sm text-gray-500 dark:text-gray-400">Generating insights for page {pagesRead + 1}…</span>
                  </div>
                )}

                <div ref={insightsEndRef} />
              </div>

              {/* Status footer */}
              <div className="shrink-0 px-4 py-3 border-t border-gray-200 dark:border-gray-700 text-center">
                {isLoadingPageInsight ? (
                  <div className="flex items-center justify-center space-x-2 text-sm text-gray-500">
                    <div className="animate-spin rounded-full h-3.5 w-3.5 border-b-2 border-primary-600" />
                    <span>Generating insights for page {pagesRead + 1}…</span>
                  </div>
                ) : pagesRead > 0 && pagesRead >= totalPages ? (
                  <p className="text-sm text-gray-500">You&apos;ve finished the document.</p>
                ) : detectedPage > 0 ? (
                  <p className="text-xs text-gray-400">On page {detectedPage}{totalPages > 0 ? ` of ${totalPages}` : ''}</p>
                ) : (
                  <p className="text-xs text-gray-400">Scroll through the document — insights appear automatically.</p>
                )}
              </div>
            </div>
          ) : activeTab === 'chat' ? (
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

                  {/* Sheets Breakdown (spreadsheet documents only) */}
                  {isSpreadsheet && sheets.length > 0 && (
                    <div className="bg-white dark:bg-gray-800 rounded-lg p-4 border border-gray-200 dark:border-gray-700">
                      <h3 className="font-semibold text-gray-900 dark:text-gray-100 mb-3 flex items-center space-x-2">
                        <Sheet className="h-4 w-4 text-gray-500" />
                        <span>Sheets ({sheets.length})</span>
                      </h3>
                      <div className="space-y-3">
                        {sheets.map((sheet) => (
                          <div
                            key={sheet.sheetName}
                            className="rounded-md border border-gray-200 dark:border-gray-700 p-3"
                          >
                            <div className="flex items-center justify-between">
                              <span className="font-medium text-gray-900 dark:text-gray-100 text-sm">
                                {sheet.sheetName}
                              </span>
                              {sheet.rowSpan && (
                                <span className="text-xs text-gray-500 dark:text-gray-400">
                                  Rows {sheet.rowSpan}
                                </span>
                              )}
                            </div>
                            {sheet.columnHeaders.length > 0 && (
                              <p className="text-xs text-gray-600 dark:text-gray-400 mt-1 truncate">
                                Columns: {sheet.columnHeaders.join(', ')}
                              </p>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

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