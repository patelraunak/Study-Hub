import {
  apiRequest,
  clearSession,
  escapeHtml,
  formatDate,
  getToken,
  renderPdfThumbnail,
  saveSession,
} from './api.js';

const userSummaryEl = document.getElementById('user-summary');
const logoutBtn = document.getElementById('logout-btn');
const uploadForm = document.getElementById('upload-form');
const uploadStatus = document.getElementById('upload-status');
const uploadSubmitBtn = document.getElementById('upload-submit-btn');

const categorySelectGroup = document.getElementById('category-select-group');
const categoryInputGroup = document.getElementById('category-input-group');
const uploadCategorySelect = document.getElementById('upload-category-select');
const uploadCategoryInput = document.getElementById('upload-category-input');
const toggleNewCategoryBtn = document.getElementById('toggle-new-category-btn');
const toggleExistingCategoryBtn = document.getElementById('toggle-existing-category-btn');

const filterAllBtn = document.getElementById('filter-all-btn');
const filterMineBtn = document.getElementById('filter-mine-btn');
const searchInput = document.getElementById('dashboard-search');
const filterCategorySelect = document.getElementById('dashboard-category-filter');
const sortSelect = document.getElementById('dashboard-sort-filter');
const notesCountEl = document.getElementById('dashboard-notes-count');
const notesContainer = document.getElementById('dashboard-notes-container');
const dashboardStatus = document.getElementById('dashboard-status');

const pdfModal = document.getElementById('pdf-modal');
const pdfModalTitle = document.getElementById('pdf-modal-title');
const pdfModalFrame = document.getElementById('pdf-modal-frame');
const pdfModalDownload = document.getElementById('pdf-modal-download');
const pdfModalClose = document.getElementById('pdf-modal-close');

const MAX_FILE_BYTES = 10 * 1024 * 1024;

let currentUser = null;
let categories = [];
let usingNewCategoryInput = false;
let scopeMode = 'all';
let pendingDeleteId = null;
let searchDebounceTimer = null;

function showUploadStatus(message, type = 'error') {
  if (!message) {
    uploadStatus.className = 'status-banner hidden';
    uploadStatus.textContent = '';
    return;
  }
  uploadStatus.className = `status-banner ${type}`;
  uploadStatus.textContent = message;
}

function showDashboardStatus(message, type = 'error') {
  if (!message) {
    dashboardStatus.className = 'status-banner hidden';
    dashboardStatus.textContent = '';
    return;
  }
  dashboardStatus.className = `status-banner ${type}`;
  dashboardStatus.textContent = message;
}

function setCategoryInputMode(isNew) {
  usingNewCategoryInput = isNew;
  if (isNew) {
    categorySelectGroup.classList.add('hidden');
    categoryInputGroup.classList.remove('hidden');
    if (categories.length === 0) {
      toggleExistingCategoryBtn.classList.add('hidden');
    } else {
      toggleExistingCategoryBtn.classList.remove('hidden');
    }
  } else {
    categoryInputGroup.classList.add('hidden');
    categorySelectGroup.classList.remove('hidden');
  }
}

