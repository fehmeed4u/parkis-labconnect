// Reflections: the form a teacher fills in after a practical, and the notes shown the next time it is used.
import { db, session, call } from '../store.js';
import { esc, kitDiff, reflectionSummary } from '../logic.js';
import { $, modal, closeModal, toast } from '../ui.js';

export const reflectionsFor = id => db.reflections.filter(f => f.practicalId === id);
export const reflectionOf = requestId => db.reflections.find(f => f.requestId === requestId);
const day = d => new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
const stars = n => '★'.repeat(Number(n) || 0) + '☆'.repeat(5 - (Number(n) || 0));
const TIMING = { short: 'Not enough time', ok: 'About right', long: 'Too much time' };

/** Opens the reflection form for a request. Resolves with the saved reflection, or null. */
export function openReflection(r) {
  const p = db.library.find(x => x.id === r.practicalId);
  const diff = kitDiff(r, p);
  const F = { rating: 0, wentWell: '', toImprove: '', timing: 'ok', setsRight: 'yes', suggestedSets: '', prepMinutes: p?.prepMinutes || '', safetyNotes: '', tipForNextTime: '', extra: [] };
  const on = diff.map(() => true);
  return new Promise(res => {
    const d = modal('', { wide: true, onClose: () => res(null) });
    const gather = () => {
      const g = n => d.querySelector(`[name="${n}"]`)?.value ?? '';
      Object.assign(F, { wentWell: g('wentWell'), toImprove: g('toImprove'), suggestedSets: F.setsRight === 'no' ? g('suggestedSets') : '', prepMinutes: g('prepMinutes'), safetyNotes: g('safetyNotes').trim(), tipForNextTime: g('tipForNextTime').trim() });
      d.querySelectorAll('[data-on]').forEach(c => { on[Number(c.dataset.on)] = c.checked; });
    };
    const changes = () => diff.filter((_, i) => on[i]).concat(F.extra);
    const preview = () => { gather(); const s = p ? reflectionSummary(p, { ...F, kitChanges: changes() }) : [];
      const box = $('#rfPreview', d); if (box) box.innerHTML = s.length ? `<ul class="rules">${s.map(x => `<li>${esc(x)}</li>`).join('')}</ul>` : '<p class="muted small">No changes to the practical — your notes are still saved and shown next time.</p>'; };
    const draw = () => {
      d.innerHTML = `<div class="row between" style="align-items:flex-start"><div><div class="kicker">Reflection</div>
          <h2 class="h2" style="margin-top:4px">${esc(r.title)}</h2><div class="muted small">${esc(r.class)} · ${esc(day(r.date))} · ${esc(r.sets)} groups</div></div>
          <button class="icon-btn b" data-close aria-label="Close">×</button></div>
        <form id="rf" class="stack" onsubmit="return false">
          <div class="fld">How did it go?<div class="stars" role="radiogroup" aria-label="Rating">${[1, 2, 3, 4, 5].map(n => `<button type="button" role="radio" aria-checked="${F.rating === n}" class="${n <= F.rating ? 'on' : ''}" data-star="${n}" aria-label="${n} of 5">★</button>`).join('')}</div></div>
          <div class="grid2"><label class="fld">What went well<textarea name="wentWell" rows="2">${esc(F.wentWell)}</textarea></label>
            <label class="fld">What to change next time<textarea name="toImprove" rows="2">${esc(F.toImprove)}</textarea></label></div>
          <div class="grid2"><div class="fld">Timing<div class="seg" role="group">${Object.entries(TIMING).map(([k, l]) => `<button type="button" data-timing="${k}" aria-pressed="${F.timing === k}">${l}</button>`).join('')}</div></div>
            <div class="fld">Were ${esc(r.sets)} groups right?<div class="row gap"><div class="seg" role="group"><button type="button" data-sets="yes" aria-pressed="${F.setsRight === 'yes'}">Yes</button><button type="button" data-sets="no" aria-pressed="${F.setsRight === 'no'}">No</button></div>
              ${F.setsRight === 'no' ? `<input name="suggestedSets" type="number" min="1" max="40" value="${esc(F.suggestedSets)}" placeholder="Better number" style="max-width:150px" aria-label="Better number of groups">` : ''}</div></div></div>
          <div class="fld">Equipment changes for the library
            ${diff.length ? `<p class="muted small" style="font-weight:400;margin:0">You ordered this differently from the library version. Untick anything that was just for this lesson.</p>
            <div class="stack" style="gap:6px">${diff.map((c, i) => `<label class="check"><input type="checkbox" data-on="${i}" ${on[i] ? 'checked' : ''}> ${esc(c.action === 'add' ? `Add ${c.perGroup} × ${c.name} per group` : c.action === 'remove' ? `Remove ${c.name}` : `${c.name}: ${c.from} → ${c.perGroup} per group`)}</label>`).join('')}</div>`
            : '<p class="muted small" style="font-weight:400;margin:0">You used the library kit as it is.</p>'}
            ${F.extra.map((c, i) => `<div class="row gap small" style="font-weight:400">${esc(c.action === 'add' ? `Add ${c.perGroup} × ${c.name} per group` : `Remove ${c.name}`)} <button type="button" class="linkbtn danger" data-rmx="${i}">Undo</button></div>`).join('')}
            <div class="add-row"><input id="rfItem" list="rfInv" placeholder="Something else was needed? Type to search…" aria-label="Add equipment"><datalist id="rfInv">${db.inventory.map(i => `<option value="${esc(i.name + (i.size ? ' · ' + i.size : '') + ' [' + i.id + ']')}">`).join('')}</datalist>
              <input id="rfPg" type="number" min="0" step="any" value="1" style="max-width:80px" aria-label="Per group"><button type="button" class="btn" id="rfAdd">+ Add</button></div></div>
          <div class="grid2"><label class="fld">Prep time (minutes)<input name="prepMinutes" type="number" min="0" value="${esc(F.prepMinutes)}"></label>
            <label class="fld">Tip for next time<input name="tipForNextTime" value="${esc(F.tipForNextTime)}" placeholder="e.g. Warm the Benedict’s in advance"></label></div>
          <label class="fld">Safety notes<input name="safetyNotes" value="${esc(F.safetyNotes)}" placeholder="Anything the next teacher must know"></label>
          ${p ? `<section class="note ok"><label class="check" style="color:inherit"><input type="checkbox" id="rfApply" checked> <strong>Update “${esc(p.title)}” in the library with these changes</strong></label>
            <div id="rfPreview" style="margin-top:8px"></div><p class="xs" style="margin:6px 0 0">Everyone sees the new version next time. Technicians and the HOD can undo it.</p></section>` : ''}
          <div class="row end gap"><button type="button" class="btn" data-close>Cancel</button><button class="btn pri" id="rfSave" ${F.rating ? '' : 'disabled'}>Save reflection</button></div>
        </form>`;
      d.querySelectorAll('[data-star]').forEach(b => b.onclick = () => { gather(); F.rating = Number(b.dataset.star); draw(); });
      d.querySelectorAll('[data-timing]').forEach(b => b.onclick = () => { gather(); F.timing = b.dataset.timing; draw(); });
      d.querySelectorAll('[data-sets]').forEach(b => b.onclick = () => { gather(); F.setsRight = b.dataset.sets; draw(); });
      d.querySelectorAll('[data-rmx]').forEach(b => b.onclick = () => { gather(); F.extra.splice(Number(b.dataset.rmx), 1); draw(); });
      $('#rfAdd', d).onclick = () => { gather(); const m = $('#rfItem', d).value.match(/\[([^\]]+)\]$/); const it = m && db.inventory.find(i => i.id === m[1]);
        if (!it) { toast('Pick an item from the list', 'bad'); return; }
        F.extra.push({ itemId: it.id, name: it.name + (it.size ? ' ' + it.size : ''), action: 'add', perGroup: Number($('#rfPg', d).value) || 1 }); draw(); };
      d.querySelector('#rf').addEventListener('input', preview); d.querySelector('#rf').addEventListener('change', preview);
      $('#rfSave', d).onclick = async () => {
        gather(); const apply = !!$('#rfApply', d)?.checked;
        const reflection = { requestId: r.id, rating: F.rating, wentWell: F.wentWell, toImprove: F.toImprove, timing: F.timing, setsRight: F.setsRight, suggestedSets: Number(F.suggestedSets) || '',
          kitChanges: changes(), prepMinutes: Number(F.prepMinutes) || '', safetyNotes: F.safetyNotes, tipForNextTime: F.tipForNextTime };
        try { const out = await call('saveReflection', { reflection, apply }); closeModal();
          toast(out.applied?.length ? `Saved — library updated to version ${out.version}` : 'Reflection saved'); res(out);
        } catch (e) { toast('Could not save: ' + e.message, 'bad'); }
      };
      preview();
    };
    draw();
  });
}

