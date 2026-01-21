import { useState, useRef, useCallback, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Upload, X, FileText, AlertCircle, CheckCircle } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { cn, formatFileSize } from '@/lib/utils';

const FileUpload = ({ 
  onUpload, 
  onClose,
  acceptedTypes = ['.txt', '.pdf', '.docx'],
  maxFileSize = 10 * 1024 * 1024, // 10MB
  className 
}) => {
  const [dragActive, setDragActive] = useState(false);
  const [files, setFiles] = useState([]);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState({});
  const [finalizing, setFinalizing] = useState({});
  const [showVisibilityInfo, setShowVisibilityInfo] = useState(true);
  const [subscription, setSubscription] = useState(null);

  const fileInputRef = useRef(null);

  useEffect(() => {
    fetch("/api/subscription")
      .then(res => res.json())
      .then(data => setSubscription(data))
      .catch(() => setSubscription(null));
  }, []);


  const planLimitBytes = subscription?.plan
    ? subscription.plan.storageLimitGb * 1024 * 1024 * 1024
    : null;

  const currentUsageBytes = subscription?.user?.storageUsedBytes
    ? Number(subscription.user.storageUsedBytes)
    : 0;

  const selectedBytes = files
    .filter(f => f.status === "pending")
    .reduce((sum, f) => sum + f.size, 0);

  const exceedsStorage =
    planLimitBytes !== null &&
    currentUsageBytes + selectedBytes > planLimitBytes;
  
  console.log("selectedBytes: ",selectedBytes)

  const validateFile = (file) => {
    const errors = [];
    
    // Check file type
    const fileExtension = '.' + file.name.split('.').pop().toLowerCase();
    if (!acceptedTypes.includes(fileExtension)) {
      errors.push(`File type ${fileExtension} is not supported`);
    }
    
    // Check file size
    if (file.size > maxFileSize) {
      errors.push(`File size exceeds ${formatFileSize(maxFileSize)} limit`);
    }
    
    return errors;
  };

  const handleFiles = useCallback((fileList) => {
    const newFiles = Array.from(fileList).map(file => {
      const errors = validateFile(file);
      return {
        id: Math.random().toString(36).substr(2, 9),
        file,
        name: file.name,
        size: file.size,
        errors,
        status: errors.length > 0 ? 'error' : 'pending',
        visibility: null,
      };
    });
    
    setFiles(prev => [...prev, ...newFiles]);
  }, [acceptedTypes, maxFileSize]);

  const handleDrag = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") {
      setDragActive(true);
    } else if (e.type === "dragleave") {
      setDragActive(false);
    }
  }, []);

  const handleDrop = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleFiles(e.dataTransfer.files);
    }
  }, [handleFiles]);

  const handleFileInput = (e) => {
    if (e.target.files && e.target.files[0]) {
      handleFiles(e.target.files);
    }
  };

  const removeFile = (id) => {
    setFiles(prev => prev.filter(f => f.id !== id));
  };

  // Upload Files
  const uploadFiles = async () => {
    let hadErrors = false;

    const validFiles = files.filter(f => f.status === 'pending');
    if (validFiles.length === 0) return;

    // block upload if any file has no visibility
    const missingVisibility = validFiles.some(f => !f.visibility);
    if (missingVisibility) {
      setFiles(prev =>
        prev.map(f =>
          f.status === 'pending' && !f.visibility
            ? { ...f, errors: ['Visibility is required'] }
            : f
        )
      );
      return;
    }
  
    setUploading(true);
  
    for (const fileItem of validFiles) {
      try {
        // Start progress
        setUploadProgress(prev => ({ ...prev, [fileItem.id]: 0 }));
  
        // Simulated progress up to 90%
        for (let progress = 0; progress <= 90; progress += 10) {
          setUploadProgress(prev => ({ ...prev, [fileItem.id]: progress }));
          await new Promise(resolve => setTimeout(resolve, 100));
        }
  
        // Actual upload (network / backend)
        await onUpload(fileItem.file, fileItem.visibility);
  
        // Mark as fully complete only AFTER upload finishes
        setUploadProgress(prev => ({ ...prev, [fileItem.id]: 100 }));
  
        setFiles(prev =>
          prev.map(f =>
            f.id === fileItem.id ? { ...f, status: 'success' } : f
          )
        );
      } catch (error) {

          hadErrors = true;

          console.error('Upload failed:', error);
        
          const message =
            error?.message ||
            'Upload failed';
        
          setFiles(prev =>
            prev.map(f =>
              f.id === fileItem.id
                ? { ...f, status: 'error', errors: [message] }
                : f
            )
          );
      }
    }
  
    setUploading(false);
  
    // Close modal after successful uploads
    if (!hadErrors) {
      setTimeout(() => {
        onClose();
      }, 800);
    }
  };
  

  const validFiles = files.filter(f => f.status === 'pending').length;
  const hasErrors = files.some(f => f.errors.length > 0);

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.95 }}
      className={cn(
        "w-full max-w-2xl mx-auto p-2",
        "flex flex-col max-h-[90vh] overflow-hidden",
        className
      )}
    >

      <div className="flex-1 overflow-y-auto pr-1">
        {/* Drop Zone */}
        <div
          className={cn(
            "relative border-2 border-dashed rounded-xl p-8 text-center transition-all",
            dragActive 
              ? "border-primary-500 bg-primary-50 dark:bg-primary-900/20" 
              : "border-gray-300 dark:border-gray-700 hover:border-gray-400 dark:hover:border-gray-600"
          )}
          onDragEnter={handleDrag}
          onDragLeave={handleDrag}
          onDragOver={handleDrag}
          onDrop={handleDrop}
        >
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept={acceptedTypes.join(',')}
            onChange={handleFileInput}
            className="hidden"
          />
          
          <div className="space-y-4">
            <div className="w-16 h-16 mx-auto bg-gray-100 dark:bg-gray-800 rounded-full flex items-center justify-center">
              <Upload className="w-8 h-8 text-gray-400" />
            </div>
            
            <div>
              <h3 className="text-lg font-medium text-gray-900 dark:text-gray-100">
                Drop files here or click to browse
              </h3>
              <p className="text-sm text-gray-600 dark:text-gray-400 mt-2">
                Supports {acceptedTypes.join(', ')} files up to {formatFileSize(maxFileSize)}
              </p>
            </div>
            
            <Button
              variant="outline"
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
            >
              Choose Files
            </Button>
          </div>
        </div>

        {/* File List */}
        <AnimatePresence>
          {files.length > 0 && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              className="mt-6 space-y-3"
            >
              <h4 className="text-sm font-medium text-gray-900 dark:text-gray-100">
                Selected Files ({files.length})
              </h4>

              {/* Batch Visibility Controls */}
              <div className="flex items-center gap-2 p-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/40">
                <span className="text-xs text-gray-500 dark:text-gray-400 mr-1">
                  Apply to all:
                </span>

                <button
                  onClick={() =>
                    setFiles(prev => prev.map(f => ({ ...f, visibility: null })))
                  }
                  className="px-3 py-1.5 text-xs rounded-md border border-gray-300 dark:border-gray-600
                            bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300
                            hover:bg-gray-100 dark:hover:bg-gray-700 transition"
                >
                  Clear
                </button>

                <button
                  onClick={() =>
                    setFiles(prev => prev.map(f => ({ ...f, visibility: 'private' })))
                  }
                  className="px-3 py-1.5 text-xs rounded-md border
                            border-yellow-300 dark:border-yellow-700
                            bg-yellow-50 dark:bg-yellow-900/30
                            text-yellow-800 dark:text-yellow-300
                            hover:bg-yellow-100 dark:hover:bg-yellow-900/50 transition"
                >
                  Private
                </button>

                <button
                  onClick={() =>
                    setFiles(prev => prev.map(f => ({ ...f, visibility: 'public' })))
                  }
                  className="px-3 py-1.5 text-xs rounded-md border
                            border-green-300 dark:border-green-700
                            bg-green-50 dark:bg-green-900/30
                            text-green-800 dark:text-green-300
                            hover:bg-green-100 dark:hover:bg-green-900/50 transition"
                >
                  Public
                </button>
              </div>
              
              <div className="space-y-2 max-h-40 overflow-y-auto">
                {files.map((fileItem) => (
                  <motion.div
                    key={fileItem.id}
                    initial={{ opacity: 0, x: -20 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: 20 }}
                    className={cn(
                      "flex items-center justify-between p-3 rounded-lg border",
                      fileItem.status === 'error' && "border-error-200 bg-error-50 dark:bg-error-900/20",
                      fileItem.status === 'success' && "border-success-200 bg-success-50 dark:bg-success-900/20",
                      fileItem.status === 'pending' && "border-gray-200 bg-gray-50 dark:bg-gray-800"
                    )}
                  >
                    <div className="flex items-center space-x-3 flex-1 min-w-0">
                      <div className="flex-shrink-0">
                        {fileItem.status === 'success' ? (
                          <CheckCircle className="w-5 h-5 text-success-600" />
                        ) : fileItem.status === 'error' ? (
                          <AlertCircle className="w-5 h-5 text-error-600" />
                        ) : (
                          <FileText className="w-5 h-5 text-gray-400" />
                        )}
                      </div>
                      
                      <div className="flex-1 min-w-0">
                        <p 
                          className={cn(
                            "text-sm font-medium text-gray-900 truncate",
                            fileItem.status === 'pending' && "dark:text-gray-100 ",
                            fileItem.status === 'error' && "dark:text-gray-400 "
                          )}
                        >
                          {fileItem.name}
                        </p>
                        <p className="text-xs text-gray-500 dark:text-gray-400">
                          {formatFileSize(fileItem.size)}
                        </p>

                        {/* Visibility selector */}
                        {fileItem.status === 'pending' && (
                          <div className="flex items-center gap-2 mt-2">
                            {['private', 'public'].map(v => (
                              <button
                                key={v}
                                onClick={() =>
                                  setFiles(prev =>
                                    prev.map(f =>
                                      f.id === fileItem.id ? { ...f, visibility: v } : f
                                    )
                                  )
                                }
                                className={cn(
                                  "px-3 py-1 text-xs rounded-md border",
                                  fileItem.visibility === v
                                    ? v === 'private'
                                      ? "bg-yellow-100 text-yellow-700 border-yellow-300"
                                      : "bg-green-100 text-green-700 border-green-300"
                                    : "bg-white dark:bg-gray-800 border-gray-300"
                                )}
                              >
                                {v === 'private' ? 'Private' : 'Public'}
                              </button>
                            ))}
                            {!fileItem.visibility && (
                              <span className="text-xs text-error-600">
                                Required
                              </span>
                            )}
                          </div>
                        )}

                        {fileItem.errors?.length > 0 && (
                          <div className="mt-1 flex items-center gap-1 text-xs text-error-600">
                            <AlertCircle className="w-3 h-3" />
                            <span>{fileItem.errors[0]}</span>
                          </div>
                        )}
                        
                        {/* {fileItem.errors.length > 0 && (
                          <p className="text-xs text-error-600 mt-1">
                            <AlertCircle className="w-3 h-3" />
                            {fileItem.errors[0]}
                          </p>
                        )} */}
                        
                        {uploading && uploadProgress[fileItem.id] !== undefined && (
                          <div className="mt-2">
                            <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-1.5">
                              <div 
                                className="bg-primary-600 h-1.5 rounded-full transition-all"
                                style={{ width: `${uploadProgress[fileItem.id]}%` }}
                              />
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                    
                    {!uploading && (
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => removeFile(fileItem.id)}
                        className="h-8 w-8 text-gray-400 hover:text-gray-600"
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    )}
                  </motion.div>
                ))}
              </div>
            </motion.div>
          )}
        </AnimatePresence>


        {/* Excess Storage Warning */}
        {exceedsStorage && (
          <div className="flex items-center mt-4 justify-between gap-4 p-3 rounded-md
                          bg-red-50 border border-red-200 dark:bg-red-900/20 dark:border-red-800">
            <p className="text-sm text-red-700 dark:text-red-300">
              Storage limit exceeded. Upgrade your plan to upload more files.
            </p>

            <button
              onClick={async () => {
                const res = await fetch("/api/stripe/portal", { method: "POST" });
                const data = await res.json();
                if (data.url) window.location.href = data.url;
              }}
              className="shrink-0 text-sm font-medium text-blue-600 hover:text-blue-700
                        dark:text-blue-400 dark:hover:text-blue-300 underline cursor-pointer"
            >
              Upgrade plan
            </button>
          </div>
        )}

        {/* Visibility Explanation */}
        <div className="mt-4">
          <button
            onClick={() => setShowVisibilityInfo(v => !v)}
            className="text-xs text-gray-600 dark:text-gray-400 hover:text-gray-800
                      dark:hover:text-gray-200 underline underline-offset-2"
          >
            {showVisibilityInfo ? "Hide visibility details" : "What does visibility mean?"}
          </button>

          <AnimatePresence>
            {showVisibilityInfo && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                exit={{ opacity: 0, height: 0 }}
                className="mt-2 rounded-md border border-gray-200 dark:border-gray-700
                          bg-gray-50 dark:bg-gray-900/40 p-3"
              >
                <div className="text-xs text-gray-600 dark:text-gray-300 space-y-1 leading-relaxed">
                  <p>
                    <strong className="text-gray-900 dark:text-gray-100">Private:</strong>{" "}
                    Best for personal or sensitive documents, higher accuracy and better answers.
                  </p>
                  <p>
                    <strong className="text-gray-900 dark:text-gray-100">Public:</strong>{" "}
                    Faster processing. Suitable for non-sensitive, shareable documents.
                  </p>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

      </div>


      {/* Actions */}
      {files.length > 0 && (
        <>
          {exceedsStorage && (
            <div className="flex items-center mt-4 justify-between gap-4 p-3 rounded-md
                            bg-red-50 border border-red-200 dark:bg-red-900/20 dark:border-red-800">
              <p className="text-sm text-red-700 dark:text-red-300">
                Storage limit exceeded. Upgrade your plan to upload more files.
              </p>

              <button
                onClick={async () => {
                  const res = await fetch("/api/stripe/portal", { method: "POST" });
                  const data = await res.json();
                  if (data.url) window.location.href = data.url;
                }}
                className="shrink-0 text-sm font-medium text-blue-600 hover:text-blue-700
                          dark:text-blue-400 dark:hover:text-blue-300 underline cursor-pointer"
              >
                Upgrade plan
              </button>
            </div>
          )}
          <div className="flex items-center justify-between mt-6 pt-6 border-t border-gray-200 dark:border-gray-800">
            {/* Excess Storage Warning */}
            
            <div className="text-sm text-gray-600 dark:text-gray-400">
              {validFiles} file{validFiles !== 1 ? 's' : ''} ready to upload
              {hasErrors && (
                <span className="text-error-600 ml-2">
                  • Some files have errors
                </span>
              )}
            </div>
            
            <div className="flex items-center space-x-3">
              <Button variant="outline" onClick={onClose} disabled={uploading}>
                Cancel
              </Button>
              
              <Button 
                onClick={uploadFiles} 
                disabled={validFiles === 0 || uploading || exceedsStorage}
                loading={uploading}
              >
                Upload {validFiles > 0 && `(${validFiles})`}
              </Button>
            </div>
          </div>
        </>
          
      )}
    </motion.div>
  );
};

export default FileUpload;
