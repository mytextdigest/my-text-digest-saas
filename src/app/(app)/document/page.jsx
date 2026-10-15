"use client";
import { useEffect, useState, useRef, useCallback, useMemo, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Layout from '@/components/layout/Layout';
import TwoColumnLayout from '@/components/layout/TwoColumnLayout';
import { ArrowLeft, MessageCircle, BarChart3, Trash2, BookOpen, Table, Presentation, Image as ImageIcon, Network } from 'lucide-react';
import mammoth from "mammoth";
import ClearChatDialog from "@/components/documents/ClearChatDialog";
import ExpandedMessageModal from "@/components/chat/ExpandedMessageModal";
import ChatMessage, { AssistantPendingRow, TypingDots } from "@/components/chat/ChatMessage";
import MarkdownMessage from "@/components/chat/MarkdownMessage";
import PdfViewer from "@/components/documents/PdfViewer";
import FiguresGallery from "@/components/documents/FiguresGallery";
import TablesView from "@/components/tables/TablesView";
import tablesApi from "@/lib/tablesApi";
import GraphView from "@/components/documents/GraphView";
import SlidesView from "@/components/slides/SlidesView";
import { useChatEngine } from "@/components/chat/useChatEngine";
import { GeneralKnowledgeProgressChip, GeneralKnowledgePermissionPrompt } from "@/components/chat/ExternalKnowledgeBadge";
import FileViewerFrame from "@/components/documents/viewer/FileViewerFrame";
import ImageViewer from "@/components/documents/viewer/ImageViewer";
import { ViewerToolbarHost } from "@/components/documents/viewer/ViewerToolbar";
import ChatComposer from "@/components/chat/ChatComposer";
import DocumentTabs from "@/components/documents/document/DocumentTabs";
import SummaryTab from "@/components/documents/document/SummaryTab";
import GuideTab from "@/components/documents/document/GuideTab";
import { ImageGeneratingPlaceholder, DropOverlay, ChatImageViewer } from "@/components/chat/ChatImages";
import { useComposerAttachments, useChatImageActions } from "@/components/chat/useChatImages";
import { printHtml } from "@/lib/printDocument";



const escapeHtml = (t) => String(t ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

// Wraps a document body for the system print dialog.
const printableHtml = (title, body) => `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>${escapeHtml(title)}</title>
<style>body{font-family:Georgia,serif;max-width:760px;margin:32px auto;color:#111;line-height:1.6}img{max-width:100%}table{border-collapse:collapse}td,th{border:1px solid #ccc;padding:4px 8px}</style>
</head><body>${body}</body></html>`;

const WORDS_PER_PAGE = 400;

function DocumentContent() {
  const searchParams = useSearchParams();
  const router = useRouter();

  const id = searchParams.get('id');


  const [doc, setDoc] = useState(null);
  const [chat, setChat] = useState([]);
  const [question, setQuestion] = useState("");
  // 'chat', 'summary', 'guide', 'figures', or 'slides' — initialized from a
  // `?tab=` deep link (the slide editor/outline-review routes navigate back
  // here with `tab=slides` on Close/Done) so leaving those pages lands back
  // on the tab the user came from instead of resetting to 'chat'.
  const [activeTab, setActiveTab] = useState(() => searchParams.get('tab') || 'chat');
  const [summary, setSummary] = useState(null);
  const [isGeneratingSummary, setIsGeneratingSummary] = useState(false);
  const chatEndRef = useRef(null);
  const inputRef = useRef(null);
  // Automatic Table Extraction: count for the tab badge, the table a
  // question is pinned to ("Ask about this table"), and PDF page jumps.
  const [tablesCount, setTablesCount] = useState(0);
  const [pinnedTable, setPinnedTable] = useState(null);
  const [pdfJump, setPdfJump] = useState(null);
  // The left header row's slot that viewer toolbars render into.
  const [toolbarHost, setToolbarHost] = useState(null);
  const toolbarSlot = useMemo(() => ({ host: toolbarHost }), [toolbarHost]);

  const [docxHtml, setDocxHtml] = useState(null);
  const [spreadsheetData, setSpreadsheetData] = useState(null);
  const [activeSheetIndex, setActiveSheetIndex] = useState(0);
  const [conversationId, setConversationId] = useState(null);
  const [showClearDialog, setShowClearDialog] = useState(false);

  const [expandedMessage, setExpandedMessage] = useState(null);

  // Reading Guide state
  const [pagesRead, setPagesRead] = useState(0);
  const [readingInsights, setReadingInsights] = useState([]);
  const [isLoadingPageInsight, setIsLoadingPageInsight] = useState(false);
  const [expandedInsightIndex, setExpandedInsightIndex] = useState(null);
  const [detectedPage, setDetectedPage] = useState(0);
  const [pdfTotalPages, setPdfTotalPages] = useState(0);
  const docScrollRef = useRef(null);
  const scrollDebounceRef = useRef(null);

  const ext = doc?.filename?.split('.').pop().toLowerCase() ?? '';
  const isSpreadsheet = ['csv', 'xlsx', 'xls'].includes(ext);
  const noGuideTab = ['jpg','jpeg','png','webp','gif','bmp','xlsx','xls','csv'].includes(ext);
  const showFiguresTab = ['pdf','docx'].includes(ext);
  const showTablesTab = ['pdf', 'docx', 'xlsx', 'xls', 'csv', 'jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp'].includes(ext);

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

  useEffect(() => {
    if (!doc) return;
    if (noGuideTab && activeTab === 'guide') setActiveTab('chat');
    if (!showFiguresTab && activeTab === 'figures') setActiveTab('chat');
    if (!showTablesTab && activeTab === 'tables') setActiveTab('chat');
  }, [doc, noGuideTab, showFiguresTab, showTablesTab, activeTab]);

  // Tab badge: current count, kept fresh while extraction runs in the background.
  useEffect(() => {
    if (!id || !showTablesTab) return;
    const refresh = () => tablesApi.listTables(id).then((res) => res?.success && setTablesCount(res.tables.length));
    refresh();
    const off = tablesApi.onTableExtractionUpdate(id, () => refresh());
    return () => off?.();
  }, [id, showTablesTab]);

  const handleAskAboutTable = useCallback((table) => {
    setPinnedTable({ id: table.id, title: table.title || `Table ${table.table_index + 1}` });
    setActiveTab('chat');
    setTimeout(() => inputRef.current?.focus(), 0);
  }, []);

  const handleShowTableInDocument = useCallback((table) => {
    if (table.page_start == null) return;
    setPdfJump({ page: table.page_start, box: table.raw?.provenance?.bbox || null, nonce: Date.now() });
  }, []);

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
    if (!id) {
      router.push('/');
    }
  }, [id, router]);




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

  // Load spreadsheet preview data from server-side parser
  useEffect(() => {
    if (!doc?.id) return;
    const ext = doc.filename?.split(".").pop()?.toLowerCase();
    if (!["xlsx", "xls", "csv"].includes(ext)) return;

    setSpreadsheetData(null);
    setActiveSheetIndex(0);

    fetch(`/api/spreadsheet-data?documentId=${doc.id}`)
      .then((r) => r.json())
      .then((res) => {
        if (res?.success) {
          setSpreadsheetData(res.sheets);
        }
      })
      .catch((err) => console.error("Spreadsheet preview error:", err));
  }, [doc?.id]);

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
            let mapped = msgsRes.messages.map((m) => ({
              id: m.id,
              role: m.role,
              content: m.content,
              status: m.status,
              timestamp: new Date(m.createdAt || m.created_at),
              chart: m.chartData || null,
              externalKnowledgeQuery: m.externalKnowledgeQuery || null,
              insight: m.insightJson || null,
              tableCitations: m.tableCitations || [],
              attachments: m.attachments || [],
              feedback: m.feedback ?? null,
              saved: true
            }));

            // An image still generating resumes its placeholder; the result
            // replaces the message when it lands.
            const last = msgsRes.messages[msgsRes.messages.length - 1];
            if (last?.role === "assistant" && last.status === "generating") {
              mapped = mapped.slice(0, -1);
              resumeImageJob({ kind: "document", messageId: last.id, leadIn: last.content, progress: last.imageProgress });
            }
  
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
  const mapAskResult = useCallback((res) => ({
    // The stored row id (needed for feedback); a temp id if the backend sent none.
    id: res.messageId ?? `assistant-${Date.now()}-${Math.random()}`,
    saved: !!res.messageId,
    role: "assistant",
    content: res.answer,
    timestamp: new Date(),
    chart: res.chart || null,
    externalKnowledgeQuery: res.externalKnowledgeQuery || null,
    insight: res.insight || null,
    tableCitations: res.tableCitations || [],
    attachments: res.attachments || []
  }), []);

  const handleAskResult = useCallback((res) => {
    setChat(prev => [...prev, mapAskResult(res)]);

    if (res.conversationId && res.conversationId !== conversationId) {
      setConversationId(res.conversationId);
    }
  }, [conversationId, mapAskResult]);

  const handleAskError = useCallback((res) => {
    setChat(prev => [
      ...prev,
      {
        id: `assistant-error-${Date.now()}`,
        role: "assistant",
        content: `Sorry, I couldn't answer right now: ${res?.error || "unknown error"}`,
        timestamp: new Date()
      }
    ]);
  }, []);

  const ask = useCallback((question, requestId, signal, { attachments = [] } = {}) => {
    return fetch(`/api/documents/${id}/ask`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      signal,
      body: JSON.stringify({ question, conversationId, requestId, pinnedTableId: pinnedTable?.id ?? null, attachmentIds: attachments.map(a => a.id) })
    }).then(r => r.json());
  }, [id, conversationId, pinnedTable]);

  const {
    isTyping,
    pendingConfirmation,
    progress,
    sendMessage,
    respondToConfirmation,
    cancelRequest,
    resumeImageJob,
  } = useChatEngine({ ask, onResult: handleAskResult, onError: handleAskError });

  // Image attachments + generated images (shared with project chat).
  // "Save to project" saves into the project this document belongs to.
  const composer = useComposerAttachments({ messageTable: 'document', disabled: isTyping });
  const imageActions = useChatImageActions({ projectId: doc?.projectId, setMessages: setChat, mapAskResult });
  const canAsk = !composer.isUploading && (question.trim().length > 0 || composer.readyAttachments.length > 0);

  const handleAsk = (e) => {
    e.preventDefault();
    if (!canAsk) return;

    const attachments = composer.readyAttachments;
    const userMessage = {
      id: `user-${Date.now()}-${Math.random()}`,
      role: "user",
      content: question,
      attachments,
      timestamp: new Date()
    };
    setChat(prev => [...prev, userMessage]);

    const q = question;
    setQuestion("");
    composer.clear();

    sendMessage(q, { attachments });
  };

  const handleCancelRequest = () => cancelRequest();
  



  const onConfirmClearChat = async () => {
    try {
      const res = await fetch(`/api/documents/${doc.id}/clear-conversation`, {
        method: "POST",
        credentials: "include"
      }).then(r => r.json());
  
      if (res?.success) {
        setConversationId(res.conversationId);

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


  const renderDocument = () => {
    if (!doc) return null;

    const ext = doc.filename.split(".").pop().toLowerCase();

    if (ext === "txt") {
      return (
        <FileViewerFrame
          ref={docScrollRef}
          onScroll={handleDocScroll}
          docId={doc.id}
          fileUrl={doc.fileUrl}
          onPrint={() => printHtml(printableHtml(doc.filename, `<pre style="white-space:pre-wrap;font:13px/1.6 ui-monospace,monospace">${escapeHtml(doc.content)}</pre>`))}
        >
          <pre className="whitespace-pre-wrap text-gray-900 dark:text-gray-100 p-6 font-mono text-sm leading-relaxed">
            {doc.content}
          </pre>
        </FileViewerFrame>
      );
    }

    if (ext === "pdf") {
      return (
        <div className="w-full h-full overflow-hidden">
          <PdfViewer
            fileUrl={doc.fileUrl}
            docId={doc.id}
            filename={doc.filename}
            onPageChange={handleDocPageChange}
            onTotalPages={setPdfTotalPages}
            jumpTo={pdfJump}
          />
        </div>
      );
    }

    if (ext === "docx") {
      return (
        <FileViewerFrame
          ref={docScrollRef}
          onScroll={handleDocScroll}
          docId={doc.id}
          fileUrl={doc.fileUrl}
          onPrint={docxHtml ? () => printHtml(printableHtml(doc.filename, docxHtml)) : undefined}
        >
          <div
            className="prose prose-gray dark:prose-invert max-w-none p-6"
            dangerouslySetInnerHTML={{ __html: docxHtml || "<p>Loading...</p>" }}
          />
        </FileViewerFrame>
      );
    }

    if (['jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp'].includes(ext)) {
      return <ImageViewer docId={doc.id} fileUrl={doc.fileUrl} filename={doc.filename} />;
    }

    if (ext === "xlsx" || ext === "xls" || ext === "csv") {
      if (!spreadsheetData) {
        return (
          <div className="w-full h-full flex items-center justify-center">
            <p className="text-gray-400 dark:text-gray-500 text-sm">Loading spreadsheet…</p>
          </div>
        );
      }

      const activeSheet = spreadsheetData[activeSheetIndex];

      return (
        <FileViewerFrame
          ref={docScrollRef}
          onScroll={handleDocScroll}
          docId={doc.id}
          fileUrl={doc.fileUrl}
          header={spreadsheetData.length > 1 && (
            <div className="flex border-b border-gray-200 dark:border-gray-700 overflow-x-auto shrink-0">
              {spreadsheetData.map((sheet, i) => (
                <button
                  key={i}
                  onClick={() => setActiveSheetIndex(i)}
                  className={`px-4 py-2 text-sm font-medium whitespace-nowrap border-b-2 transition-colors ${
                    i === activeSheetIndex
                      ? "border-primary-500 text-primary-600 dark:text-primary-400 bg-primary-50 dark:bg-primary-900/20"
                      : "border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800"
                  }`}
                >
                  {sheet.name}
                </button>
              ))}
            </div>
          )}
          footer={
            <div className="shrink-0 px-4 py-2 border-t border-gray-200 dark:border-gray-700 text-xs text-gray-400 dark:text-gray-500 flex items-center gap-3">
              <span>{activeSheet?.headers?.length ?? 0} columns</span>
              <span>•</span>
              <span>
                {activeSheet?.totalRows ?? 0} rows
                {activeSheet?.totalRows > 1000 ? " (showing first 1,000)" : ""}
              </span>
            </div>
          }
        >
            {activeSheet?.headers?.length > 0 ? (
              <table className="min-w-full text-xs border-collapse">
                <thead className="sticky top-0 z-10">
                  <tr>
                    <th className="px-3 py-2 text-left font-semibold text-gray-500 dark:text-gray-400 bg-gray-100 dark:bg-gray-800 border-b border-r border-gray-200 dark:border-gray-700 w-10 shrink-0">
                      #
                    </th>
                    {activeSheet.headers.map((h, i) => (
                      <th
                        key={i}
                        className="px-3 py-2 text-left font-semibold text-gray-700 dark:text-gray-200 bg-gray-100 dark:bg-gray-800 border-b border-r border-gray-200 dark:border-gray-700 whitespace-nowrap"
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {activeSheet.rows.map((row, rowIdx) => (
                    <tr
                      key={rowIdx}
                      className={rowIdx % 2 === 0 ? "bg-white dark:bg-gray-900" : "bg-gray-50 dark:bg-gray-800/50"}
                    >
                      <td className="px-3 py-1.5 text-gray-400 dark:text-gray-500 border-r border-gray-100 dark:border-gray-800 text-right select-none">
                        {rowIdx + 2}
                      </td>
                      {activeSheet.headers.map((h, colIdx) => (
                        <td
                          key={colIdx}
                          className="px-3 py-1.5 text-gray-800 dark:text-gray-200 border-r border-gray-100 dark:border-gray-800 whitespace-nowrap max-w-xs truncate"
                          title={String(row[h] ?? "")}
                        >
                          {String(row[h] ?? "")}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <div className="flex items-center justify-center h-full">
                <p className="text-gray-400 dark:text-gray-500 text-sm">This sheet is empty</p>
              </div>
            )}
        </FileViewerFrame>
      );
    }

    return (
      <div className="w-full h-full flex items-center justify-center">
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

  // Document Preview Panel (Left Column): a header row (Back, filename, and the
  // viewer's toolbar, which portals into toolbarHost) over the frameless viewer.
  const documentPanel = (
    <div className="h-full flex flex-col bg-white dark:bg-gray-900">
      <div className="@container shrink-0 h-12 flex items-center gap-2 pl-3 pr-2 border-b border-gray-200 dark:border-gray-700">
        <button
          type="button"
          onClick={() => router.push(doc?.projectId ? `/project?id=${doc.projectId}` : "/dashboard/")}
          title="Back to documents"
          className="shrink-0 inline-flex items-center gap-1.5 h-8 px-2.5 rounded-md border border-gray-200 dark:border-gray-700 text-sm font-medium text-gray-700 hover:text-gray-900 hover:bg-gray-50 dark:text-gray-300 dark:hover:text-gray-100 dark:hover:bg-gray-800 transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
          <span>Back</span>
        </button>
        <h1 className="flex-1 min-w-0 truncate text-sm font-semibold text-gray-900 dark:text-gray-100" title={doc.filename}>
          {doc.filename}
        </h1>
        <div ref={setToolbarHost} className="shrink-0 flex items-center" />
      </div>

      <div className="flex-1 min-h-0">
        <ViewerToolbarHost.Provider value={toolbarSlot}>
          {renderDocument()}
        </ViewerToolbarHost.Provider>
      </div>
    </div>
  );

  const hasChatHistory = chat.some(msg => msg.role !== "system");
  const tabs = [
    { id: 'chat', label: 'Chat', icon: MessageCircle },
    { id: 'summary', label: 'Summary', icon: BarChart3 },
    { id: 'slides', label: 'Slides', icon: Presentation },
    !noGuideTab && { id: 'guide', label: 'Pagewise Summary', icon: BookOpen },
    showFiguresTab && { id: 'figures', label: 'Figures', icon: ImageIcon },
    showTablesTab && { id: 'tables', label: 'Tables', icon: Table, count: tablesCount },
    { id: 'graph', label: 'Graph', icon: Network },
  ].filter(Boolean);

  // Analysis Panel (Right Column): tabs (+ clear chat on the Chat tab) in a
  // header row that lines up with the document's, over the active tab — no card.
  const chatPanel = (
    <div className="h-full flex flex-col bg-white dark:bg-gray-900">
      <div className="shrink-0 h-12 flex items-center gap-2 pl-3 pr-2 border-b border-gray-200 dark:border-gray-700">
        <div className="flex-1 min-w-0">
          <DocumentTabs tabs={tabs} activeTab={activeTab} onChange={setActiveTab} />
        </div>
        {activeTab === 'chat' && (
          <button
            type="button"
            onClick={handleClearChat}
            disabled={!hasChatHistory}
            title={hasChatHistory ? "Clear chat" : "No chat to clear"}
            aria-label="Clear chat"
            className="shrink-0 h-8 w-8 inline-flex items-center justify-center rounded-md text-gray-500 hover:text-red-600 hover:bg-red-50 dark:text-gray-400 dark:hover:text-red-400 dark:hover:bg-red-900/20 disabled:opacity-40 disabled:pointer-events-none transition-colors"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        )}
      </div>

      <div className="chat-card-content">
          {/* Content Area - Chat, Summary, or Reading Guide */}
          {activeTab === 'guide' ? (
            <GuideTab
              totalPages={totalPages}
              pagesRead={pagesRead}
              readingInsights={readingInsights}
              isLoadingPageInsight={isLoadingPageInsight}
              expandedInsightIndex={expandedInsightIndex}
              setExpandedInsightIndex={setExpandedInsightIndex}
              detectedPage={detectedPage}
            />
          ) : activeTab === 'chat' ? (
            <div className="chat-container relative" {...composer.dropHandlers}>
              <DropOverlay visible={composer.isDraggingFiles} />
              {/* Messages Area - Properly constrained with scrolling */}
              <div className="chat-messages-area px-5 py-5 space-y-6 bg-white dark:bg-gray-900 chat-scrollbar">
              {chat.map((message) => (
                <ChatMessage
                  key={message.id}
                  message={message}
                  feedbackTable="document"
                  imageActions={imageActions}
                  onExpand={() => openExpanded(message)}
                />
              ))}

              {pendingConfirmation && (
                <AssistantPendingRow>
                  <GeneralKnowledgePermissionPrompt
                    query={pendingConfirmation.query}
                    onApprove={() => respondToConfirmation(true)}
                    onDecline={() => respondToConfirmation(false)}
                  />
                </AssistantPendingRow>
              )}

              {isTyping && !pendingConfirmation && (
                <AssistantPendingRow>
                  {progress?.stage === 'consulting_general_knowledge' ? (
                    <GeneralKnowledgeProgressChip />
                  ) : progress?.stage === 'generating_image' ? (
                    <>
                      {progress.leadIn && <MarkdownMessage variant="rich" content={progress.leadIn} className="w-full text-[15px] text-gray-800 dark:text-gray-100" />}
                      <ImageGeneratingPlaceholder status={progress.status} />
                    </>
                  ) : (
                    <TypingDots />
                  )}
                </AssistantPendingRow>
              )}
                <div ref={chatEndRef} />
              </div>

              <ChatComposer
                ref={inputRef}
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                onSubmit={handleAsk}
                onCancel={handleCancelRequest}
                isTyping={isTyping}
                canSend={canAsk}
                composer={composer}
                placeholder={composer.items.length ? "Say what to do with the images..." : "Ask about this document..."}
                chips={pinnedTable ? [{
                  key: 'pinned-table',
                  icon: Table,
                  label: pinnedTable.title,
                  title: `Asking about ${pinnedTable.title} — the whole table is included in your questions`,
                  onRemove: () => setPinnedTable(null),
                }] : []}
              />
            </div>
          ) : activeTab === 'slides' ? (
            <div className="flex-1 overflow-y-auto p-4 bg-gray-50 dark:bg-gray-900/50 custom-scrollbar">
              <SlidesView docId={id} />
            </div>
          ) : activeTab === 'figures' ? (
            <div className="flex-1 overflow-y-auto p-4 bg-gray-50 dark:bg-gray-900/50 custom-scrollbar">
              <FiguresGallery documentId={id} />
            </div>
          ) : activeTab === 'tables' ? (
            <div className="flex-1 overflow-y-auto p-4 bg-gray-50 dark:bg-gray-900/50 custom-scrollbar">
              <TablesView
                docId={id}
                initialTableId={searchParams.get('table')}
                onAsk={handleAskAboutTable}
                onShowInDocument={ext === 'pdf' ? handleShowTableInDocument : null}
                onCountChange={setTablesCount}
              />
            </div>
          ) : activeTab === 'graph' ? (
            <div className="flex-1 bg-gray-50 dark:bg-gray-900/50">
              <GraphView docId={id} />
            </div>
          ) : (
            /* Summary Area */
            <SummaryTab
              doc={doc}
              summary={summary}
              isGeneratingSummary={isGeneratingSummary}
              isSpreadsheet={isSpreadsheet}
              sheets={sheets}
              onRegenerate={generateSummary}
            />
          )}
      </div>
    </div>
  );

  return (
    <Layout fullBleed>
      <div className="h-full">
        <TwoColumnLayout
          leftColumn={documentPanel}
          rightColumn={chatPanel}
          leftTitle="Document Preview"
          rightTitle="Chat"
          resizable="document"
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

      <ChatImageViewer actions={imageActions} />

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