// Solutions and risk assessment: which recipe makes a chemical, how much to weigh or measure, and the risk rows a practical needs.
// Recipes (db.recipes) and risk cards (db.riskcards) live in the Google Sheet — they come from the school's own CLEAPSS
// Recipe Sheets and Hazcards, which are for members only and so are not in this repository.
import { esc } from './logic.js';

/* ---------- name matching (the same rules as the SDS matching in apps-script/Code.gs) ---------- */
const SYN = [['ethanoic acid', 'acetic acid'], ['propanone', 'acetone'], ['ethyl ethanoate', 'ethyl acetate'], ['methanoic acid', 'formic acid'],
  ['sodium hydrogencarbonate', 'sodium bicarbonate'], ['sodium chlorate(i)', 'sodium hypochlorite'], ['calcium hydroxide solution', 'limewater'],
  ['iodine solution', 'lugol solution'], ['diastase', 'amylase'], ['dcpip', 'dichlorophenolindophenol'], ['copper(ii) sulfate', 'copper sulfate']];
export function nameBase(name) {
  let s = String(name || '').toLowerCase().replace(/_/g, ' ').replace(/sulph/g, 'sulf').replace(/aluminum/g, 'aluminium')
    .replace(/chlorate\s*\(\s*i\s*\)/g, 'hypochlorite').replace(/manganate\s*\(\s*vii\s*\)/g, 'permanganate').replace(/sulfate\s*\(\s*iv\s*\)/g, 'sulfite');
  s = s.replace(/(ic|ous|ate|ite)\s*\(\s*(?:i|ii|iii|iv|v|vi|vii)\s*\)/g, '$1').replace(/\(\s*(i|ii|iii|iv|v|vi)\s*\)/g, ' $1 ');
  return s.replace(/\s+/g, ' ').trim();
}
const HYD = /\b(anhydrous|(mono|di|tri|tetra|penta|hexa|hepta|octa|deca|dodeca)?hydrated?)\b|-?\s*\d+\s*-?\s*water\b/g;
const NOISE = /\b(\d+([.,]\d+)?\s*(%|m|mol|g|ml|cm3)?|solid|solutions?|powder|granular|pellets|crystals?|concentrated|dilute|lump|chips|reagent|grade|pure)\b/g;
export const nameKey = (name, relaxed) => { let s = nameBase(name); if (relaxed) s = s.replace(HYD, ' ').replace(NOISE, ' '); return s.replace(/[^a-z0-9]/g, ''); };
const variants = name => { const out = [nameBase(name)]; SYN.forEach(([a, b]) => [[a, b], [b, a]].forEach(([x, y]) => { const bx = nameBase(x); if (out[0].includes(bx)) out.push(out[0].replace(bx, nameBase(y))); })); return out; };

/** The recipe (and the solute line in it) for an inventory chemical, or null. Exact names first, then without hydrate/grade words. */
export function recipeFor(db, item, fallbackName = '') {
  const recipes = db.recipes || []; if (!recipes.length) return null;
  const names = [item?.name || fallbackName, ...String(item?.altNames || '').split(/\s*[;|]\s*/)].filter(Boolean).flatMap(variants);
  for (const relaxed of [false, true]) {
    const keys = names.map(n => nameKey(n, relaxed)).filter(k => k.length > 3);
    for (const r of recipes) {
      // a solute line ("solid copper(II) sulfate(VI)-5-water") beats the recipe title
      const sol = (r.solutes || []).find(s => keys.includes(nameKey(String(s.what).replace(/^(solid|hydrated|anhydrous)\s+/i, ''), relaxed)));
      if (sol) return { recipe: r, solute: sol };
      if ((r.names || [r.title]).some(n => keys.includes(nameKey(n, relaxed)))) return { recipe: r, solute: (r.solutes || [])[0] || null };
    }
  }
  return null;
}