/** “Notes from last time” — shown whenever a practical is reused (order form, prep sheet). */
export function notesCard(p, { teacher, compact = false } = {}) {
  if (!p) return '';
  const refl = reflectionsFor(p.id); const tips = (p.tips || []).slice().reverse();
  const safety = tips.filter(t => t.kind === 'safety'), plain = tips.filter(t => t.kind !== 'safety');
  const mineLast = teacher && db.requests.filter(r => r.practicalId === p.id && r.teacher === teacher && r.status === 'done').sort((a, b) => b.date.localeCompare(a.date))[0];
  const since = mineLast ? (p.changelog || []).filter(c => !c.undone && c.at > mineLast.date && c.by !== teacher) : [];
  if (!refl.length && !tips.length) return '';
  const avg = refl.filter(f => f.rating).reduce((s, f, _, a) => s + Number(f.rating) / a.length, 0);
  return `<section class="card stack reflect-notes">
    <div class="row between wrap"><h2 class="h2">Notes from last time</h2>
      <span class="muted small">${refl.length ? `${esc(avg.toFixed(1))} ★ from ${refl.length} reflection${refl.length > 1 ? 's' : ''} · ` : ''}library version ${esc(p.version || 1)}</span></div>
    ${since.length ? `<div class="note warn"><strong>Changed since you last ran it (${esc(day(mineLast.date))}):</strong> ${since.flatMap(c => c.summary).map(esc).join(' · ')}</div>` : ''}
    ${safety.length ? `<div class="note bad"><strong>Safety</strong><ul class="rules">${safety.slice(0, 3).map(t => `<li>${esc(t.text)} <span class="xs">— ${esc(t.by)}, ${esc(day(t.at))}</span></li>`).join('')}</ul></div>` : ''}
    ${plain.length ? `<div><h3 class="h3">Tips</h3><ul class="rules">${plain.slice(0, compact ? 3 : 5).map(t => `<li>${esc(t.text)} <span class="muted xs">— ${esc(t.by)}, ${esc(day(t.at))}</span></li>`).join('')}</ul></div>` : ''}
    ${!compact && refl[0] ? `<div><h3 class="h3">Latest reflection</h3>${reflItem(refl[0])}</div>` : ''}
  </section>`;
}

