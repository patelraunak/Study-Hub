import { apiRequest, getToken, saveSession } from './api.js';

const tabLoginBtn = document.getElementById('tab-login');
const tabRegisterBtn = document.getElementById('tab-register');
const loginForm = document.getElementById('login-form');
const registerForm = document.getElementById('register-form');
const statusBanner = document.getElementById('auth-status');
const authTitle = document.getElementById('auth-title');
const authSubtitle = document.getElementById('auth-subtitle');

function showStatus(message, type = 'error') {
  if (!message) {
    statusBanner.className = 'status-banner hidden';
    statusBanner.textContent = '';
    return;
  }
  statusBanner.className = `status-banner ${type}`;
  statusBanner.textContent = message;
}

function switchMode(mode) {
  showStatus('');
  if (mode === 'register') {
    tabRegisterBtn.classList.add('active');
    tabLoginBtn.classList.remove('active');
    registerForm.classList.remove('hidden');
    loginForm.classList.add('hidden');
    authTitle.textContent = 'Create a Study Hub Account';
    authSubtitle.textContent = 'Register with your academic email to upload and manage study notes.';
  } else {
    tabLoginBtn.classList.add('active');
    tabRegisterBtn.classList.remove('active');
    loginForm.classList.remove('hidden');
    registerForm.classList.add('hidden');
    authTitle.textContent = 'Sign In to Study Hub';
    authSubtitle.textContent = 'Access your dashboard to upload, organize, and download course PDFs.';
  }
}

tabLoginBtn.addEventListener('click', () => switchMode('login'));
tabRegisterBtn.addEventListener('click', () => switchMode('register'));

loginForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  showStatus('');

  const email = document.getElementById('login-email').value.trim();
  const password = document.getElementById('login-password').value;
  const submitBtn = document.getElementById('login-submit-btn');

  submitBtn.disabled = true;
  submitBtn.textContent = 'Signing in...';

  try {
    const result = await apiRequest('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });
    saveSession(result.access_token, result.user);
    window.location.href = '/dashboard.html';
  } catch (err) {
    showStatus(err.message, 'error');
    submitBtn.disabled = false;
    submitBtn.textContent = 'Sign In';
  }
});

registerForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  showStatus('');

  const name = document.getElementById('register-name').value.trim();
  const email = document.getElementById('register-email').value.trim();
  const password = document.getElementById('register-password').value;
  const role = document.getElementById('register-role').value;
  const submitBtn = document.getElementById('register-submit-btn');

  if (password.length < 6) {
    showStatus('Password must be at least 6 characters long.', 'error');
    return;
  }

  submitBtn.disabled = true;
  submitBtn.textContent = 'Creating account...';

  try {
    const result = await apiRequest('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify({ name, email, password, role }),
    });
    saveSession(result.access_token, result.user);
    window.location.href = '/dashboard.html';
  } catch (err) {
    showStatus(err.message, 'error');
    submitBtn.disabled = false;
    submitBtn.textContent = 'Create Account';
  }
});

async function checkExistingSession() {
  if (!getToken()) return;
  try {
    await apiRequest('/api/auth/me');
    window.location.href = '/dashboard.html';
  } catch {
    return;
  }
}

checkExistingSession();
