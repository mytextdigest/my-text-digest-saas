'use client'
import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Layout from '@/components/layout/Layout';
import DocumentGrid from '@/components/documents/DocumentGrid';
import FileUpload from '@/components/documents/FileUpload';
import { Modal, ModalHeader, ModalTitle, ModalContent } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { ArrowLeft } from 'lucide-react';
import { motion } from 'framer-motion';
import ChatInterface from "@/components/chat/ChatInterface";
import TwoColumnLayout from "@/components/layout/TwoColumnLayout";
import DeleteConfirmationModal from '@/components/modals/DeleteConfirmationModal';
import { useSession } from "next-auth/react";


function ProjectPageInner() {
  const [docs, setDocs] = useState([]);
  const [project, setProject] = useState(null);
  const [loading, setLoading] = useState(true);
  const [uploadModalOpen, setUploadModalOpen] = useState(false);
  const [activeFilter, setActiveFilter] = useState('all');
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [documentToDelete, setDocumentToDelete] = useState(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const router = useRouter();
  const searchParams = useSearchParams();
  const projectId = searchParams.get("id");

  const { data: session } = useSession();
  const userId = session?.user?.id;

  useEffect(() => {
    setDocs([]);
    setProject(null);
    if (projectId) {
      loadProject();
      loadDocuments();
    }
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

      setDocs(data);

      // console.log("Loaded document: ", data)
    } catch (err) {
      console.error('Failed to load documents:', err);
    } finally {
      setLoading(false);
    }
  };

  async function handleFileUpload(file, userId, projectId) {
    //  Get presigned URL from backend
    const presignRes = await fetch("/api/s3/upload", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        fileName: file.name,
        fileType: file.type,
        userId,
      }),
    });
  
    const { url, fields, key } = await presignRes.json();
  
    // 2️⃣ Upload file directly to S3
    const formData = new FormData();
    Object.entries(fields).forEach(([k, v]) => formData.append(k, v));
    formData.append("file", file);

    console.log("Presigned URL:", url);
    console.log("Presigned fields:", fields);
  
    const upload = await fetch(url, { method: "POST", body: formData });
    if (!upload.ok) {
      const errText = await upload.text();
      console.error("❌ S3 upload failed:", errText);
      throw new Error("S3 upload failed");
    }
  
    console.log("✅ File uploaded to S3:", key);
  
    // 3️⃣ Call ingestion API
    const ingestForm = new FormData();
    ingestForm.append("s3Key", key);
    ingestForm.append("projectId", projectId);

    console.log("Uploading file:", { name: file.name, type: file.type, userId });

  
    const ingestRes = await fetch("/api/documents/ingest", {
      method: "POST",
      body: ingestForm,
    });
  
    if (!ingestRes.ok) throw new Error("Ingestion failed");
    // console.log("📄 Ingestion started for:", file.name);

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

  // const filteredDocs = activeFilter === 'starred' ? docs.filter(d => d.starred) : docs;

  const filteredDocs =
    activeFilter === 'starred'
      ? docs.filter(d => d.starred)
      : activeFilter === 'unselected'
      ? docs.filter(d => d.selected === 0 || d.selected === false || d.selected === null)
      : docs;

  const documentPanel = (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5 }}
      className="h-full flex flex-col space-y-6 pt-2.5"
    >
      {/* Page Header */}
      <div className="flex items-center justify-between mb-4">
        <Button
          variant="ghost"
          onClick={() => router.push('/dashboard/')}
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
          <span>Back to Projects</span>
        </Button>
      </div>

      <div className="text-center">
        <h1 className="text-3xl font-bold text-gray-900 dark:text-gray-100">
          {project ? project.name : `Project ${projectId}`}
        </h1>
        <p className="text-gray-600 dark:text-gray-400 mt-2">
          {project?.description && <span>{project.description}</span>}
        </p>
        <p className="text-gray-600 dark:text-gray-400 mt-2">
          Manage and organize project files
        </p>
      </div>

      <div className="flex-1 min-h-0">
        <DocumentGrid
          documents={filteredDocs}
          loading={loading}
          onUpload={() => setUploadModalOpen(true)}
          onView={(doc) => router.push(`/document?id=${doc.id}`)}
          onDelete={handleDelete}
          onToggleStar={handleToggleStar}
          onToggleSelect={handleToggleSelect}
          activeFilter={activeFilter}
          onFilterChange={setActiveFilter}
        />
      </div>
    </motion.div>
  );

  const chatPanel = (
    <div className="h-full">
      <ChatInterface className="h-full" projectId={projectId} />
    </div>
  );

  return (
    <Layout>
      <div className="h-[calc(100vh-8rem)]"> 
        <TwoColumnLayout
          leftColumn={documentPanel}
          rightColumn={chatPanel}
          leftTitle="Documents"
          rightTitle="Chat"
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
        <ModalContent>
          <FileUpload
            onUpload={(file) => handleFileUpload(file, userId, projectId)}
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
