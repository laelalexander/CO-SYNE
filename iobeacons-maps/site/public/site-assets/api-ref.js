// API reference page: code tabs, copy buttons, the key box and "Try it".
const API = '/maps/api/v1';
const OPEN = '/maps/api'; // the open demo, for Space and Weather calls without a key
const keyInput = document.getElementById('ref-key-input');
const note = document.getElementById('ref-key-note');
const NOTE = note.innerHTML;
const store = { get() { try { return sessionStorage.getItem('iob.apikey') || ''; } catch { return ''; } }, set(v) { try { v ? sessionStorage.setItem('iob.apikey', v) : sessionStorage.removeItem('iob.apikey'); } catch { /* private mode */ } } };
keyInput.value = store.get();
keyInput.addEventListener('input', () => { store.set(keyInput.value.trim()); note.className = 'muted small'; note.innerHTML = NOTE; });

const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));

document.getElementById('ref-key-check').addEventListener('click', async () => {
  const key = keyInput.value.trim();
  if (!key) { note.className = 'small bad'; note.textContent = 'Paste a key first. It starts with iobm_.'; return; }
  try {
    const r = await fetch(`${API}/me`, { headers: { Authorization: `Bearer ${key}` } });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error || `Answered ${r.status}`);
    note.className = 'small ok';
    note.textContent = `Works. Workspace "${j.workspace.name}" on ${j.plan.name}, ${j.quota.limit === null ? 'unlimited calls' : `${(j.quota.limit - j.quota.used).toLocaleString()} calls left this month`}.`;
  } catch (e) { note.className = 'small bad'; note.textContent = e.message; }
});

// Code tabs: switching one switches them all, so readers stay in their language.
let lang = (() => { try { return localStorage.getItem('iob.codelang') || 'curl'; } catch { return 'curl'; } })();
function showLang(l) {
  lang = l;
  try { localStorage.setItem('iob.codelang', l); } catch { /* ignore */ }
  document.querySelectorAll('.code-tabs button').forEach((b) => { b.classList.toggle('on', b.dataset.lang === l); b.setAttribute('aria-selected', b.dataset.lang === l); });
  document.querySelectorAll('pre.code').forEach((p) => { p.hidden = p.dataset.lang !== l; });
}
document.querySelectorAll('.code-tabs button').forEach((b) => b.addEventListener('click', () => showLang(b.dataset.lang)));
showLang(lang);

document.querySelectorAll('pre.code').forEach((pre) => {
  const b = document.createElement('button');
  b.type = 'button'; b.className = 'copy'; b.textContent = 'Copy';
  b.addEventListener('click', async () => { try { await navigator.clipboard.writeText(pre.querySelector('code').textContent); b.textContent = 'Copied'; setTimeout(() => { b.textContent = 'Copy'; }, 1200); } catch { /* no clipboard */ } });
  pre.append(b);
});

// Try it.
document.querySelectorAll('.ep form').forEach((form) => {
  const ep = form.closest('.ep');
  const out = form.querySelector('.resp');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const show = (ok, status, text, ms) => {
      out.hidden = false;
      out.innerHTML = `<div class="status"><span class="${ok ? 's-ok' : 's-bad'}">${esc(status)}</span>${ms != null ? `<span>${ms} ms</span>` : ''}</div>${text ? `<pre><code>${esc(text)}</code></pre>` : ''}`;
    };
    const key = keyInput.value.trim();
    const open = ep.dataset.open === '1';
    if (!key && !open) { show(false, 'Paste your API key at the top of the page first.'); keyInput.focus(); return; }
    let path = ep.dataset.path;
    const query = new URLSearchParams();
    for (const input of form.querySelectorAll('input[data-in]')) {
      const v = input.value.trim();
      if (input.dataset.in === 'path') {
        if (!v) { show(false, `Fill in ${input.name}.`); input.focus(); return; }
        path = path.replace(`{${input.name}}`, encodeURIComponent(v));
      } else if (v) query.set(input.name, v);
    }
    const headers = {};
    if (key) headers.Authorization = `Bearer ${key}`;
    let body;
    const ta = form.querySelector('textarea[name="__body"]');
    if (ta) {
      try { body = JSON.stringify(JSON.parse(ta.value)); } catch { show(false, 'The JSON body is not valid JSON.'); ta.focus(); return; }
      headers['Content-Type'] = 'application/json';
    }
    const fileInput = form.querySelector('input[name="__file"]');
    if (fileInput) {
      if (!fileInput.files[0]) { show(false, 'Choose a file to upload.'); return; }
      body = new FormData(); body.append('file', fileInput.files[0]);
    }
    const url = `${key ? API : OPEN}${path}${query.toString() ? `?${query}` : ''}`;
    const btn = form.querySelector('button[type=submit]');
    btn.disabled = true;
    const t0 = performance.now();
    try {
      const r = await fetch(url, { method: ep.dataset.method, headers, body, credentials: 'omit' });
      const ms = Math.round(performance.now() - t0);
      const ct = r.headers.get('content-type') || '';
      const quota = r.headers.get('x-quota-remaining');
      const label = `${r.status} ${r.statusText || ''}`.trim() + (quota ? ` · ${Number(quota).toLocaleString()} calls left this month` : '');
      if (ct.includes('json')) {
        const j = await r.json();
        let text = JSON.stringify(j, null, 2);
        if (text.length > 60000) text = `${text.slice(0, 60000)}\n... (cut short here; the full answer is ${(text.length / 1024).toFixed(0)} KB)`;
        show(r.ok, label, text, ms);
      } else {
        const blob = await r.blob();
        show(r.ok, label, null, ms);
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob); a.download = path.split('/').pop(); a.textContent = `Download the file (${(blob.size / 1024).toFixed(1)} KB)`;
        out.append(a);
      }
    } catch (err) { show(false, `Could not reach the API: ${err.message}`); } finally { btn.disabled = false; }
  });
});

// Highlight where you are in the side list.
const links = new Map([...document.querySelectorAll('.ref-nav li li a')].map((a) => [a.getAttribute('href').slice(1), a]));
const io = new IntersectionObserver((entries) => {
  for (const en of entries) if (en.isIntersecting) { links.forEach((a) => a.classList.remove('on')); const a = links.get(en.target.id); if (a) { a.classList.add('on'); const nav = a.closest('.ref-nav'); if (nav.scrollHeight > nav.clientHeight) { const top = a.offsetTop - nav.offsetTop; if (top < nav.scrollTop || top > nav.scrollTop + nav.clientHeight - 40) nav.scrollTop = top - nav.clientHeight / 3; } } }
}, { rootMargin: '-110px 0px -70% 0px' });
document.querySelectorAll('.ep').forEach((el) => io.observe(el));
