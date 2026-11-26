// "Bring a practical from AI": a prompt to copy into any AI chat (with a PDF or an idea), then paste the
// answer back. The answer is matched against our inventory so the teacher sees what we have and what's missing.
import { db, session } from '../store.js';
import { esc, nice, roomName, isLabRoom, totalStock, min, gradeOf } from '../logic.js';
import { toast } from '../ui.js';

/* ---------------- the prompts ---------------- */
export function buildPrompt(l, sets) {
  const mins = min(l.end) - min(l.start);
  return `You are helping a secondary-school science teacher plan a practical for the school's lab technicians to prepare.

LESSON
- Grade ${l.grade || gradeOf(l.class)} · ${l.subject || 'Science'} · class ${l.class}
- ${mins} minutes, ${isLabRoom(db, l.room) ? 'in a science lab' : 'in a classroom (we may move to a lab)'}
- About ${sets} groups of students (2–4 students per group)

SOURCE
Use the document or idea I give you below (a worksheet, PDF, web page or description). Keep its learning aim.

PLAN IT THE MINIMALIST WAY
- Use as few different pieces of equipment and as few chemicals as possible.
- Use the smallest amounts and lowest concentrations that still work reliably at normal class scale.
- Prefer standard school-lab kit (beakers, measuring cylinders, test tubes, boiling tubes, Bunsen burners, tripods, balances, thermometers, stopwatches) over specialist apparatus.
- Choose the lowest-hazard option that works, and follow CLEAPSS guidance.
- Count equipment per group. Put anything only the teacher needs (a demo, a shared balance) under "teacherOnly".
- Do not list things everyone already has: pens, paper, calculators, eye protection, lab coats.
- It must be doable in ${mins} minutes, including setting up and clearing away.

ANSWER FORMAT
Reply with ONLY one JSON code block, exactly in this shape (no other text):

\`\`\`json
{
  "title": "Short name of the practical",
  "topic": "Topic, e.g. Rates of reaction",
  "aim": "One sentence",
  "sets": ${sets},
  "minutes": ${mins},
  "equipment": [
    { "name": "Beaker", "size": "250 mL", "perGroup": 1 }
  ],
  "chemicals": [
    { "name": "Hydrochloric acid", "concentration": "1 M", "amountPerGroup": "50 cm3", "hazard": "Irritant" }
  ],
  "teacherOnly": [
    { "name": "Balance", "size": "0.01 g", "qty": 1 }
  ],
  "method": ["Step 1", "Step 2"],
  "safety": ["Short safety point"],
  "disposal": "How to dispose of the waste"
}
\`\`\`

Here is the source:
`;
}

