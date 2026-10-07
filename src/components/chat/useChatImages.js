'use client';
import { useState, useRef, useCallback } from 'react';
import chatImagesApi from '@/lib/chatImagesApi';

// Image attachments and generated-image actions, shared by project chat and
// document chat. The two chats differ only in which message table their
// uploads belong to ("project" | "document") and how a response becomes a
// message (mapAskResult).

export const MAX_ATTACHMENTS = 4;
export const ATTACHABLE_TYPES = ['image/png', 'image/jpeg', 'image/webp'];

// Composer side: staged uploads, file picker, paste and drag-and-drop.
// items: [{ key, file, previewUrl, name, status: 'uploading' | 'ready' | 'error', attachment?, error? }]
export function useComposerAttachments({ messageTable, disabled = false }) {
  const [items, setItems] = useState([]);
  const [isDraggingFiles, setIsDraggingFiles] = useState(false);
  const fileInputRef = useRef(null);

  const addFiles = useCallback(async (fileList) => {
    const files = Array.from(fileList || []).filter(f => ATTACHABLE_TYPES.includes(f.type));
    if (!files.length) return;
    const accepted = files.slice(0, Math.max(MAX_ATTACHMENTS - items.length, 0));
    if (!accepted.length) return;

    const added = accepted.map(file => ({
      key: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      file,
      previewUrl: URL.createObjectURL(file),
      name: file.name || 'pasted-image.png',
      status: 'uploading',
    }));
    setItems(prev => [...prev, ...added].slice(0, MAX_ATTACHMENTS));

    await Promise.all(added.map(async (item) => {
      let res;
      try {
        const ext = item.file.type === 'image/jpeg' ? '.jpg' : item.file.type === 'image/webp' ? '.webp' : '.png';
        const filename = /\.[a-z0-9]+$/i.test(item.name) ? item.name : `${item.name}${ext}`;
        res = await chatImagesApi.uploadChatAttachment({ messageTable, filename, file: item.file });
      } catch (err) {
        res = { success: false, error: 'Could not read that image.' };
      }
      setItems(prev => {
        // Removed while uploading — drop the staged upload too.
        if (!prev.some(p => p.key === item.key)) {
          if (res?.success) chatImagesApi.discardChatAttachment(res.attachment.id);
          return prev;
        }
        return prev.map(p => p.key !== item.key ? p : res?.success
          ? { ...p, status: 'ready', attachment: res.attachment }
          : { ...p, status: 'error', error: res?.error || 'Upload failed' });
      });
    }));
  }, [items.length, messageTable]);

  const removeItem = useCallback((key) => {
    setItems(prev => {
      const item = prev.find(p => p.key === key);
      if (item?.attachment) chatImagesApi.discardChatAttachment(item.attachment.id);
      if (item?.previewUrl) URL.revokeObjectURL(item.previewUrl);
      return prev.filter(p => p.key !== key);
    });
  }, []);

  // After sending: the uploads now belong to the message, so only the local
  // previews are released.
  const clear = useCallback(() => {
    setItems(prev => {
      prev.forEach(i => i.previewUrl && URL.revokeObjectURL(i.previewUrl));
      return [];
    });
  }, []);

  const handlePaste = (e) => {
    const files = Array.from(e.clipboardData?.files || []);
    if (files.some(f => ATTACHABLE_TYPES.includes(f.type))) {
      e.preventDefault();
      addFiles(files);
    }
  };

  const hasDraggedFiles = (e) => Array.from(e.dataTransfer?.types || []).includes('Files');
  const dropHandlers = {
    onDragOver: (e) => {
      if (!hasDraggedFiles(e)) return;
      e.preventDefault();
      if (!disabled) setIsDraggingFiles(true);
    },
    onDragLeave: (e) => {
      if (!e.currentTarget.contains(e.relatedTarget)) setIsDraggingFiles(false);
    },
    onDrop: (e) => {
      if (!hasDraggedFiles(e)) return;
      e.preventDefault();
      setIsDraggingFiles(false);
      if (!disabled) addFiles(e.dataTransfer.files);
    },
  };

  return {
    items,
    addFiles,
    removeItem,
    clear,
    handlePaste,
    dropHandlers,
    isDraggingFiles,
    fileInputRef,
    openFilePicker: () => fileInputRef.current?.click(),
    isFull: items.length >= MAX_ATTACHMENTS,
    isUploading: items.some(i => i.status === 'uploading'),
    readyAttachments: items.filter(i => i.status === 'ready').map(i => i.attachment),
  };
}

