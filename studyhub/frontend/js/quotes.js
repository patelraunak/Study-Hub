export const studyQuotes = [
  'Clear notes turn complex lectures into lasting understanding.',
  'Organizing what you learn today saves hours before the final exam.',
  'Shared knowledge strengthens the entire lecture hall.',
  'A well-structured summary is the bridge between reading and mastery.',
  'Consistent daily review outperforms last-minute cramming every semester.',
  'Writing down a concept in your own words is the first test of comprehension.',
  'Every unit mastered builds the foundation for the next course.',
  'Good study material should be easy to find, easy to read, and open to all.',
  'Questions become simpler when your reference notes are arranged by topic.',
  'Collaboration turns individual study sessions into collective progress.',
  'Precision in your notes leads to clarity in your problem solving.',
  'Revisiting lecture outlines within twenty-four hours locks in key ideas.',
  'The best exam preparation starts with a clean, searchable archive.',
  'Understanding the core principle makes memorizing ten formulas unnecessary.',
  'A single shared PDF can help an entire class master a difficult unit.',
  'Steady focus in small blocks accomplishes more than marathon distractions.',
  'Structure your subjects clearly so your mind can focus on thinking.',
  'Learning deepens when students teach and share with one another.',
  'Strong fundamentals turn unfamiliar exam problems into familiar steps.',
  'Reviewing worked examples side by side reveals the underlying pattern.',
  'Curiosity asks the question; disciplined notes preserve the answer.',
  'When course materials are organized by unit, revision becomes effortless.',
  'Every clear diagram and summary uploaded helps the next student succeed.',
  'Mastery is built one lecture, one unit, and one page at a time.',
  'Knowledge grows fastest in a community that shares its best resources.',
];

export function initQuoteRotator(containerElement) {
  if (!containerElement) return () => {};

  if (containerElement._quoteTimerId) {
    clearInterval(containerElement._quoteTimerId);
    containerElement._quoteTimerId = null;
  }
  if (containerElement._quoteFadeTimeoutId) {
    clearTimeout(containerElement._quoteFadeTimeoutId);
    containerElement._quoteFadeTimeoutId = null;
  }

  let currentIndex = 0;
  containerElement.innerHTML = '';

  const quoteTextEl = document.createElement('p');
  quoteTextEl.className = 'quote-rotator-text';
  quoteTextEl.setAttribute('aria-live', 'polite');
  quoteTextEl.textContent = `"${studyQuotes[currentIndex]}"`;
  containerElement.appendChild(quoteTextEl);

  const advanceQuote = () => {
    currentIndex = (currentIndex + 1) % studyQuotes.length;
    const reduceMotion =
      typeof window !== 'undefined' &&
      window.matchMedia &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    if (reduceMotion) {
      quoteTextEl.textContent = `"${studyQuotes[currentIndex]}"`;
      return;
    }

    quoteTextEl.classList.add('quote-fading');
    containerElement._quoteFadeTimeoutId = setTimeout(() => {
      quoteTextEl.textContent = `"${studyQuotes[currentIndex]}"`;
      quoteTextEl.classList.remove('quote-fading');
    }, 240);
  };

  const timerId = setInterval(advanceQuote, 6000);
  containerElement._quoteTimerId = timerId;

  return () => {
    clearInterval(timerId);
    if (containerElement._quoteFadeTimeoutId) {
      clearTimeout(containerElement._quoteFadeTimeoutId);
    }
  };
}
