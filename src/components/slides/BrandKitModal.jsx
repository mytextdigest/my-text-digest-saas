'use client';
import { useEffect, useRef, useState } from 'react';
import { Image as ImageIcon, X, Loader2, Sparkles } from 'lucide-react';
import { Modal, ModalHeader, ModalTitle, ModalDescription, ModalContent, ModalFooter } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Textarea } from '@/components/ui/Input';
import { cn } from '@/lib/utils';

const DEFAULT_COLORS = { primary: '6B7280', secondary: '9CA3AF', accent: 'D1D5DB' };

const PRESENTATION_TYPES = [
  { key: 'pitch-deck', label: 'Pitch Deck', starter: 'Make this a pitch deck for investors — focus on traction, market size, and a clear ask.' },
  { key: 'university', label: 'University / Lecture', starter: 'Make this an academic presentation — favor thorough explanation and precise terminology.' },
  { key: 'sales', label: 'Sales Deck', starter: 'Make this a sales deck for prospective customers — emphasize benefits and outcomes.' },
  { key: 'internal-report', label: 'Internal Report', starter: 'Make this an internal report for leadership — focus on status, metrics, and next steps.' },
  { key: 'conference-talk', label: 'Conference Talk', starter: 'Make this a conference talk — favor a narrative arc and memorable statements.' },
  { key: 'minimal', label: 'Minimal / Editorial', starter: 'Make this minimal and editorial — understated, text-forward, no heavy card chrome.' },
];

// A genuinely honored lever, not decoration — '' ("Balanced") sends no
// nudge at all; the other three add one instruction to the structuring
// prompt steering slide-TYPE choice (see outline.js's VISUAL_STYLE_GUIDANCE),
// independent of presentationType's own type-leaning framing.
const VISUAL_STYLES = [
  { key: '', label: 'Balanced' },
  { key: 'more-visual', label: 'More Visual' },
  { key: 'more-analytical', label: 'More Analytical' },
  { key: 'minimal', label: 'Minimal' },
];

