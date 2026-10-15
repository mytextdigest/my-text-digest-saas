'use client'
import { Suspense, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Layout from '@/components/layout/Layout';
import TopicsView from '@/components/topics/TopicsView';
import FileUpload from '@/components/documents/FileUpload';
import { Modal, ModalHeader, ModalTitle, ModalContent } from '@/components/ui/Modal';
import { ArrowLeft, Pencil, Upload } from 'lucide-react';
import ChatInterface from "@/components/chat/ChatInterface";
import TwoColumnLayout from "@/components/layout/TwoColumnLayout";
import DeleteConfirmationModal from '@/components/modals/DeleteConfirmationModal';
import EditDocumentModal from '@/components/modals/EditDocumentModal';
import EditProjectModal from '@/components/modals/EditProjectModal';
import { useSession } from "next-auth/react";

const PROCESSING_STATUSES = new Set([
  'queued', 'extracting', 'running_ocr', 'chunked', 'embedding', 'embedded', 'summarizing', 'clustering',
]);


function ProjectPageInner() {
  const [docs, setDocs]       = useState([]);
  const [topics, setTopics]   = useState([]);
  const [project, setProject] = useState(null);
  const [loading, setLoading] = useState(true);
  const [uploadModalOpen, setUploadModalOpen] = useState(false);
  const [activeFilter, setActiveFilter]       = useState('all');
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [documentToDelete, setDocumentToDelete] = useState(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const [showRenameModal, setShowRenameModal]   = useState(false);
  const [documentToRename, setDocumentToRename] = useState(null);
  const [isRenaming, setIsRenaming]             = useState(false);

  const [showEditProjectModal, setShowEditProjectModal] = useState(false);
  const [isEditingProject, setIsEditingProject]         = useState(false);

  const router       = useRouter();
  const searchParams = useSearchParams();
  const projectId    = searchParams.get("id");

  const { data: session } = useSession();
  const userId = session?.user?.id;

  // Polling ref — holds the setInterval id
  const pollRef = useRef(null);

  const stopPolling = () => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  };

  useEffect(() => {
    setDocs([]);
    setTopics([]);
    setProject(null);
    stopPolling();
    if (projectId) {
      loadProject();
      loadDocuments();
      loadTopics();
    }
    return () => stopPolling();
  }, [projectId]);

  const loadProject = async () => {
    try {
      setLoading(true);
  
      const res = await fetch(`/api/projects/${projectId}`, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
      });

      console.log("fetch project: ", res)
  
      if (!res.ok) {
        console.error('Failed to fetch project:', res.status);
        return;
      }
  
      const projectData = await res.json();
      console.log("Project Data: ", projectData)
      setProject(projectData);
    } catch (err) {
      console.error('Failed to load project:', err);
    } finally {
      setLoading(false);
    }
  };
  

  const loadDocuments = async () => {
    try {
      setLoading(true);

      const res = await fetch(`/api/documents?projectId=${projectId}`, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
      });

      if (!res.ok) {
        console.error('Failed to fetch documents:', res.status);
        return;
      }

      const data = await res.json();
      setDocs(prev => {
        // Detect newly-ready documents (were processing, now ready) → reload topics
        const prevIds = new Set(prev.filter(d => PROCESSING_STATUSES.has(d.status)).map(d => d.id));
        const newlyReady = data.filter(d => d.status === 'ready' && prevIds.has(d.id));
        if (newlyReady.length > 0) {
          loadTopics();
        }
        return data;
      });

      // Start polling if any documents are still processing; stop if all done
      const anyProcessing = data.some(d => PROCESSING_STATUSES.has(d.status));
      if (anyProcessing && !pollRef.current) {
        pollRef.current = setInterval(async () => {
          const r = await fetch(`/api/documents?projectId=${projectId}`);
          if (!r.ok) return;
          const fresh = await r.json();
          setDocs(prev => {
            const prevProcessing = new Set(prev.filter(d => PROCESSING_STATUSES.has(d.status)).map(d => d.id));
            const newlyReadyNow = fresh.filter(d => d.status === 'ready' && prevProcessing.has(d.id));
            if (newlyReadyNow.length > 0) loadTopics();
            return fresh;
          });
          const stillProcessing = fresh.some(d => PROCESSING_STATUSES.has(d.status));
          if (!stillProcessing) stopPolling();
        }, 3000);
      } else if (!anyProcessing) {
        stopPolling();
      }
    } catch (err) {
      console.error('Failed to load documents:', err);
    } finally {
      setLoading(false);
    }
  };

  const loadTopics = async () => {
    if (!projectId) return;
    try {
      const res = await fetch(`/api/projects/${projectId}/topics`);
      if (!res.ok) return;
      const data = await res.json();
      setTopics(data);
    } catch (err) {
      console.error('Failed to load topics:', err);
    }
  };

  async function handleFileUpload(file, userId, projectId, visibility) {
    const presignRes = await fetch("/api/s3/upload", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        fileName: file.name,
        fileType: file.type,
        userId,
        projectId,
      }),
    });
  
    const presignData = await presignRes.json();
  
    // 🔴 Handle early rejection
    if (!presignRes.ok) {
      if (presignData?.error === "DUPLICATE_FILENAME") {
        throw new Error(presignData.message || "Duplicate filename");
      }
  
      throw new Error("Failed to prepare upload");
    }
  
    const { url, fields, key } = presignData;
  
    // ✅ Safe now
    const formData = new FormData();
    Object.entries(fields).forEach(([k, v]) => formData.append(k, v));
    formData.append("file", file);
  
    const upload = await fetch(url, { method: "POST", body: formData });
    if (!upload.ok) {
      throw new Error("S3 upload failed");
    }
  
    const ingestForm = new FormData();
    ingestForm.append("s3Key", key);
    ingestForm.append("projectId", projectId);
    ingestForm.append("visibility", visibility);
  
    const ingestRes = await fetch("/api/documents/ingest", {
      method: "POST",
      body: ingestForm,
    });
  
    if (!ingestRes.ok) {
      throw new Error("Ingestion failed");
    }
  
    await loadDocuments();
  }
  

  const handleDelete = async (id) => {
    const docToDelete = docs.find(doc => doc.id === id);
    setDocumentToDelete(docToDelete);
    setShowDeleteModal(true);
  };

  const handleConfirmDelete = async () => {
    if (!documentToDelete) return;
    setIsDeleting(true);
  
    try {
      console.log("Document id: ", documentToDelete.id)
      const res = await fetch(`/api/documents/${documentToDelete.id}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
      });
  
      if (!res.ok) {
        console.error("Failed to delete document:", res.status);
        return;
      }
  
      await loadDocuments();
      setShowDeleteModal(false);
    } catch (err) {
      console.error("Error deleting document:", err);
    } finally {
      setIsDeleting(false);
    }
  };
  

  const handleCancelDelete = () => {
    setShowDeleteModal(false);
    setDocumentToDelete(null);
  };

  const handleToggleStar = async (id) => {
    try {
      const res = await fetch(`/api/documents/${id}/star`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
      });
  
      if (!res.ok) {
        console.error("Failed to toggle star:", res.status);
        return;
      }
  
      const { starred } = await res.json();
  
      // update locally without re-fetching everything
      setDocs((prev) =>
        prev.map((doc) =>
          doc.id === id ? { ...doc, starred } : doc
        )
      );
    } catch (err) {
      console.error("Failed to toggle star:", err);
    }
  };

  const handleToggleSelect = async (id) => {
    try {
      // If running inside Electron, use the API instead of IPC
      // if (typeof window !== "undefined" && !window.api) {
      //   // Browser dev fallback (same as before)
      //   setDocuments((docs) =>
      //     docs.map((doc) =>
      //       doc.id === id ? { ...doc, selected: !doc.selected } : doc
      //     )
      //   );
      //   return;
      // }
  
      // --- API CALL (replacing the IPC handler) ---
      const res = await fetch(`/api/documents/${id}/toggle-selection`, {
        method: "POST",
      });
  
      const data = await res.json();
  
      if (!data.success) {
        console.error("Toggle selection API error:", data.error);
        return;
      }
  
      // Reload documents from server
      await loadDocuments();
    } catch (err) {
      console.error("Toggle selection failed:", err);
    }
  };

  const handleRetry = async (id) => {
    try {
      const res = await fetch(`/api/documents/${id}/retry`, { method: "POST" });
      const data = await res.json();

      if (!res.ok || !data.success) {
        console.error("Retry failed:", data.error);
        return;
      }

      // Doc is back in a processing status — loadDocuments() will resume polling.
      await loadDocuments();
    } catch (err) {
      console.error("Retry failed:", err);
    }
  };

  const handleRename = (doc) => {
    setDocumentToRename(doc);
    setShowRenameModal(true);
  };

  const handleSaveRename = async (newFilename) => {
    if (!documentToRename) return;
    setIsRenaming(true);
    try {
      const res = await fetch(`/api/documents/${documentToRename.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename: newFilename }),
      });
      if (!res.ok) {
        const data = await res.json();
        console.error('Rename failed:', data.error);
        return;
      }
      setDocs((prev) =>
        prev.map((d) => d.id === documentToRename.id ? { ...d, filename: newFilename } : d)
      );
      setShowRenameModal(false);
      setDocumentToRename(null);
    } catch (err) {
      console.error('Rename error:', err);
    } finally {
      setIsRenaming(false);
    }
  };

  const handleRecluster = async () => {
    try {
      await fetch(`/api/projects/${projectId}/recluster`, { method: 'POST' });
      // Start polling to pick up clustering status updates
      if (!pollRef.current) {
        pollRef.current = setInterval(async () => {
          const r = await fetch(`/api/documents?projectId=${projectId}`);
          if (!r.ok) return;
          const fresh = await r.json();
          setDocs(prev => {
            const prevProcessing = new Set(prev.filter(d => PROCESSING_STATUSES.has(d.status)).map(d => d.id));
            const newlyReadyNow = fresh.filter(d => d.status === 'ready' && prevProcessing.has(d.id));
            if (newlyReadyNow.length > 0) loadTopics();
            return fresh;
          });
          const stillProcessing = fresh.some(d => PROCESSING_STATUSES.has(d.status));
          if (!stillProcessing) { stopPolling(); loadTopics(); }
        }, 3000);
      }
    } catch (err) {
      console.error('Recluster failed:', err);
    }
  };

  const handleEditProject = () => setShowEditProjectModal(true);

  const handleSaveProject = async (name, description) => {
    if (!projectId) return;
    setIsEditingProject(true);
    try {
      const res = await fetch(`/api/projects/${projectId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, description }),
      });
      if (!res.ok) {
        const data = await res.json();
        console.error('Project update failed:', data.error);
        return;
      }
      const updated = await res.json();
      setProject(updated);
      setShowEditProjectModal(false);
    } catch (err) {
      console.error('Project update error:', err);
    } finally {
      setIsEditingProject(false);
    }
  };

  // Documents column: a header row (Back, project name, Upload) that lines up
  // with the chat column's, over the topic list — no title block or margins.
  const projectName = project ? project.name : `Project ${projectId}`;
  const documentPanel = (
    <div className="h-full flex flex-col bg-white dark:bg-gray-900">
      <div className="shrink-0 h-12 flex items-center gap-2 pl-3 pr-2 border-b border-gray-200 dark:border-gray-700">
        <button
          type="button"
          onClick={() => router.push('/dashboard/')}
          title="Back to projects"
          className="shrink-0 inline-flex items-center gap-1.5 h-8 px-2.5 rounded-md border border-gray-200 dark:border-gray-700 text-sm font-medium text-gray-700 hover:text-gray-900 hover:bg-gray-50 dark:text-gray-300 dark:hover:text-gray-100 dark:hover:bg-gray-800 transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
          <span>Back</span>
        </button>
        <div className="flex-1 min-w-0 flex items-center gap-1">
          <h1
            className="min-w-0 truncate text-sm font-semibold text-gray-900 dark:text-gray-100"
            title={project?.description ? `${projectName} — ${project.description}` : projectName}
          >
            {projectName}
          </h1>
          {project && (
            <button
              type="button"
              onClick={handleEditProject}
              title="Edit project name and description"
              aria-label="Edit project"
              className="shrink-0 h-7 w-7 inline-flex items-center justify-center rounded-md text-gray-400 hover:text-gray-700 hover:bg-gray-100 dark:text-gray-500 dark:hover:text-gray-200 dark:hover:bg-gray-800 transition-colors"
            >
              <Pencil className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
        <button
          type="button"
          onClick={() => setUploadModalOpen(true)}
          className="shrink-0 inline-flex items-center gap-1.5 h-8 px-3 rounded-md bg-primary-600 hover:bg-primary-700 text-white text-sm font-medium transition-colors"
        >
          <Upload className="h-4 w-4" />
          <span>Upload</span>
        </button>
      </div>

      <div className="flex-1 min-h-0">
        <TopicsView
          topics={topics}
          documents={docs}
          loading={loading}
          projectId={projectId}
          onUpload={() => setUploadModalOpen(true)}
          onView={(doc) => router.push(`/document?id=${doc.id}`)}
          onDelete={handleDelete}
          onToggleStar={handleToggleStar}
          onToggleSelect={handleToggleSelect}
          onRename={handleRename}
          onRetry={handleRetry}
          onTopicsChange={async () => { await loadDocuments(); await loadTopics(); }}
          onReclusterUnassigned={handleRecluster}
          activeFilter={activeFilter}
          onFilterChange={setActiveFilter}
        />
      </div>
    </div>
  );

  const chatPanel = (
    <div className="h-full">
      <ChatInterface className="h-full" projectId={projectId} onDocumentAdded={loadDocuments} />
    </div>
  );

  return (
    <Layout fullBleed>
      <div className="h-full">
        <TwoColumnLayout
          leftColumn={documentPanel}
          rightColumn={chatPanel}
          leftTitle="Documents"
          rightTitle="Chat"
          resizable="project"
        />
      </div>

      <Modal
        isOpen={uploadModalOpen}
        onClose={() => setUploadModalOpen(false)}
        size="lg"
      >
        <ModalHeader>
          <ModalTitle>Upload Documents</ModalTitle>
        </ModalHeader>
        <ModalContent className="flex flex-col max-h-[calc(100vh-8rem)] overflow-hidden">
          <FileUpload
            onUpload={(file, visibility) => handleFileUpload(file, userId, projectId, visibility)}
            onClose={() => setUploadModalOpen(false)}
          />
        </ModalContent>
      </Modal>

      {/* Delete Confirmation Modal */}
      <DeleteConfirmationModal
        isOpen={showDeleteModal}
        onClose={handleCancelDelete}
        onConfirm={handleConfirmDelete}
        title="Delete Document"
        message={`Are you sure you want to delete "${documentToDelete?.filename}"? This action cannot be undone.`}
        confirmText="Delete Document"
        cancelText="Cancel"
        isLoading={isDeleting}
      />

      {/* Rename Document Modal */}
      <EditDocumentModal
        isOpen={showRenameModal}
        onClose={() => { setShowRenameModal(false); setDocumentToRename(null); }}
        onSave={handleSaveRename}
        document={documentToRename}
        isLoading={isRenaming}
      />

      {/* Edit Project Modal */}
      <EditProjectModal
        isOpen={showEditProjectModal}
        onClose={() => setShowEditProjectModal(false)}
        onSave={handleSaveProject}
        project={project}
        isLoading={isEditingProject}
      />

    </Layout>
  );
}

// Loading component for Suspense fallback
function ProjectLoading() {
  return (
    <Layout>
      <div className="h-[calc(100vh-8rem)] flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto mb-4"></div>
          <p className="text-gray-600 dark:text-gray-400">Loading project...</p>
        </div>
      </div>
    </Layout>
  );
}

// Main component with Suspense boundary
export default function ProjectPage() {
  return (
    <Suspense fallback={<ProjectLoading />}>
      <ProjectPageInner />
    </Suspense>
  );
}
