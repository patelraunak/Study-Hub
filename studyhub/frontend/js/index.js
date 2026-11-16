import {
  apiRequest,
  clearSession,
  escapeHtml,
  formatDate,
  getStoredUser,
  getToken,
  renderPdfThumbnail,
  saveSession,
} from './api.js';

const searchInput = document.getElementById('search-input');
const categorySelect = document.getElementById('category-filter');
const unitInput = document.getElementById('unit-filter');
const sortSelect = document.getElementById('sort-filter');
const resetBtn = document.getElementById('reset-filters-btn');
const notesContainer = document.getElementById('notes-container');
const notesCountEl = document.getElementById('notes-count');
const statusBanner = document.getElementById('status-banner');
const topActionContainer = document.getElementById('top-action-container');

const pdfModal = document.getElementById('pdf-modal');
const pdfModalTitle = document.getElementById('pdf-modal-title');
const pdfModalFrame = document.getElementById('pdf-modal-frame');
const pdfModalDownload = document.getElementById('pdf-modal-download');
const pdfModalClose = document.getElementById('pdf-modal-close');

let currentUser = getStoredUser();
let pendingDeleteId = null;
let searchDebounceTimer = null;

function showStatus(message, type = 'error') {
  if (!message) {
    statusBanner.className = 'status-banner hidden';
    statusBanner.textContent = '';
    return;
  }
  statusBanner.className = `status-banner ${type}`;
  statusBanner.textContent = message;
}

function renderTopBarAction() {
  if (currentUser) {
    topActionContainer.innerHTML = `
      <a href="/dashboard.html" class="btn btn-primary">Upload Note</a>
    `;
  } else {
    topActionContainer.innerHTML = `
      <a href="/login.html" class="btn btn-primary">Sign In</a>
    `;
  }
}

async function syncCurrentUser() {
  if (!getToken()) {
    currentUser = null;
    renderTopBarAction();
    return;
  }
  try {
    const user = await apiRequest('/api/auth/me');
    currentUser = user;
    saveSession(getToken(), user);
  } catch {
    clearSession();
    currentUser = null;
  }
  renderTopBarAction();
}

async function loadCategories() {
  try {
    const categories = await apiRequest('/api/categories');
    const currentVal = categorySelect.value;
    categorySelect.innerHTML = '<option value="">All Subjects</option>';
    categories.forEach((cat) => {
      const option = document.createElement('option');
      option.value = String(cat.id);
      option.textContent = cat.name;
      categorySelect.appendChild(option);
    });
    if (currentVal) {
      categorySelect.value = currentVal;
    }
  } catch (err) {
    showStatus(err.message, 'error');
  }
}

function canDeleteNote(note) {
  if (!currentUser) return false;
  return currentUser.id === note.uploader_id || currentUser.role === 'admin';
}

function openPdfViewer(note) {
  pdfModalTitle.textContent = `${note.title} (${note.category_name} · ${note.unit})`;
  pdfModalFrame.src = `/api/notes/${note.id}/view`;
  pdfModalDownload.href = `/api/notes/${note.id}/download`;
  pdfModal.classList.remove('hidden');
}

function closePdfViewer() {
  pdfModal.classList.add('hidden');
  pdfModalFrame.src = 'about:blank';
}

function sortNotesList(notes, sortValue) {
  const copy = [...notes];
  if (sortValue === 'oldest') {
    return copy.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
  }
  if (sortValue === 'title_asc') {
    return copy.sort((a, b) =>
      String(a.title || '').localeCompare(String(b.title || ''), undefined, {
        sensitivity: 'base',
      })
    );
  }
  return copy.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
}