/** Reflections list + version history for the library detail panel. */
export function librarySection(p, canUndo) {
  const refl = reflectionsFor(p.id); const log = (p.changelog || []).slice().reverse();
  const lastUndoable = (p.changelog || []).slice().reverse().find(c => !c.undone && c.before);
  return `<div><h3 class="h3">Reflections${refl.length ? ` <span class="muted small">(${refl.length})</span>` : ''}</h3>
      ${(p.tips || []).filter(t => t.kind === 'safety').slice(-2).reverse().map(t => `<div class="note bad small" style="margin-bottom:6px"><strong>Safety:</strong> ${esc(t.text)}</div>`).join('')}
      ${refl.length ? `<div class="stack" style="gap:10px">${refl.slice(0, 3).map(reflItem).join('')}</div>` : '<p class="muted small">No reflections yet. Teachers are asked for one after each run.</p>'}</div>
    ${log.length ? `<details class="vlog"><summary>Version ${esc(p.version || 1)} · updated ${esc(day(p.updatedAt))} by ${esc(p.updatedBy)}</summary>
      <ul class="hist">${log.map(c => `<li><b>v${esc(c.version)}</b><span class="muted">${esc(day(c.at))} · ${esc(c.by)}${c.reflectionId ? ' (reflection)' : ''}<br>${c.summary.map(esc).join(' · ')}</span>${c.undone ? '<span class="pill">Undone</span>' : c === lastUndoable && canUndo ? '<button class="linkbtn danger small" id="undoV">Undo</button>' : '<span></span>'}</li>`).join('')}</ul></details>` : ''}`;
}

function reflItem(f) {
  return `<article class="refl">
    <div class="row between"><strong class="small">${esc(f.teacher)} · ${esc(f.class)} · ${esc(day(f.date || f.createdAt))}</strong><span class="stars-s" aria-label="${esc(f.rating)} of 5">${stars(f.rating)}</span></div>
    ${f.wentWell ? `<div class="small"><span class="ok-t strong">Went well:</span> ${esc(f.wentWell)}</div>` : ''}
    ${f.toImprove ? `<div class="small"><span class="warn-t strong">Change:</span> ${esc(f.toImprove)}</div>` : ''}
    <div class="muted xs">${esc(TIMING[f.timing] || '')}${f.setsRight === 'no' && f.suggestedSets ? ` · better with ${esc(f.suggestedSets)} groups` : ''}${f.applied?.length ? ` · updated the library to v${esc(f.version)}` : ''}</div>
  </article>`;
}
