/* Loading screen: one of 20 small animated pieces of lab equipment, a different one each time.
   busy(promise, label) shows it while the promise runs. It appears only if the wait is longer than a
   moment (no flash on quick saves) and then stays long enough to be seen. */

const S = 'fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"';
const A = 'data-acc'; // accent-coloured fill (liquid, flame, …)

/** [name, inner SVG on a 64×64 canvas]. Animations are CSS classes in app.css (.ld-*). */
export const SCENES = [
  ['Beaker', `<path ${S} d="M18 12v38a4 4 0 0 0 4 4h20a4 4 0 0 0 4-4V12M14 12h36"/><path ${A} d="M20 32h24v18a2 2 0 0 1-2 2H22a2 2 0 0 1-2-2z"/>
    <circle class="ld-rise" cx="26" cy="46" r="2.2" ${A}/><circle class="ld-rise d2" cx="34" cy="48" r="1.8" ${A}/><circle class="ld-rise d3" cx="39" cy="45" r="1.5" ${A}/>`],
  ['Test tube', `<g transform="rotate(20 32 32)"><rect x="24" y="6" width="16" height="52" rx="8" ${S}/><rect class="ld-fill" x="26.5" y="22" width="11" height="33" rx="5.5" ${A}/></g>`],
  ['Conical flask', `<path ${S} d="M26 8h12M28 8v16L14 52a3 3 0 0 0 3 4h30a3 3 0 0 0 3-4L36 24V8"/><path class="ld-swirl" ${A} d="M20 42h24l5 10a2 2 0 0 1-2 3H17a2 2 0 0 1-2-3z"/>
    <circle class="ld-rise" cx="29" cy="48" r="1.8" ${A}/><circle class="ld-rise d2" cx="36" cy="50" r="1.5" ${A}/>`],
  ['Bunsen burner', `<path ${S} d="M28 30h8v20h-8zM20 54h24M24 50h16"/><path class="ld-flame" ${A} d="M32 6c5 7 8 11 8 16a8 8 0 0 1-16 0c0-5 3-9 8-16z"/><path class="ld-flame d2" d="M32 15c2.5 4 4 6 4 9a4 4 0 0 1-8 0c0-3 1.5-5 4-9z" fill="var(--surface)"/>`],
  ['Magnet', `<path ${S} d="M14 10v20a18 18 0 0 0 36 0V10"/><path d="M14 10h8v8h-8zM42 10h8v8h-8z" ${A}/><path ${S} d="M22 10v20a10 10 0 0 0 20 0V10"/><circle class="ld-pull" cx="32" cy="58" r="4" ${A}/>`],
  ['Microscope', `<path ${S} d="M18 56h30M26 56v-6h18M38 50a12 12 0 0 0-6-20"/><g class="ld-focus"><path ${S} d="M24 8l8 3-7 18-8-3z"/><path ${S} d="M21 28l-2 5"/></g><circle class="ld-glow" cx="19" cy="38" r="2.5" ${A}/><path ${S} d="M12 42h16"/>`],
  ['Pendulum', `<path ${S} d="M14 8h36"/><g class="ld-swing"><path ${S} d="M32 8v34"/><circle cx="32" cy="46" r="6" ${A}/></g>`],
  ['Atom', `<circle cx="32" cy="32" r="4" ${A}/><g class="ld-spin"><ellipse ${S} cx="32" cy="32" rx="24" ry="9"/><circle cx="56" cy="32" r="2.6" ${A}/></g>
    <g class="ld-spin d2"><ellipse ${S} cx="32" cy="32" rx="24" ry="9" transform="rotate(60 32 32)"/></g><g class="ld-spin d3"><ellipse ${S} cx="32" cy="32" rx="24" ry="9" transform="rotate(120 32 32)"/></g>`],
  ['DNA', [0, 1, 2, 3, 4, 5, 6].map(i => `<g class="ld-twist" style="animation-delay:${-i * 0.18}s;transform-origin:32px ${10 + i * 7.3}px"><path ${S} d="M18 ${10 + i * 7.3}h28"/><circle cx="18" cy="${10 + i * 7.3}" r="2.4" ${A}/><circle cx="46" cy="${10 + i * 7.3}" r="2.4" fill="currentColor"/></g>`).join('')],
  ['Thermometer', `<path ${S} d="M27 40V12a5 5 0 0 1 10 0v28a9 9 0 1 1-10 0z"/><circle cx="32" cy="47" r="5.5" ${A}/><rect class="ld-temp" x="30" y="14" width="4" height="32" rx="2" ${A}/><path ${S} d="M40 16h4M40 24h4M40 32h4"/>`],
  ['Pipette', `<path ${S} d="M32 4v8M28 12h8l-1 26-3 8-3-8z"/><rect x="27" y="4" width="10" height="7" rx="3" ${A}/><path class="ld-drop" ${A} d="M32 48c2 3 3 4.5 3 6a3 3 0 0 1-6 0c0-1.5 1-3 3-6z"/><path ${S} d="M20 60h24"/>`],
  ['Balance', `<path ${S} d="M32 12v40M22 56h20"/><g class="ld-tip"><path ${S} d="M12 16h40"/><path ${S} d="M14 16l-6 14h12zM50 16l-6 14h12z"/><path d="M8 30h12M44 30h12" ${S}/><circle cx="14" cy="26" r="3" ${A}/></g><circle cx="32" cy="12" r="2.5" ${A}/>`],
  ['Spring', `<path ${S} d="M16 6h32"/><g class="ld-bounce-spring"><path ${S} d="M32 6v4l-8 3 16 5-16 5 16 5-16 5 8 3v3"/></g><rect class="ld-bounce-mass" x="24" y="40" width="16" height="12" rx="2" ${A}/>`],
  ['Magnifying glass', `<path ${S} d="M10 52c10-4 34-4 44 0"/><path d="M22 46c0-6 4-10 8-10-1 5-3 8-8 10z" ${A}/><g class="ld-scan"><circle ${S} cx="30" cy="26" r="10"/><path ${S} d="M37 33l9 9"/></g>`],
  ['Light bulb', `<path class="ld-glow" ${A} d="M32 8a14 14 0 0 0-8 25c2 2 3 4 3 7h10c0-3 1-5 3-7a14 14 0 0 0-8-25z"/><path ${S} d="M32 8a14 14 0 0 0-8 25c2 2 3 4 3 7h10c0-3 1-5 3-7a14 14 0 0 0-8-25zM27 46h10M28 51h8"/>
    <g class="ld-rays"><path ${S} d="M32 0v2M8 22H5M59 22h-3M14 6l2 2M50 6l-2 2"/></g>`],
  ['Seedling', `<path ${S} d="M14 56h36M20 56l2-8h20l2 8"/><g class="ld-grow"><path ${S} d="M32 48V24"/><path class="ld-leaf" ${A} d="M32 32c-10 0-14-6-14-12 8 0 14 4 14 12z"/><path class="ld-leaf d2" ${A} d="M32 26c8 0 12-5 12-10-7 0-12 3-12 10z"/></g>`],
  ['Centrifuge', `<rect ${S} x="10" y="10" width="44" height="44" rx="10"/><g class="ld-spin fast"><path ${S} d="M32 18v28M18 32h28"/><circle cx="32" cy="18" r="3.5" ${A}/><circle cx="32" cy="46" r="3.5" ${A}/><circle cx="18" cy="32" r="3.5" fill="currentColor"/><circle cx="46" cy="32" r="3.5" fill="currentColor"/></g><circle cx="32" cy="32" r="3" fill="currentColor"/>`],
  ['Petri dish', `<ellipse ${S} cx="32" cy="34" rx="24" ry="14"/><ellipse ${S} cx="32" cy="30" rx="24" ry="14"/>`
    + [[22, 28], [36, 24], [42, 33], [28, 36], [33, 30], [18, 33]].map(([x, y], i) => `<circle class="ld-colony" style="animation-delay:${i * 0.25}s" cx="${x}" cy="${y}" r="${2 + (i % 3)}" ${A}/>`).join('')],
  ['Battery', `<rect ${S} x="8" y="20" width="44" height="24" rx="4"/><path d="M53 27h4v10h-4z" fill="currentColor"/>`
    + [0, 1, 2, 3].map(i => `<rect class="ld-charge" style="animation-delay:${i * 0.3}s" x="${12 + i * 10}" y="24" width="8" height="16" rx="1.5" ${A}/>`).join('')],
  ['Oscilloscope', `<rect ${S} x="6" y="12" width="52" height="38" rx="4"/><path ${S} d="M20 56h24"/><clipPath id="ldclip"><rect x="10" y="16" width="44" height="30"/></clipPath>
    <g clip-path="url(#ldclip)"><path class="ld-wave" d="M-12 31q5.5-12 11 0t11 0 11 0 11 0 11 0 11 0 11 0 11 0" fill="none" stroke="var(--pri)" stroke-width="2.4" stroke-linecap="round"/></g>`]
];