/* ---------- amounts ---------- */
/** "0.1 M", "1 mol/dm3", "2%", "10 g/dm3" → { value, unit: 'M' | '%' | 'g/dm3' } or null. */
export function parseConc(s) {
  const m = String(s || '').replace(',', '.').match(/(\d*\.?\d+)\s*(m\b|mol\s*\/?\s*(?:dm-?3|dm³|l)|mol\s*dm|%|g\s*\/\s*(?:dm-?3|dm³|l))/i);
  if (!m) return null;
  const u = m[2].toLowerCase(); return { value: Number(m[1]), unit: u.startsWith('%') ? '%' : u.startsWith('g') ? 'g/dm3' : 'M' };
}
/** "50 cm3", "50 ml", "0.5 dm3" per group → cm³ (number) or 0. */
export function parseVol(s) {
  const m = String(s || '').replace(',', '.').match(/(\d*\.?\d+)\s*(cm3|cm³|ml|mL|dm3|dm³|l\b|L\b)?/); if (!m) return 0;
  const n = Number(m[1]); return /dm|^l$/i.test(m[2] || '') ? n * 1000 : n;
}
const FLASKS = [50, 100, 250, 500, 1000, 2000, 2500, 5000];
/** What to make up: the next standard flask size above what's needed plus ~10 % for spills and rinsing. */
export const makeUpVolume = need => need <= 0 ? 0 : FLASKS.find(f => f >= need * 1.1) || Math.ceil(need * 1.1 / 1000) * 1000;
const r2 = n => n >= 100 ? Math.round(n) : n >= 10 ? Math.round(n * 10) / 10 : Math.round(n * 100) / 100;

/**
 * Plan for one chemical on a request: kit line k = { itemId, name, conc, vol (cm³ per group) }, `sets` groups.
 * → { item, conc, need, makeUp, recipe, solute, amount, unit, how, dilute } — amount is null when the recipe has no table for it.
 */
export function solutionPlan(db, k, sets) {
  const item = db.inventory.find(i => i.id === k.itemId) || null;
  const conc = parseConc(k.conc), need = (Number(k.vol) || 0) * (Number(sets) || 0), makeUp = makeUpVolume(need);
  const rf = recipeFor(db, item, k.name);
  const out = { item, conc, need, makeUp, recipe: rf?.recipe || null, solute: rf?.solute || null, amount: null, unit: '', how: '', dilute: false };
  if (!conc || !makeUp) return out;
  if (conc.unit === '%' ) { out.amount = r2(conc.value * makeUp / 100); out.unit = 'g'; out.how = `Dissolve ${out.amount} g in water and make up to ${makeUp} cm³ (${conc.value} % w/v).`; return out; }
  if (conc.unit === 'g/dm3') { out.amount = r2(conc.value * makeUp / 1000); out.unit = 'g'; out.how = `Dissolve ${out.amount} g in water and make up to ${makeUp} cm³.`; return out; }
  const s = rf?.solute; if (!s || !(Number(s.perMolarPerLitre) > 0)) return out;
  const amt = Number(s.perMolarPerLitre) * conc.value * makeUp / 1000;
  out.amount = r2(amt); out.unit = s.unit === 'cm3' ? 'cm³' : 'g';
  out.dilute = amt < 1; // tiny amounts: easier to dilute a stronger solution
  out.how = s.unit === 'cm3'
    ? `Add ${out.amount} cm³ of ${s.what} to about two-thirds of ${makeUp} cm³ of water, stir, then make up to ${makeUp} cm³.`
    : `Weigh ${out.amount} g of ${s.what}, dissolve in about two-thirds of ${makeUp} cm³ of water, then make up to ${makeUp} cm³.`;
  if (out.dilute) out.how += ` (That is a very small amount: it is easier to make a 10× stronger solution and dilute 1 in 10.)`;
  return out;
}

