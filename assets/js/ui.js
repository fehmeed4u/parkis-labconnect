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
