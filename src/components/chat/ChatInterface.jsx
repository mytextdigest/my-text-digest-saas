'use client'
import { useState, useRef, useEffect, useCallback } from 'react';
import { MessageCircle, Trash2, Network, GitCompare, Table as TableIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import DeleteConfirmationModal from '@/components/modals/DeleteConfirmationModal';
import ExpandedMessageModal from './ExpandedMessageModal';
import ChatMessage, { AssistantPendingRow, TypingDots } from './ChatMessage';
import ChatComposer from './ChatComposer';
import DocumentTabs from '@/components/documents/document/DocumentTabs';
import MarkdownMessage from './MarkdownMessage';
import DocumentPreviewModal from '@/components/documents/DocumentPreviewModal';
import ProjectGraphView from '@/components/graph/ProjectGraphView';
import ComparisonsView from '@/components/documents/ComparisonsView';
import { useChatEngine } from './useChatEngine';
import { GeneralKnowledgeProgressChip, GeneralKnowledgePermissionPrompt } from './ExternalKnowledgeBadge';
import ProjectTablesView from '@/components/tables/ProjectTablesView';
import { ImageGeneratingPlaceholder, DropOverlay, ChatImageViewer } from './ChatImages';
import { useComposerAttachments, useChatImageActions } from './useChatImages';

const ChatInterface = ({ className, projectId, onDocumentAdded }) => {
  const [activeTab, setActiveTab] = useState('chat'); // 'chat' | 'graph' | 'comparisons' | 'tables'
  const [messages, setMessages] = useState([]);
  const [inputValue, setInputValue] = useState('');
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const messagesEndRef = useRef(null);
  const inputRef = useRef(null);
  const [expandedMessage, setExpandedMessage] = useState(null);
  const [previewDocumentId, setPreviewDocumentId] = useState(null);

  const ask = useCallback((question, requestId, signal, { attachments = [] } = {}) => {
    return fetch("/api/projects/ask", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      signal,
      body: JSON.stringify({ projectId, question, requestId, attachmentIds: attachments.map(a => a.id) })
    }).then(r => r.json());
  }, [projectId]);
  const mapAskResult = useCallback((res) => ({
    // The stored row id (needed for feedback); a temp id if the backend sent none.
    id: res.messageId ?? `assistant-${Date.now()}-${Math.random()}`,
    saved: !!res.messageId,
    role: 'assistant',
    content: res.answer,
    chart: res.chart || null,
    citations: res.citations || null,
    insight: res.insight || null,
    externalKnowledgeQuery: res.externalKnowledgeQuery || null,
    comparisonId: res.comparisonId || null,
    derivedTableId: res.derivedTableId || null,
    tableCitations: res.tableCitations || [],
    attachments: res.attachments || [],
    timestamp: new Date(),
  }), []);
  const mapHistoryMessage = useCallback((m) => ({
    id: m.id,
    saved: true,
    role: m.role === 'user' ? 'user' : 'assistant',
    content: m.content,
    status: m.status,
    chart: m.chart || null,
    citations: m.citations || null,
    insight: m.insight || null,
    externalKnowledgeQuery: m.externalKnowledgeQuery || null,
    comparisonId: m.comparisonId || null,
    derivedTableId: m.derivedTableId || null,
    tableCitations: m.tableCitations || [],
    attachments: m.attachments || [],
    imageProgress: m.imageProgress || null,
    feedback: m.feedback ?? null,
    timestamp: new Date(m.timestamp),
  }), []);

  const handleAskResult = useCallback((res) => {
    setMessages(prev => [...prev, mapAskResult(res)]);
  }, [mapAskResult]);

  const handleAskError = useCallback((res) => {
    setMessages(prev => [
      ...prev,
      {
        id: `assistant-error-${Date.now()}`,
        role: 'assistant',
        content: res?.error || "Failed to get response.",
        timestamp: new Date()
      }
    ]);
  }, []);

  const {
    isTyping,
    progress,
    pendingConfirmation,
    sendMessage,
    respondToConfirmation,
    cancelRequest: handleCancelRequest,
    resumeImageJob,
  } = useChatEngine({ ask, onResult: handleAskResult, onError: handleAskError });

  const openExpanded = (message) => {
    setExpandedMessage(message);
  };

  const closeExpanded = () => {
    setExpandedMessage(null);
  };

  // --- Fetch project messages on mount ---
  useEffect(() => {
    if (!projectId) return;
    fetch(`/api/projects/messages/${projectId}`, { method: "GET", credentials: "include" })
      .then(r => r.json())
      .then(res => {
        if (!res.success) return;
        const mapped = res.messages.map(mapHistoryMessage);
        // An image still generating resumes its placeholder; the result
        // replaces the message when it lands.
        const last = mapped[mapped.length - 1];
        if (last?.role === 'assistant' && last.status === 'generating') {
          setMessages(mapped.slice(0, -1));
          resumeImageJob({ kind: 'project', messageId: last.id, leadIn: last.content, progress: last.imageProgress });
        } else {
          setMessages(mapped);
        }
      })
      .catch(err => console.error("Error loading project messages:", err));
  }, [projectId, mapHistoryMessage, resumeImageJob]);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };
  useEffect(() => { scrollToBottom(); }, [messages]);

  const composer = useComposerAttachments({ messageTable: 'project', disabled: isTyping });
  const imageActions = useChatImageActions({ projectId, setMessages, mapAskResult, onDocumentAdded });
  const canSend = !composer.isUploading && (inputValue.trim().length > 0 || composer.readyAttachments.length > 0);

  // --- Send message ---
  const handleSendMessage = (e) => {
    e.preventDefault();
    if (!canSend || !projectId) return;
    const question = inputValue;
    const attachments = composer.readyAttachments;
    setMessages(prev => [...prev, {
      id: `user-${Date.now()}`,
      role: 'user',
      content: question,
      attachments,
      timestamp: new Date()
    }]);
    setInputValue('');
    composer.clear();
    sendMessage(question, { attachments });
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
      console.error('Error clearing chat:', error);
    } finally {
      setIsDeleting(false);
    }
  };

  const handleCancelDelete = () => {
    setShowDeleteModal(false);
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

  const tabs = [
    { id: 'chat', label: 'Chat', icon: MessageCircle },
    { id: 'graph', label: 'Graph', icon: Network },
    { id: 'comparisons', label: 'Comparisons', icon: GitCompare },
    { id: 'tables', label: 'Tables', icon: TableIcon },
  ];
  const hasChatHistory = messages.length > 0;

  // No card: a header row (tabs + clear chat on the Chat tab) that lines up with
  // the documents column's header, over the active tab.
  return (
    <div className={cn("h-full flex flex-col overflow-hidden relative bg-white dark:bg-gray-900", className)}>
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

      {activeTab === 'graph' ? (
        <div className="chat-card-content">
          <div className="flex-1 min-h-0">
            <ProjectGraphView projectId={projectId} />
          </div>
        </div>
      ) : activeTab === 'comparisons' ? (
        <div className="chat-card-content overflow-y-auto custom-scrollbar">
          <ComparisonsView projectId={projectId} />
        </div>
      ) : activeTab === 'tables' ? (
        <div className="chat-card-content p-4">
          <ProjectTablesView projectId={projectId} className="h-full" />
        </div>
      ) : (
      <div
        className="chat-card-content relative"
        {...composer.dropHandlers}
      >
        <DropOverlay visible={composer.isDraggingFiles} />
        {/* Messages Area */}
        <div className="chat-messages-area chat-scrollbar relative">
          {messages.length === 0 ? (
            <EmptyState />
          ) : (
            <div className="px-5 py-5 space-y-6">
              {messages.map((message) => (
                <ChatMessage
                  key={message.id}
                  message={message}
                  feedbackTable="project"
                  imageActions={imageActions}
                  onExpand={() => openExpanded(message)}
                  onCitationClick={(citation) => setPreviewDocumentId(citation.id)}
                />
              ))}

              {/* Permission prompt for the Ask Question tool */}
              {pendingConfirmation && (
                <AssistantPendingRow>
                  <GeneralKnowledgePermissionPrompt
                    query={pendingConfirmation.query}
                    onApprove={() => respondToConfirmation(true)}
                    onDecline={() => respondToConfirmation(false)}
                  />
                </AssistantPendingRow>
              )}

              {/* Typing Indicator */}
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
              <div ref={messagesEndRef} />
            </div>
          )}
        </div>

        <ChatComposer
          ref={inputRef}
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          onSubmit={handleSendMessage}
          onCancel={handleCancelRequest}
          isTyping={isTyping}
          canSend={canSend}
          composer={composer}
          placeholder={composer.items.length ? "Say what to do with the images..." : "Ask me anything about this project..."}
        />
      </div>
      )}

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

      <ChatImageViewer actions={imageActions} />

      <ExpandedMessageModal
        open={!!expandedMessage}
        message={expandedMessage}
        onClose={closeExpanded}
      />

      {previewDocumentId && (
        <DocumentPreviewModal
          documentId={previewDocumentId}
          onClose={() => setPreviewDocumentId(null)}
        />
      )}
    </div>
  );
};

export default ChatInterface;
