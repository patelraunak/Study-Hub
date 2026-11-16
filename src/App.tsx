import React, {
  Suspense,
  lazy,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { BookOpen, FileText, Info, LayoutDashboard, Menu, User, X } from 'lucide-react';
import { renderTeam } from '../studyhub/frontend/js/team.js';
import { initQuoteRotator } from '../studyhub/frontend/js/quotes.js';

const IMG_LIBRARY_HALL = '/assets/aistudio/__ce35ffb7.jpeg';
const IMG_STUDY_GROUP = '/assets/aistudio/843017624036572199_d3cd5671.jpeg';
const IMG_DESK_COMPANION = '/assets/aistudio/655133077053441128_6da755e3.jpeg';

interface UserRecord {
  id: number;
  name: string;
  email: string;
  password_hash: string;
  role: 'student' | 'admin';
  created_at: string;
}

interface CategoryRecord {
  id: number;
  name: string;
}

interface NoteRecord {
  id: number;
  title: string;
  description: string;
  file_path: string;
  uploader_id: number;
  category_id: number;
  unit: string;
  created_at: string;
  uploader_name: string;
  category_name: string;
  blob_data_url?: string;
}

type ActivePage = 'catalog' | 'login' | 'dashboard';
type AuthMode = 'login' | 'register';
type SortOption = 'newest' | 'oldest' | 'title_asc';

const USERS_KEY = 'studyhub_db_users';
const CATEGORIES_KEY = 'studyhub_db_categories';
const NOTES_KEY = 'studyhub_db_notes';
const SESSION_USER_KEY = 'studyhub_user';
const MAX_PDF_BYTES = 10 * 1024 * 1024;

let pdfjsPromise: Promise<typeof import('pdfjs-dist')> | null = null;

function loadPdfJs() {
  if (!pdfjsPromise) {
    pdfjsPromise = import('pdfjs-dist').then((mod) => {
      mod.GlobalWorkerOptions.workerSrc = new URL(
        'pdfjs-dist/build/pdf.worker.min.mjs',
        import.meta.url
      ).toString();
      return mod;
    });
  }
  return pdfjsPromise;
}

function readStorage<T>(key: string, fallback: T): T {
  const raw = localStorage.getItem(key);
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function writeStorage<T>(key: string, value: T): void {
  localStorage.setItem(key, JSON.stringify(value));
}

async function hashPasswordHex(password: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(`studyhub_bcrypt_salt_${password}`);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function generateUuidHex(): string {
  if (typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID().replace(/-/g, '');
  }
  return Array.from({ length: 32 }, () => Math.floor(Math.random() * 16).toString(16)).join('');
}

function formatDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
  });
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('Failed to read PDF file.'));
    reader.readAsDataURL(file);
  });
}

async function validatePdfHeader(file: File): Promise<boolean> {
  const slice = file.slice(0, 5);
  const buffer = await slice.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  const header = String.fromCharCode(...bytes);
  return header === '%PDF-';
}

function dataUrlToUint8Array(dataUrl: string): Uint8Array {
  const commaIdx = dataUrl.indexOf(',');
  const base64 = commaIdx >= 0 ? dataUrl.slice(commaIdx + 1) : dataUrl;
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function drawFallbackCanvas(canvas: HTMLCanvasElement, title: string) {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const w = canvas.width;
  const h = canvas.height;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, w, h);

  ctx.fillStyle = '#1d4ed8';
  ctx.fillRect(0, 0, w, 10);

  ctx.fillStyle = '#0f172a';
  ctx.font = 'bold 14px "Plus Jakarta Sans", sans-serif';
  ctx.fillText(title.slice(0, 14), 14, 38);

  ctx.fillStyle = '#cbd5e1';
  for (let y = 56; y < h - 32; y += 14) {
    const lineWidth = y % 28 === 0 ? w - 42 : w - 28;
    ctx.fillRect(14, y, lineWidth, 5);
  }

  ctx.fillStyle = '#64748b';
  ctx.font = '500 11px "JetBrains Mono", monospace';
  ctx.fillText('PDF', 14, h - 12);
}

interface LazyImageProps {
  src: string;
  alt: string;
  width: number;
  height: number;
  className?: string;
}

function LazyImage({ src, alt, width, height, className = '' }: LazyImageProps) {
  const [loaded, setLoaded] = useState(false);

  return (
    <>
      {!loaded && (
        <div
          aria-hidden="true"
          className="absolute inset-0 bg-slate-200 animate-pulse"
        />
      )}
      <img
        src={src}
        alt={alt}
        width={width}
        height={height}
        loading="lazy"
        decoding="async"
        referrerPolicy="no-referrer"
        onLoad={() => setLoaded(true)}
        onError={() => setLoaded(true)}
        className={`${className} transition-opacity duration-200 ${loaded ? 'opacity-100' : 'opacity-0'}`}
      />
    </>
  );
}

interface PdfThumbnailProps {
  dataUrl?: string;
  title: string;
  onClick: () => void;
}

function PdfThumbnail({ dataUrl, title, onClick }: PdfThumbnailProps) {
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [isVisible, setIsVisible] = useState(false);
  const [isRendering, setIsRendering] = useState(Boolean(dataUrl));

  useEffect(() => {
    const el = buttonRef.current;
    if (!el || typeof IntersectionObserver === 'undefined') {
      setIsVisible(true);
      return undefined;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setIsVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin: '120px' }
    );

    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    drawFallbackCanvas(canvas, title);

    if (!dataUrl) {
      setIsRendering(false);
      return;
    }

    if (!isVisible) return;

    let cancelled = false;
    setIsRendering(true);

    async function renderPageOne() {
      try {
        const pdfjsLib = await loadPdfJs();
        if (cancelled) return;

        const bytes = dataUrlToUint8Array(dataUrl!);
        const loadingTask = pdfjsLib.getDocument({ data: bytes });
        const pdf = await loadingTask.promise;
        if (cancelled) return;

        const page = await pdf.getPage(1);
        if (cancelled || !canvasRef.current) return;

        const targetW = 168;
        const targetH = 224;
        const unscaled = page.getViewport({ scale: 1 });
        const scale = Math.max(targetW / unscaled.width, targetH / unscaled.height);
        const viewport = page.getViewport({ scale });

        const targetCanvas = canvasRef.current;
        targetCanvas.width = Math.floor(viewport.width);
        targetCanvas.height = Math.floor(viewport.height);

        const context = targetCanvas.getContext('2d');
        if (!context) return;

        context.fillStyle = '#ffffff';
        context.fillRect(0, 0, targetCanvas.width, targetCanvas.height);

        await page.render({
          canvasContext: context,
          viewport,
          canvas: targetCanvas,
        }).promise;
      } catch {
        if (!cancelled && canvasRef.current) {
          drawFallbackCanvas(canvasRef.current, title);
        }
      } finally {
        if (!cancelled) {
          setIsRendering(false);
        }
      }
    }

    renderPageOne();

    return () => {
      cancelled = true;
    };
  }, [dataUrl, title, isVisible]);

  return (
    <button
      ref={buttonRef}
      type="button"
      onClick={onClick}
      title="Open PDF preview"
      className="relative w-[76px] h-[102px] sm:w-[84px] sm:h-[112px] shrink-0 border border-slate-200/80 rounded-xl bg-white shadow-xs overflow-hidden flex items-center justify-center cursor-pointer"
    >
      {isRendering && (
        <div
          aria-hidden="true"
          className="absolute inset-0 bg-slate-200 animate-pulse z-10"
        />
      )}
      <canvas
        ref={canvasRef}
        width={168}
        height={224}
        aria-label={`First page preview of ${title}`}
        className="w-full h-full object-cover block bg-white"
      />
    </button>
  );
}

const glassSurfaceClass =
  'bg-white/95 md:bg-white/65 md:backdrop-blur-xl border border-slate-200/80 md:border-white/70 shadow-sm md:shadow-lg md:shadow-slate-900/5 rounded-2xl';

const inputControlClass =
  'w-full min-h-[44px] px-3.5 py-2.5 text-base sm:text-sm bg-white border border-slate-300/90 rounded-xl text-slate-900 placeholder:text-slate-400 focus:outline-2 focus:outline-blue-700';

function QuoteRotatorBox({ light = false }: { light?: boolean }) {
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const node = containerRef.current;
    if (!node) return undefined;
    return initQuoteRotator(node);
  }, []);

  return (
    <div
      ref={containerRef}
      className={`quote-rotator ${light ? 'quote-rotator-light' : ''}`}
    />
  );
}

function TechnicalTeamMount({ activeKey }: { activeKey: string }) {
  const containerRef = useRef<HTMLDivElement | null>(null);

  const setTeamNode = useCallback((node: HTMLDivElement | null) => {
    containerRef.current = node;
    if (node) {
      renderTeam(node);
    }
  }, []);

  useEffect(() => {
    const node = containerRef.current;
    if (!node) return undefined;

    renderTeam(node);

    const observer = new MutationObserver(() => {
      if (node.children.length === 0) {
        renderTeam(node);
      }
    });

    observer.observe(node, { childList: true });
    return () => observer.disconnect();
  }, [activeKey]);

  return <div ref={setTeamNode} id="team-grid" className="team-grid" />;
}

function RouteSkeleton() {
  return (
    <div className="space-y-4 py-4" aria-busy="true" aria-label="Loading view">
      <div className="h-16 rounded-2xl bg-slate-200/80 animate-pulse" />
      <div className="h-44 rounded-2xl bg-slate-200/70 animate-pulse" />
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        <div className="h-40 rounded-2xl bg-slate-200/70 animate-pulse" />
        <div className="h-40 rounded-2xl bg-slate-200/70 animate-pulse" />
        <div className="h-40 rounded-2xl bg-slate-200/70 animate-pulse" />
      </div>
    </div>
  );
}

