import { esc } from './logic.js';

export const $ = (s, el = document) => el.querySelector(s);
export const $$ = (s, el = document) => [...el.querySelectorAll(s)];

export function toast(msg, kind = '') {
  const t = document.createElement('div'); t.className = 'toast ' + kind; t.setAttribute('role', 'status'); t.textContent = msg;
  document.body.appendChild(t); setTimeout(() => t.remove(), 3200);
}

/** Opens a modal. `html` is trusted markup built with esc(); returns the dialog element. */
export function modal(html, { wide = false, onClose } = {}) {
  closeModal();
  const wrap = document.createElement('div'); wrap.className = 'overlay'; wrap.id = 'overlay';
  wrap.innerHTML = `<div class="dialog${wide ? ' wide' : ''}" role="dialog" aria-modal="true">${html}</div>`;
  document.body.appendChild(wrap);
  wrap.addEventListener('click', e => { if (e.target === wrap || e.target.closest('[data-close]')) { closeModal(); onClose && onClose(); } });
  const f = wrap.querySelector('button, input, select, textarea, a'); f && f.focus();
  return wrap.firstElementChild;
}
export function closeModal() { const o = document.getElementById('overlay'); o && o.remove(); }
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeModal(); });

export function confirmBox(text, okLabel = 'OK') {
  return new Promise(res => {
    const d = modal(`<h2 class="h2">${esc(text)}</h2><div class="row end gap"><button class="btn" data-close>Cancel</button><button class="btn pri" id="ok">${esc(okLabel)}</button></div>`, { onClose: () => res(false) });
    d.querySelector('#ok').onclick = () => { closeModal(); res(true); };
  });
}
export function promptBox(title, fields, okLabel = 'Save') {
  return new Promise(res => {
    const d = modal(`<h2 class="h2">${esc(title)}</h2><form id="pf" class="stack">${fields.map(f => `<label class="fld">${esc(f.label)}${f.options
      ? `<select name="${esc(f.name)}">${f.options.map(o => `<option${o === f.value ? ' selected' : ''}>${esc(o)}</option>`).join('')}</select>`
      : f.type === 'textarea' ? `<textarea name="${esc(f.name)}" rows="${f.rows || 6}">${esc(f.value ?? '')}</textarea>`
      : `<input name="${esc(f.name)}" type="${f.type || 'text'}" value="${esc(f.value ?? '')}">`}</label>`).join('')}
      <div class="row end gap"><button type="button" class="btn" data-close>Cancel</button><button class="btn pri">${esc(okLabel)}</button></div></form>`, { onClose: () => res(null) });
    d.querySelector('#pf').onsubmit = e => { e.preventDefault(); const o = Object.fromEntries(new FormData(e.target)); closeModal(); res(o); };
  });
}

/** Steps through hazcards. Resolves true when the reader has gone through all of them. */
export function hazcardModal(cards, headline, doneLabel = 'I’ve read these', uses = {}) {
  return new Promise(res => {
    let i = 0;
    const isImg = u => /\.(png|jpe?g|gif|webp|svg)(\?|$)/i.test(u || '');
    const draw = d => {
      const c = cards[i];
      d.innerHTML = `<div class="row between" style="align-items:flex-start"><div><div class="kicker danger">${esc(headline)}</div>
        <h2 class="h2" style="margin-top:4px">Hazcard ${esc(c.code)}${c.title ? ' · ' + esc(c.title) : ''}</h2>
        ${uses[c.code] ? `<div class="muted small">Used here for: ${esc(uses[c.code])}</div>` : ''}</div><button class="icon-btn b" data-close aria-label="Close">×</button></div>
        <div class="chips" role="group" aria-label="Hazcards">${cards.map((x, j) => `<button class="chip danger${j === i ? ' on' : ''}" aria-pressed="${j === i}" data-i="${j}">${esc(x.code)}${x.title ? ' · ' + esc(shortTitle(x.title)) : ''}</button>`).join('')}</div>
        ${c.url ? (isImg(c.url) ? `<img class="hazimg" src="${esc(c.url)}" alt="CLEAPSS Hazcard ${esc(c.code)}">` : `<iframe class="hazframe" src="${esc(c.url)}" title="Hazcard ${esc(c.code)}"></iframe>`)
               : `<div class="empty">The card file for ${esc(c.code)} isn’t linked yet. Ask the HOD to run <code>linkHazcards</code> (see README) or read the paper card in the prep room.</div>`}
        <div class="row between"><span class="muted xs">Your school’s CLEAPSS Hazcards · ${i + 1} of ${cards.length}</span>
        <button class="btn pri big" id="hzNext">${i < cards.length - 1 ? 'Next hazcard' : esc(doneLabel)}</button></div>`;
      d.querySelectorAll('[data-i]').forEach(b => b.onclick = () => { i = Number(b.dataset.i); draw(d); });
      d.querySelector('#hzNext').onclick = () => { if (i < cards.length - 1) { i++; draw(d); } else { closeModal(); res(true); } };
    };
    const d = modal('', { wide: true, onClose: () => res(false) }); draw(d);
  });
}
const shortTitle = t => String(t).split(/ and | & |, /)[0];