function rethinkPrompt(rows, sets) {
  const missing = rows.filter(r => r.status === 'missing'), short = rows.filter(r => r.status === 'short');
  const have = rows.filter(r => r.status === 'ok').map(r => `- ${r.item.name}${r.item.size ? ' ' + r.item.size : ''}`);
  const similar = [...missing, ...short].flatMap(r => candidates(r, true).filter(c => c.item !== r.item && totalStock(c.item) > 0).slice(0, 3).map(c => `- ${c.item.name}${c.item.size ? ' ' + c.item.size : ''} (we have ${totalStock(c.item)})`));
  return `Thanks. Our prep room can't supply everything in that plan:
${missing.map(r => `- MISSING: ${label(r.ai)} — we don't have this`).join('\n')}${short.map(r => `\n- NOT ENOUGH: ${label(r.ai)} — need ${r.need}, we have ${totalStock(r.item)}`).join('')}

We DO have:
${have.join('\n') || '- (none of the other items matched)'}
${similar.length ? `\nSimilar things we have that might replace the missing ones:\n${[...new Set(similar)].join('\n')}` : ''}

Please revise the practical so it only uses what we have (or fewer groups / sharing between groups, for ${sets} groups), still minimalist and still doable at normal class scale. Reply again with ONLY the full JSON in exactly the same shape as before.`;
}

/* ---------------- reading the answer ---------------- */
export function parseAnswer(text) {
  let t = String(text || '').trim();
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i); if (fence) t = fence[1];
  const a = t.indexOf('{'), b = t.lastIndexOf('}');
  if (a < 0 || b <= a) throw new Error('No JSON found. Paste the AI’s whole answer, including the part between the { and } brackets.');
  t = t.slice(a, b + 1).replace(/[“”]/g, '"').replace(/[‘’]/g, "'").replace(/,\s*([}\]])/g, '$1');
  let j; try { j = JSON.parse(t); } catch (e) { throw new Error('The answer isn’t valid JSON (' + e.message + '). Ask the AI to “reply again with only the JSON code block”.'); }
  const arr = x => Array.isArray(x) ? x : [];
  const num = (x, d) => { const n = Number(String(x ?? '').replace(',', '.').match(/[\d.]+/)?.[0]); return n > 0 ? n : d; };
  const out = {
    title: String(j.title || '').trim(), topic: String(j.topic || '').trim(), aim: String(j.aim || '').trim(), sets: num(j.sets, 0),
    method: arr(j.method).map(String), safety: arr(j.safety).map(String), disposal: String(j.disposal || ''),
    items: [
      ...arr(j.equipment).map(x => ({ kind: 'equipment', name: String(x.name || '').trim(), size: String(x.size || '').trim(), perGroup: num(x.perGroup, 1) })),
      ...arr(j.chemicals).map(x => ({ kind: 'chemical', name: String(x.name || '').trim(), concentration: String(x.concentration || '').trim(), amount: String(x.amountPerGroup || x.amount || '').trim(), hazard: String(x.hazard || '').trim(), perGroup: 1 })),
      ...arr(j.teacherOnly).map(x => ({ kind: 'teacher', name: String(x.name || '').trim(), size: String(x.size || '').trim(), qty: num(x.qty, 1) }))
    ].filter(x => x.name)
  };
  if (!out.title && !out.items.length) throw new Error('That JSON has no title and no equipment. Check you copied the AI’s answer.');
  return out;
}
const label = x => [x.name, x.size, x.concentration].filter(Boolean).join(' ') + (x.amount ? ` (${x.amount} per group)` : '');

/* ---------------- matching against the inventory ---------------- */
const SYN = [[/erlenmeyer( flask)?/g, 'conical flask'], [/graduated cylinder/g, 'measuring cylinder'], [/retort stand|ring stand/g, 'clamp stand'],
  [/\bhcl\b/g, 'hydrochloric acid'], [/\bnaoh\b/g, 'sodium hydroxide'], [/\bh2so4\b/g, 'sulfuric acid'], [/sulph/g, 'sulf'], [/aluminum/g, 'aluminium'],
  [/\btimer\b/g, 'stopwatch'], [/\bbunsen\b(?! burner)/g, 'bunsen burner'], [/wire gauze|gauze mat/g, 'gauze'], [/dropper|dropping pipette/g, 'pipette'],
  [/\bcm3\b|\bcm³|\bml\b/g, 'ml'], [/\bdm3\b|\bdm³/g, 'l']];
const STOP = new Set(['of', 'the', 'a', 'an', 'and', 'with', 'for', 'per', 'x', 'ml', 'l', 'mm', 'cm', 'm', 'g', 'kg', 'mg', 'mol', 'dm', 'ul', 'diam', 'ext', 'int', 'small', 'large', 'medium', 'student', 'standard', 'lab', 'laboratory']);
const norm = s => { let t = String(s || '').toLowerCase().replace(/[()\[\],/:;*×–-]/g, ' '); SYN.forEach(([a, b]) => { t = t.replace(a, b); }); return t.replace(/\s+/g, ' ').trim(); };
const words = s => norm(s).split(' ').map(w => w.replace(/[^a-z0-9]/g, '')).filter(w => w.length > 1 && !/^\d/.test(w) && !STOP.has(w)).map(w => w.length > 3 && w.endsWith('s') && !w.endsWith('ss') ? w.slice(0, -1) : w);
const nums = s => (String(s || '').replace(',', '.').match(/\d+(\.\d+)?/g) || []).map(Number);
const UNIT = { ul: ['v', 0.001], 'µl': ['v', 0.001], 'μl': ['v', 0.001], ml: ['v', 1], cm3: ['v', 1], 'cm³': ['v', 1], l: ['v', 1000], dm3: ['v', 1000], 'dm³': ['v', 1000], mg: ['m', 0.001], g: ['m', 1], kg: ['m', 1000] };
/** Sizes with units, converted to mL or g, e.g. "100 uL" → [{ d: 'v', v: 0.1 }]. */
const qtys = s => [...String(s || '').toLowerCase().replace(/(\d),(\d)/g, '$1.$2').matchAll(/(\d+(?:\.\d+)?)\s*(µl|μl|ul|ml|cm3|cm³|dm3|dm³|mg|kg|g|l)(?![a-z])/g)]
  .map(m => ({ d: UNIT[m[2]][0], v: Number(m[1]) * UNIT[m[2]][1] }));
/** +1 same size, -1 different size, 0 can't tell. */
function sizeMatch(a, b) {
  const qa = qtys(a), qb = qtys(b);
  if (qa.length && qb.length) { const same = qa.filter(x => qb.some(y => y.d === x.d)); if (!same.length) return 0;
    return same.some(x => qb.some(y => y.d === x.d && Math.abs(y.v - x.v) <= x.v * 0.01)) ? 1 : -1; }
  const na = nums(a), nb = nums(b); if (!na.length || !nb.length || qa.length || qb.length) return 0;
  return na.some(n => nb.includes(n)) ? 1 : -1;
}
const listsFor = kind => kind === 'chemical' ? ['Chemicals', 'Temporary'] : null;

/** Inventory items that could be what the AI means. loose = also near misses (for “similar things we have”). */
function candidates(row, loose = false) {
  const ai = row.ai; const aw = [...new Set(words(ai.name))]; if (!aw.length) return [];
  const lists = listsFor(ai.kind); const need = loose ? 0.34 : aw.length === 1 ? 1 : 0.67;
  const out = [];
  for (const it of db.inventory) {
    if (lists ? !lists.includes(it.list) : it.list === 'Chemicals' || it.list === 'Temporary' || it.list === 'Documents') continue;
    const iw = new Set(words(it.name)); let common = 0; aw.forEach(w => { if (iw.has(w)) common++; });
    if (!common) continue;
    const cover = common / aw.length; if (cover < need) continue; // the AI's key words must be there ("gas syringe" is not a "syringe")
    let score = cover + 0.3 * common / Math.max(1, iw.size);
    if (iw.has(aw[aw.length - 1])) score += 0.5; // the last word is usually the thing itself: gas SYRINGE, conical FLASK
    if (ai.kind !== 'chemical') { const m = sizeMatch(ai.size || ai.name, it.size + ' ' + it.name); score += 0.6 * (loose ? Math.max(0, m) : m); } // a different size is still a useful suggestion
    if (totalStock(it) > 0) score += 0.1;
    if (score >= 0.5 || loose) out.push({ item: it, score });
  }
  return out.sort((a, b) => b.score - a.score || totalStock(b.item) - totalStock(a.item)).slice(0, 6);
}

function assess(rows, sets) {
  rows.forEach(r => {
    r.need = r.ai.kind === 'teacher' ? r.ai.qty : r.ai.perGroup * sets;
    if (!r.item) r.status = 'missing';
    else if (r.ai.kind === 'chemical') r.status = totalStock(r.item) > 0 ? 'ok' : 'missing';
    else { const have = totalStock(r.item); r.status = have >= r.need ? 'ok' : have > 0 ? 'short' : 'missing'; }
  });
  return rows;
}

/* ---------------- the page ---------------- */
const store = key => ({ get: () => { try { return sessionStorage.getItem('sp_ai_' + key) || ''; } catch (e) { return ''; } }, set: v => { try { sessionStorage.setItem('sp_ai_' + key, v); } catch (e) {} } });

/**
 * opts: { lesson, teacher, key, back (href), lessonCard (html), onUse(draft) }
 * draft: { title, topic, sets, kit: [{ itemId, name, perGroup, qty, fixed }], notes }
 */
export function render(el, opts) {
  const { lesson: l, key } = opts; const saved = store(key);
  const st = { text: saved.get(), parsed: null, err: '', rows: [], sets: Number(new URLSearchParams(location.hash.split('?')[1] || '').get('sets')) || 6 };
  const prompt = () => buildPrompt(l, st.sets);
  const invList = `<datalist id="aiInv">${db.inventory.map(i => `<option value="${esc(i.name + (i.size ? ' · ' + i.size : '') + ' [' + i.id + ']')}">`).join('')}</datalist>`;

  const parse = () => {
    st.err = ''; st.parsed = null; st.rows = [];
    if (!st.text.trim()) return;
    try { st.parsed = parseAnswer(st.text); } catch (e) { st.err = e.message; return; }
    if (st.parsed.sets) st.sets = st.parsed.sets;
    st.rows = st.parsed.items.map(ai => { const r = { ai, keep: false }; const c = candidates(r); r.item = c[0]?.item || null; return r; });
    assess(st.rows, st.sets);
  };

  const draw = () => {
    const rows = st.rows; const ok = rows.filter(r => r.status === 'ok').length, missing = rows.filter(r => r.status === 'missing'), short = rows.filter(r => r.status === 'short');
    const p = st.parsed;
    el.innerHTML = `<div class="page" style="max-width:1100px">
      <div><a href="${opts.back}" class="small">‹ Back to how to start</a>
      <div class="steps-nav" aria-label="Steps"><span class="done">1 · Pick a lesson</span><span class="on">2 · How to start</span><span>3 · Request</span></div>
      <h1 class="h1" style="margin-top:8px">Bring a practical from AI</h1>
      <p class="lede">Found a good worksheet, PDF or idea? Let ChatGPT, Gemini, Claude or Copilot turn it into a minimalist request, then check it against what we have.</p></div>
      ${opts.lessonCard}

      <section class="card stack">
        <div class="row between wrap"><h2 class="h2">1 · Copy this prompt into your AI chat</h2>
          <label class="row gap small" style="font-weight:600">Groups <input id="aiSets" type="number" min="1" max="40" value="${st.sets}" class="num" style="width:80px !important"></label></div>
        <ol class="rules" style="line-height:1.7"><li>Copy the prompt and paste it into the AI chat you use.</li><li>Attach the PDF or worksheet, or paste the text or link, under the prompt.</li><li>Copy the AI’s whole answer and paste it in box 2 below.</li></ol>
        <textarea id="aiPrompt" rows="9" readonly style="font-family:ui-monospace,Menlo,Consolas,monospace;font-size:12px;background:var(--head)">${esc(prompt())}</textarea>
        <div class="row gap wrap"><button type="button" class="btn pri" id="copyPrompt">Copy prompt</button><span class="muted small">It asks for as little equipment and as few chemicals as possible, at normal class scale.</span></div>
      </section>

      <section class="card stack">
        <h2 class="h2">2 · Paste the AI’s answer</h2>
        <textarea id="aiAnswer" rows="${st.text ? 6 : 8}" placeholder="Paste the whole answer here — the part in { … } is what we read." style="font-family:ui-monospace,Menlo,Consolas,monospace;font-size:12px">${esc(st.text)}</textarea>
        <div class="row gap wrap"><button type="button" class="btn pri" id="readIt">Check against our inventory</button>${st.text ? '<button type="button" class="btn" id="clearIt">Clear</button>' : ''}</div>
        ${st.err ? `<div class="note bad" role="alert">${esc(st.err)}</div>` : ''}
      </section>

      ${p ? `<section class="card stack" id="aiReview">
        <div class="row between wrap"><div><div class="kicker">3 · Check what we have</div><h2 class="h2" style="font-family:var(--display);font-size:22px;margin-top:4px">${esc(p.title || 'Untitled practical')}</h2>
          <div class="muted small">${[p.topic, p.aim].filter(Boolean).map(esc).join(' · ')}</div></div>
          <span class="row gap">${ok === rows.length && rows.length ? '<span class="pill ok">Everything in stock</span>' : `<span class="pill ${missing.length ? 'urgent' : 'warn'}">${ok} of ${rows.length} items available</span>`}</span></div>
        ${missing.length || short.length ? `<div class="note ${missing.length ? 'bad' : 'warn'}"><strong>Please rethink before sending.</strong>
          ${missing.length ? ` We don’t have: ${missing.map(r => esc(label(r.ai))).join(', ')}.` : ''}${short.length ? ` Not enough: ${short.map(r => `${esc(r.ai.name)} (need ${r.need}, have ${totalStock(r.item)})`).join(', ')}.` : ''}
          Can you do it without them, share between groups, or swap for something we have? Pick a different item in the list below, or ask the AI to redo it with only our kit.
          <div class="row gap wrap" style="margin-top:10px"><button type="button" class="btn small pri" id="copyRethink">Copy “rethink” prompt for the AI</button><span class="small">Then paste its new answer in box 2.</span></div></div>`
          : rows.length ? '<div class="note ok">We have everything this practical needs. The technicians still check what’s free at your lesson time.</div>' : '<div class="note warn">The answer lists no equipment or chemicals.</div>'}
        <div class="scroll"><table class="tbl"><thead><tr><th>From the AI</th><th>Our item</th><th>Needed</th><th>We have</th><th>Status</th></tr></thead><tbody>
        ${rows.map((r, i) => `<tr>
          <td><strong>${esc(r.ai.name)}</strong>${r.ai.size || r.ai.concentration ? ` <span class="muted">${esc(r.ai.size || r.ai.concentration)}</span>` : ''}
            <div class="muted xs">${r.ai.kind === 'teacher' ? 'teacher only' : r.ai.kind === 'chemical' ? (r.ai.amount ? r.ai.amount + ' per group' : 'chemical') + (r.ai.hazard ? ' · ' + esc(r.ai.hazard) : '') : r.ai.perGroup + ' per group'}</div></td>
          <td style="min-width:240px"><input list="aiInv" data-match="${i}" value="${r.item ? esc(r.item.name + (r.item.size ? ' · ' + r.item.size : '') + ' [' + r.item.id + ']') : ''}" placeholder="Not in our inventory — type to search" aria-label="Our item for ${esc(r.ai.name)}"></td>
          <td class="strong">${r.ai.kind === 'chemical' ? esc(r.ai.amount || '—') : r.need}</td>
          <td>${r.item ? `${totalStock(r.item)}${r.item.list === 'Chemicals' ? ' bottle' + (totalStock(r.item) === 1 ? '' : 's') : ''}<div class="muted xs">${Object.keys(r.item.rooms).filter(k => Number(r.item.rooms[k]) > 0).slice(0, 2).map(k => esc(roomName(db, k))).join(', ')}</div>` : '—'}</td>
          <td>${r.status === 'ok' ? '<span class="pill ok">✓ We have it</span>' : r.status === 'short' ? '<span class="pill warn">⚠ Not enough</span>' : `<span class="pill urgent">✕ Missing</span><label class="check xs" style="margin-top:6px"><input type="checkbox" data-keep="${i}" ${r.keep ? 'checked' : ''}> Still need it</label>`}</td></tr>`).join('')}
        </tbody></table>${invList}</div>
        ${p.method.length || p.safety.length || p.disposal ? `<details><summary class="strong" style="cursor:pointer">Method, safety and disposal from the AI (goes into the notes for the technicians)</summary>
          ${p.method.length ? `<h3 class="h3" style="margin-top:12px">Method</h3><ol class="rules">${p.method.map(m => `<li>${esc(m)}</li>`).join('')}</ol>` : ''}
          ${p.safety.length ? `<h3 class="h3" style="margin-top:12px">Safety</h3><ul class="rules">${p.safety.map(m => `<li>${esc(m)}</li>`).join('')}</ul>` : ''}
          ${p.disposal ? `<h3 class="h3" style="margin-top:12px">Disposal</h3><p class="small">${esc(p.disposal)}</p>` : ''}</details>` : ''}
        <div class="row between wrap" style="border-top:1px solid var(--line);padding-top:16px">
          <span class="muted small">${missing.filter(r => !r.keep).length ? `${missing.filter(r => !r.keep).length} missing item${missing.filter(r => !r.keep).length > 1 ? 's' : ''} will be left out. ` : ''}You can still change everything on the next page.</span>
          <button type="button" class="btn pri big" id="useIt" ${rows.length || p.title ? '' : 'disabled'}>Use this practical ›</button></div>
      </section>` : ''}
    </div>`;
    wire();
  };

  const copy = async (text, what) => { try { await navigator.clipboard.writeText(text); toast(what + ' copied — paste it into your AI chat'); } catch (e) { toast('Select the text and copy it by hand', 'bad'); } };
  const wire = () => {
    el.querySelector('#copyPrompt').onclick = () => copy(prompt(), 'Prompt');
    el.querySelector('#aiSets').onchange = e => { st.sets = Math.max(1, Number(e.target.value) || 6); if (st.rows.length) assess(st.rows, st.sets); draw(); };
    const ans = el.querySelector('#aiAnswer'); ans.oninput = () => { st.text = ans.value; saved.set(st.text); };
    el.querySelector('#readIt').onclick = () => { st.text = ans.value; saved.set(st.text); parse(); draw(); el.querySelector(st.err ? '.note.bad' : '#aiReview')?.scrollIntoView({ behavior: 'smooth', block: 'start' }); };
    const cl = el.querySelector('#clearIt'); if (cl) cl.onclick = () => { st.text = ''; saved.set(''); parse(); draw(); };
    const rt = el.querySelector('#copyRethink'); if (rt) rt.onclick = () => copy(rethinkPrompt(st.rows, st.sets), '“Rethink” prompt');
    el.querySelectorAll('[data-match]').forEach(inp => inp.onchange = () => {
      const r = st.rows[Number(inp.dataset.match)]; const m = inp.value.match(/\[([^\]]+)\]$/);
      r.item = m ? db.inventory.find(i => i.id === m[1]) || null : null; if (inp.value && !r.item) toast('Pick an item from the list, or clear the box if we don’t have it', 'bad');
      assess(st.rows, st.sets); setTimeout(draw, 0);
    });
    el.querySelectorAll('[data-keep]').forEach(c => c.onchange = () => { st.rows[Number(c.dataset.keep)].keep = c.checked; draw(); });
    const use = el.querySelector('#useIt'); if (use) use.onclick = () => {
      const p = st.parsed;
      const kit = st.rows.filter(r => r.item || r.keep).map(r => {
        const name = r.item ? r.item.name + (r.item.size ? ' ' + r.item.size : '') + (r.ai.kind === 'chemical' ? [r.ai.concentration && ' · ' + r.ai.concentration, r.ai.amount && ` (${r.ai.amount} per group)`].filter(Boolean).join('') : '')
          : label(r.ai) + ' — not in our inventory';
        return r.ai.kind === 'teacher' ? { itemId: r.item?.id || '', name: name + ' (teacher)', perGroup: r.ai.qty, qty: r.ai.qty, fixed: true }
          : { itemId: r.item?.id || '', name, perGroup: r.ai.perGroup, qty: r.ai.perGroup * st.sets };
      });
      const notes = [p.aim && 'Aim: ' + p.aim, p.method.length && 'Method:\n' + p.method.map((m, i) => `${i + 1}. ${m}`).join('\n'), p.safety.length && 'Safety: ' + p.safety.join(' '), p.disposal && 'Disposal: ' + p.disposal,
        st.rows.some(r => !r.item && r.keep) && 'Not in our inventory (please source): ' + st.rows.filter(r => !r.item && r.keep).map(r => label(r.ai)).join(', '), '(Planned with AI from a teacher’s source.)'].filter(Boolean).join('\n\n');
      opts.onUse({ title: p.title || 'Untitled practical', topic: p.topic, sets: st.sets, kit, notes });
    };
  };

  parse(); draw();
}
