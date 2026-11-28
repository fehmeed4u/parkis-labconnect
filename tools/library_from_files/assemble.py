import sys, os, re, json
HERE=os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
sys.path.insert(1, os.path.join(HERE, '..'))
from parse2 import parse as _parse, text, rel
from cie import parse_cie
JUNK = re.compile(r'^(IB CHEMISTRY( PRACTICAL)?|(IGCSE CHEMISTRY )?PRACTICAL ACTIVITIES|PaRK|PARK INTERNATIONAL|INTERNATIONAL|SCHOOL|\d{1,3})$|©|All Rights Reserved|www\.|https?://', re.I)
def _clean(r):
    for key in ('method', 'safety', 'prep'):
        r[key] = [l for l in r[key] if not JUNK.search(l.strip())]
    r['kit'] = [k for k in r['kit'] if not JUNK.search(k['name'].strip()) and not k['name'].strip().endswith('?')]
    return r
def parse(i):
    if '9700_Practical_booklet' in rel(i):
        r = parse_cie(i); r.update({'title': '', 'sets': '', 'flags': []}); return _clean(r)
    return _clean(_parse(i))
from extract import is_req
from groups import G as _G
from extract import IDX
_IX = {x['rel']: n for n, x in enumerate(IDX)}
for _g in _G:
    for _p in _g[4]:
        if _p not in _IX: print('missing file (check groups.py):', _p, file=sys.stderr)
G = [(t, g, c, s, [_IX[p] for p in files if p in _IX]) for t, g, c, s, files in _G]
import build_library as BL
from alias import alias
from alias import INVL
INV = BL.Inventory(INVL)
SHARED = re.compile(r'for (the )?class|to share|shared|demo|per class|class (set|items?)|teacher', re.I)

def num(s):
    m = re.search(r'(\d+(?:\.\d+)?)', s); return float(m.group(1)) if m else None

def kit_item(k):
    name = re.sub(r'^\s*(?:[*•·▪●◦\-–]|\d+[.)])\s*', '', k['name']).strip(' ,;:')
    name = re.sub(r'\s+', ' ', name)
    name = re.sub(r'^\(?[a-z]\)\s+', '', name)
    name = re.sub(r'^/\s*', '', re.sub(r'\s*\[[A-Z]\]', '', name)).strip()
    W = {'one':1,'two':2,'three':3,'four':4,'five':5,'six':6,'ten':10}
    mw = re.match(r'^(one|two|three|four|five|six|ten)\s+(.+)$', name, re.I)
    if mw: name = str(W[mw.group(1).lower()]) + ' ' + mw.group(2)
    name = re.sub(r'^(\d{1,2})(?=[A-Za-z]{3})', r'\1 ', name)
    if not name or len(name) < 2: return None
    if re.search(r'^(ib chemistry|practical activities|activities|for group|comments?|task|additional information|enzyme activity|ib chemistry practical|materials? \(?per group\)?|equipment list|quantity|per group|class set)\b', name, re.I) and len(name) < 40: return None
    if re.fullmatch(r'[\d\s.,/-]+', name): return None
    if (name[:1].islower() and len(name.split()) > 4) or re.search(r'\b(can be|should be|needs to|will be|must be|is used|are used)\b', name) and len(name.split()) > 6: return None
    if re.match(r'^option \d', name, re.I): return None
    if re.match(r'^(n/?a|none|-+|see (method|comments?|exam question)|optional|materials?|reagents?|equipment|chemicals?)$', name, re.I): return None
    per, fixed, conc, vol, notes = None, bool(SHARED.search(k.get('section') or '')), '', '', []
    m = re.match(r'^(\d{1,2})\s*(?:x|×)\s*(.+)$', name, re.I) or re.match(r'^(\d{1,2})\s+(?!(?:m|cm|mm|ml|g|kg|v|w|cm3|cm³|mL|M|%|V)\b)(.+)$', name)
    if m: per, name = int(m.group(1)), m.group(2).strip()
    m = re.match(r'^(.+?)\s*[x×]\s*(\d{1,2})$', name, re.I)
    if m: name, per = m.group(1).strip(), int(m.group(2))
    q = (k.get('qty') or '').strip().rstrip(',').strip()
    if re.fullmatch(r'\d{1,3}', q): per = int(q)
    elif q:
        mv = re.match(r'^~?\s*(\d+(?:\.\d+)?)\s*(cm3|cm³|ml|mL|cm 3)\b', q, re.I)
        ml = re.match(r'^~?\s*(\d+(?:\.\d+)?)\s*(l|dm3|dm³)\b', q, re.I)
        mi = re.match(r'^(\d{1,2})\s*(sets?|pairs?|each|per group|of each|x)?\s*$', q, re.I)
        if mv: vol = num(mv.group(1)) if '.' in mv.group(1) else int(mv.group(1))
        elif ml: vol = int(float(ml.group(1)) * 1000)
        elif mi: per = int(mi.group(1))
        elif re.search(r'class|whole|share|teacher|demo', q, re.I): fixed = True; notes.append(q)
        elif re.match(r'^\d+\s*[–-]\s*\d+', q): per = int(re.match(r'^\d+', q).group()); notes.append(q)
        else:
            m2 = re.match(r'^(\d{1,2})\b', q)
            if m2 and not re.match(r'^\d+\s*(g|mg|kg|cm|mm|m|ml|drops?|%)', q, re.I): per = int(m2.group(1)); rest = q[len(m2.group(1)):].strip(' ,x×(')
            else: rest = q
            if rest: notes.append(rest.strip(') '))
    mc = re.search(r'(\d+(?:\.\d+)?)\s*(M|mol\s*dm-?3|mol/dm3|mol dm⁻³)\b', name)
    if mc: conc = mc.group(1) + ' M'
    else:
        mp = re.search(r'(\d+(?:\.\d+)?)\s*%', name)
        if mp and re.search(r'solution|glucose|sucrose|starch|protein|salt|acid|ethanol|peroxide|suspension|lactose|fructose|chloride|sugar|amylase|trypsin|enzyme', name, re.I): conc = mp.group(1) + ' %'
    com = (k.get('comment') or '').strip()
    if com and not re.fullmatch(r'[\d\s.,]+', com) and com.lower() not in name.lower(): notes.append(com)
    note = '; '.join(n for n in notes if n and len(n) < 90)
    if note: name = f'{name} ({note})'
    it = {'itemId': '', 'name': name[:160], 'perGroup': per if per and 0 < per <= 60 else 1}
    if fixed: it['fixed'] = True
    if conc: it['conc'] = conc
    if vol: it['vol'] = vol
    hit = alias(name)
    if hit is None: hit = INV.match(re.sub(r'\(.*?\)', '', name))
    if hit: it['itemId'] = hit['id']; it['_inv'] = hit['name']
    return it