function renderNotes(notes) {
  const sortedNotes = sortNotesList(notes, sortSelect ? sortSelect.value : 'newest');
  const count = sortedNotes.length;
  notesCountEl.textContent = `${count} ${count === 1 ? 'study note' : 'study notes'} available`;

  if (count === 0) {
    const hasFilters =
      searchInput.value.trim() !== '' ||
      categorySelect.value !== '' ||
      unitInput.value.trim() !== '';

    notesContainer.innerHTML = `
      <div class="empty-state">
        <h2 class="empty-title">${hasFilters ? 'No matching study notes found' : 'No study notes uploaded yet'}</h2>
        <p class="empty-text">
          ${
            hasFilters
              ? 'Try clearing your search query or selecting a different subject filter.'
              : 'Sign in to upload the first PDF study note and organize course materials by subject and unit.'
          }
        </p>
        ${
          hasFilters
            ? '<button type="button" id="empty-reset-btn" class="btn btn-secondary">Clear Filters</button>'
            : `<a href="${currentUser ? '/dashboard.html' : '/login.html'}" class="btn btn-primary">${
                currentUser ? 'Go to Dashboard' : 'Sign In to Upload'
              }</a>`
        }
      </div>
    `;

    const emptyResetBtn = document.getElementById('empty-reset-btn');
    if (emptyResetBtn) {
      emptyResetBtn.addEventListener('click', () => {
        searchInput.value = '';
        categorySelect.value = '';
        unitInput.value = '';
        if (sortSelect) sortSelect.value = 'newest';
        loadNotes();
      });
    }
    return;
  }

  const listEl = document.createElement('div');
  listEl.className = 'notes-list';

  sortedNotes.forEach((note) => {
    const row = document.createElement('article');
    row.className = 'note-row';

    const allowDelete = canDeleteNote(note);
    const isConfirming = pendingDeleteId === note.id;

    let deleteMarkup = '';
    if (allowDelete) {
      if (isConfirming) {
        deleteMarkup = `
          <div class="confirm-bar">
            <span class="confirm-label">Delete PDF?</span>
            <button type="button" class="btn btn-danger btn-sm" data-confirm-delete="${note.id}">Confirm</button>
            <button type="button" class="btn btn-secondary btn-sm" data-cancel-delete="${note.id}">Cancel</button>
          </div>
        `;
      } else {
        deleteMarkup = `
          <button type="button" class="btn btn-danger btn-sm" data-request-delete="${note.id}">Delete</button>
        `;
      }
    }

    row.innerHTML = `
      <div class="note-content-group">
        <div class="note-thumb-wrap" data-thumb-open="${note.id}" title="Open PDF preview">
          <canvas class="note-thumb-canvas" width="168" height="224" aria-label="First page preview of ${escapeHtml(note.title)}"></canvas>
        </div>
        <div class="note-main">
          <div class="note-kicker">
            <span>${escapeHtml(note.category_name)}</span>
            <span aria-hidden="true">·</span>
            <span class="mono">${escapeHtml(note.unit)}</span>
          </div>
          <h2 class="note-title">${escapeHtml(note.title)}</h2>
          ${
            note.description
              ? `<p class="note-description">${escapeHtml(note.description)}</p>`
              : ''
          }
          <div class="note-meta">
            <span>Uploaded by ${escapeHtml(note.uploader_name)}</span>
            <span aria-hidden="true">·</span>
            <span class="mono">${escapeHtml(formatDate(note.created_at))}</span>
          </div>
        </div>
      </div>
      <div class="note-actions">
        <button type="button" class="btn btn-secondary btn-sm" data-open-pdf="${note.id}">Open PDF</button>
        <a href="/api/notes/${note.id}/download" download class="btn btn-primary btn-sm">Download</a>
        ${deleteMarkup}
      </div>
    `;

    const thumbCanvas = row.querySelector('.note-thumb-canvas');
    renderPdfThumbnail(thumbCanvas, `/api/notes/${note.id}/view`, note.title);

    const thumbOpenEl = row.querySelector(`[data-thumb-open="${note.id}"]`);
    if (thumbOpenEl) {
      thumbOpenEl.addEventListener('click', () => openPdfViewer(note));
    }

    const openBtn = row.querySelector(`[data-open-pdf="${note.id}"]`);
    if (openBtn) {
      openBtn.addEventListener('click', () => openPdfViewer(note));
    }

    const requestDeleteBtn = row.querySelector(`[data-request-delete="${note.id}"]`);
    if (requestDeleteBtn) {
      requestDeleteBtn.addEventListener('click', () => {
        pendingDeleteId = note.id;
        renderNotes(sortedNotes);
      });
    }

    const cancelDeleteBtn = row.querySelector(`[data-cancel-delete="${note.id}"]`);
    if (cancelDeleteBtn) {
      cancelDeleteBtn.addEventListener('click', () => {
        pendingDeleteId = null;
        renderNotes(sortedNotes);
      });
    }

    const confirmDeleteBtn = row.querySelector(`[data-confirm-delete="${note.id}"]`);
    if (confirmDeleteBtn) {
      confirmDeleteBtn.addEventListener('click', async () => {
        confirmDeleteBtn.disabled = true;
        try {
          await apiRequest(`/api/notes/${note.id}`, { method: 'DELETE' });
          pendingDeleteId = null;
          showStatus('Study note deleted.', 'success');
          await loadNotes();
        } catch (err) {
          showStatus(err.message, 'error');
          confirmDeleteBtn.disabled = false;
        }
      });
    }

    listEl.appendChild(row);
  });

  notesContainer.innerHTML = '';
  notesContainer.appendChild(listEl);
}

async function loadNotes() {
  const params = new URLSearchParams();
  const searchVal = searchInput.value.trim();
  const categoryVal = categorySelect.value;
  const unitVal = unitInput.value.trim();
  const sortVal = sortSelect ? sortSelect.value : 'newest';

  if (searchVal) params.set('search', searchVal);
  if (categoryVal) params.set('category_id', categoryVal);
  if (unitVal) params.set('unit', unitVal);
  if (sortVal) params.set('sort', sortVal);

  const queryString = params.toString();
  const url = queryString ? `/api/notes?${queryString}` : '/api/notes';

  try {
    const notes = await apiRequest(url);
    renderNotes(notes);
  } catch (err) {
    showStatus(err.message, 'error');
  }
}

searchInput.addEventListener('input', () => {
  if (searchDebounceTimer) clearTimeout(searchDebounceTimer);
  searchDebounceTimer = setTimeout(() => {
    loadNotes();
  }, 180);
});

categorySelect.addEventListener('change', () => {
  loadNotes();
});

unitInput.addEventListener('input', () => {
  if (searchDebounceTimer) clearTimeout(searchDebounceTimer);
  searchDebounceTimer = setTimeout(() => {
    loadNotes();
  }, 180);
});

if (sortSelect) {
  sortSelect.addEventListener('change', () => {
    loadNotes();
  });
}

resetBtn.addEventListener('click', () => {
  searchInput.value = '';
  categorySelect.value = '';
  unitInput.value = '';
  if (sortSelect) sortSelect.value = 'newest';
  showStatus('');
  loadNotes();
});

pdfModalClose.addEventListener('click', closePdfViewer);
pdfModal.addEventListener('click', (event) => {
  if (event.target === pdfModal) {
    closePdfViewer();
  }
});

async function init() {
  renderTopBarAction();
  await syncCurrentUser();
  await Promise.all([loadCategories(), loadNotes()]);
}

init();
