// CO-SYNE thesis presentation: arrow keys, space, swipe or the buttons move
// between slides; the URL hash keeps the current slide; P toggles autoplay.
import { icon } from '../lib/icons.js';

const slides = [...document.querySelectorAll('.slide')];
const bar = document.getElementById('deck-bar');
const progress = document.getElementById('progress');
let i = Math.max(0, Math.min(slides.length - 1, (Number(location.hash.slice(1)) || 1) - 1));
let timer = null;

document.querySelectorAll('[data-icon]').forEach((el) => { el.outerHTML = icon(el.dataset.icon); });
bar.insertAdjacentHTML('beforeend', `<span class="dots">${slides.map((_, n) => `<i data-n="${n}" title="Slide ${n + 1}"></i>`).join('')}</span>
  <button id="d-prev" aria-label="Previous slide">${icon('chevronLeft')}</button><span class="count" id="d-count"></span>
  <button id="d-next" aria-label="Next slide">${icon('chevronRight')}</button>
  <button id="d-play" aria-label="Play">${icon('activity')}</button>
  <button id="d-full" aria-label="Full screen">${icon('square')}</button>
  <a class="dbtn" href="${bar.dataset.close ?? 'cosyne_investors.html'}" aria-label="Close presentation">${icon('x')}</a>`);

function show(n) {
  i = (n + slides.length) % slides.length;
  slides.forEach((s, k) => { s.classList.toggle('on', k === i); s.classList.toggle('past', k < i); s.setAttribute('aria-hidden', String(k !== i)); });
  bar.classList.toggle('on-dark', slides[i].matches('.dark, .photo'));
  progress.style.width = `${((i + 1) / slides.length) * 100}%`;
  document.getElementById('d-count').textContent = `${i + 1} / ${slides.length}`;
  bar.querySelectorAll('.dots i').forEach((d, k) => d.classList.toggle('on', k === i));
  history.replaceState(null, '', `#${i + 1}`);
  // Lazy photos load as their slide is reached.
  slides[i].querySelectorAll('img[data-src]').forEach((im) => { im.src = im.dataset.src; im.removeAttribute('data-src'); });
  slides[(i + 1) % slides.length].querySelectorAll('img[data-src]').forEach((im) => { im.src = im.dataset.src; im.removeAttribute('data-src'); });
}
const next = () => show(i + 1);
const prev = () => show(i - 1);
function play(on = !timer) {
  clearInterval(timer); timer = null;
  if (on) timer = setInterval(next, 7000);
  document.getElementById('d-play').innerHTML = icon(timer ? 'square' : 'activity');
  document.getElementById('d-play').setAttribute('aria-label', timer ? 'Pause' : 'Play');
}

document.getElementById('d-next').onclick = () => { play(false); next(); };
document.getElementById('d-prev').onclick = () => { play(false); prev(); };
document.getElementById('d-play').onclick = () => play();
document.getElementById('d-full').onclick = () => (document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen?.());
bar.querySelectorAll('.dots i').forEach((d) => { d.onclick = () => { play(false); show(Number(d.dataset.n)); }; });
addEventListener('keydown', (e) => {
  if (['ArrowRight', 'PageDown', ' '].includes(e.key)) { e.preventDefault(); play(false); next(); }
  if (['ArrowLeft', 'PageUp'].includes(e.key)) { e.preventDefault(); play(false); prev(); }
  if (e.key === 'Home') show(0);
  if (e.key === 'End') show(slides.length - 1);
  if (e.key.toLowerCase() === 'p') play();
  if (e.key.toLowerCase() === 'f') document.getElementById('d-full').click();
});
let x0 = null;
addEventListener('touchstart', (e) => { x0 = e.touches[0].clientX; }, { passive: true });
addEventListener('touchend', (e) => {
  if (x0 == null) return;
  const dx = e.changedTouches[0].clientX - x0; x0 = null;
  if (Math.abs(dx) > 50) { play(false); if (dx < 0) next(); else prev(); }
});
show(i);
