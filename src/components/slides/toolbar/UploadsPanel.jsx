'use client';
import { useEffect, useRef, useState } from 'react';
import { Upload, Sparkles, Loader2, Trash2, ImageOff } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { cn } from '@/lib/utils';
import PanelHeader from './PanelHeader';

// The 3 shapes gpt-image-1 actually supports (the generate-slide-image
// route whitelists against the same set). `box` is the icon's footprint in
// px, kept proportional to the real ratio so the picker reads correctly at a
// glance, not just from its numbers.
const ASPECT_RATIOS = [
  { size: '1024x1024', name: 'Square', ratio: '1:1', box: { w: 20, h: 20 } },
  { size: '1024x1536', name: 'Portrait', ratio: '2:3', box: { w: 16, h: 24 } },
  { size: '1536x1024', name: 'Landscape', ratio: '3:2', box: { w: 24, h: 16 } },
];

// Shared thumbnail grid for both tabs below — click to pick (onPick), hover
// to delete (onDelete). Factored out so "Uploaded" and "Generate" don't
// duplicate the same grid/delete-on-hover markup.
function ImageGrid({ images, onPick, onDelete, disabled, insertLabel, emptyText }) {
  if (images.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 py-10 text-center text-gray-400 dark:text-gray-600">
        <ImageOff className="w-6 h-6" />
        <p className="text-xs">{emptyText}</p>
      </div>
    );
  }
  return (
    <div className="grid grid-cols-2 gap-2">
      {images.map((image) => (
        <button
          key={image.id}
          type="button"
          onClick={() => !disabled && onPick?.(image)}
          disabled={disabled}
          title={insertLabel}
          className="group relative aspect-square rounded-lg overflow-hidden border border-gray-200 dark:border-gray-700 hover:ring-2 hover:ring-violet-500 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={image.url} alt="" className="w-full h-full object-cover" />
          <span
            role="button"
            tabIndex={-1}
            onClick={(e) => { e.stopPropagation(); onDelete?.(image.id); }}
            title="Delete"
            className="absolute top-1 right-1 w-5 h-5 flex items-center justify-center rounded bg-black/60 text-white opacity-0 group-hover:opacity-100 transition-opacity hover:bg-black/80"
          >
            <Trash2 className="w-3 h-3" />
          </span>
        </button>
      ))}
    </div>
  );
}

