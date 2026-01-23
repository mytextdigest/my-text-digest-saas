'use client'
import { useState } from 'react';
import { motion } from 'framer-motion';

export default function CreateProjectModal({ onClose, onCreate }) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [error, setError] = useState(null);


  const handleSubmit = async () => {
    if (!name.trim()) {
      setError("Please enter a project name.");
      return;
    }
  
    const result = await onCreate(name, description);
  
    if (result?.error) {
      setError(result.message || "Failed to create project.");
      return;
    }
  
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <motion.div
        initial={{ scale: 0.9, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        className="bg-white dark:bg-gray-900 rounded-2xl shadow-xl p-6 w-full max-w-md"
      >
        <h2 className="text-2xl font-semibold mb-4">Create New Project</h2>

        <input
          type="text"
          placeholder="Project name"
          className="w-full p-2 border rounded-lg mb-3 dark:bg-gray-800 dark:border-gray-700"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />

        <textarea
          placeholder="Description (optional)"
          className="w-full p-2 border rounded-lg mb-4 dark:bg-gray-800 dark:border-gray-700"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
        {error && (
          <div className="mb-3 text-sm text-red-600 dark:text-red-400">
            {error}
          </div>
        )}

        <div className="flex justify-end gap-3">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-lg bg-gray-200 dark:bg-gray-700"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            className="px-4 py-2 rounded-lg bg-blue-600 text-white hover:bg-blue-700"
          >
            Create
          </button>
        </div>
      </motion.div>
    </div>
  );
}