async function loadCategories() {
  categories = await apiRequest('/api/categories');

  uploadCategorySelect.innerHTML = '';
  categories.forEach((cat) => {
    const option = document.createElement('option');
    option.value = String(cat.id);
    option.textContent = cat.name;
    uploadCategorySelect.appendChild(option);
  });

  const previousFilter = filterCategorySelect.value;
  filterCategorySelect.innerHTML = '<option value="">All Subjects</option>';
  categories.forEach((cat) => {
    const option = document.createElement('option');
    option.value = String(cat.id);
    option.textContent = cat.name;
    filterCategorySelect.appendChild(option);
  });
  if (previousFilter) {
    filterCategorySelect.value = previousFilter;
  }

  if (categories.length === 0) {
    setCategoryInputMode(true);
  } else if (!usingNewCategoryInput) {
    setCategoryInputMode(false);
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
  notesCountEl.textContent = `${count} ${count === 1 ? 'note' : 'notes'}`;

  if (count === 0) {
    notesContainer.innerHTML = `
      <div class="empty-state">
        <h3 class="empty-title">No study notes found</h3>
        <p class="empty-text">
          ${
            scopeMode === 'mine'
              ? 'You have not uploaded any PDF notes matching the current filters yet.'
              : 'Use the upload form on the left to publish a PDF study note.'
          }
        </p>
      </div>
    `;
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
            <span class="confirm-label">Delete?</span>
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
          <h3 class="note-title">${escapeHtml(note.title)}</h3>
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
          showDashboardStatus('Study note deleted.', 'success');
          await loadNotes();
        } catch (err) {
          showDashboardStatus(err.message, 'error');
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
  const categoryVal = filterCategorySelect.value;
  const sortVal = sortSelect ? sortSelect.value : 'newest';

  if (searchVal) params.set('search', searchVal);
  if (categoryVal) params.set('category_id', categoryVal);
  if (scopeMode === 'mine' && currentUser) {
    params.set('uploader_id', String(currentUser.id));
  }
  if (sortVal) params.set('sort', sortVal);

  const queryString = params.toString();
  const url = queryString ? `/api/notes?${queryString}` : '/api/notes';

  try {
    const notes = await apiRequest(url);
    renderNotes(notes);
  } catch (err) {
    showDashboardStatus(err.message, 'error');
  }
}

toggleNewCategoryBtn.addEventListener('click', () => {
  setCategoryInputMode(true);
  uploadCategoryInput.focus();
});

toggleExistingCategoryBtn.addEventListener('click', () => {
  setCategoryInputMode(false);
});

uploadForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  showUploadStatus('');

  const title = document.getElementById('upload-title').value.trim();
  const unit = document.getElementById('upload-unit').value.trim();
  const description = document.getElementById('upload-description').value.trim();
  const fileInput = document.getElementById('upload-file');
  const file = fileInput.files && fileInput.files[0];

  if (!title) {
    showUploadStatus('Please enter a note title.', 'error');
    return;
  }
  if (!unit) {
    showUploadStatus('Please enter the unit or module.', 'error');
    return;
  }
  if (!file) {
    showUploadStatus('Please select a PDF file to upload.', 'error');
    return;
  }
  if (!file.name.toLowerCase().endsWith('.pdf')) {
    showUploadStatus('Only PDF files (.pdf) are allowed.', 'error');
    return;
  }
  if (file.size > MAX_FILE_BYTES) {
    showUploadStatus('File size exceeds the 10 MB limit.', 'error');
    return;
  }

  const formData = new FormData();
  formData.append('title', title);
  formData.append('unit', unit);
  formData.append('description', description);
  formData.append('file', file);

  if (usingNewCategoryInput) {
    const newCategoryName = uploadCategoryInput.value.trim();
    if (!newCategoryName) {
      showUploadStatus('Please enter a subject category name.', 'error');
      return;
    }
    formData.append('category_name', newCategoryName);
  } else {
    const selectedCategoryId = uploadCategorySelect.value;
    if (!selectedCategoryId) {
      showUploadStatus('Please select a subject category.', 'error');
      return;
    }
    formData.append('category_id', selectedCategoryId);
  }

  uploadSubmitBtn.disabled = true;
  uploadSubmitBtn.textContent = 'Uploading PDF...';

  try {
    await apiRequest('/api/notes', {
      method: 'POST',
      body: formData,
    });
    uploadForm.reset();
    uploadCategoryInput.value = '';
    usingNewCategoryInput = false;
    showUploadStatus('PDF note uploaded and indexed.', 'success');
    await loadCategories();
    await loadNotes();
  } catch (err) {
    showUploadStatus(err.message, 'error');
  } finally {
    uploadSubmitBtn.disabled = false;
    uploadSubmitBtn.textContent = 'Upload PDF Note';
  }
});

filterAllBtn.addEventListener('click', () => {
  scopeMode = 'all';
  filterAllBtn.classList.add('active');
  filterMineBtn.classList.remove('active');
  loadNotes();
});

filterMineBtn.addEventListener('click', () => {
  scopeMode = 'mine';
  filterMineBtn.classList.add('active');
  filterAllBtn.classList.remove('active');
  loadNotes();
});

searchInput.addEventListener('input', () => {
  if (searchDebounceTimer) clearTimeout(searchDebounceTimer);
  searchDebounceTimer = setTimeout(() => {
    loadNotes();
  }, 180);
});

filterCategorySelect.addEventListener('change', () => {
  loadNotes();
});

if (sortSelect) {
  sortSelect.addEventListener('change', () => {
    loadNotes();
  });
}

logoutBtn.addEventListener('click', () => {
  clearSession();
  window.location.href = '/login.html';
});

pdfModalClose.addEventListener('click', closePdfViewer);
pdfModal.addEventListener('click', (event) => {
  if (event.target === pdfModal) {
    closePdfViewer();
  }
});

async function initDashboard() {
  initQuoteRotator(dashboardQuoteEl);
  if (!getToken()) {
    window.location.href = '/login.html';
    return;
  }

  try {
    currentUser = await apiRequest('/api/auth/me');
    saveSession(getToken(), currentUser);
  } catch {
    clearSession();
    window.location.href = '/login.html';
    return;
  }

  userSummaryEl.innerHTML = `
    <span>${escapeHtml(currentUser.name)}</span>
    <span aria-hidden="true">·</span>
    <span>${escapeHtml(currentUser.email)}</span>
    <span aria-hidden="true">·</span>
    <span class="mono">${escapeHtml(currentUser.role)}</span>
  `;

  await Promise.all([loadCategories(), loadNotes()]);
}

initDashboard();
