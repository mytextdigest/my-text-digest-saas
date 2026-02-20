'use client'
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Layout from '@/components/layout/Layout';
import { motion } from 'framer-motion';
import { Trash2, Plus, Search, SortDesc } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import DeleteProjectModal from '@/components/modals/DeleteProjectModal';
import CreateProjectModal from '@/components/modals/CreateProjectModal';
import { Input } from '@/components/ui/Input';
import { cn } from '@/lib/utils';

export default function ProjectsPage() {
  const [projects, setProjects] = useState([]);
  const [loading, setLoading] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState(null); // {id, name}
  const [searchQuery, setSearchQuery] = useState('');
  const [sortBy, setSortBy] = useState('date'); // 'name' or 'date'
  const [sortOrder, setSortOrder] = useState('desc'); // 'asc' or 'desc'
  const router = useRouter();

  useEffect(() => {
    const checkApiKey = async () => {
      if (typeof window !== "undefined" && window.api) {
        const key = await window.api.getApiKey();
        // if (!key) router.push("/setup/");
      }
    };
    checkApiKey();
    loadProjects();
  }, []);

  const loadProjects = async () => {
    try {
      setLoading(true);
      // Browser mock fallback
      if (typeof window !== 'undefined' && window.api) {
        // keep old flow for electron-mode (optional)
        const list = await window.api.listProjects();
        setProjects(list);
        return;
      }
  
      // SaaS / web mode
      const res = await fetch('/api/projects');
      if (!res.ok) throw new Error('Failed to fetch projects');
      const data = await res.json();
  
      // `data` is an array of projects with `created_at`
      setProjects(data);
    } catch (err) {
      console.error('Failed to load projects:', err);
    } finally {
      setLoading(false);
    }
  };

  const openProject = (id) => router.push(`/project?id=${id}`);

  const handleCreate = async (name, description) => {
    try {
      const res = await fetch('/api/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, description }),
      });
  
      const result = await res.json();
  
      if (!res.ok) {
        return {
          error: true,
          message:
            result.message ||
            (result.error === "PROJECT_ALREADY_EXISTS"
              ? "A project with this name already exists."
              : "Failed to create project.")
        };
      }
  
      await loadProjects();
      return { success: true };
  
    } catch (err) {
      return {
        error: true,
        message: "Network error. Please try again."
      };
    }
  };
  

  const handleDelete = async (id, name) => {
    setDeleteTarget({ id, name });
  };

  const confirmDelete = async (id) => {
    try {
      setLoading(true);
  
      if (typeof window !== "undefined" && window.api) {
        const result = await window.api.deleteProject(id);
        if (result.success) {
          await loadProjects();
        } else {
          alert(`❌ ${result.error}`);
        }
        return;
      }
  
      const res = await fetch(`/api/projects/${id}`, { method: 'DELETE' });
      const result = await res.json();
      if (res.ok && result.success) {
        await loadProjects();
      } else {
        alert(`❌ ${result.error || 'Delete failed'}`);
      }
    } catch (err) {
      console.error('Delete failed:', err);
    } finally {
      setLoading(false);
    }
  };

  const toggleSort = (field) => {
    if (sortBy === field) {
      setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
    } else {
      setSortBy(field);
      setSortOrder('asc');
    }
  };

  // Filter and sort projects
  const filteredProjects = projects
    .filter(project => {
      const matchesSearch = project.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
                           (project.description && project.description.toLowerCase().includes(searchQuery.toLowerCase()));
      return matchesSearch;
    })
    .sort((a, b) => {
      let comparison = 0;
      
      if (sortBy === 'name') {
        comparison = a.name.localeCompare(b.name);
      } else if (sortBy === 'date') {
        comparison = new Date(a.created_at) - new Date(b.created_at);
      }
      
      return sortOrder === 'asc' ? comparison : -comparison;
    });

  return (
    <Layout>
      <div className="max-w-7xl mx-auto px-6 py-8">
          {/* Page Header */}
          <div className="text-center mb-8">
            <h1 className="text-3xl font-bold text-gray-900 dark:text-gray-100 mb-2">
              My Text Digest
            </h1>
            <p className="text-gray-600 dark:text-gray-400">
              Document Management System
            </p>
          </div>

          {/* Projects Section Header */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
            <div>
              <h2 className="text-2xl font-bold text-gray-900 dark:text-gray-100">My Projects</h2>
              <p className="text-gray-600 dark:text-gray-400 mt-1">
                Organize, manage, and collaborate on your documents with powerful AI-driven insights
              </p>
            </div>
            <Button
              onClick={() => setShowCreateModal(true)}
              className="h-12 text-base font-medium bg-blue-600 hover:bg-blue-700"
            >
              <Plus className="w-5 h-5 mr-2" />
              New Project
            </Button>

            
          </div>

          {/* Search and Sort Controls */}
          <div className="flex flex-col sm:flex-row gap-4 mb-6">
            {/* Search Bar */}
            <div className="flex-1 relative">

              <Input
                placeholder="Search projects..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                leftIcon={<Search className="h-4 w-4" />}
                className="w-full pr-10"   // space for clear button
              />

              {/* CLEAR BUTTON */}
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery("")}
                  className="
                    absolute right-2 top-1/2 -translate-y-1/2

                    text-xs font-medium
                    px-2.5 py-1
                    rounded-full

                    bg-gray-100 text-gray-600
                    hover:bg-gray-200 hover:text-gray-800

                    dark:bg-gray-800 dark:text-gray-300
                    dark:hover:bg-gray-700 dark:hover:text-gray-100

                    transition
                    select-none
                  "
                  aria-label="Clear search"
                  title="Clear search"
                >
                  Clear Search
                </button>
              )}

            </div>

            {/* Sort Controls */}
            <div className="flex items-center gap-2">
              <Button
                variant={sortBy === 'name' ? 'default' : 'outline'}
                size="sm"
                onClick={() => toggleSort('name')}
                className={cn(
                  "flex items-center space-x-1",
                  sortBy === 'name'
                    ? "text-white dark:text-gray-200"
                    : "text-gray-600 dark:text-gray-400"
                )}
              >
                <span>Name</span>
                {sortBy === 'name' && (
                  sortOrder === 'asc' ? <SortAsc className="h-4 w-4" /> : <SortDesc className="h-4 w-4" />
                )}
              </Button>

              <Button
                variant={sortBy === 'date' ? 'default' : 'outline'}
                size="sm"
                onClick={() => toggleSort('date')}
                className={cn(
                  "flex items-center space-x-1",
                  sortBy === 'date'
                    ? "text-white dark:text-gray-200"
                    : "text-gray-600 dark:text-gray-400"
                )}
              >
                <span>Date</span>
                {sortBy === 'date' && (
                  sortOrder === 'asc' ? <SortAsc className="h-4 w-4" /> : <SortDesc className="h-4 w-4" />
                )}
              </Button>
            </div>
          </div>

          {/* Project Count and Loading */}
          <div className="flex items-center space-x-4 mb-6">
            <div className="text-sm text-gray-500 dark:text-gray-400">
              {filteredProjects.length} {filteredProjects.length === 1 ? 'project' : 'projects'}
            </div>
            {loading && (
              <div className="flex items-center space-x-2 text-blue-600 dark:text-blue-400">
                <div className="w-4 h-4 border-2 border-blue-600 border-t-transparent rounded-full animate-spin"></div>
                <span className="text-sm">Loading...</span>
              </div>
            )}
          </div>

          {/* Empty State */}
          {filteredProjects.length === 0 && !loading && (
            <div className="text-center py-20">
              <div className="w-16 h-16 mx-auto mb-4 bg-gray-100 dark:bg-gray-800 rounded-full flex items-center justify-center">
                <Plus className="w-8 h-8 text-gray-600 dark:text-gray-400" />
              </div>
              <h3 className="text-xl font-semibold text-gray-900 dark:text-white mb-2">
                No projects yet
              </h3>
              <p className="text-gray-600 dark:text-gray-400 mb-6 max-w-md mx-auto">
                Create your first project to start organizing your documents
              </p>
              <button
                onClick={() => setShowCreateModal(true)}
                className="inline-flex items-center space-x-2 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg font-medium transition-colors"
              >
                <Plus className="w-4 h-4" />
                <span>Create First Project</span>
              </button>
            </div>
          )}

          {/* Projects Grid */}
          {filteredProjects.length > 0 && (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
              {filteredProjects.map((project) => (
                <div
                  key={project.id}
                  className="group relative bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600 transition-all duration-300 hover:shadow-lg overflow-hidden"
                >
                  {/* Gradient Hover Effect */}
                  <div className="absolute inset-0 bg-gradient-to-br from-blue-500/10 via-purple-500/10 to-pink-500/10 opacity-0 group-hover:opacity-100 transition-opacity duration-300 pointer-events-none"></div>
                  
                  <div className="relative p-6">
                    {/* Project Header */}
                    <div className="flex items-center justify-between mb-4">
                      <div className="w-10 h-10 bg-blue-600 rounded-lg flex items-center justify-center">
                        <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
                        </svg>
                      </div>
                      
                      {/* Delete Button */}
                      <button
                        className="opacity-0 group-hover:opacity-100 transition-opacity p-2 rounded-lg hover:bg-red-50 dark:hover:bg-red-900/20"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDelete(project.id, project.name);
                        }}
                        title="Delete Project"
                      >
                        <Trash2 className="w-4 h-4 text-red-500 hover:text-red-600" />
                      </button>
                    </div>

                    {/* Project Info */}
                    <div 
                      onClick={() => openProject(project.id)}
                      className="cursor-pointer"
                    >
                      <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-2 group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors">
                        {project.name}
                      </h3>
                      
                      <p className="text-gray-600 dark:text-gray-400 mb-4 text-sm line-clamp-2">
                        {project.description || "No description provided"}
                      </p>

                      {/* Metadata */}
                      <div className="flex items-center justify-between text-sm">
                        <div className="flex items-center space-x-2 text-gray-500 dark:text-gray-400">
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                          </svg>
                          <span>{new Date(project.created_at).toLocaleDateString()}</span>
                        </div>
                        
                        <div className="flex items-center space-x-1 text-blue-600 dark:text-blue-400 opacity-0 group-hover:opacity-100 transition-opacity">
                          <span className="text-sm font-medium">Open</span>
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                          </svg>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
             </div>
          )}
        </div>

      {/* Modals */}
      {showCreateModal && (
        <CreateProjectModal
          onClose={() => setShowCreateModal(false)}
          onCreate={handleCreate}
        />
      )}
      {deleteTarget && (
        <DeleteProjectModal
          project={deleteTarget}
          onCancel={() => setDeleteTarget(null)}
          onConfirm={async () => {
            await confirmDelete(deleteTarget.id);
            setDeleteTarget(null);
          }}
        />
      )}
    </Layout>
  );
}
