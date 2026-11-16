export const STUDY_QUOTES = [
  "Small notes today, big marks tomorrow.",
  "Revision is where understanding becomes memory.",
  "Start with one page. Momentum does the rest.",
  "Good notes save the hours you haven't lived yet.",
  "Share what you know. Learn it twice.",
  "Consistency beats cramming.",
  "Every topic feels hard until you have studied it twice.",
  "Today's effort is tomorrow's exam confidence.",
  "Ask the question. Someone else is wondering too.",
  "Progress counts, even when it is slow.",
  "Clear summaries turn complex chapters into simple steps.",
  "One focused hour beats four distracted ones.",
  "Write it in your own words to make it stick.",
  "A tidy notebook is a calm mind on exam morning.",
  "Reviewing for ten minutes tonight saves an hour next month.",
  "Understanding the why makes the how effortless.",
  "Every solved problem builds the next intuition.",
  "Short study blocks build lasting academic habits.",
  "Organize by unit today so revision flows tomorrow.",
  "Master the fundamentals and advanced topics follow.",
  "Steady daily reading outperforms midnight marathons.",
  "Test yourself early to discover what needs attention.",
  "Shared study notes lift the whole classroom.",
  "Break large syllabi into one unit at a time.",
  "Patience with difficult concepts pays off in clarity."
];

const ROTATION_INTERVAL_MS = 6000;
const FADE_DURATION_MS = 500;
const MAX_VISIBLE_DOTS = 5;
const activeControllers = new WeakMap();

function buildShuffledIndices(total, excludeFirst = -1) {
  const indices = Array.from({ length: total }, (_, idx) => idx);
  for (let i = indices.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    const temp = indices[i];
    indices[i] = indices[j];
    indices[j] = temp;
  }
  if (indices.length > 1 && indices[0] === excludeFirst) {
    const swapIdx = 1 + Math.floor(Math.random() * (indices.length - 1));
    const first = indices[0];
    indices[0] = indices[swapIdx];
    indices[swapIdx] = first;
  }
  return indices;
}

export function initQuoteRotator(containerElement) {
  if (!containerElement) return () => {};

  const existingCleanup = activeControllers.get(containerElement);
  if (typeof existingCleanup === 'function') {
    existingCleanup();
  }

  const reducedMotionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
  let queue = buildShuffledIndices(STUDY_QUOTES.length);
  let queuePosition = 0;
  let currentQuoteIndex = queue[queuePosition];
  let intervalId = null;
  let fadeTimeoutId = null;
  let isInteracting = false;
  let isDestroyed = false;

  containerElement.innerHTML = `
    <div class="quote-rotator-inner" tabindex="0">
      <p class="quote-rotator-text" aria-live="polite" aria-atomic="true"></p>
      <div class="quote-rotator-dots" role="tablist" aria-label="Study quote navigation"></div>
    </div>
  `;

  const wrapperEl = containerElement.querySelector('.quote-rotator-inner');
  const textEl = containerElement.querySelector('.quote-rotator-text');
  const dotsEl = containerElement.querySelector('.quote-rotator-dots');

  function renderDots() {
    if (!dotsEl) return;
    const total = queue.length;
    const windowSize = Math.min(MAX_VISIBLE_DOTS, total);
    let start = queuePosition - Math.floor(windowSize / 2);
    if (start < 0) start = 0;
    if (start + windowSize > total) start = Math.max(0, total - windowSize);

    dotsEl.innerHTML = '';
    for (let pos = start; pos < start + windowSize; pos += 1) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = `quote-dot${pos === queuePosition ? ' active' : ''}`;
      btn.setAttribute('aria-label', `Show quote ${pos + 1}`);
      btn.setAttribute('aria-selected', pos === queuePosition ? 'true' : 'false');
      btn.addEventListener('click', () => {
        if (pos === queuePosition) return;
        queuePosition = pos;
        currentQuoteIndex = queue[queuePosition];
        transitionToQuote(STUDY_QUOTES[currentQuoteIndex]);
        restartTimer();
      });
      dotsEl.appendChild(btn);
    }
  }

  function transitionToQuote(nextText) {
    if (!textEl || isDestroyed) return;
    if (fadeTimeoutId) {
      clearTimeout(fadeTimeoutId);
      fadeTimeoutId = null;
    }

    if (reducedMotionQuery.matches) {
      textEl.textContent = `"${nextText}"`;
      textEl.classList.remove('is-fading');
      renderDots();
      return;
    }

    textEl.classList.add('is-fading');
    fadeTimeoutId = window.setTimeout(() => {
      if (isDestroyed || !textEl) return;
      textEl.textContent = `"${nextText}"`;
      renderDots();
      requestAnimationFrame(() => {
        if (!isDestroyed && textEl) {
          textEl.classList.remove('is-fading');
        }
      });
    }, FADE_DURATION_MS / 2);
  }

  function advanceQuote() {
    if (isDestroyed || isInteracting || document.hidden) return;
    queuePosition += 1;
    if (queuePosition >= queue.length) {
      queue = buildShuffledIndices(STUDY_QUOTES.length, currentQuoteIndex);
      queuePosition = 0;
    }
    currentQuoteIndex = queue[queuePosition];
    transitionToQuote(STUDY_QUOTES[currentQuoteIndex]);
  }

  function stopTimer() {
    if (intervalId !== null) {
      clearInterval(intervalId);
      intervalId = null;
    }
  }

  function startTimer() {
    if (isDestroyed || intervalId !== null || isInteracting || document.hidden) return;
    intervalId = window.setInterval(advanceQuote, ROTATION_INTERVAL_MS);
  }

  function restartTimer() {
    stopTimer();
    startTimer();
  }

  function handlePause() {
    isInteracting = true;
    stopTimer();
  }

  function handleResume() {
    isInteracting = false;
    startTimer();
  }

  function handleVisibilityChange() {
    if (document.hidden) {
      stopTimer();
    } else {
      startTimer();
    }
  }

  textEl.textContent = `"${STUDY_QUOTES[currentQuoteIndex]}"`;
  renderDots();
  startTimer();

  wrapperEl.addEventListener('mouseenter', handlePause);
  wrapperEl.addEventListener('mouseleave', handleResume);
  wrapperEl.addEventListener('focusin', handlePause);
  wrapperEl.addEventListener('focusout', handleResume);
  document.addEventListener('visibilitychange', handleVisibilityChange);

  const observer = new MutationObserver(() => {
    if (!document.body.contains(containerElement)) {
      cleanup();
    }
  });
  if (document.body) {
    observer.observe(document.body, { childList: true, subtree: true });
  }

  function cleanup() {
    if (isDestroyed) return;
    isDestroyed = true;
    stopTimer();
    if (fadeTimeoutId) {
      clearTimeout(fadeTimeoutId);
      fadeTimeoutId = null;
    }
    wrapperEl.removeEventListener('mouseenter', handlePause);
    wrapperEl.removeEventListener('mouseleave', handleResume);
    wrapperEl.removeEventListener('focusin', handlePause);
    wrapperEl.removeEventListener('focusout', handleResume);
    document.removeEventListener('visibilitychange', handleVisibilityChange);
    observer.disconnect();
    activeControllers.delete(containerElement);
  }

  activeControllers.set(containerElement, cleanup);
  return cleanup;
}