// Pre-generation modal: lets the user upload a logo (colors auto-suggested
// from it, always editable), pick/describe a presentation type, and add a
// free-text instruction — all optional. "Skip" reproduces plain
// generate-with-defaults behavior exactly.
//
// Ported from electron/slides/BrandKitModal.jsx — `window.api.*` IPC calls
// replaced with fetch() against this port's API routes; logo upload goes
// through the existing presigned-POST-to-S3 flow (needs the document's
// userId/projectId, fetched lazily on first use) instead of sending raw
// bytes over IPC. `buildBrandKit()`'s shape changes from desktop's
// logoPath/logoFileUrl to logoKey/logoWidth/logoHeight, matching what
// worker/processSlideBuild.js expects to resolve into a signed URL at
// build time.
export default function BrandKitModal({ isOpen, onClose, onGenerate, isGenerating, docId }) {
  const [logo, setLogo] = useState(null); // { logoKey, url, width, height }
  const [colors, setColors] = useState(DEFAULT_COLORS);
  const [colorsTouched, setColorsTouched] = useState(false);
  const [presentationType, setPresentationType] = useState('');
  const [visualStyle, setVisualStyle] = useState('');
  const [customPrompt, setCustomPrompt] = useState('');
  const [rememberBrand, setRememberBrand] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const [isUploadingLogo, setIsUploadingLogo] = useState(false);
  const [uploadError, setUploadError] = useState(null);
  const fileInputRef = useRef(null);
  const docMetaRef = useRef(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const res = await fetch('/api/settings/default-brand-kit').then((r) => r.json()).catch(() => null);
      if (cancelled || !res?.brandKit) return;
      const bk = res.brandKit;
      if (bk.logoKey) {
        setLogo({ logoKey: bk.logoKey, url: bk.logoUrl, width: bk.logoWidth || null, height: bk.logoHeight || null });
      }
      if (bk.colors) {
        setColors(bk.colors);
        setColorsTouched(true);
      }
      setRememberBrand(true);
    })();
    return () => { cancelled = true; };
  }, []);

  // Fetches the parent document's userId/projectId once, needed to build
  // the presigned-upload key — cached in a ref rather than state since it
  // never changes for the lifetime of this modal.
  const getDocMeta = async () => {
    if (docMetaRef.current) return docMetaRef.current;
    const doc = await fetch(`/api/documents/${docId}`).then((r) => r.json()).catch(() => null);
    if (doc?.userId && doc?.projectId) docMetaRef.current = { userId: doc.userId, projectId: doc.projectId };
    return docMetaRef.current;
  };

  const handleFiles = async (fileList) => {
    const file = fileList?.[0];
    if (!file || !docId) return;
    setUploadError(null);
    setIsUploadingLogo(true);
    try {
      const meta = await getDocMeta();
      if (!meta) throw new Error('Could not resolve document.');

      const presignRes = await fetch('/api/s3/upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fileName: `slides/brand-${crypto.randomUUID()}-${file.name}`, fileType: file.type, userId: meta.userId, projectId: meta.projectId }),
      }).then((r) => r.json());
      if (!presignRes.url) throw new Error(presignRes.error || 'Could not prepare upload.');

      const formData = new FormData();
      Object.entries(presignRes.fields).forEach(([k, v]) => formData.append(k, v));
      formData.append('file', file);
      const s3Res = await fetch(presignRes.url, { method: 'POST', body: formData });
      if (!s3Res.ok) throw new Error('Upload to storage failed.');

      const recordRes = await fetch(`/api/documents/${docId}/brand-logo`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: presignRes.key }),
      }).then((r) => r.json());
      if (!recordRes.logoKey) throw new Error(recordRes.error || 'Could not process that logo.');

      setLogo({ logoKey: recordRes.logoKey, url: recordRes.logoUrl, width: recordRes.width, height: recordRes.height });
      if (recordRes.colors?.primary) {
        setColors({
          primary: recordRes.colors.primary || DEFAULT_COLORS.primary,
          secondary: recordRes.colors.secondary || DEFAULT_COLORS.secondary,
          accent: recordRes.colors.accent || DEFAULT_COLORS.accent,
        });
        setColorsTouched(true);
      }
    } catch (err) {
      setUploadError(err.message || 'Could not upload that logo.');
    } finally {
      setIsUploadingLogo(false);
    }
  };

  const handleDrag = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(e.type === 'dragenter' || e.type === 'dragover');
  };

  const handleDrop = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    if (e.dataTransfer.files?.length) handleFiles(e.dataTransfer.files);
  };

  const handleRemoveLogo = () => {
    setLogo(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleColorChange = (key, hex) => {
    setColorsTouched(true);
    setColors((c) => ({ ...c, [key]: hex.replace('#', '').toUpperCase() }));
  };

  const handleSelectType = (type) => {
    if (presentationType === type.key) {
      setPresentationType('');
      return;
    }
    setPresentationType(type.key);
    if (!customPrompt.trim()) setCustomPrompt(type.starter);
  };

  const buildBrandKit = () => {
    if (!logo && !colorsTouched && !presentationType && !visualStyle && !customPrompt.trim()) return null;
    return {
      logoKey: logo?.logoKey || null,
      logoWidth: logo?.width || null,
      logoHeight: logo?.height || null,
      colors: logo || colorsTouched ? colors : null,
      presentationType: presentationType || null,
      visualStyle: visualStyle || null,
      customPrompt: customPrompt.trim() || null,
    };
  };

  const handleGenerateClick = async () => {
    const brandKit = buildBrandKit();
    if (rememberBrand && (logo || colorsTouched)) {
      fetch('/api/settings/default-brand-kit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          brandKit: {
            logoKey: logo?.logoKey || null,
            logoUrl: logo?.url || null,
            logoWidth: logo?.width || null,
            logoHeight: logo?.height || null,
            colors: colorsTouched ? colors : null,
          },
        }),
      }).catch(() => {});
    }
    await onGenerate({ brandKit });
  };

  const handleSkip = async () => {
    await onGenerate({});
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} size="lg">
      <ModalHeader>
        <ModalTitle>Customize Your Slide Deck</ModalTitle>
        <ModalDescription>
          Optional — add your brand and presentation style, or skip to generate with defaults.
        </ModalDescription>
      </ModalHeader>

      <ModalContent className="space-y-6 max-h-[60vh] overflow-y-auto">
        {/* Logo */}
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Logo</label>
          {logo?.url ? (
            <div className="flex items-center gap-3 p-3 rounded-lg border border-gray-200 dark:border-gray-700">
              <img
                src={logo.url}
                alt="Brand logo"
                className="h-14 w-14 object-contain rounded bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700"
              />
              <p className="flex-1 min-w-0 text-xs text-gray-500 dark:text-gray-400">
                Uploaded — will appear on your generated slides.
              </p>
              <Button
                variant="ghost"
                size="icon"
                onClick={handleRemoveLogo}
                className="h-8 w-8 text-gray-400 hover:text-red-600 shrink-0"
                title="Remove logo"
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
          ) : (
            <div
              onDragEnter={handleDrag}
              onDragOver={handleDrag}
              onDragLeave={handleDrag}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
              className={cn(
                'border-2 border-dashed rounded-xl p-6 text-center transition-colors cursor-pointer',
                dragActive
                  ? 'border-primary-500 bg-primary-50 dark:bg-primary-900/10'
                  : 'border-gray-300 dark:border-gray-700 hover:border-gray-400 dark:hover:border-gray-600'
              )}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept=".png,.jpg,.jpeg,.webp"
                className="hidden"
                onChange={(e) => handleFiles(e.target.files)}
              />
              {isUploadingLogo ? (
                <Loader2 className="w-6 h-6 mx-auto text-gray-400 animate-spin" />
              ) : (
                <>
                  <ImageIcon className="w-6 h-6 mx-auto text-gray-400" />
                  <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">Drop your logo or click to browse</p>
                  <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">PNG, JPG, or WEBP — up to 5MB</p>
                </>
              )}
            </div>
          )}
          {uploadError && <p className="mt-2 text-xs text-red-600 dark:text-red-400">{uploadError}</p>}
        </div>

        {/* Brand colors */}
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Brand Colors</label>
          <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">
            {logo ? 'Auto-suggested from your logo — tweak any swatch.' : 'Optional, even without a logo.'}
          </p>
          <div className="flex gap-4">
            {['primary', 'secondary', 'accent'].map((key) => (
              <div key={key} className="flex flex-col items-center gap-1.5">
                <span className="text-xs font-medium text-gray-500 dark:text-gray-400 capitalize">{key}</span>
                <input
                  type="color"
                  value={`#${colors[key]}`}
                  onChange={(e) => handleColorChange(key, e.target.value)}
                  className="h-9 w-9 rounded-lg border border-gray-300 dark:border-gray-700 cursor-pointer bg-transparent p-0"
                  title={`${key} color`}
                />
                <span className="text-[10px] font-mono text-gray-400 dark:text-gray-500">#{colors[key]}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Presentation type */}
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Presentation Type</label>
          <div className="flex flex-wrap gap-2">
            {PRESENTATION_TYPES.map((type) => (
              <button
                key={type.key}
                type="button"
                onClick={() => handleSelectType(type)}
                className={cn(
                  'rounded-full border px-3 py-1 text-xs font-medium transition-colors',
                  presentationType === type.key
                    ? 'border-primary-500 bg-primary-100 text-primary-700 dark:bg-primary-900/40 dark:text-primary-300'
                    : 'border-gray-300 dark:border-gray-700 text-gray-600 dark:text-gray-400 hover:border-gray-400 dark:hover:border-gray-600'
                )}
              >
                {type.label}
              </button>
            ))}
          </div>
        </div>

        {/* Visual style */}
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Visual Style</label>
          <div className="flex flex-wrap gap-2">
            {VISUAL_STYLES.map((v) => (
              <button
                key={v.key || 'balanced'}
                type="button"
                onClick={() => setVisualStyle(v.key)}
                className={cn(
                  'rounded-full border px-3 py-1 text-xs font-medium transition-colors',
                  visualStyle === v.key
                    ? 'border-primary-500 bg-primary-100 text-primary-700 dark:bg-primary-900/40 dark:text-primary-300'
                    : 'border-gray-300 dark:border-gray-700 text-gray-600 dark:text-gray-400 hover:border-gray-400 dark:hover:border-gray-600'
                )}
              >
                {v.label}
              </button>
            ))}
          </div>
        </div>

        {/* Custom instruction */}
        <Textarea
          label="Audience, Goal, or Style Notes"
          value={customPrompt}
          onChange={(e) => setCustomPrompt(e.target.value)}
          placeholder="e.g. Make this a pitch deck for early-stage investors, focus on traction and market size"
          helperText="Shapes slide type, emphasis, and closing framing — not just wording."
          rows={3}
        />

        {/* Remember toggle */}
        <label className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400 cursor-pointer">
          <input
            type="checkbox"
            checked={rememberBrand}
            onChange={(e) => setRememberBrand(e.target.checked)}
            className="rounded border-gray-300 dark:border-gray-600 text-primary-600 focus:ring-primary-500"
          />
          Remember this brand for future decks
        </label>
      </ModalContent>

      <ModalFooter>
        <Button variant="outline" onClick={handleSkip} disabled={isGenerating}>
          Skip / Use Defaults
        </Button>
        <Button onClick={handleGenerateClick} disabled={isGenerating}>
          {isGenerating ? (
            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
          ) : (
            <Sparkles className="h-4 w-4 mr-2" />
          )}
          Generate Slides
        </Button>
      </ModalFooter>
    </Modal>
  );
}