// Canva-style "Uploads" flyout, extended with a second "Generate" source
// (in-editor AI image generation, so a useless generated hero image can be
// swapped for something on-topic without regenerating the whole deck).
// Both tabs share one per-document gallery (SlideImage, tagged by `source`)
// and the same pick/delete grid. `title`/`insertLabel` let the caller
// repurpose this same panel as a hero-image picker (SlideDeckEditor's
// imagePickTarget) without this component knowing anything about that use
// case — it just reports onInsertImage(image) either way.
//
// Ported from electron/slides — `window.api.*` IPC calls replaced with
// fetch() against this port's API routes; file upload goes through the
// existing presigned-POST-to-S3 flow (/api/s3/upload) instead of sending
// raw bytes over IPC.
export default function UploadsPanel({ documentId, userId, projectId, deckId, slideIndex, onInsertImage, onClose, disabled, title = 'Uploads', insertLabel = 'Insert into slide' }) {
  const [images, setImages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('uploaded');

  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState(null);
  const fileInputRef = useRef(null);

  const [prompt, setPrompt] = useState('');
  // Only offered when the caller actually has a slide to draw context from
  // (deckId/slideIndex — absent when this panel is repurposed as a bare
  // hero-image picker). Defaults on: grounding the image in the slide/
  // deck/palette is almost always what you want, and the checkbox is there
  // mainly for the rare case it isn't.
  const [includeContext, setIncludeContext] = useState(true);
  // Defaults to Portrait (1024x1536) — matches the hero-image right-side
  // panel this is most often used to fill.
  const [aspectRatio, setAspectRatio] = useState(ASPECT_RATIOS[1].size);
  const [generating, setGenerating] = useState(false);
  const [generateError, setGenerateError] = useState(null);
  const canIncludeContext = deckId != null && Number.isInteger(slideIndex);

  useEffect(() => {
    let cancelled = false;
    if (!documentId) { setImages([]); setLoading(false); return; }
    setLoading(true);
    fetch(`/api/documents/${documentId}/slide-images`)
      .then((res) => res.json())
      .then((data) => {
        if (cancelled) return;
        if (Array.isArray(data.images)) setImages(data.images);
        setLoading(false);
      })
      .catch(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [documentId]);

  const handleFileChange = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || !documentId) return;
    setUploading(true);
    setUploadError(null);
    try {
      const presignRes = await fetch('/api/s3/upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fileName: `slides/${crypto.randomUUID()}-${file.name}`, fileType: file.type, userId, projectId }),
      });
      const presign = await presignRes.json();
      if (!presignRes.ok) throw new Error(presign.error || 'Could not prepare upload.');

      const formData = new FormData();
      Object.entries(presign.fields).forEach(([k, v]) => formData.append(k, v));
      formData.append('file', file);
      const s3Res = await fetch(presign.url, { method: 'POST', body: formData });
      if (!s3Res.ok) throw new Error('Upload to storage failed.');

      const recordRes = await fetch(`/api/documents/${documentId}/slide-images`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: presign.key }),
      });
      const record = await recordRes.json();
      if (!recordRes.ok) throw new Error(record.error || 'Could not save uploaded image.');
      setImages((prev) => [record.image, ...prev]);
    } catch (err) {
      setUploadError(err.message || 'Could not upload image.');
    } finally {
      setUploading(false);
    }
  };

  const handleGenerate = async () => {
    const trimmed = prompt.trim();
    if (!trimmed || !documentId) return;
    setGenerating(true);
    setGenerateError(null);
    try {
      const res = await fetch(`/api/documents/${documentId}/slide-images/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: trimmed, size: aspectRatio, deckId, slideIndex,
          includeContext: canIncludeContext && includeContext,
        }),
      });
      const data = await res.json();
      if (res.ok) {
        setImages((prev) => [data.image, ...prev]);
        setPrompt('');
      } else {
        setGenerateError(data.error || 'Could not generate image.');
      }
    } catch (err) {
      setGenerateError(err.message || 'Could not generate image.');
    } finally {
      setGenerating(false);
    }
  };

  const handleDelete = async (imageId) => {
    setImages((prev) => prev.filter((img) => img.id !== imageId));
    await fetch(`/api/slide-images/${imageId}`, { method: 'DELETE' }).catch(() => {});
  };

  const uploadedImages = images.filter((img) => (img.source || 'upload') !== 'generated');
  const generatedImages = images.filter((img) => img.source === 'generated');
  const isDisabled = disabled || uploading || generating;

  return (
    <div className="w-72 shrink-0 border-r border-gray-200 dark:border-gray-700 flex flex-col bg-white dark:bg-gray-900">
      <PanelHeader title={title} onClose={onClose} />

      {/* Same Button variant="default"/"ghost" + cn() tab-toggle pattern
          already used for the document page's tab bar. */}
      <div className="shrink-0 flex gap-1 px-3 pt-3">
        <Button
          variant={activeTab === 'uploaded' ? 'default' : 'ghost'}
          size="sm"
          onClick={() => setActiveTab('uploaded')}
          className={cn('flex-1 flex items-center justify-center gap-1.5', activeTab === 'uploaded' ? 'text-white dark:text-gray-200' : 'text-gray-600 dark:text-gray-400')}
        >
          <Upload className="w-3.5 h-3.5" />
          Uploaded
        </Button>
        <Button
          variant={activeTab === 'generate' ? 'default' : 'ghost'}
          size="sm"
          onClick={() => setActiveTab('generate')}
          className={cn('flex-1 flex items-center justify-center gap-1.5', activeTab === 'generate' ? 'text-white dark:text-gray-200' : 'text-gray-600 dark:text-gray-400')}
        >
          <Sparkles className="w-3.5 h-3.5" />
          Generate
        </Button>
      </div>

      {activeTab === 'uploaded' ? (
        <>
          <div className="shrink-0 p-3">
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={isDisabled}
              className={cn(
                'w-full flex items-center justify-center gap-2 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors',
                isDisabled
                  ? 'bg-gray-200 dark:bg-gray-800 text-gray-400 cursor-not-allowed'
                  : 'bg-violet-600 hover:bg-violet-700 text-white'
              )}
            >
              {uploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
              {uploading ? 'Uploading…' : 'Upload files'}
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/png,image/jpeg,image/webp,image/gif"
              onChange={handleFileChange}
              disabled={isDisabled}
              className="sr-only"
              tabIndex={-1}
            />
            {uploadError && <p className="mt-2 text-xs text-red-600 dark:text-red-400">{uploadError}</p>}
          </div>

          <div className="flex-1 min-h-0 overflow-y-auto px-3 pb-3">
            {loading ? (
              <div className="flex items-center justify-center py-10 text-gray-400">
                <Loader2 className="w-5 h-5 animate-spin" />
              </div>
            ) : (
              <ImageGrid
                images={uploadedImages}
                onPick={onInsertImage}
                onDelete={handleDelete}
                disabled={disabled}
                insertLabel={insertLabel}
                emptyText="No uploads yet"
              />
            )}
          </div>
        </>
      ) : (
        <>
          <div className="shrink-0 p-3 space-y-2">
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value.slice(0, 400))}
              disabled={isDisabled}
              placeholder="Describe the image you want…"
              rows={3}
              className="w-full resize-none rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-2 text-sm text-gray-800 dark:text-gray-100 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-violet-500 disabled:opacity-50"
            />

            <div>
              <p className="mb-1.5 text-xs font-medium text-gray-500 dark:text-gray-400">Aspect ratio</p>
              <div className="flex gap-2">
                {ASPECT_RATIOS.map((opt) => {
                  const active = aspectRatio === opt.size;
                  return (
                    <button
                      key={opt.size}
                      type="button"
                      onClick={() => setAspectRatio(opt.size)}
                      disabled={isDisabled}
                      title={`${opt.name} — ${opt.size.replace('x', '×')}px`}
                      className={cn(
                        'flex-1 flex flex-col items-center justify-end gap-1.5 rounded-lg border px-2 py-2 h-19 transition-colors disabled:opacity-50 disabled:cursor-not-allowed',
                        active
                          ? 'border-violet-500 bg-violet-50 dark:bg-violet-500/10'
                          : 'border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600'
                      )}
                    >
                      <span
                        style={{ width: opt.box.w, height: opt.box.h }}
                        className={cn(
                          'rounded-[3px] border-2',
                          active ? 'border-violet-500 bg-violet-500/20' : 'border-gray-400 dark:border-gray-500'
                        )}
                      />
                      <span className={cn('text-[11px] font-semibold leading-none', active ? 'text-violet-700 dark:text-violet-300' : 'text-gray-600 dark:text-gray-300')}>
                        {opt.ratio}
                      </span>
                      <span className="text-[10px] leading-none text-gray-400 dark:text-gray-500">
                        {opt.size.replace('x', '×')}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            {canIncludeContext && (
              <label className="flex items-start gap-2 rounded-lg border border-violet-200 dark:border-violet-500/30 bg-violet-50 dark:bg-violet-500/10 px-2.5 py-2 text-xs cursor-pointer">
                <input
                  type="checkbox"
                  checked={includeContext}
                  onChange={(e) => setIncludeContext(e.target.checked)}
                  disabled={isDisabled}
                  className="mt-0.5 rounded border-gray-300 dark:border-gray-600 text-violet-600 focus:ring-violet-500 disabled:opacity-50"
                />
                <span className="font-medium text-violet-800 dark:text-violet-300">
                  Include this slide&apos;s context, the deck&apos;s topic, and its color palette
                </span>
              </label>
            )}
            <button
              type="button"
              onClick={handleGenerate}
              disabled={isDisabled || !prompt.trim()}
              className={cn(
                'w-full flex items-center justify-center gap-2 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors',
                isDisabled || !prompt.trim()
                  ? 'bg-gray-200 dark:bg-gray-800 text-gray-400 cursor-not-allowed'
                  : 'bg-violet-600 hover:bg-violet-700 text-white'
              )}
            >
              {generating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
              {generating ? 'Generating…' : 'Generate'}
            </button>
            {generateError && <p className="text-xs text-red-600 dark:text-red-400">{generateError}</p>}
          </div>

          <div className="flex-1 min-h-0 overflow-y-auto px-3 pb-3">
            {loading ? (
              <div className="flex items-center justify-center py-10 text-gray-400">
                <Loader2 className="w-5 h-5 animate-spin" />
              </div>
            ) : (
              <ImageGrid
                images={generatedImages}
                onPick={onInsertImage}
                onDelete={handleDelete}
                disabled={disabled}
                insertLabel={insertLabel}
                emptyText="No generated images yet"
              />
            )}
          </div>
        </>
      )}
    </div>
  );
}
