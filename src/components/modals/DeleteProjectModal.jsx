'use client'
import { motion } from 'framer-motion';

export default function DeleteProjectModal({ project, onCancel, onConfirm }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <motion.div
        initial={{ scale: 0.9, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        className="bg-white dark:bg-gray-900 rounded-2xl shadow-xl p-6 w-full max-w-md"
      >
        <h2 className="text-2xl font-semibold text-red-600 mb-3">
          Delete Project
        </h2>
        <p className="text-gray-700 dark:text-gray-300 mb-5">
          Are you sure you want to delete <strong>{project.name}</strong>?  
          <br />
          This will permanently remove all documents, summaries, and chats under this project.
        </p>

        <div className="flex justify-end gap-3">
          <button
            onClick={onCancel}
            className="px-4 py-2 rounded-lg bg-gray-200 dark:bg-gray-700"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            className="px-4 py-2 rounded-lg bg-red-600 text-white hover:bg-red-700"
          >
            Delete
          </button>
        </div>
      </motion.div>
    </div>
  );
}
