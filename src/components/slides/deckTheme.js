import { resolveTheme } from '@/lib/slides/theme.js';

// The render theme for a deck's outline — palette/fonts (or the active brand
// kit's colors), presentationType for SlideRenderer's getStyle(), and the
// brand logo. Mirrors src/lib/slides/buildDeck.js so every live preview
// (editor, presenter view, audience window) matches the exported .pptx.
export function deckTheme(outline) {
  if (!outline) return null;
  const activeBrandKit = outline.brandKit?.active ? outline.brandKit : null;
  const theme = resolveTheme(outline.paletteName, outline.fontPairName, activeBrandKit?.colors);
  theme.presentationType = outline.presentationType || null;
  if (activeBrandKit?.logoPath) {
    theme.logo = { url: activeBrandKit.logoPath, width: activeBrandKit.logoWidth, height: activeBrandKit.logoHeight };
  }
  return theme;
}