/** Hazcard chips (click to read) and the SDS link for one inventory item. `staff` also shows "check this SDS" notes. */
export function safetyLinks(i, staff = false) {
  const hz = (i.hazcards || []).map(c => `<button type="button" class="chip hz" data-hz="${esc(c)}">Hazcard ${esc(c)}</button>`).join('');
  const sds = i.sds ? `<a class="chip sds" href="${esc(i.sds)}" target="_blank" rel="noopener">Safety data sheet ↗</a>` : '';
  const missing = !hz && !sds ? '<span class="pill st-rejected">No hazcard or SDS yet</span>' : !sds && i.list === 'Chemicals' ? '<span class="muted small">No SDS yet</span>' : '';
  const check = staff && /^Close match/.test(i.sdsNote || '') ? `<div class="note warn small">${esc(i.sdsNote)}. <button type="button" class="linkbtn" data-sds-ok="${esc(i.id)}">It’s right</button></div>` : '';
  return `<div class="chips safety">${hz}${sds}${missing}</div>${check}`;
}

export const statusLabel = { draft: 'Draft', submitted: 'Waiting for approval', accepted: 'Not started', in_progress: 'In prep', ready: 'Ready', done: 'Closed', rejected: 'Rejected', cancelled: 'Cancelled', queried: 'Queried' };
/** Status chip. Pass a request to show “Queried” when the technicians asked something. */
export const statusChip = (s, r) => { if (r && r.query && !['done', 'rejected', 'cancelled'].includes(s)) s = 'queried';
  if (s === 'accepted' && r && Number(r.prep) > 0) s = Number(r.prep) === 2 ? 'ready' : 'in_progress'; // technicians set the colour on the board
  return `<span class="pill st-${esc(s)}">${esc(statusLabel[s] || s)}</span>`; };
export const iconImg = (item, size = 40) => item.photo ? `<img src="${esc(item.photo)}" alt="" width="${size}" height="${size}" class="thumb">`
  : item.icon ? `<img src="assets/icons/${esc(item.icon)}.svg" alt="" width="${size}" height="${size}" class="thumb icon">` : `<span class="thumb none" style="width:${size}px;height:${size}px">?</span>`;
export function download(name, text, type = 'application/json') {
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type })); a.download = name; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
}

/** Small line icons (16×16, currentColor), so the interface doesn't rely on emoji. */
const ICONS = {
  nav: '<rect x="2" y="3" width="12" height="10" rx="1.5"/><path d="M6 3v10"/>',
  paneL: '<rect x="2" y="3" width="12" height="10" rx="1.5"/><path d="M6 3v10"/><path d="M3.5 6h1M3.5 8h1"/>',
  paneR: '<rect x="2" y="3" width="12" height="10" rx="1.5"/><path d="M10 3v10"/><path d="M11.5 6h1M11.5 8h1"/>',
  plus: '<path d="M8 3v10M3 8h10"/>',
  book: '<path d="M3 3.5h4a1.5 1.5 0 0 1 1 .5 1.5 1.5 0 0 1 1-.5h4v9H9a1 1 0 0 0-1 1 1 1 0 0 0-1-1H3z"/><path d="M8 4v9.5"/>',
  clipboard: '<rect x="3.5" y="3" width="9" height="11" rx="1"/><path d="M6 3V2h4v1M6 7h4M6 9.5h4M6 12h2"/>',
  sparkle: '<path d="M8 2l1.3 3.7L13 7l-3.7 1.3L8 12l-1.3-3.7L3 7l3.7-1.3z"/>',
  lock: '<rect x="3.5" y="7" width="9" height="6.5" rx="1"/><path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2"/>',
  arrow: '<path d="M6 3.5L10.5 8 6 12.5"/>'
};
export const icon = (name, cls = '') => `<svg class="ic ${cls}" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name] || ''}</svg>`;

/* ---------------- show / hide password ----------------
   Every password box gets a "Show" button inside it, so people can check what they typed (handy when choosing a new
   password). Done once here for every page and pop-up, including any password box added later. */
function addPasswordToggles(root) {
  root.querySelectorAll('input[type=password]:not([data-pw])').forEach(inp => {
    inp.dataset.pw = '1';
    const wrap = document.createElement('span'); wrap.className = 'pw';
    inp.replaceWith(wrap); wrap.appendChild(inp);
    const b = document.createElement('button'); b.type = 'button'; b.className = 'pw-eye';
    const set = show => { inp.type = show ? 'text' : 'password'; b.textContent = show ? 'Hide' : 'Show'; b.setAttribute('aria-pressed', String(show)); b.setAttribute('aria-label', show ? 'Hide password' : 'Show password'); };
    set(false);
    b.onclick = () => { const pos = inp.selectionStart; set(inp.type === 'password'); inp.focus(); try { inp.setSelectionRange(pos, pos); } catch (e) {} };
    wrap.appendChild(b);
  });
}
// Hide every password again when its form is sent, so the browser saves it as a password.
document.addEventListener('submit', e => e.target.querySelectorAll?.('input[data-pw]').forEach(i => { i.type = 'password'; const b = i.parentElement.querySelector('.pw-eye'); if (b) { b.textContent = 'Show'; b.setAttribute('aria-pressed', 'false'); b.setAttribute('aria-label', 'Show password'); } }), true);
new MutationObserver(() => addPasswordToggles(document)).observe(document.documentElement, { childList: true, subtree: true });