/* ---------- risk assessment ---------- */
/** Activities a practical can involve. Picked up from words in the title, method and kit, or ticked by the teacher. */
export const ACTIVITIES = [
  { id: 'glass', label: 'Glassware (always)', always: true, words: [],
    hazard: 'Broken glass can cut hands.', control: 'Check glassware for cracks before use. Do not overfill. Carry one item at a time.', action: 'Do not pick up broken glass by hand — tell the teacher; use the brush and dustpan and the glass bin. Cuts: rinse, apply pressure, first aid.' },
  { id: 'heating', label: 'Heating with a Bunsen burner', words: ['bunsen', 'heat', 'burner', 'flame', 'tripod', 'gauze', 'boil'],
    hazard: 'Burns from flames, hot apparatus and hot liquids; hair or clothing catching fire.', control: 'Tie back long hair and loose clothing. Use the safety (yellow) flame when not heating. Stand up, never leave the flame. Use tongs; let apparatus cool before touching. Point boiling tubes away from people.', action: 'Burns: cool under cold running water for at least 10 minutes. Fire: turn off the gas; smother small fires with a fire blanket. Tell the teacher.' },
  { id: 'hotwater', label: 'Hot water / water bath / kettle', words: ['water bath', 'kettle', 'hot water', 'boiling water', 'beaker of hot'],
    hazard: 'Scalds from hot water and steam.', control: 'Stand while working. Keep kettles and water baths at the back of the bench, cables tidy. Do not carry beakers of very hot water across the room.', action: 'Scald: cool under cold running water for at least 10 minutes; tell the teacher.' },
  { id: 'titration', label: 'Titration', words: ['titration', 'titrate', 'burette', 'pipette'],
    hazard: 'Splashes of acid or alkali in the eyes or on the skin; burette falling; pipette filler misuse.', control: 'Wear eye protection. Fill the burette below eye level, using a small funnel removed after filling. Clamp the burette securely. Use a pipette filler — never mouth pipette.', action: 'Eyes: rinse with water for 10 minutes, tell the teacher. Skin: rinse with water. Wipe up small spills with a damp cloth.' },
  { id: 'electricity', label: 'Low-voltage electricity', words: ['circuit', 'voltage', 'power supply', 'power pack', 'battery', 'cell', 'resistor', 'ammeter', 'voltmeter', 'electrolysis', 'lamp'],
    hazard: 'Hot wires or resistors; short circuits; mains-powered packs.', control: 'Use low-voltage supplies only (≤ 12 V). Switch off before changing the circuit. Do not touch resistors or wires that may be hot. Keep water away from mains plugs.', action: 'Switch off at the supply. Burns: cool under cold running water. Report damaged leads or packs.' },
  { id: 'electrolysis', label: 'Electrolysis (gases)', words: ['electrolysis', 'electrolyse', 'electrode'],
    hazard: 'Chlorine or other gases released at the electrodes; solutions may be irritant.', control: 'Run only for the time needed, in a well-ventilated room (or fume cupboard for chlorine). Low voltage only. Wear eye protection.', action: 'Anyone affected by gas: move to fresh air, tell the teacher. Rinse splashes with water.' },
  { id: 'dissection', label: 'Dissection / sharp tools', words: ['dissect', 'scalpel', 'heart', 'eye', 'kidney', 'lung', 'organ', 'blade', 'cork borer'],
    hazard: 'Cuts from scalpels, blades and cork borers; contamination from animal tissue.', control: 'Cut away from the body on a board; carry sharps point-down; count sharps out and in. Wear gloves if needed; wash hands afterwards; disinfect surfaces.', action: 'Cuts: rinse, apply pressure, first aid, record it. Dispose of tissue as clinical/food waste as instructed.' },
  { id: 'micro', label: 'Microbiology', words: ['bacteria', 'agar', 'culture', 'petri', 'yeast', 'microb', 'incubat', 'inoculat', 'e. coli', 'e.coli'],
    hazard: 'Growth of harmful microorganisms; contamination.', control: 'Use aseptic technique. Seal plates with two pieces of tape (not all round), incubate at ≤ 25 °C, never open after incubation. Wash hands. Disinfect benches before and after.', action: 'Spills of cultures: cover with disinfectant (e.g. Virkon) for 10–15 minutes, then wipe up. Autoclave or sterilise cultures before disposal.' },
  { id: 'enzymes', label: 'Enzymes / biological materials', words: ['enzyme', 'amylase', 'lipase', 'trypsin', 'pepsin', 'catalase', 'protease'],
    hazard: 'Enzyme powders and solutions can cause allergies and asthma; eye irritation.', control: 'Use dilute solutions made up by technicians. Do not raise dust or create sprays. Wear eye protection.', action: 'Eyes: rinse with water for 10 minutes. Breathing difficulties: fresh air and tell the teacher; check medical records.' },
  { id: 'flammable', label: 'Flammable liquids', words: ['ethanol', 'propanone', 'acetone', 'hexane', 'cyclohexane', 'methanol', 'propanol', 'butanol', 'ether', 'flammable', 'chromatography solvent'],
    hazard: 'Flammable vapour can catch fire.', control: 'No naked flames nearby (heat with a water bath, not a Bunsen). Use small volumes and keep bottles closed.', action: 'Fire: smother with a fire blanket or damp cloth; turn off gas. Skin/eyes: rinse with water.' },
  { id: 'gases', label: 'Gases produced', words: ['gas', 'hydrogen', 'oxygen', 'carbon dioxide', 'chlorine', 'ammonia', 'sulfur dioxide', 'collect'],
    hazard: 'Gases may be toxic, irritant or form explosive mixtures (hydrogen).', control: 'Use small amounts in a well-ventilated room; use a fume cupboard for toxic gases. Keep flames away from hydrogen except for the squeaky-pop test.', action: 'Anyone affected: move to fresh air, tell the teacher.' },
  { id: 'foodtests', label: 'Food tests', words: ['food test', 'benedict', 'biuret', 'iodine', 'emulsion', 'reducing sugar'],
    hazard: 'Hot water bath (Benedict’s); irritant reagents; food allergies.', control: 'Heat Benedict’s tests in a water bath, not a flame. Wear eye protection. Do not eat any food in the lab; check allergies (e.g. nuts).', action: 'Eyes: rinse with water for 10 minutes. Scalds: cold water for 10 minutes.' },
  { id: 'light', label: 'Lasers / bright light / UV', words: ['laser', 'uv', 'ultraviolet', 'stroboscope'],
    hazard: 'Eye damage from lasers or UV; strobes can affect people with epilepsy.', control: 'Class 2 lasers only; never look into the beam or point at people. UV: shielded lamps, short exposure. Check for photosensitive epilepsy before using strobes.', action: 'Eye exposure: tell the teacher; seek medical advice if vision is affected.' },
  { id: 'radioactive', label: 'Radioactive sources', words: ['radioactive', 'geiger', 'alpha', 'beta', 'gamma', 'source', 'half-life'],
    hazard: 'Ionising radiation.', control: 'Teacher demonstration only, following the school’s local rules. Handle with tongs at arm’s length; keep exposure short; sign sources out and in.', action: 'Lost or damaged source: stop, keep everyone away, tell the Radiation Protection Supervisor.' },
  { id: 'fieldwork', label: 'Fieldwork / outdoors', words: ['fieldwork', 'field', 'outdoor', 'pond', 'quadrat', 'sampling', 'stream', 'soil'],
    hazard: 'Slips, trips, water, weather, plants and animals, getting lost.', control: 'Brief students on boundaries and behaviour; suitable clothing; supervision ratios; check the site beforehand; wash hands after handling soil or water.', action: 'First aid kit and phone on site. Report any injury; follow the school’s off-site procedures.' },
  { id: 'animals', label: 'Living organisms', words: ['woodlice', 'maggot', 'animal', 'insect', 'worm', 'daphnia', 'plants', 'seeds', 'pollen'],
    hazard: 'Allergies, bites, stings; harm to the animals.', control: 'Handle gently and briefly; return animals to their habitat. Wash hands afterwards. Check for allergies (e.g. pollen, latex).', action: 'Bites or stings: first aid and tell the teacher. Allergic reaction: follow the student’s care plan.' },
  { id: 'cold', label: 'Very cold materials', words: ['dry ice', 'liquid nitrogen', 'ice bath', 'freezing'],
    hazard: 'Cold burns; asphyxiation from carbon dioxide or nitrogen in small rooms.', control: 'Insulated gloves and tongs; ventilated room; small amounts; teacher handles dry ice.', action: 'Cold burns: warm gently with tepid water; tell the teacher.' }
];

