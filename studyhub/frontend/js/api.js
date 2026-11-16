const TOKEN_STORAGE_KEY = 'studyhub_token';
const USER_STORAGE_KEY = 'studyhub_user';
const PDFJS_WORKER_SRC = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

export function getToken() {
  return localStorage.getItem(TOKEN_STORAGE_KEY);
}

export function getStoredUser() {
  const raw = localStorage.getItem(USER_STORAGE_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function saveSession(token, user) {
  localStorage.setItem(TOKEN_STORAGE_KEY, token);
  localStorage.setItem(USER_STORAGE_KEY, JSON.stringify(user));
}

export function clearSession() {
  localStorage.removeItem(TOKEN_STORAGE_KEY);
  localStorage.removeItem(USER_STORAGE_KEY);
}

export async function apiRequest(path, options = {}) {
  const token = getToken();
  const headers = new Headers(options.headers || {});

  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
  }

  if (options.body && !(options.body instanceof FormData) && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  const response = await fetch(path, {
    ...options,
    headers,
  });

  if (response.status === 204) {
    return null;
  }

  const contentType = response.headers.get('content-type') || '';
  const data = contentType.includes('application/json')
    ? await response.json()
    : await response.text();

  if (!response.ok) {
    const detail =
      data && typeof data === 'object' && data.detail
        ? Array.isArray(data.detail)
          ? data.detail.map((item) => item.msg || JSON.stringify(item)).join(', ')
          : String(data.detail)
        : 'Request failed. Please check your input and try again.';
    const error = new Error(detail);
    error.status = response.status;
    throw error;
  }

  return data;
}

export function formatDate(isoString) {
  if (!isoString) return '';
  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) return String(isoString);
  return date.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
  });
}

export function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function drawFallbackThumbnail(canvas, title) {
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
  const snippet = String(title || 'PDF Note').slice(0, 14);
  ctx.fillText(snippet, 14, 38);

  ctx.fillStyle = '#cbd5e1';
  for (let y = 56; y < h - 32; y += 14) {
    const lineWidth = y % 28 === 0 ? w - 42 : w - 28;
    ctx.fillRect(14, y, lineWidth, 5);
  }

  ctx.fillStyle = '#64748b';
  ctx.font = '500 11px "JetBrains Mono", monospace';
  ctx.fillText('PDF', 14, h - 12);
}

export async function renderPdfThumbnail(canvas, pdfUrl, title) {
  if (!canvas) return;
  drawFallbackThumbnail(canvas, title);

  const pdfjsLib = window.pdfjsLib;
  if (!pdfjsLib) return;

  if (!pdfjsLib.GlobalWorkerOptions.workerSrc) {
    pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER_SRC;
  }

  try {
    const loadingTask = pdfjsLib.getDocument(pdfUrl);
    const pdf = await loadingTask.promise;
    const page = await pdf.getPage(1);

    const targetWidth = 168;
    const targetHeight = 224;
    const unscaledViewport = page.getViewport({ scale: 1 });
    const scale = Math.max(
      targetWidth / unscaledViewport.width,
      targetHeight / unscaledViewport.height
    );
    const viewport = page.getViewport({ scale });

    canvas.width = Math.floor(viewport.width);
    canvas.height = Math.floor(viewport.height);

    const context = canvas.getContext('2d');
    if (!context) return;

    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, canvas.width, canvas.height);

    await page.render({
      canvasContext: context,
      viewport,
    }).promise;
  } catch {
    drawFallbackThumbnail(canvas, title);
  }
}
