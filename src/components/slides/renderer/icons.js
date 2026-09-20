// src/components/slides/renderer/icons.js
// Frontend-only icon map for the slide preview renderer. Same icon set and
// names as src/lib/slides/icons.js's ICONS, but renders the lucide-react
// components directly as JSX for on-screen display instead of rasterizing
// to a PNG — that only exists to embed icons into the exported .pptx and
// isn't needed (or usable) in the browser.
//
// Ported from electron/slides/renderer/icons.js, swapping react-icons/lu
// for lucide-react directly (this repo's own dependency, same icon source —
// see src/lib/slides/icons.js's header comment for why this is a
// same-source swap, not a visual change).
'use client';

import {
  CircleCheck, CircleX, Lightbulb, ChartLine, ChartBar, ChartPie,
  ChartArea, Target, Users, User, Calendar, Clock, Flag, Star,
  Award, Shield, Lock, LockOpen, Globe, Mail, Phone,
  MapPin, Briefcase, Book, FileText, Layers, DollarSign,
  Percent, TriangleAlert, Info, CircleHelp,
  ArrowRight, TrendingUp, TrendingDown, ThumbsUp, Settings, Cog, Database,
  Server, Cloud, Link, Search, Filter, List, LayoutGrid, MessageCircle,
  Heart, Zap, Rocket, Handshake, Building, GraduationCap, Leaf,
  HeartPulse, Scale, Puzzle, ClipboardList, ListChecks, Network, Check,
} from 'lucide-react';

// Keep this map's keys in sync with src/lib/slides/icons.js's ICONS.
export const ICONS = {
  'check-circle': CircleCheck,
  'x-circle': CircleX,
  'lightbulb': Lightbulb,
  'chart-line': ChartLine,
  'chart-bar': ChartBar,
  'chart-pie': ChartPie,
  'chart-area': ChartArea,
  'target': Target,
  'users': Users,
  'user': User,
  'calendar': Calendar,
  'clock': Clock,
  'flag': Flag,
  'star': Star,
  'award': Award,
  'shield': Shield,
  'lock': Lock,
  'unlock': LockOpen,
  'globe': Globe,
  'mail': Mail,
  'phone': Phone,
  'map-pin': MapPin,
  'briefcase': Briefcase,
  'book': Book,
  'file-text': FileText,
  'layers': Layers,
  'dollar-sign': DollarSign,
  'percent': Percent,
  'alert-triangle': TriangleAlert,
  'info': Info,
  'help-circle': CircleHelp,
  'arrow-right': ArrowRight,
  'trending-up': TrendingUp,
  'trending-down': TrendingDown,
  'thumbs-up': ThumbsUp,
  'settings': Settings,
  'gears': Cog,
  'database': Database,
  'server': Server,
  'cloud': Cloud,
  'link': Link,
  'search': Search,
  'filter': Filter,
  'list': List,
  'grid': LayoutGrid,
  'message-circle': MessageCircle,
  'heart': Heart,
  'zap': Zap,
  'rocket': Rocket,
  'handshake': Handshake,
  'building': Building,
  'graduation-cap': GraduationCap,
  'leaf': Leaf,
  'heartbeat': HeartPulse,
  'balance-scale': Scale,
  'puzzle': Puzzle,
  'clipboard-list': ClipboardList,
  'tasks': ListChecks,
  'sitemap': Network,
  'check': Check,
};

// Falls back to "lightbulb" for an unknown/hallucinated icon name, same as
// layouts.js's addIconCircle fallback — a circle should never render with
// no glyph inside it.
export function SlideIcon({ name, size = 24, color = '000000', style }) {
  const Icon = ICONS[name] || ICONS['lightbulb'];
  return <Icon size={size} color={`#${color}`} strokeWidth={2.25} style={style} />;
}