const GENERAL_CHEM = 'Wear eye protection. Use the lowest concentration and smallest amount that works. Label all solutions. Wash hands after the practical.';
/** The risk rows a practical needs right now: glassware, each hazcard in the kit, and each activity found or ticked. */
export function autoRisks(db, req) {
  const text = [req.title, req.method, ...(req.kit || []).map(k => k.name)].join(' ').toLowerCase();
  const rows = [];
  const found = w => new RegExp('(^|[^a-z])' + w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).test(text); // start of a word: "eye" is not in "Erlenmeyer"
  const acts = ACTIVITIES.filter(a => a.always || (req.activities || []).includes(a.id) || a.words.some(found));
  acts.forEach(a => rows.push({ key: 'act:' + a.id, source: a.label, hazard: a.hazard, control: a.control, action: a.action }));
  const codes = new Set(); (req.kit || []).forEach(k => (db.inventory.find(i => i.id === k.itemId)?.hazcards || []).forEach(c => codes.add(c)));
  [...codes].forEach(code => {
    const card = (db.riskcards || []).find(c => c.code === code), hz = (db.hazcards || []).find(h => h.code === code);
    const uses = (req.kit || []).filter(k => (db.inventory.find(i => i.id === k.itemId)?.hazcards || []).includes(code)).map(k => k.name.replace(/ — not in our inventory$/, '')).join(', ');
    const list = x => Array.isArray(x) ? x : x ? String(x).split(/\n+/) : [];
    rows.push({ key: 'hz:' + code, source: `Hazcard ${code}${hz?.title ? ' · ' + hz.title : ''}`,
      hazard: `${uses}${card?.signal ? ' — ' + card.signal : ''}${card ? ': ' + (list(card.hazards).join('; ') || 'see the hazcard') : ': read Hazcard ' + code}`,
      control: card ? list(card.controls).join(' ') || GENERAL_CHEM : GENERAL_CHEM + ' Follow Hazcard ' + code + '.',
      action: card ? list(card.emergency).join(' ') || 'Follow standard procedures (see the Emergency Hazcards): eyes and skin — rinse with plenty of water; tell the teacher.' : 'Follow Hazcard ' + code + ' and the Emergency Hazcards.' });
  });
  return rows;
}
/** Keep what the teacher changed or added, add new automatic rows, drop automatic rows that no longer apply. */
export function mergeRisks(oldRows, auto, removed = []) {
  const old = oldRows || [];
  const out = auto.filter(a => !removed.includes(a.key)).map(a => { const o = old.find(x => x.key === a.key); return o && o.edited ? o : a; });
  return out.concat(old.filter(o => String(o.key).startsWith('own:'))); // rows the teacher added always stay
}

/** Read-only risk assessment table (prep sheet, preview). */
export function riskTable(rows) {
  if (!rows || !rows.length) return '<p class="muted small">No risk assessment recorded.</p>';
  return `<div class="scroll"><table class="tbl boxed risk"><thead><tr><th>Hazard (what could go wrong)</th><th>How to reduce the risk</th><th>If it happens</th></tr></thead><tbody>
    ${rows.map(r => `<tr><td>${r.source ? `<div class="kicker" style="margin:0 0 4px">${esc(r.source)}</div>` : ''}${esc(r.hazard)}</td><td>${esc(r.control)}</td><td>${esc(r.action)}</td></tr>`).join('')}</tbody></table></div>`;
}