SUB = re.compile(r'^(part\s+[a-z0-9]+|experiment\s*\d+|activity\s*\d+|station\s*\d+|demo\s*\d*|practical\b|test for|investigation|method\s*\d|[A-D]\)|\([a-d]\)|[a-d]\)\s|section\b)', re.I)
def unwrap(lines):
    out = []
    for l in lines:
        l = re.sub(r'\s+', ' ', l).strip()
        if not l: continue
        if out and (l[0].islower() or (not re.search(r'[.:;!?)]$', out[-1]) and not re.match(r'^(\d{1,2}\s*[.)]|[•·▪●◦\-–]|\(?[a-z]\)\s|For |Option|Part|Experiment|Step)', l) and len(out[-1]) > 45)):
            out[-1] += ' ' + l
        else: out.append(l)
    res = []
    for l in out: res += [x for x in re.split(r'\s(?=\d{1,2}\.\s+[A-Z])', l) if x.strip()]
    return res
def fmt_method(lines, pdf=False):
    out, n = [], 0
    lines = unwrap(lines) if pdf else [re.sub(r'\s+', ' ', l).strip() for l in lines if l and l.strip()]
    already = sum(1 for l in lines if re.match(r'^\d+\s*[.)]\s*\S', l)) >= max(2, len(lines) // 3)
    for l in lines:
        l = re.sub(r'^[•·▪●◦\-–]\s*', '', l)
        l = re.sub(r'^step\s*\d+\s*[:.)-]?\s*', '', l, flags=re.I)
        if re.fullmatch(r'(example\s*[a-z]?|\d+)', l, re.I): continue
        if already: out.append(l); continue
        is_sub = (SUB.match(l) and len(l) < 90) or (l.endswith(':') and len(l) < 80) or (l.isupper() and len(l) < 80)
        if is_sub: out.append(('' if not out else '\n') + l); n = 0; continue
        n += 1; out.append(f'{n}. {l}')
    return '\n'.join(out).strip()

CONTROL = re.compile(r'^(wear|keep|do not|don.t|never|avoid|use|ensure|make sure|take care|always|handle|tie|wash|clean|carry|stand|check|switch|turn|place|work|dispose|allow|label|supervise|only|be careful|care|pupils|students|teacher|technicians?|the teacher)\b|must|should', re.I)
ACTION = re.compile(r'^(if|in case|in the event|spill|eyes?:|skin:|burns?:|cuts?:|first aid|seek|rinse)', re.I)
def risks_from(lines):
    hz, ct, ac = [], [], []
    for l in lines:
        l = re.sub(r'^[•·▪●◦\-–]\s*', '', re.sub(r'\s+', ' ', l)).strip()
        if not l or len(l) < 4: continue
        if re.match(r'^(hazard information|required ppe|safety precautions|ventilation|disposal instructions|safety information( and measures)?)\s*:?$', l, re.I): continue
        if ACTION.match(l): ac.append(l)
        elif CONTROL.search(l) and not re.search(r'hazcard\s*\d', l, re.I): ct.append(l)
        else: hz.append(l)
    if not (hz or ct or ac): return []
    return [{'key': 'own:sheet', 'source': 'From the practical sheet', 'hazard': '\n'.join(hz) or 'See the safety notes on the practical sheet.', 'control': '\n'.join(ct), 'action': '\n'.join(ac), 'edited': True}]

def build(gi):
    title, grade, course, subj, files = G[gi]
    reqs, protos = [], []
    for i in files:
        p = parse(i); p['i'] = i
        (reqs if rel(i).endswith('.docx') and is_req(i) else protos).append(p)
    kit_src = [r for r in reqs if r['kit']] or [p for p in protos if p['kit']][:1]
    raw = []
    for r in kit_src:
        for k in r['kit']:
            nm = k['name']
            if re.match(r'^(practical|experiment|station|part)\s*\d+\s*(—|-|:|–)', nm, re.I) and ' / ' not in nm: continue
            sep = r'\s*[▪•●]\s*|\s+/\s+' if (' / ' in nm and len(nm) > 40) else r'\s*[▪•●]\s*'
            parts = [x.strip() for x in re.split(sep, nm) if x.strip() and not re.match(r'^experiment \d+:?$', x.strip(), re.I)]
            raw += [k] if len(parts) == 1 else [dict(k, name=x) for x in parts]
    kit, seen = [], set()
    for k in raw:
        it = kit_item(k)
        if not it: continue
        key = re.sub(r'[^a-z0-9]', '', it['name'].lower())
        if key in seen: continue
        seen.add(key); kit.append(it)
    pm = sorted([p for p in protos if len(p['method']) >= 3], key=lambda p: not rel(p['i']).endswith('.docx'))
    rm = [r for r in reqs if len(' '.join(r['method'])) > 60 and not re.search(r'^see (exam|the|attached)', ' '.join(r['method']), re.I)]
    from collections import Counter
    shared = Counter(i for g in G for i in g[4])
    if any(shared[p['i']] > 1 for p in pm) and rm: pm = []
    msrc = pm[:1] or rm[:1] or [p for p in protos + reqs if p['method']][:1]
    method = fmt_method(msrc[0]['method'], rel(msrc[0]['i']).lower().endswith('.pdf')) if msrc else ''
    safety = [l for p in protos + reqs for l in p['safety']]
    prep = [l for p in protos + reqs for l in p['prep']]
    flags = sorted(set(f for r in reqs for f in r['flags']))
    sets = next((r['sets'] for r in reqs if r['sets']), '')
    return {'gi': gi, 'title': title, 'grade': grade, 'subject': subj, 'course': course,
            'kit': kit, 'method': method, 'safety': safety, 'prep': prep, 'flags': flags, 'sets': sets,
            'kitFrom': rel(kit_src[0]['i']) if kit_src else '', 'methodFrom': rel(msrc[0]['i']) if msrc else '',
            'files': [rel(i) for i in files]}
if __name__ == '__main__':
    out = [build(gi) for gi in range(len(G))]
    json.dump(out, open(os.path.join(HERE, 'built.json'), 'w'), ensure_ascii=False, indent=1)
    for b in out:
        print(f"## {b['gi']} {b['title']} [{b['course']} {b['grade']} {b['subject']}] sets={b['sets']!r}")
        print('  KIT:', ' ; '.join(f"{k['perGroup']}×{k['name']}{'*' if k.get('fixed') else ''}{'' if k['itemId'] else '?'}" for k in b['kit'])[:900])
        print('  METHOD:', b['method'][:350].replace('\n', ' ⏎ '), f'…[{len(b["method"])}]')
        if b['safety']: print('  SAFETY:', ' | '.join(b['safety'])[:250])
        if b['prep']: print('  PREP:', ' | '.join(b['prep'])[:200])