const LazySectionWrapper = lazy(async () => ({
  default: function SectionSlot({ children }: { children: React.ReactNode }) {
    return <>{children}</>;
  },
}));

function scrollFieldIntoViewOnFocus(event: React.FocusEvent<HTMLElement>) {
  const target = event.target;
  if (!(target instanceof HTMLElement)) return;
  setTimeout(() => {
    target.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, 180);
}

export default function App() {
  const shouldReduceMotion = useReducedMotion();
  const [isMobile, setIsMobile] = useState(() =>
    typeof window !== 'undefined'
      ? window.matchMedia('(max-width: 767px), (hover: none) and (pointer: coarse)').matches
      : false
  );
  const [isScrolled, setIsScrolled] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const [page, setPage] = useState<ActivePage>('catalog');
  const [authMode, setAuthMode] = useState<AuthMode>('login');

  const [users, setUsers] = useState<UserRecord[]>(() => readStorage<UserRecord[]>(USERS_KEY, []));
  const [categories, setCategories] = useState<CategoryRecord[]>(() =>
    readStorage<CategoryRecord[]>(CATEGORIES_KEY, [])
  );
  const [notes, setNotes] = useState<NoteRecord[]>(() => readStorage<NoteRecord[]>(NOTES_KEY, []));
  const [currentUser, setCurrentUser] = useState<UserRecord | null>(() =>
    readStorage<UserRecord | null>(SESSION_USER_KEY, null)
  );

  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategoryId, setSelectedCategoryId] = useState('');
  const [unitFilter, setUnitFilter] = useState('');
  const [sortBy, setSortBy] = useState<SortOption>('newest');
  const [dashboardScope, setDashboardScope] = useState<'all' | 'mine'>('all');

  const [loginEmail, setLoginEmail] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [registerName, setRegisterName] = useState('');
  const [registerEmail, setRegisterEmail] = useState('');
  const [registerPassword, setRegisterPassword] = useState('');
  const [registerRole, setRegisterRole] = useState<'student' | 'admin'>('student');
  const [authMessage, setAuthMessage] = useState<{ text: string; type: 'error' | 'success' } | null>(
    null
  );

  const [uploadTitle, setUploadTitle] = useState('');
  const [uploadUnit, setUploadUnit] = useState('');
  const [uploadDescription, setUploadDescription] = useState('');
  const [uploadCategoryId, setUploadCategoryId] = useState('');
  const [uploadCategoryName, setUploadCategoryName] = useState('');
  const [isNewCategoryMode, setIsNewCategoryMode] = useState(categories.length === 0);
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploadStatus, setUploadStatus] = useState<{
    text: string;
    type: 'error' | 'success';
  } | null>(null);
  const [catalogStatus, setCatalogStatus] = useState<{
    text: string;
    type: 'error' | 'success';
  } | null>(null);

  const [pendingDeleteId, setPendingDeleteId] = useState<number | null>(null);
  const [activePdfNote, setActivePdfNote] = useState<NoteRecord | null>(null);

  useEffect(() => {
    const mq = window.matchMedia('(max-width: 767px), (hover: none) and (pointer: coarse)');
    const onChange = () => setIsMobile(mq.matches);
    onChange();
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  function navigateToPage(nextPage: ActivePage) {
    setCatalogStatus(null);
    setMobileMenuOpen(false);
    if (nextPage === 'dashboard' && !currentUser) {
      setPage('login');
    } else {
      setPage(nextPage);
    }
    window.scrollTo({ top: 0, behavior: shouldReduceMotion ? 'auto' : 'smooth' });
  }

  function scrollToAbout(event?: React.MouseEvent<HTMLElement>) {
    if (event) event.preventDefault();
    setMobileMenuOpen(false);
    const doScroll = () => {
      const grid = document.getElementById('team-grid');
      if (grid && grid.children.length === 0) {
        renderTeam(grid);
      }
      const target = document.getElementById('about');
      if (target) {
        target.scrollIntoView({ behavior: shouldReduceMotion ? 'auto' : 'smooth' });
      }
    };
    if (page !== 'catalog') {
      setPage('catalog');
      setTimeout(doScroll, 200);
    } else {
      doScroll();
    }
  }

  useEffect(() => {
    const handleScroll = () => {
      setIsScrolled(window.scrollY > 8);
    };
    handleScroll();
    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  useEffect(() => {
    writeStorage(USERS_KEY, users);
  }, [users]);

  useEffect(() => {
    writeStorage(CATEGORIES_KEY, categories);
    if (categories.length === 0) {
      setIsNewCategoryMode(true);
    } else if (!uploadCategoryId && categories[0]) {
      setUploadCategoryId(String(categories[0].id));
    }
  }, [categories, uploadCategoryId]);

  useEffect(() => {
    writeStorage(NOTES_KEY, notes);
  }, [notes]);

  useEffect(() => {
    if (currentUser) {
      writeStorage(SESSION_USER_KEY, currentUser);
    } else {
      localStorage.removeItem(SESSION_USER_KEY);
    }
  }, [currentUser]);

  const reduceOrMobile = Boolean(shouldReduceMotion || isMobile);

  const staggerContainerVariants = useMemo(
    () => ({
      hidden: { opacity: 0 },
      show: {
        opacity: 1,
        transition: {
          staggerChildren: shouldReduceMotion ? 0 : isMobile ? 0.04 : 0.08,
        },
      },
    }),
    [shouldReduceMotion, isMobile]
  );

  const fadeUpItemVariants = useMemo(
    () => ({
      hidden: { opacity: 0, y: shouldReduceMotion ? 0 : isMobile ? 8 : 16 },
      show: {
        opacity: 1,
        y: 0,
        transition: {
          duration: shouldReduceMotion ? 0 : isMobile ? 0.18 : 0.36,
          ease: [0.16, 1, 0.3, 1] as [number, number, number, number],
        },
      },
    }),
    [shouldReduceMotion, isMobile]
  );

  const buttonHoverProps = useMemo(
    () =>
      reduceOrMobile
        ? {
            whileTap: shouldReduceMotion ? undefined : { scale: 0.97 },
          }
        : {
            whileHover: {
              y: -2,
              boxShadow: '0 8px 22px -4px rgba(37, 99, 235, 0.35)',
            },
            whileTap: { scale: 0.97 },
            transition: { duration: 0.16 },
          },
    [reduceOrMobile, shouldReduceMotion]
  );

  const cardHoverProps = useMemo(
    () =>
      reduceOrMobile
        ? {}
        : {
            whileHover: {
              y: -4,
              rotateX: 1.2,
              rotateY: -1.2,
              scale: 1.005,
            },
            transition: { type: 'spring' as const, stiffness: 320, damping: 24 },
          },
    [reduceOrMobile]
  );

  const pageTransitionProps = useMemo(
    () => ({
      initial: { opacity: 0, y: shouldReduceMotion ? 0 : isMobile ? 6 : 10 },
      animate: { opacity: 1, y: 0 },
      exit: { opacity: 0, y: shouldReduceMotion ? 0 : isMobile ? -6 : -10 },
      transition: {
        duration: shouldReduceMotion ? 0 : isMobile ? 0.14 : 0.22,
        ease: [0.16, 1, 0.3, 1] as [number, number, number, number],
      },
    }),
    [shouldReduceMotion, isMobile]
  );

  const filteredNotes = useMemo(() => {
    return notes
      .filter((note) => {
        if (page === 'dashboard' && dashboardScope === 'mine' && currentUser) {
          if (note.uploader_id !== currentUser.id) return false;
        }
        if (selectedCategoryId && String(note.category_id) !== selectedCategoryId) {
          return false;
        }
        if (unitFilter.trim()) {
          const term = unitFilter.trim().toLowerCase();
          if (!note.unit.toLowerCase().includes(term)) return false;
        }
        if (searchQuery.trim()) {
          const q = searchQuery.trim().toLowerCase();
          const inTitle = note.title.toLowerCase().includes(q);
          const inDesc = (note.description || '').toLowerCase().includes(q);
          if (!inTitle && !inDesc) return false;
        }
        return true;
      })
      .sort((a, b) => {
        if (sortBy === 'oldest') {
          return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
        }
        if (sortBy === 'title_asc') {
          return a.title.localeCompare(b.title, undefined, { sensitivity: 'base' });
        }
        return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
      });
  }, [
    notes,
    page,
    dashboardScope,
    currentUser,
    selectedCategoryId,
    unitFilter,
    searchQuery,
    sortBy,
  ]);

  function canDelete(note: NoteRecord): boolean {
    if (!currentUser) return false;
    return currentUser.id === note.uploader_id || currentUser.role === 'admin';
  }

  async function handleLogin(event: React.FormEvent) {
    event.preventDefault();
    setAuthMessage(null);

    const normalizedEmail = loginEmail.trim().toLowerCase();
    const user = users.find((u) => u.email.toLowerCase() === normalizedEmail);
    const passwordHash = await hashPasswordHex(loginPassword);

    if (!user || user.password_hash !== passwordHash) {
      setAuthMessage({ text: 'Invalid email or password.', type: 'error' });
      return;
    }

    setCurrentUser(user);
    setLoginEmail('');
    setLoginPassword('');
    setPage('dashboard');
  }

  async function handleRegister(event: React.FormEvent) {
    event.preventDefault();
    setAuthMessage(null);

    const trimmedName = registerName.trim();
    const normalizedEmail = registerEmail.trim().toLowerCase();

    if (trimmedName.length < 2) {
      setAuthMessage({ text: 'Full name must be at least 2 characters.', type: 'error' });
      return;
    }
    if (!normalizedEmail.includes('@')) {
      setAuthMessage({ text: 'Please enter a valid email address.', type: 'error' });
      return;
    }
    if (registerPassword.length < 6) {
      setAuthMessage({ text: 'Password must be at least 6 characters.', type: 'error' });
      return;
    }
    if (users.some((u) => u.email.toLowerCase() === normalizedEmail)) {
      setAuthMessage({ text: 'An account with this email already exists.', type: 'error' });
      return;
    }

    const passwordHash = await hashPasswordHex(registerPassword);
    const nextId = users.length > 0 ? Math.max(...users.map((u) => u.id)) + 1 : 1;
    const newUser: UserRecord = {
      id: nextId,
      name: trimmedName,
      email: normalizedEmail,
      password_hash: passwordHash,
      role: registerRole,
      created_at: new Date().toISOString(),
    };

    setUsers((prev) => [...prev, newUser]);
    setCurrentUser(newUser);
    setRegisterName('');
    setRegisterEmail('');
    setRegisterPassword('');
    setPage('dashboard');
  }

  async function handleUploadNote(event: React.FormEvent) {
    event.preventDefault();
    setUploadStatus(null);

    if (!currentUser) {
      setPage('login');
      return;
    }

    const cleanTitle = uploadTitle.trim();
    const cleanUnit = uploadUnit.trim();
    const cleanDesc = uploadDescription.trim();

    if (!cleanTitle) {
      setUploadStatus({ text: 'Title is required.', type: 'error' });
      return;
    }
    if (!cleanUnit) {
      setUploadStatus({ text: 'Unit is required.', type: 'error' });
      return;
    }
    if (!uploadFile) {
      setUploadStatus({ text: 'Please choose a PDF file to upload.', type: 'error' });
      return;
    }
    if (!uploadFile.name.toLowerCase().endsWith('.pdf')) {
      setUploadStatus({ text: 'Only PDF files (.pdf) are accepted.', type: 'error' });
      return;
    }
    if (uploadFile.size === 0) {
      setUploadStatus({ text: 'Uploaded PDF file cannot be empty.', type: 'error' });
      return;
    }
    if (uploadFile.size > MAX_PDF_BYTES) {
      setUploadStatus({ text: 'File exceeds the maximum allowed size of 10 MB.', type: 'error' });
      return;
    }

    const isPdfValid = await validatePdfHeader(uploadFile);
    if (!isPdfValid) {
      setUploadStatus({
        text: 'Invalid PDF header. Only valid PDF files are accepted.',
        type: 'error',
      });
      return;
    }

    let resolvedCategory: CategoryRecord | undefined;
    if (isNewCategoryMode) {
      const catName = uploadCategoryName.trim();
      if (!catName) {
        setUploadStatus({ text: 'Please enter a subject category name.', type: 'error' });
        return;
      }
      const existingCat = categories.find((c) => c.name.toLowerCase() === catName.toLowerCase());
      if (existingCat) {
        resolvedCategory = existingCat;
      } else {
        const nextCatId =
          categories.length > 0 ? Math.max(...categories.map((c) => c.id)) + 1 : 1;
        resolvedCategory = { id: nextCatId, name: catName };
        setCategories((prev) =>
          [...prev, resolvedCategory!].sort((a, b) => a.name.localeCompare(b.name))
        );
      }
    } else {
      resolvedCategory = categories.find((c) => String(c.id) === uploadCategoryId);
      if (!resolvedCategory) {
        setUploadStatus({ text: 'Please select a subject category.', type: 'error' });
        return;
      }
    }

    const dataUrl = await readFileAsDataUrl(uploadFile);
    const uuidFilename = `${generateUuidHex()}.pdf`;
    const nextNoteId = notes.length > 0 ? Math.max(...notes.map((n) => n.id)) + 1 : 1;

    const newNote: NoteRecord = {
      id: nextNoteId,
      title: cleanTitle,
      description: cleanDesc,
      file_path: `uploads/${uuidFilename}`,
      uploader_id: currentUser.id,
      category_id: resolvedCategory.id,
      unit: cleanUnit,
      created_at: new Date().toISOString(),
      uploader_name: currentUser.name,
      category_name: resolvedCategory.name,
      blob_data_url: dataUrl,
    };

    setNotes((prev) => [newNote, ...prev]);
    setUploadTitle('');
    setUploadUnit('');
    setUploadDescription('');
    setUploadCategoryName('');
    setUploadFile(null);
    setUploadCategoryId(String(resolvedCategory.id));
    setIsNewCategoryMode(false);

    const fileInputEl = document.getElementById('react-upload-file') as HTMLInputElement | null;
    if (fileInputEl) fileInputEl.value = '';

    setUploadStatus({
      text: `Saved as ${newNote.file_path} and added to repository.`,
      type: 'success',
    });
  }

  function handleDeleteNote(noteId: number) {
    const target = notes.find((n) => n.id === noteId);
    if (!target || !canDelete(target)) return;
    setNotes((prev) => prev.filter((n) => n.id !== noteId));
    setPendingDeleteId(null);
    setCatalogStatus({ text: 'Study note deleted.', type: 'success' });
  }

  function handleDownloadNote(note: NoteRecord) {
    if (!note.blob_data_url) return;
    const link = document.createElement('a');
    link.href = note.blob_data_url;
    const cleanName = note.title.replace(/[^A-Za-z0-9._-]+/g, '_').replace(/^_|_$/g, '');
    link.download = `${cleanName || 'study_note'}.pdf`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }

  const navItems: { id: ActivePage; label: string }[] = [
    { id: 'catalog', label: 'Browse Notes' },
    { id: 'dashboard', label: 'Dashboard' },
    { id: 'login', label: 'Account' },
  ];

  return (
    <div className="relative min-h-dvh w-full max-w-full text-slate-900 overflow-x-hidden flex flex-col">
      <div
        aria-hidden="true"
        className="fixed inset-0 -z-10 pointer-events-none overflow-hidden bg-slate-50"
      >
        <motion.div
          animate={
            reduceOrMobile
              ? undefined
              : {
                  x: [0, 90, -50, 0],
                  y: [0, -70, 50, 0],
                  scale: [1, 1.12, 0.94, 1],
                }
          }
          transition={{ duration: 20, repeat: Infinity, ease: 'easeInOut' }}
          className="absolute -top-20 -left-16 w-[240px] h-[240px] md:w-[480px] md:h-[480px] rounded-full bg-blue-500/12 blur-2xl md:blur-3xl"
        />
        {!isMobile && (
          <>
            <motion.div
              animate={
                shouldReduceMotion
                  ? undefined
                  : {
                      x: [0, -80, 60, 0],
                      y: [0, 80, -40, 0],
                      scale: [1, 0.92, 1.1, 1],
                    }
              }
              transition={{ duration: 20, repeat: Infinity, ease: 'easeInOut' }}
              className="absolute top-1/4 -right-28 w-[520px] h-[520px] rounded-full bg-indigo-500/15 blur-3xl"
            />
            <motion.div
              animate={
                shouldReduceMotion
                  ? undefined
                  : {
                      x: [0, 60, -70, 0],
                      y: [0, -60, 40, 0],
                      scale: [1, 1.08, 0.95, 1],
                    }
              }
              transition={{ duration: 20, repeat: Infinity, ease: 'easeInOut' }}
              className="absolute -bottom-32 left-1/3 w-[500px] h-[500px] rounded-full bg-violet-500/15 blur-3xl"
            />
          </>
        )}
      </div>

      <header
        className={`sticky top-0 z-30 safe-top transition-colors duration-200 ${
          isScrolled
            ? 'bg-white/95 md:bg-white/75 md:backdrop-blur-xl border-b border-slate-200/80 shadow-xs'
            : 'bg-white/90 md:bg-white/45 md:backdrop-blur-md border-b border-slate-200/60'
        }`}
      >
        <div className="max-w-[1200px] mx-auto safe-x py-2.5 md:py-3.5 flex items-center justify-between gap-2 sm:gap-6">
          <button
            type="button"
            onClick={() => navigateToPage('catalog')}
            className="min-h-[44px] px-2 -ml-2 inline-flex items-center text-base sm:text-lg font-bold tracking-tight text-slate-900 whitespace-nowrap shrink-0 cursor-pointer"
          >
            Study Hub
          </button>

          <nav
            aria-label="Primary Navigation"
            className="hidden md:flex items-center gap-6 text-sm font-bold text-slate-800"
          >
            <button
              type="button"
              onClick={() => navigateToPage('catalog')}
              className={`relative min-h-[44px] px-2 inline-flex items-center transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                page === 'catalog' ? 'text-slate-950' : 'text-slate-800 hover:text-slate-950'
              }`}
            >
              Browse Notes
              {page === 'catalog' && (
                <motion.span
                  layoutId="navbar-active-underline"
                  className="absolute left-2 right-2 bottom-1 h-0.5 bg-blue-700 rounded-full"
                  transition={{ type: 'spring', stiffness: 380, damping: 30 }}
                />
              )}
            </button>

            <a
              href="#about"
              onClick={scrollToAbout}
              className="relative min-h-[44px] px-2 inline-flex items-center text-slate-900 font-bold transition-colors whitespace-nowrap shrink-0 hover:text-blue-700 cursor-pointer"
            >
              About
            </a>

            {navItems
              .filter((item) => item.id !== 'catalog')
              .map((item) => {
                const isActive = page === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => navigateToPage(item.id)}
                    className={`relative min-h-[44px] px-2 inline-flex items-center transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                      isActive ? 'text-slate-950' : 'text-slate-800 hover:text-slate-950'
                    }`}
                  >
                    {item.label}
                    {isActive && (
                      <motion.span
                        layoutId="navbar-active-underline"
                        className="absolute left-2 right-2 bottom-1 h-0.5 bg-blue-700 rounded-full"
                        transition={{ type: 'spring', stiffness: 380, damping: 30 }}
                      />
                    )}
                  </button>
                );
              })}
          </nav>

          <div className="flex items-center gap-2 shrink-0">
            {currentUser ? (
              page === 'dashboard' ? (
                <motion.button
                  type="button"
                  {...buttonHoverProps}
                  onClick={() => {
                    setCurrentUser(null);
                    navigateToPage('login');
                  }}
                  className="px-3.5 py-2 min-h-[44px] min-w-[44px] text-xs font-semibold text-slate-900 bg-white border border-slate-300 rounded-xl hover:bg-slate-50 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                >
                  Sign Out
                </motion.button>
              ) : (
                <motion.button
                  type="button"
                  {...buttonHoverProps}
                  onClick={() => navigateToPage('dashboard')}
                  className="px-3.5 py-2 min-h-[44px] min-w-[44px] text-xs font-semibold text-white bg-blue-700 rounded-xl hover:bg-blue-800 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                >
                  Upload Note
                </motion.button>
              )
            ) : (
              <motion.button
                type="button"
                {...buttonHoverProps}
                onClick={() => navigateToPage('login')}
                className="px-3.5 py-2 min-h-[44px] min-w-[44px] text-xs font-semibold text-white bg-blue-700 rounded-xl hover:bg-blue-800 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                Sign In
              </motion.button>
            )}

            <button
              type="button"
              aria-label={mobileMenuOpen ? 'Close navigation menu' : 'Open navigation menu'}
              aria-expanded={mobileMenuOpen}
              onClick={() => setMobileMenuOpen((prev) => !prev)}
              className="md:hidden min-h-[44px] min-w-[44px] inline-flex items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-900 cursor-pointer"
            >
              {mobileMenuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
            </button>
          </div>
        </div>

        {mobileMenuOpen && (
          <div className="md:hidden border-t border-slate-200 bg-white safe-x py-2 flex flex-col gap-1 shadow-md">
            <button
              type="button"
              onClick={() => navigateToPage('catalog')}
              className={`min-h-[44px] px-3 rounded-xl text-left text-sm font-bold flex items-center justify-between ${
                page === 'catalog' ? 'bg-blue-50 text-blue-700' : 'text-slate-800'
              }`}
            >
              <span>Browse Notes</span>
            </button>
            <a
              href="#about"
              onClick={scrollToAbout}
              className="min-h-[44px] px-3 rounded-xl text-left text-sm font-bold text-slate-800 flex items-center justify-between"
            >
              <span>About & Technical Team</span>
            </a>
            <button
              type="button"
              onClick={() => navigateToPage('dashboard')}
              className={`min-h-[44px] px-3 rounded-xl text-left text-sm font-bold flex items-center justify-between ${
                page === 'dashboard' ? 'bg-blue-50 text-blue-700' : 'text-slate-800'
              }`}
            >
              <span>Dashboard</span>
            </button>
            <button
              type="button"
              onClick={() => navigateToPage('login')}
              className={`min-h-[44px] px-3 rounded-xl text-left text-sm font-bold flex items-center justify-between ${
                page === 'login' ? 'bg-blue-50 text-blue-700' : 'text-slate-800'
              }`}
            >
              <span>Account</span>
            </button>
          </div>
        )}
      </header>

      <main className="flex-1 w-full max-w-[1200px] mx-auto safe-x py-5 sm:py-8 pb-28 md:pb-16">
        <Suspense fallback={<RouteSkeleton />}>
          <LazySectionWrapper>
            <AnimatePresence mode="wait">
              {page === 'catalog' && (
                <motion.div key="page-catalog" {...pageTransitionProps}>
                  <motion.div
                    variants={staggerContainerVariants}
                    initial="hidden"
                    animate="show"
                  >
                    <motion.section
                      variants={fadeUpItemVariants}
                      className="flex flex-wrap items-end justify-between gap-3 pb-4 mb-5 border-b border-slate-200/80"
                    >
                      <div className="min-w-0">
                        <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-slate-900">
                          Course Study Notes
                        </h1>
                        <p className="mt-1 text-sm text-slate-600 max-w-2xl">
                          Search peer-uploaded lecture notes, summaries, and unit reference PDFs
                          organized by academic subject.
                        </p>
                      </div>
                      <div className="text-xs text-slate-600 font-mono tabular-nums">
                        {filteredNotes.length}{' '}
                        {filteredNotes.length === 1 ? 'study note' : 'study notes'} available
                      </div>
                    </motion.section>

                    <motion.section
                      variants={fadeUpItemVariants}
                      className="grid grid-cols-1 lg:grid-cols-12 gap-4 mb-5 items-stretch"
                    >
                      <div
                        className={`lg:col-span-7 relative overflow-hidden ${glassSurfaceClass} min-h-[200px] sm:min-h-[220px] flex flex-col justify-end p-4 sm:p-6`}
                      >
                        <LazyImage
                          src={IMG_LIBRARY_HALL}
                          alt="University reading room desk with open lecture notes and laptop"
                          width={720}
                          height={420}
                          className="absolute inset-0 w-full h-full object-cover"
                        />
                        <div className="absolute inset-0 bg-gradient-to-t from-slate-950/90 via-slate-900/50 to-transparent" />
                        <div className="relative z-10 text-white min-w-0">
                          <div className="text-xs text-slate-200 mb-1">
                            <span>Academic Archive</span>
                            <span aria-hidden="true"> · </span>
                            <span>Peer Repository</span>
                          </div>
                          <h2 className="text-lg sm:text-xl font-bold tracking-tight">
                            Shared University Reading Room & Course Summaries
                          </h2>
                          <p className="text-xs text-slate-200 mt-1 max-w-xl">
                            Upload structured PDF notes by course subject and unit so classmates can
                            review and download verified study material.
                          </p>
                          <QuoteRotatorBox light />
                        </div>
                      </div>

                      <div className="lg:col-span-5 grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <div
                          className={`relative overflow-hidden ${glassSurfaceClass} min-h-[160px] sm:min-h-[220px] flex flex-col justify-end p-4`}
                        >
                          <LazyImage
                            src={IMG_STUDY_GROUP}
                            alt="Students collaborating around study table with handwritten notebooks"
                            width={400}
                            height={300}
                            className="absolute inset-0 w-full h-full object-cover"
                          />
                          <div className="absolute inset-0 bg-gradient-to-t from-slate-950/85 via-slate-900/35 to-transparent" />
                          <div className="relative z-10 text-white">
                            <div className="text-xs text-slate-200">Collaborative Study</div>
                            <p className="text-sm font-bold leading-snug mt-0.5">
                              Handwritten & Typed Unit Notes
                            </p>
                          </div>
                        </div>

                        <div
                          className={`relative overflow-hidden ${glassSurfaceClass} min-h-[160px] sm:min-h-[220px] flex flex-col justify-end p-4`}
                        >
                          <LazyImage
                            src={IMG_DESK_COMPANION}
                            alt="Late-night focused study desk workstation"
                            width={400}
                            height={300}
                            className="absolute inset-0 w-full h-full object-cover"
                          />
                          <div className="absolute inset-0 bg-gradient-to-t from-slate-950/85 via-slate-900/35 to-transparent" />
                          <div className="relative z-10 text-white">
                            <div className="text-xs text-slate-200">Exam Prep</div>
                            <p className="text-sm font-bold leading-snug mt-0.5">
                              Organized by Subject & Unit
                            </p>
                          </div>
                        </div>
                      </div>
                    </motion.section>

                    {catalogStatus && (
                      <motion.div
                        variants={fadeUpItemVariants}
                        className={`mb-4 px-4 py-3 rounded-xl text-xs font-semibold border ${
                          catalogStatus.type === 'error'
                            ? 'bg-red-50 text-red-700 border-red-200'
                            : 'bg-green-50 text-green-800 border-green-200'
                        }`}
                      >
                        {catalogStatus.text}
                      </motion.div>
                    )}

                    <motion.section
                      variants={fadeUpItemVariants}
                      className={`${glassSurfaceClass} p-4 sm:p-5 mb-6 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3 items-end`}
                    >
                      <div className="flex flex-col gap-1.5 min-w-0">
                        <label
                          htmlFor="catalog-search"
                          className="text-xs font-semibold text-slate-900"
                        >
                          Search Title or Description
                        </label>
                        <input
                          id="catalog-search"
                          type="search"
                          enterKeyHint="search"
                          value={searchQuery}
                          onChange={(e) => setSearchQuery(e.target.value)}
                          placeholder="e.g. Dynamic Programming..."
                          className={inputControlClass}
                        />
                      </div>

                      <div className="flex flex-col gap-1.5 min-w-0">
                        <label
                          htmlFor="catalog-category"
                          className="text-xs font-semibold text-slate-900"
                        >
                          Subject Category
                        </label>
                        <select
                          id="catalog-category"
                          value={selectedCategoryId}
                          onChange={(e) => setSelectedCategoryId(e.target.value)}
                          className={inputControlClass}
                        >
                          <option value="">All Subjects</option>
                          {categories.map((cat) => (
                            <option key={cat.id} value={String(cat.id)}>
                              {cat.name}
                            </option>
                          ))}
                        </select>
                      </div>

                      <div className="flex flex-col gap-1.5 min-w-0">
                        <label
                          htmlFor="catalog-unit"
                          className="text-xs font-semibold text-slate-900"
                        >
                          Unit
                        </label>
                        <input
                          id="catalog-unit"
                          type="text"
                          value={unitFilter}
                          onChange={(e) => setUnitFilter(e.target.value)}
                          placeholder="e.g. Unit 1"
                          className={inputControlClass}
                        />
                      </div>

                      <div className="flex flex-col gap-1.5 min-w-0">
                        <label
                          htmlFor="catalog-sort"
                          className="text-xs font-semibold text-slate-900"
                        >
                          Sort By
                        </label>
                        <select
                          id="catalog-sort"
                          value={sortBy}
                          onChange={(e) => setSortBy(e.target.value as SortOption)}
                          className={inputControlClass}
                        >
                          <option value="newest">Newest First</option>
                          <option value="oldest">Oldest First</option>
                          <option value="title_asc">Title (A-Z)</option>
                        </select>
                      </div>

                      <div className="sm:col-span-2 lg:col-span-1">
                        <motion.button
                          type="button"
                          {...buttonHoverProps}
                          onClick={() => {
                            setSearchQuery('');
                            setSelectedCategoryId('');
                            setUnitFilter('');
                            setSortBy('newest');
                            setCatalogStatus(null);
                          }}
                          className="w-full min-h-[44px] px-4 py-2.5 text-xs font-semibold text-slate-900 bg-white border border-slate-300 rounded-xl hover:bg-slate-50 transition-colors cursor-pointer"
                        >
                          Reset Filters
                        </motion.button>
                      </div>
                    </motion.section>

                    {filteredNotes.length === 0 ? (
                      <motion.div
                        variants={fadeUpItemVariants}
                        className={`${glassSurfaceClass} py-10 px-4 sm:px-6 text-center`}
                      >
                        <motion.div
                          animate={reduceOrMobile ? undefined : { y: [0, -7, 0] }}
                          transition={{ duration: 3.2, repeat: Infinity, ease: 'easeInOut' }}
                          className="mx-auto mb-4 flex flex-col items-center gap-3"
                        >
                          <div className="w-12 h-12 rounded-2xl bg-blue-50 border border-blue-200/70 flex items-center justify-center text-blue-700 shadow-xs">
                            <FileText className="w-6 h-6" />
                          </div>
                          <div className="relative w-24 h-24 rounded-2xl overflow-hidden border border-white/80 shadow-sm">
                            <LazyImage
                              src={IMG_DESK_COMPANION}
                              alt="Study desk workstation"
                              width={96}
                              height={96}
                              className="w-24 h-24 object-cover"
                            />
                          </div>
                        </motion.div>
                        <h2 className="text-base font-bold text-slate-900 mb-1.5">
                          {searchQuery || selectedCategoryId || unitFilter
                            ? 'No matching study notes found'
                            : 'No study notes uploaded yet'}
                        </h2>
                        <p className="text-sm text-slate-600 max-w-md mx-auto mb-5">
                          {searchQuery || selectedCategoryId || unitFilter
                            ? 'Try clearing your search query or selecting a different subject filter.'
                            : 'Sign in to upload the first PDF study note and organize course materials by subject and unit.'}
                        </p>
                        {searchQuery || selectedCategoryId || unitFilter ? (
                          <motion.button
                            type="button"
                            {...buttonHoverProps}
                            onClick={() => {
                              setSearchQuery('');
                              setSelectedCategoryId('');
                              setUnitFilter('');
                            }}
                            className="px-4 py-2.5 min-h-[44px] min-w-[44px] text-xs font-semibold text-slate-900 bg-white border border-slate-300 rounded-xl hover:bg-slate-50 transition-colors cursor-pointer"
                          >
                            Clear Filters
                          </motion.button>
                        ) : (
                          <motion.button
                            type="button"
                            {...buttonHoverProps}
                            onClick={() => navigateToPage(currentUser ? 'dashboard' : 'login')}
                            className="px-4 py-2.5 min-h-[44px] min-w-[44px] text-xs font-semibold text-white bg-blue-700 rounded-xl hover:bg-blue-800 transition-colors cursor-pointer"
                          >
                            {currentUser ? 'Go to Dashboard' : 'Sign In to Upload'}
                          </motion.button>
                        )}
                      </motion.div>
                    ) : (
                      <motion.div
                        variants={staggerContainerVariants}
                        className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4"
                      >
                        {filteredNotes.map((note) => (
                          <motion.article
                            key={note.id}
                            variants={fadeUpItemVariants}
                            {...cardHoverProps}
                            className={`${glassSurfaceClass} p-4 sm:p-5 flex flex-col justify-between gap-4 min-w-0`}
                          >
                            <div className="flex items-start gap-3.5 min-w-0">
                              <PdfThumbnail
                                dataUrl={note.blob_data_url}
                                title={note.title}
                                onClick={() => setActivePdfNote(note)}
                              />
                              <div className="min-w-0 flex-1">
                                <div className="flex flex-wrap items-center gap-1.5 text-xs text-slate-500 mb-1">
                                  <span className="truncate max-w-full">{note.category_name}</span>
                                  <span aria-hidden="true">·</span>
                                  <span className="font-mono">{note.unit}</span>
                                </div>
                                <h2 className="text-base font-bold text-slate-900 mb-1 break-words">
                                  {note.title}
                                </h2>
                                {note.description && (
                                  <p className="text-sm text-slate-600 mb-2 line-clamp-3 break-words">
                                    {note.description}
                                  </p>
                                )}
                                <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-500">
                                  <span>By {note.uploader_name}</span>
                                  <span aria-hidden="true">·</span>
                                  <span className="font-mono tabular-nums">
                                    {formatDate(note.created_at)}
                                  </span>
                                </div>
                              </div>
                            </div>

                            <div className="flex items-center gap-2 pt-3 border-t border-slate-200/70 flex-wrap">
                              <motion.button
                                type="button"
                                {...buttonHoverProps}
                                onClick={() => setActivePdfNote(note)}
                                className="flex-1 min-h-[44px] min-w-[44px] px-3 py-2 text-xs font-semibold text-slate-900 bg-white border border-slate-300 rounded-xl hover:bg-slate-50 transition-colors cursor-pointer"
                              >
                                Open PDF
                              </motion.button>
                              <motion.button
                                type="button"
                                {...buttonHoverProps}
                                onClick={() => handleDownloadNote(note)}
                                className="flex-1 min-h-[44px] min-w-[44px] px-3 py-2 text-xs font-semibold text-white bg-blue-700 rounded-xl hover:bg-blue-800 transition-colors cursor-pointer"
                              >
                                Download
                              </motion.button>
                              {canDelete(note) &&
                                (pendingDeleteId === note.id ? (
                                  <div className="w-full flex items-center justify-end gap-2 pt-1">
                                    <span className="text-xs font-semibold text-red-600">
                                      Delete?
                                    </span>
                                    <motion.button
                                      type="button"
                                      {...buttonHoverProps}
                                      onClick={() => handleDeleteNote(note.id)}
                                      className="px-3 py-2 min-h-[44px] min-w-[44px] text-xs font-semibold text-red-700 bg-red-50 border border-red-200 rounded-xl hover:bg-red-100 cursor-pointer"
                                    >
                                      Confirm
                                    </motion.button>
                                    <motion.button
                                      type="button"
                                      {...buttonHoverProps}
                                      onClick={() => setPendingDeleteId(null)}
                                      className="px-3 py-2 min-h-[44px] min-w-[44px] text-xs font-semibold text-slate-700 bg-white border border-slate-300 rounded-xl hover:bg-slate-50 cursor-pointer"
                                    >
                                      Cancel
                                    </motion.button>
                                  </div>
                                ) : (
                                  <motion.button
                                    type="button"
                                    {...buttonHoverProps}
                                    onClick={() => setPendingDeleteId(note.id)}
                                    className="px-3 py-2 min-h-[44px] min-w-[44px] text-xs font-semibold text-red-700 bg-red-50 border border-red-200 rounded-xl hover:bg-red-100 transition-colors cursor-pointer"
                                  >
                                    Delete
                                  </motion.button>
                                ))}
                            </div>
                          </motion.article>
                        ))}
                      </motion.div>
                    )}
                  </motion.div>
                </motion.div>
              )}

              {page === 'login' && (
                <motion.div
                  key="page-login"
                  {...pageTransitionProps}
                  className="max-w-[920px] mx-auto my-2 sm:my-6 grid grid-cols-1 md:grid-cols-12 gap-5 items-stretch"
                >
                  <div
                    className={`${glassSurfaceClass} md:col-span-6 p-4 sm:p-6 flex flex-col justify-center min-w-0`}
                  >
                    <div
                      role="tablist"
                      aria-label="Authentication Mode"
                      className="grid grid-cols-2 p-1 bg-slate-100 border border-slate-200/80 rounded-xl gap-1 mb-5"
                    >
                      <button
                        type="button"
                        role="tab"
                        aria-selected={authMode === 'login'}
                        onClick={() => {
                          setAuthMessage(null);
                          setAuthMode('login');
                        }}
                        className={`min-h-[44px] px-3 py-2 text-xs font-semibold rounded-lg transition-colors cursor-pointer ${
                          authMode === 'login'
                            ? 'bg-white text-slate-900 shadow-xs'
                            : 'text-slate-600 hover:text-slate-900'
                        }`}
                      >
                        Sign In
                      </button>
                      <button
                        type="button"
                        role="tab"
                        aria-selected={authMode === 'register'}
                        onClick={() => {
                          setAuthMessage(null);
                          setAuthMode('register');
                        }}
                        className={`min-h-[44px] px-3 py-2 text-xs font-semibold rounded-lg transition-colors cursor-pointer ${
                          authMode === 'register'
                            ? 'bg-white text-slate-900 shadow-xs'
                            : 'text-slate-600 hover:text-slate-900'
                        }`}
                      >
                        Create Account
                      </button>
                    </div>

                    <h1 className="text-lg font-bold text-slate-900 mb-1">
                      {authMode === 'login' ? 'Sign In to Study Hub' : 'Create a Study Hub Account'}
                    </h1>
                    <p className="text-xs text-slate-600 mb-5">
                      {authMode === 'login'
                        ? 'Access your dashboard to upload, organize, and download course PDFs.'
                        : 'Register with your academic email to upload and manage study notes.'}
                    </p>

                    {authMessage && (
                      <div
                        className={`mb-4 px-3.5 py-2.5 rounded-xl text-xs font-semibold border ${
                          authMessage.type === 'error'
                            ? 'bg-red-50 text-red-700 border-red-200'
                            : 'bg-green-50 text-green-800 border-green-200'
                        }`}
                      >
                        {authMessage.text}
                      </div>
                    )}

                    <AnimatePresence mode="wait">
                      {authMode === 'login' ? (
                        <motion.form
                          key="auth-login-form"
                          {...pageTransitionProps}
                          onSubmit={handleLogin}
                          onFocusCapture={scrollFieldIntoViewOnFocus}
                          className="flex flex-col gap-4 pb-4"
                        >
                          <div className="flex flex-col gap-1.5">
                            <label htmlFor="login-email-input" className="text-xs font-semibold">
                              Email Address
                            </label>
                            <input
                              id="login-email-input"
                              name="email"
                              type="email"
                              inputMode="email"
                              autoCapitalize="none"
                              autoCorrect="off"
                              autoComplete="email"
                              enterKeyHint="next"
                              required
                              value={loginEmail}
                              onChange={(e) => setLoginEmail(e.target.value)}
                              placeholder="student@university.edu"
                              className={inputControlClass}
                            />
                          </div>

                          <div className="flex flex-col gap-1.5">
                            <label htmlFor="login-password-input" className="text-xs font-semibold">
                              Password
                            </label>
                            <input
                              id="login-password-input"
                              name="password"
                              type="password"
                              autoComplete="current-password"
                              enterKeyHint="done"
                              required
                              value={loginPassword}
                              onChange={(e) => setLoginPassword(e.target.value)}
                              placeholder="Enter your password"
                              className={inputControlClass}
                            />
                          </div>

                          <motion.button
                            type="submit"
                            {...buttonHoverProps}
                            className="w-full min-h-[44px] px-4 py-2.5 text-sm font-semibold text-white bg-blue-700 rounded-xl hover:bg-blue-800 transition-colors cursor-pointer scroll-mt-24"
                          >
                            Sign In
                          </motion.button>
                        </motion.form>
                      ) : (
                        <motion.form
                          key="auth-register-form"
                          {...pageTransitionProps}
                          onSubmit={handleRegister}
                          onFocusCapture={scrollFieldIntoViewOnFocus}
                          className="flex flex-col gap-4 pb-4"
                        >
                          <div className="flex flex-col gap-1.5">
                            <label htmlFor="reg-name-input" className="text-xs font-semibold">
                              Full Name
                            </label>
                            <input
                              id="reg-name-input"
                              name="name"
                              type="text"
                              autoComplete="name"
                              enterKeyHint="next"
                              required
                              value={registerName}
                              onChange={(e) => setRegisterName(e.target.value)}
                              placeholder="Alex Rivera"
                              className={inputControlClass}
                            />
                          </div>

                          <div className="flex flex-col gap-1.5">
                            <label htmlFor="reg-email-input" className="text-xs font-semibold">
                              Email Address
                            </label>
                            <input
                              id="reg-email-input"
                              name="email"
                              type="email"
                              inputMode="email"
                              autoCapitalize="none"
                              autoCorrect="off"
                              autoComplete="email"
                              enterKeyHint="next"
                              required
                              value={registerEmail}
                              onChange={(e) => setRegisterEmail(e.target.value)}
                              placeholder="student@university.edu"
                              className={inputControlClass}
                            />
                          </div>

                          <div className="flex flex-col gap-1.5">
                            <label htmlFor="reg-password-input" className="text-xs font-semibold">
                              Password
                            </label>
                            <input
                              id="reg-password-input"
                              name="new-password"
                              type="password"
                              autoComplete="new-password"
                              enterKeyHint="next"
                              required
                              minLength={6}
                              value={registerPassword}
                              onChange={(e) => setRegisterPassword(e.target.value)}
                              placeholder="Minimum 6 characters"
                              className={inputControlClass}
                            />
                          </div>

                          <div className="flex flex-col gap-1.5">
                            <label htmlFor="reg-role-select" className="text-xs font-semibold">
                              Account Role
                            </label>
                            <select
                              id="reg-role-select"
                              name="role"
                              value={registerRole}
                              onChange={(e) =>
                                setRegisterRole(e.target.value as 'student' | 'admin')
                              }
                              className={inputControlClass}
                            >
                              <option value="student">Student</option>
                              <option value="admin">Admin</option>
                            </select>
                          </div>

                          <motion.button
                            type="submit"
                            {...buttonHoverProps}
                            className="w-full min-h-[44px] px-4 py-2.5 text-sm font-semibold text-white bg-blue-700 rounded-xl hover:bg-blue-800 transition-colors cursor-pointer scroll-mt-24"
                          >
                            Create Account
                          </motion.button>
                        </motion.form>
                      )}
                    </AnimatePresence>
                  </div>

                  <div className="md:col-span-6 flex flex-col gap-4 min-w-0">
                    <div
                      className={`relative overflow-hidden ${glassSurfaceClass} flex-1 min-h-[200px] flex flex-col justify-end p-5`}
                    >
                      <LazyImage
                        src={IMG_STUDY_GROUP}
                        alt="Students studying together with course notebooks"
                        width={540}
                        height={360}
                        className="absolute inset-0 w-full h-full object-cover"
                      />
                      <div className="absolute inset-0 bg-gradient-to-t from-slate-950/85 via-slate-900/40 to-transparent" />
                      <div className="relative z-10 text-white">
                        <div className="text-xs text-slate-200 mb-1">Student Community</div>
                        <h2 className="text-base font-bold">
                          Share Lecture PDFs & Study Guides Across Courses
                        </h2>
                        <QuoteRotatorBox light />
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-3 sm:gap-4">
                      <div
                        className={`relative overflow-hidden ${glassSurfaceClass} h-32 sm:h-36 flex flex-col justify-end p-3.5`}
                      >
                        <LazyImage
                          src={IMG_LIBRARY_HALL}
                          alt="University reading room"
                          width={280}
                          height={180}
                          className="absolute inset-0 w-full h-full object-cover"
                        />
                        <div className="absolute inset-0 bg-gradient-to-t from-slate-950/80 via-slate-900/30 to-transparent" />
                        <span className="relative z-10 text-xs font-semibold text-white">
                          Library Archives
                        </span>
                      </div>

                      <div
                        className={`relative overflow-hidden ${glassSurfaceClass} h-32 sm:h-36 flex flex-col justify-end p-3.5`}
                      >
                        <LazyImage
                          src={IMG_DESK_COMPANION}
                          alt="Late night desk session"
                          width={280}
                          height={180}
                          className="absolute inset-0 w-full h-full object-cover"
                        />
                        <div className="absolute inset-0 bg-gradient-to-t from-slate-950/80 via-slate-900/30 to-transparent" />
                        <span className="relative z-10 text-xs font-semibold text-white">
                          Focused Study
                        </span>
                      </div>
                    </div>
                  </div>
                </motion.div>
              )}

              {page === 'dashboard' && currentUser && (
                <motion.div key="page-dashboard" {...pageTransitionProps}>
                  <motion.div
                    variants={staggerContainerVariants}
                    initial="hidden"
                    animate="show"
                  >
                    <motion.section
                      variants={fadeUpItemVariants}
                      className="flex flex-wrap items-end justify-between gap-3 pb-4 mb-5 border-b border-slate-200/80"
                    >
                      <div className="min-w-0">
                        <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-slate-900">
                          Student Workspace
                        </h1>
                        <p className="mt-1 text-sm text-slate-600 max-w-2xl">
                          Upload PDF lecture notes, assign subject categories and course units, and
                          manage repository files.
                        </p>
                      </div>
                      <div className="flex flex-wrap items-center gap-2 text-xs text-slate-600">
                        <span>{currentUser.name}</span>
                        <span aria-hidden="true">·</span>
                        <span className="break-all">{currentUser.email}</span>
                        <span aria-hidden="true">·</span>
                        <span className="font-mono">{currentUser.role}</span>
                      </div>
                    </motion.section>

                    <motion.section
                      variants={fadeUpItemVariants}
                      className="dashboard-quote-banner"
                      aria-label="Study Inspiration"
                    >
                      <QuoteRotatorBox />
                    </motion.section>

                    <div className="grid grid-cols-1 lg:grid-cols-[360px_1fr] gap-6 items-start">
                      <motion.aside
                        variants={fadeUpItemVariants}
                        className={`${glassSurfaceClass} p-4 sm:p-6 min-w-0`}
                      >
                        <div className="grid grid-cols-3 gap-2 mb-4">
                          <div className="relative h-14 sm:h-16 rounded-xl overflow-hidden border border-slate-200">
                            <LazyImage
                              src={IMG_LIBRARY_HALL}
                              alt="Library reading desk"
                              width={120}
                              height={64}
                              className="w-full h-full object-cover"
                            />
                          </div>
                          <div className="relative h-14 sm:h-16 rounded-xl overflow-hidden border border-slate-200">
                            <LazyImage
                              src={IMG_STUDY_GROUP}
                              alt="Group study table"
                              width={120}
                              height={64}
                              className="w-full h-full object-cover"
                            />
                          </div>
                          <div className="relative h-14 sm:h-16 rounded-xl overflow-hidden border border-slate-200">
                            <LazyImage
                              src={IMG_DESK_COMPANION}
                              alt="Study desk workstation"
                              width={120}
                              height={64}
                              className="w-full h-full object-cover"
                            />
                          </div>
                        </div>

                        <h2 className="text-lg font-bold text-slate-900 mb-1">Upload PDF Note</h2>
                        <p className="text-xs text-slate-600 mb-4">
                          PDF documents only, maximum file size 10 MB. Stored under a UUID filename.
                        </p>

                        {uploadStatus && (
                          <div
                            className={`mb-4 px-3.5 py-2.5 rounded-xl text-xs font-semibold border break-words ${
                              uploadStatus.type === 'error'
                                ? 'bg-red-50 text-red-700 border-red-200'
                                : 'bg-green-50 text-green-800 border-green-200'
                            }`}
                          >
                            {uploadStatus.text}
                          </div>
                        )}

                        <form
                          onSubmit={handleUploadNote}
                          onFocusCapture={scrollFieldIntoViewOnFocus}
                          className="flex flex-col gap-4"
                        >
                          <div className="flex flex-col gap-1.5">
                            <label htmlFor="react-upload-title" className="text-xs font-semibold">
                              Note Title
                            </label>
                            <input
                              id="react-upload-title"
                              type="text"
                              required
                              value={uploadTitle}
                              onChange={(e) => setUploadTitle(e.target.value)}
                              placeholder="e.g. Graph Traversal & Shortest Paths"
                              className={inputControlClass}
                            />
                          </div>

                          {!isNewCategoryMode && categories.length > 0 ? (
                            <div className="flex flex-col gap-1.5">
                              <div className="flex items-center justify-between gap-2">
                                <label
                                  htmlFor="react-upload-cat-select"
                                  className="text-xs font-semibold"
                                >
                                  Subject (Category)
                                </label>
                                <button
                                  type="button"
                                  onClick={() => setIsNewCategoryMode(true)}
                                  className="min-h-[44px] px-2 inline-flex items-center text-xs font-semibold text-blue-700 hover:underline cursor-pointer"
                                >
                                  New Subject
                                </button>
                              </div>
                              <select
                                id="react-upload-cat-select"
                                value={uploadCategoryId}
                                onChange={(e) => setUploadCategoryId(e.target.value)}
                                className={inputControlClass}
                              >
                                {categories.map((cat) => (
                                  <option key={cat.id} value={String(cat.id)}>
                                    {cat.name}
                                  </option>
                                ))}
                              </select>
                            </div>
                          ) : (
                            <div className="flex flex-col gap-1.5">
                              <div className="flex items-center justify-between gap-2">
                                <label
                                  htmlFor="react-upload-cat-input"
                                  className="text-xs font-semibold"
                                >
                                  Subject (Category)
                                </label>
                                {categories.length > 0 && (
                                  <button
                                    type="button"
                                    onClick={() => setIsNewCategoryMode(false)}
                                    className="min-h-[44px] px-2 inline-flex items-center text-xs font-semibold text-blue-700 hover:underline cursor-pointer"
                                  >
                                    Choose Existing
                                  </button>
                                )}
                              </div>
                              <input
                                id="react-upload-cat-input"
                                type="text"
                                required
                                value={uploadCategoryName}
                                onChange={(e) => setUploadCategoryName(e.target.value)}
                                placeholder="e.g. Data Structures & Algorithms"
                                className={inputControlClass}
                              />
                            </div>
                          )}

                          <div className="flex flex-col gap-1.5">
                            <label htmlFor="react-upload-unit" className="text-xs font-semibold">
                              Unit
                            </label>
                            <input
                              id="react-upload-unit"
                              type="text"
                              required
                              value={uploadUnit}
                              onChange={(e) => setUploadUnit(e.target.value)}
                              placeholder="e.g. Unit 3"
                              className={inputControlClass}
                            />
                          </div>

                          <div className="flex flex-col gap-1.5">
                            <label htmlFor="react-upload-desc" className="text-xs font-semibold">
                              Description
                            </label>
                            <textarea
                              id="react-upload-desc"
                              rows={3}
                              value={uploadDescription}
                              onChange={(e) => setUploadDescription(e.target.value)}
                              placeholder="Key topics covered, theorems, or exam preparation notes..."
                              className="w-full px-3.5 py-2.5 text-base sm:text-sm bg-white border border-slate-300/90 rounded-xl text-slate-900"
                            />
                          </div>

                          <div className="flex flex-col gap-1.5">
                            <label htmlFor="react-upload-file" className="text-xs font-semibold">
                              PDF Document
                            </label>
                            <input
                              id="react-upload-file"
                              type="file"
                              accept=".pdf,application/pdf"
                              required
                              onChange={(e) => setUploadFile(e.target.files?.[0] || null)}
                              className="w-full min-h-[44px] px-3 py-2 text-base sm:text-sm bg-white border border-slate-300/90 rounded-xl"
                            />
                            <span className="text-xs text-slate-500 font-mono">
                              Accepted format: .pdf · Max size: 10 MB
                            </span>
                          </div>

                          <motion.button
                            type="submit"
                            {...buttonHoverProps}
                            className="w-full min-h-[44px] px-4 py-2.5 text-sm font-semibold text-white bg-blue-700 rounded-xl hover:bg-blue-800 transition-colors cursor-pointer scroll-mt-24"
                          >
                            Upload PDF Note
                          </motion.button>
                        </form>
                      </motion.aside>

                      <section className="min-w-0">
                        <motion.div
                          variants={fadeUpItemVariants}
                          className="flex flex-wrap items-center justify-between gap-3 mb-4"
                        >
                          <div className="inline-flex p-1 bg-white border border-slate-200 rounded-xl gap-1 shadow-xs">
                            <button
                              type="button"
                              onClick={() => setDashboardScope('all')}
                              className={`min-h-[44px] px-3.5 py-2 text-xs font-semibold rounded-lg transition-colors cursor-pointer ${
                                dashboardScope === 'all'
                                  ? 'bg-blue-700 text-white shadow-xs'
                                  : 'text-slate-700 hover:text-slate-900'
                              }`}
                            >
                              All Notes
                            </button>
                            <button
                              type="button"
                              onClick={() => setDashboardScope('mine')}
                              className={`min-h-[44px] px-3.5 py-2 text-xs font-semibold rounded-lg transition-colors cursor-pointer ${
                                dashboardScope === 'mine'
                                  ? 'bg-blue-700 text-white shadow-xs'
                                  : 'text-slate-700 hover:text-slate-900'
                              }`}
                            >
                              My Uploads
                            </button>
                          </div>

                          <span className="text-xs text-slate-600 font-mono tabular-nums">
                            {filteredNotes.length} {filteredNotes.length === 1 ? 'note' : 'notes'}
                          </span>
                        </motion.div>

                        <motion.div
                          variants={fadeUpItemVariants}
                          className={`${glassSurfaceClass} p-4 mb-5 grid grid-cols-1 sm:grid-cols-3 gap-3`}
                        >
                          <div className="flex flex-col gap-1.5 min-w-0">
                            <label htmlFor="dash-search" className="text-xs font-semibold">
                              Search Notes
                            </label>
                            <input
                              id="dash-search"
                              type="search"
                              enterKeyHint="search"
                              value={searchQuery}
                              onChange={(e) => setSearchQuery(e.target.value)}
                              placeholder="Filter by title or description..."
                              className={inputControlClass}
                            />
                          </div>

                          <div className="flex flex-col gap-1.5 min-w-0">
                            <label htmlFor="dash-cat" className="text-xs font-semibold">
                              Subject Filter
                            </label>
                            <select
                              id="dash-cat"
                              value={selectedCategoryId}
                              onChange={(e) => setSelectedCategoryId(e.target.value)}
                              className={inputControlClass}
                            >
                              <option value="">All Subjects</option>
                              {categories.map((cat) => (
                                <option key={cat.id} value={String(cat.id)}>
                                  {cat.name}
                                </option>
                              ))}
                            </select>
                          </div>

                          <div className="flex flex-col gap-1.5 min-w-0">
                            <label htmlFor="dash-sort" className="text-xs font-semibold">
                              Sort By
                            </label>
                            <select
                              id="dash-sort"
                              value={sortBy}
                              onChange={(e) => setSortBy(e.target.value as SortOption)}
                              className={inputControlClass}
                            >
                              <option value="newest">Newest First</option>
                              <option value="oldest">Oldest First</option>
                              <option value="title_asc">Title (A-Z)</option>
                            </select>
                          </div>
                        </motion.div>

                        {filteredNotes.length === 0 ? (
                          <motion.div
                            variants={fadeUpItemVariants}
                            className={`${glassSurfaceClass} py-10 px-4 sm:px-6 text-center`}
                          >
                            <h3 className="text-base font-bold text-slate-900 mb-1">
                              No study notes found
                            </h3>
                            <p className="text-sm text-slate-600 max-w-md mx-auto">
                              {dashboardScope === 'mine'
                                ? 'You have not uploaded any PDF notes matching the current filters yet.'
                                : 'Use the upload form to publish a PDF study note.'}
                            </p>
                          </motion.div>
                        ) : (
                          <motion.div
                            variants={staggerContainerVariants}
                            className="grid grid-cols-1 md:grid-cols-2 gap-4"
                          >
                            {filteredNotes.map((note) => (
                              <motion.article
                                key={note.id}
                                variants={fadeUpItemVariants}
                                {...cardHoverProps}
                                className={`${glassSurfaceClass} p-4 sm:p-5 flex flex-col justify-between gap-4 min-w-0`}
                              >
                                <div className="flex items-start gap-3.5 min-w-0">
                                  <PdfThumbnail
                                    dataUrl={note.blob_data_url}
                                    title={note.title}
                                    onClick={() => setActivePdfNote(note)}
                                  />
                                  <div className="min-w-0 flex-1">
                                    <div className="flex flex-wrap items-center gap-1.5 text-xs text-slate-500 mb-1">
                                      <span className="truncate max-w-full">
                                        {note.category_name}
                                      </span>
                                      <span aria-hidden="true">·</span>
                                      <span className="font-mono">{note.unit}</span>
                                    </div>
                                    <h3 className="text-base font-bold text-slate-900 mb-1 break-words">
                                      {note.title}
                                    </h3>
                                    {note.description && (
                                      <p className="text-sm text-slate-600 mb-2 line-clamp-2 break-words">
                                        {note.description}
                                      </p>
                                    )}
                                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-500">
                                      <span>By {note.uploader_name}</span>
                                      <span aria-hidden="true">·</span>
                                      <span className="font-mono tabular-nums">
                                        {formatDate(note.created_at)}
                                      </span>
                                    </div>
                                  </div>
                                </div>

                                <div className="flex items-center gap-2 pt-3 border-t border-slate-200/70 flex-wrap">
                                  <motion.button
                                    type="button"
                                    {...buttonHoverProps}
                                    onClick={() => setActivePdfNote(note)}
                                    className="flex-1 min-h-[44px] min-w-[44px] px-3 py-2 text-xs font-semibold text-slate-900 bg-white border border-slate-300 rounded-xl hover:bg-slate-50 transition-colors cursor-pointer"
                                  >
                                    Open PDF
                                  </motion.button>
                                  <motion.button
                                    type="button"
                                    {...buttonHoverProps}
                                    onClick={() => handleDownloadNote(note)}
                                    className="flex-1 min-h-[44px] min-w-[44px] px-3 py-2 text-xs font-semibold text-white bg-blue-700 rounded-xl hover:bg-blue-800 transition-colors cursor-pointer"
                                  >
                                    Download
                                  </motion.button>
                                  {canDelete(note) &&
                                    (pendingDeleteId === note.id ? (
                                      <div className="w-full flex items-center justify-end gap-2 pt-1">
                                        <span className="text-xs font-semibold text-red-600">
                                          Delete?
                                        </span>
                                        <motion.button
                                          type="button"
                                          {...buttonHoverProps}
                                          onClick={() => handleDeleteNote(note.id)}
                                          className="px-3 py-2 min-h-[44px] min-w-[44px] text-xs font-semibold text-red-700 bg-red-50 border border-red-200 rounded-xl hover:bg-red-100 cursor-pointer"
                                        >
                                          Confirm
                                        </motion.button>
                                        <motion.button
                                          type="button"
                                          {...buttonHoverProps}
                                          onClick={() => setPendingDeleteId(null)}
                                          className="px-3 py-2 min-h-[44px] min-w-[44px] text-xs font-semibold text-slate-700 bg-white border border-slate-300 rounded-xl hover:bg-slate-50 cursor-pointer"
                                        >
                                          Cancel
                                        </motion.button>
                                      </div>
                                    ) : (
                                      <motion.button
                                        type="button"
                                        {...buttonHoverProps}
                                        onClick={() => setPendingDeleteId(note.id)}
                                        className="px-3 py-2 min-h-[44px] min-w-[44px] text-xs font-semibold text-red-700 bg-red-50 border border-red-200 rounded-xl hover:bg-red-100 transition-colors cursor-pointer"
                                      >
                                        Delete
                                      </motion.button>
                                    ))}
                                </div>
                              </motion.article>
                            ))}
                          </motion.div>
                        )}
                      </section>
                    </div>
                  </motion.div>
                </motion.div>
              )}
            </AnimatePresence>
          </LazySectionWrapper>
        </Suspense>

        <div id="about" className="about-wrapper">
          <section className="vision-section" aria-labelledby="vision-heading">
            <div className="vision-header">
              <h2 id="vision-heading" className="section-heading">
                Our Vision
              </h2>
              <p className="vision-lead">
                We believe good notes should never stay buried in a chat group or a forgotten
                folder. Study Hub is built to bring every student's study material into one
                organized, searchable place, so learning is easier to share, faster to revise and
                open to everyone on campus.
              </p>
            </div>
            <div className="vision-grid">
              <article className="vision-card">
                <div className="vision-icon" aria-hidden="true">
                  <svg
                    width="22"
                    height="22"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
                  </svg>
                </div>
                <h3 className="vision-card-title">Organized</h3>
                <p className="vision-card-text">Every note sorted by subject, unit and topic.</p>
              </article>

              <article className="vision-card">
                <div className="vision-icon" aria-hidden="true">
                  <svg
                    width="22"
                    height="22"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                    <circle cx="9" cy="7" r="4" />
                    <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
                    <path d="M16 3.13a4 4 0 0 1 0 7.75" />
                  </svg>
                </div>
                <h3 className="vision-card-title">Shared</h3>
                <p className="vision-card-text">
                  Students helping students, one upload at a time.
                </p>
              </article>

              <article className="vision-card">
                <div className="vision-icon" aria-hidden="true">
                  <svg
                    width="22"
                    height="22"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z" />
                    <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" />
                  </svg>
                </div>
                <h3 className="vision-card-title">Smarter</h3>
                <p className="vision-card-text">
                  Summaries, flashcards and quizzes built from the notes.
                </p>
              </article>
            </div>
          </section>

          <section className="team-section" aria-labelledby="team-heading">
            <h2 id="team-heading" className="section-heading">
              Meet the Technical Team
            </h2>
            <TechnicalTeamMount activeKey={`${page}-${filteredNotes.length}`} />
          </section>
        </div>
      </main>

      <footer className="site-footer">
        <div className="site-footer-inner">
          <span>Study Hub</span>
          <span aria-hidden="true">·</span>
          <span>Campus Study Notes Repository</span>
        </div>
      </footer>

      <nav
        aria-label="Mobile Bottom Navigation"
        className="md:hidden fixed bottom-0 left-0 right-0 z-40 bg-white/95 border-t border-slate-200 safe-bottom shadow-lg"
      >
        <div className="grid grid-cols-4 gap-1 px-2 py-1">
          <button
            type="button"
            onClick={() => navigateToPage('catalog')}
            className={`min-h-[48px] rounded-xl flex flex-col items-center justify-center gap-0.5 text-[11px] font-bold cursor-pointer ${
              page === 'catalog' ? 'text-blue-700 bg-blue-50/80' : 'text-slate-600'
            }`}
          >
            <BookOpen className="w-4 h-4" />
            <span>Browse</span>
          </button>

          <button
            type="button"
            onClick={() => scrollToAbout()}
            className="min-h-[48px] rounded-xl flex flex-col items-center justify-center gap-0.5 text-[11px] font-bold text-slate-600 cursor-pointer"
          >
            <Info className="w-4 h-4" />
            <span>About</span>
          </button>

          <button
            type="button"
            onClick={() => navigateToPage('dashboard')}
            className={`min-h-[48px] rounded-xl flex flex-col items-center justify-center gap-0.5 text-[11px] font-bold cursor-pointer ${
              page === 'dashboard' ? 'text-blue-700 bg-blue-50/80' : 'text-slate-600'
            }`}
          >
            <LayoutDashboard className="w-4 h-4" />
            <span>Dashboard</span>
          </button>

          <button
            type="button"
            onClick={() => navigateToPage('login')}
            className={`min-h-[48px] rounded-xl flex flex-col items-center justify-center gap-0.5 text-[11px] font-bold cursor-pointer ${
              page === 'login' ? 'text-blue-700 bg-blue-50/80' : 'text-slate-600'
            }`}
          >
            <User className="w-4 h-4" />
            <span>Account</span>
          </button>
        </div>
      </nav>

      <AnimatePresence>
        {activePdfNote && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-slate-900/70 flex items-center justify-center p-2 sm:p-6 safe-top safe-bottom"
            onClick={(e) => {
              if (e.target === e.currentTarget) setActivePdfNote(null);
            }}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.96, y: 12 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.96, y: 12 }}
              className="bg-white border border-slate-200 shadow-2xl rounded-2xl w-full max-w-4xl h-[88dvh] max-h-[88dvh] flex flex-col overflow-hidden"
            >
              <div className="px-3.5 sm:px-5 py-3 border-b border-slate-200 flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-xs sm:text-sm font-bold text-slate-900 truncate max-w-full">
                  {activePdfNote.title} ({activePdfNote.category_name} · {activePdfNote.unit})
                </h2>
                <div className="flex items-center gap-2 shrink-0 w-full sm:w-auto justify-end">
                  <motion.button
                    type="button"
                    {...buttonHoverProps}
                    onClick={() => handleDownloadNote(activePdfNote)}
                    className="flex-1 sm:flex-initial px-3.5 py-2 min-h-[44px] min-w-[44px] text-xs font-semibold text-white bg-blue-700 rounded-xl hover:bg-blue-800 cursor-pointer"
                  >
                    Download PDF
                  </motion.button>
                  <motion.button
                    type="button"
                    {...buttonHoverProps}
                    onClick={() => setActivePdfNote(null)}
                    className="px-3.5 py-2 min-h-[44px] min-w-[44px] text-xs font-semibold text-slate-900 bg-white border border-slate-300 rounded-xl hover:bg-slate-100 cursor-pointer"
                  >
                    Close
                  </motion.button>
                </div>
              </div>
              <div className="flex-1 overflow-auto bg-slate-100">
                <iframe
                  src={activePdfNote.blob_data_url}
                  title={`PDF Viewer - ${activePdfNote.title}`}
                  className="w-full h-full min-h-[320px] border-0 bg-slate-100"
                />
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