// Message side: the full-screen viewer, download, Save to project and
// Improve quality for images in the conversation.
export function useChatImageActions({ projectId, setMessages, mapAskResult, onDocumentAdded }) {
  const [viewer, setViewer] = useState(null); // { images: [attachment], index } | null
  const [saveStates, setSaveStates] = useState({}); // attachmentId -> 'saving' | 'saved'
  const [improving, setImproving] = useState({}); // attachmentId -> { quality, requestId }
  const [improveErrors, setImproveErrors] = useState({}); // attachmentId -> message

  const openViewer = (images, index = 0) => setViewer({ images, index });
  const closeViewer = () => setViewer(null);

  const downloadImage = (img) => chatImagesApi.saveImageAs({ fileUrl: img.fileUrl, defaultName: img.name || 'generated-image.png' });

  const saveImageToProject = async (img) => {
    if (!img?.id || !projectId || saveStates[img.id] === 'saving') return;
    setSaveStates(s => ({ ...s, [img.id]: 'saving' }));
    const res = await chatImagesApi.saveChatAttachmentToProject({ attachmentId: img.id, projectId });
    if (res?.success) {
      setSaveStates(s => ({ ...s, [img.id]: 'saved' }));
      const markSaved = (a) => (a.id === img.id ? { ...a, savedDocumentId: res.documentId } : a);
      setMessages(prev => prev.map(m => (m.attachments?.some(a => a.id === img.id)
        ? { ...m, attachments: m.attachments.map(markSaved) } : m)));
      setViewer(v => (v ? { ...v, images: v.images.map(markSaved) } : v));
      if (!res.alreadySaved) onDocumentAdded?.(res.documentId);
    } else {
      setSaveStates(({ [img.id]: _, ...rest }) => rest);
      setImproveErrors(e => ({ ...e, [img.id]: res?.error || 'Could not save the image.' }));
    }
  };

  // The redraw arrives as a new assistant message.
  const improveImage = async (img, quality) => {
    if (!img?.id || improving[img.id]) return;
    const requestId = `improve-${img.id}-${Date.now()}`;
    setImproving(s => ({ ...s, [img.id]: { quality, requestId } }));
    setImproveErrors(({ [img.id]: _, ...rest }) => rest);
    let res;
    try {
      res = await chatImagesApi.improveChatImage({ attachmentId: img.id, quality, requestId });
    } catch (err) {
      res = { success: false, error: 'Could not redraw the image. Please try again.' };
    }
    setImproving(({ [img.id]: _, ...rest }) => rest);
    if (res?.success) setMessages(prev => [...prev, mapAskResult(res)]);
    else if (!res?.cancelled) setImproveErrors(e => ({ ...e, [img.id]: res?.error || 'Could not redraw the image.' }));
  };

  const cancelImprove = (img) => {
    const pending = improving[img.id];
    if (pending) chatImagesApi.cancelRequest(pending.requestId);
  };

  // Props for <GeneratedImage> — one call per image keeps the call sites short.
  const generatedImageProps = (img) => ({
    image: img,
    onOpen: () => openViewer([img]),
    onDownload: () => downloadImage(img),
    onSave: projectId ? () => saveImageToProject(img) : undefined,
    saveState: saveStates[img.id],
    onImprove: (quality) => improveImage(img, quality),
    onCancelImprove: () => cancelImprove(img),
    improving: improving[img.id],
    improveError: improveErrors[img.id],
  });

  return { viewer, openViewer, closeViewer, saveStates, saveImageToProject, generatedImageProps };
}
