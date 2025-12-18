import { useState, useRef, useCallback } from 'react';
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

  const fileInputRef = useRef(null);

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
        status: errors.length > 0 ? 'error' : 'pending'
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

  const uploadFiles = async () => {
    const validFiles = files.filter(f => f.status === 'pending');
    if (validFiles.length === 0) return;
  
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
        await onUpload(fileItem.file);
  
        // Mark as fully complete only AFTER upload finishes
        setUploadProgress(prev => ({ ...prev, [fileItem.id]: 100 }));
  
        setFiles(prev =>
          prev.map(f =>
            f.id === fileItem.id ? { ...f, status: 'success' } : f
          )
        );
      } catch (error) {
        console.error('Upload failed:', error);
  
        setFiles(prev =>
          prev.map(f =>
            f.id === fileItem.id
              ? { ...f, status: 'error', errors: ['Upload failed'] }
              : f
          )
        );
      }
    }
  
    setUploading(false);
  
    // Close modal after successful uploads
    setTimeout(() => {
      onClose();
    }, 1000);
  };
  

  const validFiles = files.filter(f => f.status === 'pending').length;
  const hasErrors = files.some(f => f.errors.length > 0);

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.95 }}
      className={cn("w-full max-w-2xl mx-auto", className)}
    >
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
            
            <div className="space-y-2 max-h-64 overflow-y-auto">
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
                      <p className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">
                        {fileItem.name}
                      </p>
                      <p className="text-xs text-gray-500 dark:text-gray-400">
                        {formatFileSize(fileItem.size)}
                      </p>
                      
                      {fileItem.errors.length > 0 && (
                        <p className="text-xs text-error-600 mt-1">
                          {fileItem.errors[0]}
                        </p>
                      )}
                      
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

      {/* Actions */}
      {files.length > 0 && (
        <div className="flex items-center justify-between mt-6 pt-6 border-t border-gray-200 dark:border-gray-800">
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
              disabled={validFiles === 0 || uploading}
              loading={uploading}
            >
              Upload {validFiles > 0 && `(${validFiles})`}
            </Button>
          </div>
        </div>
      )}
    </motion.div>
  );
};

export default FileUpload;