const LINES = { bootstrap: 'Loading the practicals…', login: 'Signing in…', changePassword: 'Saving your password…', logout: 'Signing out…' };
export const labelFor = action => LINES[action] || 'Saving…';

function pick() {
  let last = -1; try { last = Number(sessionStorage.getItem('sp_loader')); } catch (e) {}
  let i = Math.floor(Math.random() * SCENES.length); if (i === last) i = (i + 1) % SCENES.length;
  try { sessionStorage.setItem('sp_loader', String(i)); } catch (e) {}
  return i;
}
export const sceneSVG = i => `<svg viewBox="0 0 64 64" width="72" height="72" aria-hidden="true">${SCENES[i][1]}</svg>`;

let open = 0, node = null, timer = null, removeT = null, shownAt = 0;
const SHOW_AFTER = 250, MIN_SHOWN = 700;

function show(label) {
  clearTimeout(removeT);
  if (node) { node.querySelector('.ld-label').textContent = label; return; }
  const i = pick();
  node = document.createElement('div'); node.className = 'loader'; node.setAttribute('role', 'status'); node.setAttribute('aria-live', 'polite');
  node.innerHTML = `<div class="ld-card"><div class="ld-art">${sceneSVG(i)}</div><div class="ld-label">${label}</div><div class="ld-name">${SCENES[i][0]}</div><div class="ld-bar"><i></i></div></div>`;
  document.body.appendChild(node); shownAt = Date.now();
}
function hide() {
  if (!node) return;
  removeT = setTimeout(() => { if (open === 0 && node) { node.remove(); node = null; } }, Math.max(0, MIN_SHOWN - (Date.now() - shownAt)));
}

/** Show the loader while `promise` runs. */
export async function busy(promise, label = 'Loading…') {
  open++;
  if (node) show(label); else if (open === 1) { clearTimeout(timer); timer = setTimeout(() => show(label), SHOW_AFTER); }
  try { return await promise; }
  finally { open--; if (open === 0) { clearTimeout(timer); hide(); } }
}
