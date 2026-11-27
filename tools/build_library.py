#!/usr/bin/env python3
"""
Build the app's practical library from a Drive scan (apps-script/drive-practicals-scan).

    python3 tools/build_library.py SCAN.json INVENTORY.json OUT_DIR

Reads the JSON the Drive scan wrote, drops what isn't a practical (exam papers, mark schemes,
answers, rubrics, IA samples, purchase requests, templates…), merges the copies of the same
practical (Word + PDF + "(1)" + "old" + its requisition sheet), reads the equipment list
(requisition-sheet tables and "Equipment / Apparatus" sections), matches each item to the
inventory, and writes:

    OUT_DIR/library.json        → Admin › Import & export › Import › table "Library"
    OUT_DIR/library-review.csv  → one row per practical, with the files it came from
    OUT_DIR/excluded.csv        → every file that was left out, and why

The output holds school data: keep it in the private school-data folder, not in this repository.
"""
import csv, json, re, sys, unicodedata
from collections import defaultdict

# ---------------------------------------------------------------- what is not a practical
EXCLUDE = [
    (r'_files\b', 'saved web page'),
    (r'^\(function|^window\[', 'saved web page'),
    (r'question\s*paper|\bqp\b|_qp_|\bms\b|_ms_|mark\s*scheme|\bMS$', 'exam paper / mark scheme'),
    (r'\banswers?\b|coursebook|workbook', 'answers'),
    (r'guidance', 'teacher guidance (kept with the practical sheet)'),
    (r'rubric|checklist|grading\s*sheet|criteria', 'assessment rubric'),
    (r'\bIA\s*Eg|internal\s+assessment\s+sample|commentary|IA\s+drafts|example\s+feedback', 'IA sample'),
    (r'individual\s+investigation|extended\s+essay|\bIA\s*/\s*EE\b.*policy|lab\s*policy', 'IA / EE guidance'),
    (r'purchase\s*request|equipment\s*sign\s*out|equipment\s*list', 'ordering / equipment list'),
    (r'safety\s*(contract|agreement)|safety\s+and\s+compliance', 'safety contract'),
    (r'scheme\s+of\s+work|teaching\s+practical\s+skills|factsheet|managing-science-practicals|calendar', 'planning document'),
    (r'\[template\]|lab\s*template|lab\s*ideas|lab\s*tool\s*kit|resources\s+from|^master\b', 'template / ideas'),
    (r'\bresults\b|lab\s*report\s*student|writing\s+an?\b.*lab\s*report|examples$', 'results / report'),
    (r'designing\s+(an\s+investigation|methods)', 'skills lesson'),
    (r'virtual\s*lab|simulat|simulator', 'virtual lab'),
    (r'practical\s+(skills\s+)?assessment|experimental\s+and\s+calculation\s+questions|experimental\s+data', 'assessment'),
    (r'homework', 'student work'),
    (r'^\d*\s*worksheet$|practical\s+\d+\s+worksheet', 'worksheet without a practical name'),
    (r'\bIA\b|internal\s+assessment', 'IA guidance'),
    (r'practical\s*booklet\s*\d+\s*\(accompanies', 'booklet without a practical name'),
    (r'^(anatomy|chapter\s*\d+|stwaves|8 standing wave)$', 'not a practical sheet'),
]
EXCLUDE = [(re.compile(p, re.I), why) for p, why in EXCLUDE]
EXCLUDE_TYPES = {'Excel': 'spreadsheet', 'Text': 'text file'}

# ---------------------------------------------------------------- titles
FIXES = [  # this department's file-name shorthand and typos
    (r'\bDet\.? of\b', 'Determination of'), (r'\bVit\.?\s*C\b', 'vitamin C'), (r'\bChromat\b', 'Chromatography'), (r'\bsolv\b', 'solvent'),
    (r'\bEmp\.? formula\b', 'Empirical formula'), (r'\bsol$', 'solutions'), (r'\bSurfact\b', 'Surface'), (r'\bClorophyll\b', 'Chlorophyll'),
    (r'\bquantative\b', 'quantitative'), (r'\bSimspon\s*s\b', "Simpson's"), (r'\bchemiclas\b', 'chemicals'), (r'\bprac\b', 'practical'),
    (r'\bbenedicts?\b', "Benedict's"), (r'\bph\b', 'pH'), (r'\bColorimetery\b', 'Colorimetry'), (r'\bMicroscopes and magnification\b', 'Microscopes and magnification'),
    (r'\s+(exam\s+q|lab\s+handout|handout|lab\s+report\s+(teacher|student)|lab\s+method|method|v\d+|20\d\d)$', ''),
    (r'\s+(HL|SL|IB)$', ''), (r'^(II|NO|HL|SL)\s+', ''), (r'^practical\s+', ''), (r'\s+lab$', ''),
    (r'^ESS\s+(\d+\.\d+\s*:?\s*(systems\s*:\s*)?)?', ''), (r'\s*(Imagem relacionada|Resultado de imagem.*)$', ''),
    (r'(?<=[a-z])\s+(\d)$', ''), (r'\s*(\[[a-z]\])+', ''), (r'\baccelration\b', 'acceleration'), (r'\bChromotography\b', 'chromatography'),
    (r'^lab\s+', ''), (r'\s+p\d+\s+\w+$', ''), (r'\b(\w+) experiment \1$', r'\1 experiment'), (r'\s+Levers$', ''),
    (r'^Chemistry Paper 3 Term$', 'AS Paper 3 practice (Term 1)'),
]
FIXES = [(re.compile(a, re.I), b) for a, b in FIXES]
CANON = [  # titles that mean the same practical
    (r'^pH curves', 'pH curves for acid–alkali titrations'), (r'^(the )?decay of (beer )?(bubbles|foam)', 'Decay of beer foam'),
    (r'^(investigating factors that affect the )?resistance of a wire', 'Resistance of a wire'),
    (r'^investigating gas laws', "Investigating the gas laws (Boyle's law)"), (r'^(using a )?pendulum', 'Using a pendulum to measure g'),
    (r'^(measuring the )?speed of sound$', 'Measuring the speed of sound'), (r'^(halogen displacement|displacement reactions of halogens)', 'Displacement reactions of halogens'),
    (r'^determination of vitamin c', 'Determination of vitamin C content'),
    (r"^semi quantitative benedict", "Semi-quantitative Benedict's test and dilutions"), (r'^bio(logical)? ?molecules test|^testing for bio molecules', 'Testing for biological molecules'),
]
CANON = [(re.compile(a, re.I), b) for a, b in CANON]

def clean_title(t):
    t = unicodedata.normalize('NFKC', t or '').replace(' ́', "'").replace('´', "'").replace('_', ' ')
    t = re.sub(r'(?<=[A-Za-z])-(?=[A-Za-z])', ' ', t) if len(re.findall(r'[A-Za-z]-[A-Za-z]', t)) >= 2 else t   # Drag-Swimming-Pool
    t = re.sub(r'-{2,}', ' ', t)
    t = re.sub(r'^\s*copy of\s+', '', t, flags=re.I)
    t = re.sub(r'\s*\((\d+)\)\s*$', '', t)                                     # "(1)"
    t = re.sub(r'\s+(old|OLD)(\s*\(\d+\))?$', '', t)
    t = re.sub(r'\[template\]\s*', '', t, flags=re.I)
    t = re.sub(r'\s*-?\s*(protocol\s+by\s+\w+)(\s*-\s*answers)?\s*', ' ', t, flags=re.I)
    t = re.sub(r'\s*-\s*IB\s+Chemistry\s+Practical.*$', '', t, flags=re.I)
    t = re.sub(r'\b(practical\s+requisition(\s+sheet)?|requisition\s+sheet|prac(tical)?\s+request|request)\b', ' ', t, flags=re.I)
    t = re.sub(r'^\s*(igcse\s+)?lab\s*[.:]\s*', '', t, flags=re.I)
    t = re.sub(r'^\s*(a[\s-]?level|as|cie|ibdp|ib|dp\s*1?|dpchem|dp\s*\d?\s*bio|g1[12]\s+ib\s+phy|1[12]\s*(chem|phy|bio))\b\s*[-:]?\s*', '', t, flags=re.I)
    t = re.sub(r'\b(a[\s-]?level|cie|ibdp|alevel)\b', ' ', t, flags=re.I)
    t = re.sub(r'^\s*(bio\s+)?practical\s+\d+\s+', '', t, flags=re.I)
    t = re.sub(r'^\s*topic\s*[\d/]+\s*-\s*', '', t, flags=re.I)
    t = re.sub(r'^\s*\d+(\.\d+)?\s*[-.]?\s+(?=[A-Za-z])', '', t)              # "6 - ", "3 ", "2.1 "
    t = re.sub(r'^\s*[A-E]\d(\.\d+)?\s+', '', t)                              # "D2.3 "
    t = re.sub(r'\b(9700|9701|9702)\s+practical\s+booklet\s+\d+\s*', '', t, flags=re.I)
    t = re.sub(r'\s*\b(lab|practical|prac|experiment)\s*$', '', t, flags=re.I) if len(t.split()) > 2 else t
    t = re.sub(r'\s*-\s*$|^\s*-\s*', '', t)
    t = re.sub(r'\s{2,}', ' ', t).strip(' -:.')
    for rx, b in FIXES: t = rx.sub(b, t).strip(' -:.')
    for rx, b in CANON:
        if rx.search(t): t = b; break
    t = re.sub(r'\s{2,}', ' ', t).strip()
    t = ' '.join(w.capitalize() if len(w) > 3 and w.isupper() and not re.search(r'\d|DNA|DCPIP|TLC|PAG|UV|LED', w) else w for w in t.split())
    if re.match(r'^ph\b', t, re.I): return 'pH' + t[2:]
    return t[:1].upper() + t[1:] if t else t

def title_from_text(text):
    m = re.search(r'Practical Title\s*/\s*Reference:?\s*\n\s*\t?(.+?)\n\s*\t', (text or '').replace('\r', ''), re.S)
    if m:
        t = re.sub(r'\s+', ' ', m.group(1)).strip(' :')
        if 4 <= len(t) <= 100 and not re.match(r'^(number of sets|equipment)', t, re.I): return t
    raw = (text or '').replace('\r', '')
    m = re.search(r'Practical information sheet \d+\.\d+[^:\n]*:\s*([^\n]+)(?:\n([a-z][^\n]{0,60}))?', raw)
    if m:
        t = re.sub(r'\s+', ' ', m.group(1) + (' ' + m.group(2) if m.group(2) else '')).strip(' :.')
        if 4 <= len(t) <= 160: return t
    s = re.sub(r'\s+', ' ', text or '')
    for pat in [r'Practical information sheet \d+\.\d+\s*(?:\([a-z ]+\))?\s*:\s*(.{4,110}?)(?:\s+(?:In this practical|Safety|Apparatus|Introduction|Wear|Procedure|Method|You will|Equipment|Materials|Your teacher|This practical|Background|Aim)\b)',
                r'Practical booklet \d+\s+(.+?)\s+Introduction\b',
                r'Lab Protocol\s+(.+?)\s+Background\b']:
        m = re.search(pat, s)
        if m and 4 <= len(m.group(1)) <= 110:
            return m.group(1).strip(' :.')
    return None

STOP = set('a an the of and with in on to for by using use from at or its their your vs'.split())
GROUP_DROP = set('investigating investigation investigate determining determination measuring measurement '
                 'calculating finding lab practical prac experiment experiments hl sl ib dp protocol activity '
                 'sheet method worksheet'.split())

def group_key(title):
    w = re.findall(r'[a-z0-9]+', title.lower().replace("'", ''))
    w = [x[:-1] if len(x) > 4 and x.endswith('s') and not x.endswith('ss') else x for x in w]
    w = [x for x in w if x not in STOP and x not in GROUP_DROP and not re.fullmatch(r'\d', x)]
    return frozenset(w)

# ---------------------------------------------------------------- equipment
HEADER_RE = re.compile(r'^(chemicals?|apparatus(\s*/\s*equipment)?|equipment(\s*list)?|materials?|reagents?|per\s+(group|pair|student|bench)|'
                       r'quantity|qty|comments?|see\s+comments|item|amount|to\s+share|n/?a|-|none|for\s+class|teacher|student|'
                       r'equipment\s*/\s*chemicals?|apparatus\s*\(per\s+\w+\)|you\s+will\s+need|task)\s*:?$', re.I)
STOP_RE = re.compile(r'^(task|procedure|method|research\s+question|safety|risk|background|variables|instructions?|diagram|set\s*up|'
                     r'results|analysis|introduction|aim|hypothesis|practical\s+setup|demonstration\s+only)\b', re.I)

def norm_amount(a):
    return re.sub(r'\s+', ' ', a.replace('cm3', 'cm³')).strip()

def item(name, qty=None, note=None):
    name = re.sub(r'^\s*(?:[*•·▪●◦o\-–]|\(?[a-z]\)|\d+[.)])\s+', '', name or '').strip(' ,;:')
    name = re.sub(r'\[[a-z]\]', '', name).strip()
    m = re.match(r'^(\d{1,2})\s*(?:x|×)\s*(.+)$', name, re.I) or re.match(r'^(.+?)\s*\(?\s*(?:x|×)\s*(\d{1,2})\s*\)?$', name, re.I)
    per = 1
    if m:
        a, b = m.groups()
        if a.isdigit(): per, name = int(a), b
        else: name, per = a, int(b)
    if qty:
        q = str(qty).strip()
        if re.fullmatch(r'\d{1,3}', q): per = int(q)
        elif q and len(q) <= 20 and not re.search(r'see|comment', q, re.I): note = (q + (' · ' + note if note else ''))
    name = name.strip(' ,;:')
    if note and len(note) <= 45 and note.lower() not in name.lower(): name = f'{name} ({norm_amount(note)})'
    return {'name': name[:120], 'perGroup': per if 0 < per <= 60 else 1}

def ok_item(name):
    if not name or len(name) < 2 or len(name) > 120 or HEADER_RE.match(name.strip()): return False
    words = name.split()
    if len(words) > 10: return False
    if re.match(r'^(preparation|pre-?lab|adding|leave|to\s+(put|fix|mount|suspend)|dissolve|repeat|record|measure|place|set\s+up|the\s+\w+\s+\w+\s+\w+)', name, re.I): return False
    if re.search(r'park\s+international|^ib\s+\w+$|^school$|\bexercise$|\(topic\s+[\d.]', name, re.I): return False
    if re.fullmatch(r'[A-Z0-9 &:’\'-]{10,}', name): return False
    if len(words) > 7 and re.search(r'\b(you|your|will|should|must|then|until|measure|record|repeat|place|add|start|use)\b', name, re.I): return False
    if name.endswith('.') and len(words) > 5: return False
    return True

def table_cells(text):
    """Google Docs plain text puts each table cell on a line starting with a tab; continuation lines don't."""
    cells, started = [], False
    for line in (text or '').replace('\r', '').split('\n'):
        if line.startswith('\t'):
            cells.append(line.strip()); started = True
        elif started and cells:
            cells[-1] += '\n' + line.strip()
    return cells

def kit_from_requisition(text):
    cells = table_cells(text)
    start = next((i for i, c in enumerate(cells) if re.match(r'^(EQUIPMENT AND CHEMICALS|Equipment\s*/\s*Chemical)', c, re.I)), None)
    if start is None: return None, None
    i = start + 1
    while i < len(cells) and re.match(r'^(Equipment(\s*/\s*Chemical)?|Chemicals?)$', cells[i], re.I): i += 1
    head = []
    while i < len(cells) and len(head) < 4 and re.match(r'^(/?\s*set|quantity|qty|amount|comments?|notes?|per\s+group)$', cells[i].strip(), re.I):
        head.append(cells[i]); i += 1
    ncols = 1 + len(head) if head else 3
    sets = None
    for j, c in enumerate(cells[:start]):
        if re.match(r'number of sets', c, re.I) and j + 1 < len(cells):
            m = re.search(r'\d+', cells[j + 1]); sets = int(m.group()) if m else None
    out = []
    while i < len(cells):
        if re.match(r'^(METHOD|PRACTICAL SETUP|RISK|SAFETY|HAZARD)', cells[i], re.I): break
        row = cells[i:i + ncols]; i += ncols
        name, qty, note = (row + ['', '', ''])[:3]
        lines = [l for l in name.split('\n') if l.strip()]
        if re.search(r'see\s+comments?', name, re.I) or (not lines and note.count('\n') >= 2):
            lines, note = [l for l in note.split('\n') if l.strip()], ''
            qty = '' if re.fullmatch(r'1', qty.strip()) else qty
        note = note.split('\n')[0].strip() if note else ''
        for l in lines:
            if ok_item(l.strip()): out.append(item(l, qty if len(lines) == 1 else None, note if len(lines) == 1 else None))
    return out, sets

JUNK_RE = re.compile(r'©|www\.|https?:|automatically generated|\bdiagram\b|^part\s+[a-z]\b|teacher.s resource|^\W*$', re.I)
CAPS_RE = re.compile(r'^[A-Z0-9 &:’\'-]{18,}$')   # a heading in capitals

def kit_from_section(lines):
    out, junk = [], 0
    for l in lines or []:
        s = l.strip()
        cut = re.split(r'\s+(?=(?:Procedure|Method|Safety|Calculations|Results)\b)', s)
        s = cut[0].strip()
        if (STOP_RE.match(s) or re.match(r'^(calculations?|data|questions?|table\s*\d*|hydride)\b', s, re.I)) and len(s) < 40: break
        if JUNK_RE.search(s) or CAPS_RE.match(s) or len(re.findall(r'[A-Za-z]', s)) < 3 or (len(s) < 16 and s[:1].islower()): junk += 1
        elif ok_item(s): out.append(item(s))
        if len(cut) > 1: break
    return [] if junk >= 4 and junk >= len(out) / 2 else out

def dedupe_kit(kit):
    seen, out = set(), []
    for k in kit:
        key = re.sub(r'[^a-z0-9]', '', k['name'].lower())
        if key and key not in seen and ok_item(k['name']): seen.add(key); out.append(k)
    return out[:45]

# ---------------------------------------------------------------- inventory matching
FORMULAS = {
    'hcl': 'hydrochloric acid', 'naoh': 'sodium hydroxide', 'nh3': 'ammonia', 'ch3cooh': 'ethanoic acid', 'h2so4': 'sulfuric acid',
    'hno3': 'nitric acid', 'kmno4': 'potassium manganate', 'cuso4': 'copper sulfate', 'na2co3': 'sodium carbonate', 'nacl': 'sodium chloride',
    'agno3': 'silver nitrate', 'ki': 'potassium iodide', 'na2s2o3': 'sodium thiosulfate', 'h2o2': 'hydrogen peroxide', 'koh': 'potassium hydroxide',
    'caco3': 'calcium carbonate', 'mgso4': 'magnesium sulfate', 'feso4': 'iron sulfate', 'kbr': 'potassium bromide', 'kcl': 'potassium chloride',
    'nahco3': 'sodium hydrogencarbonate', 'baCl2'.lower(): 'barium chloride', 'dcpip': 'dcpip', 'acetic': 'ethanoic', 'acetone': 'propanone',
}
SPELL = {'sulphate': 'sulfate', 'sulphuric': 'sulfuric', 'sulphur': 'sulfur', 'aluminum': 'aluminium', 'hidrated': 'hydrated', 'colour': 'color',
         'cm3': 'ml', 'cm³': 'ml', 'mls': 'ml', 'litre': 'l', 'liter': 'l', 'dm3': 'l', 'dm³': 'l', 'stopclock': 'stopwatch', 'timer': 'stopwatch',
         'boiling': 'boiling', 'tubes': 'tube', 'deionised': 'distilled', 'deionized': 'distilled', 'clamps': 'clamp', 'stands': 'stand'}
INV_STOP = STOP | set('x per group set sets each student pair class approx approximately about small large medium new pp class b glass plastic'.split())

def toks(s):
    s = unicodedata.normalize('NFKC', s.lower()).replace('³', '3')
    s = re.sub(r'(\d)\s*(ml|cm3|l|g|mm|cm|m)\b', r'\1 \2', s)
    out = []
    for w in re.findall(r'[a-z0-9]+(?:\.[0-9]+)?', s):
        w = SPELL.get(w, w)
        if w in FORMULAS: out += FORMULAS[w].split(); continue
        if len(w) > 4 and w.endswith('s') and not w.endswith('ss'): w = w[:-1]
        if w not in INV_STOP: out.append(w)
    return out

GENERIC = set('various size sizes assorted box set student digital w without type model pack bottle bottles natural gas for use'.split())
SYN = {'dropping': ['pasteur'], 'forcep': ['tweezer'], 'tweezer': ['forcep'], 'stopwatch': ['timer'], 'timer': ['stopwatch'], 'boss': ['bosshead'],
       'retort': ['stand'], 'splint': ['splint'], 'tile': ['tile']}

UNITS = set('ml l g kg mg mm cm m mol dm v w hz kw'.split())

def head_of(name):
    """The main noun: the last real word before a bracket, dash, comma or 'for/with/to'."""
    core = re.split(r'\s*[(\[—–,;:/]\s*|\s+-\s+|\s+(?:for|with|without|to|in|on|of)\s+', name.strip(), maxsplit=1)[0]
    words = [w for w in toks(core) if not re.fullmatch(r'[\d.]+', w) and w not in UNITS and w not in GENERIC]
    return words[-1] if words else ''

class Inventory:
    def __init__(self, items):
        import math
        self.items, df = [], defaultdict(int)
        for it in items:
            t = toks(it.get('name', ''))
            words = {w for w in t if not re.fullmatch(r'[\d.]+', w) and w not in GENERIC}
            if not words: continue
            nums = set(re.findall(r'\d+', it.get('name', ''))) | set(re.findall(r'\d+', str(it.get('size', ''))))
            self.items.append((it, words, nums, head_of(it.get('name', '')), it.get('list') == 'Chemicals'))
            for w in words: df[w] += 1
        n = max(len(self.items), 1)
        self.idf = defaultdict(lambda: math.log(n), {w: math.log(n / c) + 0.3 for w, c in df.items()})

    def match(self, name):
        raw = toks(re.sub(r'\(.*?\)|—.*$|–.*$', ' ', name)) or toks(name)
        kw = {w for w in raw if not re.fullmatch(r'[\d.]+', w) and w not in GENERIC}
        for w in list(kw): kw.update(SYN.get(w, []))
        knums = set(re.findall(r'\d+', name))
        if not kw: return None
        kw_total = sum(self.idf[w] for w in kw)
        best, score = None, 0
        khead = head_of(name)
        kw_syn = kw | set(SYN.get(khead, []))
        for it, words, nums, ihead, chem in self.items:
            inter = kw & words
            if not inter: continue
            # the main noun must agree: a "test tube rack" is not a "test tube", "ice" is not a "box (for ice)"
            if khead and not ({khead} | set(SYN.get(khead, []))) & words: continue
            if not chem and ihead and ihead not in kw_syn: continue
            wi = sum(self.idf[w] for w in inter)
            kc, ic = wi / kw_total, wi / sum(self.idf[w] for w in words)
            if kc < 0.6 or ic < 0.45: continue
            sc = kc + ic + (0.15 if knums and nums & knums else 0) - (0.3 if knums and nums and not nums & knums else 0)
            if sc > score: best, score = it, sc
        return best if score >= 1.2 else None

# ---------------------------------------------------------------- grades and topics
AS_LAST = {'Chemistry': 22, 'Biology': 11, 'Physics': 11}   # Cambridge 9701 / 9700 / 9702: AS topics, then A Level topics

def grade_text(gs):
    gs = sorted(set(int(g) for g in gs))
    return gs[0] if len(gs) == 1 else f'{gs[0]}-{gs[-1]}'

def grade_for(p, course, subj):
    src, path = p['source'], p['source']['path']
    gs = p.get('grades') or []
    # newer scans list the grades from folder names; anything below Grade 11 can be used as it is
    if gs and max(gs) <= 10 and src.get('gradeEvidence') != 'document': return grade_text(gs)
    hay = ' / '.join([path, src['fileName']])
    ev = src.get('gradeEvidence') or ''
    trusted = re.search(r'\b(grade|G)\s*1[12]\b|\bDP\s*[12]\b|Grade\s*:\s*DP', ev, re.I) and not re.search(r'AS\s*(&|and)\s*A\s*Level', ev, re.I)
    if trusted:
        if p.get('grades') and len(p['grades']) == 1: return p['grades'][0]
        if p.get('grade'): return p['grade']
    if re.search(r'\b(DP\s*1|grade\s*11|G\s*11|11\s*(chem|phy|bio))', hay, re.I): return 11
    if re.search(r'\b(DP\s*2|grade\s*12|G\s*12|12\s*(chem|phy|bio)|A-Level G12)', hay, re.I): return 12
    if 'A Level' in course:
        if re.search(r'\bAS\b', hay) or re.search(r'confidential instructions|_ci_', hay, re.I): return 11   # Paper 3 = AS practical exam
        m = (re.search(r'practical[_ ]info[_ ]sheet[_ ](\d+)\.', hay, re.I) or re.search(r'/\s*(?:topic\s*)?(\d{1,2})\s*[.\-]?\s+[A-Z][a-z]', path))
        if m and subj in AS_LAST: return 11 if int(m.group(1)) <= AS_LAST[subj] else 12
    return '11-12'

def clean_topic(t):
    if not t: return ''
    t = re.sub(r'^\s*(topic|unit)\s*\d+\s*[-:.]?\s*', '', t, flags=re.I)
    t = re.sub(r'^\s*\d+(\.\d+)?\s*[-.]?\s*', '', t)
    t = re.sub(r'\b(IB|DP\s*\d?|A[\s-]?Level|AS)\b', '', t)
    t = re.sub(r'\s{2,}', ' ', t).strip(' -:.')
    if re.search(r"key\s*stage|^pags?\b|homework|^practicals?$|lesson|resources?$|cabrita|maria|guillermo|durso|corrine|fahmeed|handover|requisition|prac\s*requests|^PRs?$|pracs\s*handout|suggested|prescribed|optional|recommen|assessment|practices", t, re.I): return ''
    if t.isupper() and len(t) > 3: t = t.capitalize()
    t = {'Biochem': 'Biochemistry', 'Paper 3 Practice': 'Paper 3 practical exam', 'Ex Phys': 'Exercise physiology'}.get(t, t)
    return t[:1].upper() + t[1:] if t else ''

TOPICS = {  # one consistent topic list per subject, so the library's topic filter stays short
    'Biology': [
        (r'microscop|cell staining|cheek|onion|blood smear|celery|cell size|magnification', 'Cell structure'),
        (r"benedict|biuret|lipid|biological molecules|food test|starch|reducing sugar", 'Biological molecules'),
        (r'enzyme|amylase|catalase|substrate|denaturation', 'Enzymes'),
        (r'osmosis|osmometer|membrane|permeability|diffusion|surface area|visking', 'Membranes and transport'),
        (r'mitosis|root tip', 'Cell division'), (r'dna|electrophoresis', 'Nucleic acids and genetics'),
        (r'photosynth|chlorophyll|pigment|chromatography|dcpip|algae|elodea|\btlc\b', 'Photosynthesis'),
        (r'respiration|respirometer|yeast|gas exchange', 'Respiration'), (r'potometer|transpiration', 'Transport in plants'),
        (r'kidney|urine', 'Homeostasis'), (r'food test|nutrition|digestion', 'Nutrition and digestion'),
        (r'heart|lung|breathing|pulse|dissect', 'Organs and systems'), (r'seed|germination|plant growth|tropism', 'Plants'), (r'gibberellin', 'Control and coordination'),
        (r'lincoln|quadrat|biodiversity|simpson|ecosystem', 'Ecology and biodiversity'), (r'water circus', 'Water and its properties')],
    'Chemistry': [
        (r'transition|complex|ligand|hydroxides of copper', 'Transition elements'),
        (r'enthalpy|calorimetry|hess|combustion|heat of', 'Energetics'),
        (r'rates? of reaction|kinetic|order of reaction|catalyst|activation energ|iodination|thiosulfate', 'Kinetics'),
        (r"equilibri|chatelier|buffer|ph curve|ph values|titration curve|reversible|solubility product", 'Equilibria and pH'),
        (r'redox|electrode potential|voltaic|oxidation reduction|ion tests', 'Redox and electrochemistry'),
        (r'empirical formula|crystallisation|hydrated|molar mass|molecular mass|atomic mass|molar volume|volatile liquid', 'Amount of substance'),
        (r'titration|standard solution|dilut|vitamin c|egg shell|calibration|colorimetric analysis', 'Titrations and solutions'),
        (r'displacement|halogen|group 1|group 2|periodicity|flame test|magnesium and calcium|ammonia from', 'Periodic table and inorganic'),
        (r'intermolecular|polarity|bonding', 'Bonding and structure'),
        (r"ester|alcohol|aldehyde|carbonyl|tollens|iodoform|carboxylic|amine|amide|azo dye|nylon|benzoate|ethanoyl|ethanedioic|methanoic|organic|nitration|polymer|benzene", 'Organic chemistry'),
        (r'qualitative analysis|chemical tests|test for (ions|gases)', 'Qualitative analysis'),
        (r'acids?\b|alkali|neutralis|indicator|salts?\b', 'Acids, bases and salts'),
        (r'electrolysis', 'Electrolysis'), (r'reactivity|metals?\b|rust', 'Metals and reactivity'),
        (r'chromatograph|solvent|rf value|thin.layer', 'Separation and analysis'),
        (r'separat|filtration|distillation|crystallis|evaporat|mixture', 'Separating mixtures'), (r'dna extraction', 'Biochemistry')],
    'Environmental Systems and Societies': [
        (r'mesocosm|models', 'Systems and models'), (r'productivity|photosynth|ecosystem|lincoln|quadrat|simpson', 'Ecosystems'),
        (r'acidification|shells|eutrophication|evaporation|water', 'Water'), (r'soil', 'Soil'), (r'uv\b|atmosphere', 'Atmosphere')],
}
TOPICS['Physics'] = [
    (r'density', 'Density'), (r'speed|velocity|accelerat|motion|free fall|ramp|trolley', 'Motion'),
    (r'force|spring|hooke|friction|moment|pressure|terminal', 'Forces and pressure'),
    (r'specific heat|thermal|heat|temperature|conduction|insulation', 'Thermal physics'),
    (r'circuit|resistance|current|voltage|ohm|diode|battery|electric', 'Electricity'), (r'magnet|electromagnet|motor|induction', 'Magnetism'),
    (r'wave|sound|refraction|reflection|light|lens|ray', 'Waves, light and sound'), (r'pendulum|oscillat', 'Oscillations'),
    (r'radioactiv|half.life', 'Radioactivity'), (r'energy|power|efficiency', 'Energy')]
TOPICS = {k: [(re.compile(a, re.I), b) for a, b in v] for k, v in TOPICS.items()}

def topic_for(subject, title, folder_topic):
    rules = TOPICS.get(subject) or ([r for v in TOPICS.values() for r in v] if subject == 'Science' else [])
    for text in (title, folder_topic or ''):
        for rx, t in rules:
            if rx.search(text): return t
    return folder_topic

def course_of(p):
    path = p['source']['path']
    if re.search(r'Key Stage 3|\bKS\s*3\b', path): return 'KS3'
    if re.search(r'Key Stage 4|\bKS\s*4\b', path): return 'IGCSE'
    if re.search(r'International Baccalaureate|\bIB\b', path): return 'IB'
    if re.search(r'A-Level|A Level', path): return 'A Level'
    return (p.get('course') or '').replace('IB / A Level', 'IB')

def subject_of(p):
    return 'Sports, Exercise and Health Science' if re.search(r'\bSEHS\b', p['source']['path']) else (p.get('subject') or 'Science')

# ---------------------------------------------------------------- main
TYPE_RANK = {'Google Doc': 0, 'Word': 1, 'PDF': 2, 'PowerPoint': 3, 'Google Slides': 3}

def main(scan_path, inv_path, out_dir):
    scan = json.load(open(scan_path, encoding='utf-8'))
    inv = Inventory(json.load(open(inv_path, encoding='utf-8')) if inv_path else [])
    excluded, kept = [], []
    for p in scan['practicals']:
        s, c = p['source'], p.get('content') or {}
        text = c.get('excerpt') or ''
        title = title_from_text(text) or p['title']
        fn_key = group_key(clean_title(p['title']))
        if title != p['title'] and fn_key and len(fn_key) <= 4 and not (fn_key & group_key(clean_title(title))) and not re.search(r'info|sheet|booklet|worksheet|\bprac\b|demo', p['title'], re.I):
            title = p['title']   # a requisition copied from another one still has the old practical's name in it
        why = None
        if s.get('duplicateOf'): why = 'exact copy of another file'
        elif s['fileType'] in EXCLUDE_TYPES: why = EXCLUDE_TYPES[s['fileType']]
        else:
            for rx, w in EXCLUDE:
                if rx.search(s['fileName']) or rx.search(title) or (w in ('saved web page', 'IA sample', 'student work') and rx.search(s['path'])):
                    why = w; break
        if why: excluded.append((p, why)); continue
        is_ci = bool(re.search(r'confidential\s+instructions|_ci_', s['fileName'], re.I))
        if is_ci:
            m = re.search(r'(9700|9701|9702)\D+(?:(June|November|w)\D*(\d{2,4}))?.*?(\d{2})\b', s['fileName'])
            f = s['fileName']; ses = re.search(r'(June|November|March)\s+(20\d\d)', f, re.I)
            code = re.search(r'_([wsm])(\d\d)_ci_(\d\d)', f, re.I)
            when = f'{ses.group(1).capitalize()} {ses.group(2)}' if ses else (f"{ {'w': 'November', 's': 'June', 'm': 'March'}[code.group(1).lower()]} 20{code.group(2)}" if code else '')
            var = re.search(r'Instructions\s*(\d\d)', f, re.I) or code
            title = f"Paper 3 practical exam, {when} (variant {var.group(var.lastindex)})" if when and var else 'Paper 3 practical exam'
        else:
            title = clean_title(title)
        is_req = bool(re.search(r'requisition|prac(tical)?\s+request|request', s['fileName'], re.I) or text.lstrip().upper().startswith('PRACTICAL REQUISITION'))
        req_kit, sets = kit_from_requisition(text) if (is_req or '\tEQUIPMENT AND CHEMICALS' in text) else (None, None)
        sec_kit = kit_from_section(c.get('equipment'))
        kept.append({'p': p, 'title': title, 'text': text, 'is_req': is_req, 'is_ci': is_ci,
                     'kit': dedupe_kit(req_kit if req_kit else sec_kit), 'kit_src': 'requisition' if req_kit else ('sheet' if sec_kit else ''),
                     'sets': sets, 'key': group_key(title), 'course': course_of(p), 'subject': subject_of(p)})

    # group copies of the same practical (same subject + course + near-identical title words)
    groups = []
    for k in kept:
        sc = (k['subject'], k['course'])
        for g in groups:
            if g['sc'] != sc: continue
            a, b = g['key'], k['key']
            same_folder = g['items'][0]['p']['source']['path'] == k['p']['source']['path']
            if a and b and (a == b or (len(a & b) / len(a | b) >= 0.75 and min(len(a), len(b)) >= 2) or (min(len(a), len(b)) >= 3 and (a <= b or b <= a))
                            or (same_folder and min(len(a), len(b)) >= 2 and (a <= b or b <= a))):
                g['items'].append(k); g['key'] = a | b if a <= b or b <= a else a; break
        else:
            groups.append({'sc': sc, 'key': k['key'], 'items': [k]})

    library, review = [], []
    for g in groups:
        items = g['items']
        sheets = [k for k in items if not k['is_req']] or items
        main_doc = min(sheets, key=lambda k: (TYPE_RANK.get(k['p']['source']['fileType'], 5), -len(k['text']), len(k['title'])))
        kit_doc = max(items, key=lambda k: (k['kit_src'] == 'requisition', len(k['kit']) if len(k['kit']) <= 40 else 0))
        p = main_doc['p']
        kit = []
        for k in kit_doc['kit']:
            hit = inv.match(k['name'])
            kit.append({'itemId': hit['id'] if hit else '', 'name': k['name'], 'perGroup': k['perGroup']})
        title = min((k['title'] for k in sheets if k['title']), key=lambda t: (len(t) < 6, abs(len(t) - 38))) if not main_doc['is_ci'] else main_doc['title']
        subject, course = main_doc['subject'], main_doc['course']
        grade = grade_for(p, course, subject)
        topic = clean_topic(p.get('topic'))
        if topic and group_key(topic) and group_key(topic) <= group_key(title): topic = ''   # a folder named after the practical
        if main_doc['is_ci'] or re.search(r'paper 3 practi', title, re.I): topic = 'Paper 3 practical exam'
        elif not (subject == 'Physics' and course == 'IB' and topic): topic = topic_for(subject, title, topic)
        row = {'id': 'drv-' + p['source']['driveFileId'][:20], 'title': title, 'grade': grade, 'subject': subject,
               'course': course, 'topic': topic, 'kit': kit, 'prepMinutes': '',
               'method': p['method']}
        library.append(row)
        review.append({**{k: row[k] for k in ('id', 'title', 'grade', 'subject', 'course', 'topic', 'method')},
                       'kitItems': len(kit), 'matchedToInventory': sum(1 for k in kit if k['itemId']), 'kitFrom': kit_doc['kit_src'] + ': ' + kit_doc['p']['source']['fileName'] if kit else '',
                       'files': len(items), 'fileNames': ' | '.join(k['p']['source']['fileName'] for k in items),
                       'folder': p['source']['path']})

    order = lambda r: (str(r['course']), str(r['subject']), str(r['grade']), r['topic'] or 'zzz', r['title'].lower())
    library.sort(key=order); review.sort(key=order)
    with open(f'{out_dir}/library.json', 'w', encoding='utf-8') as f: json.dump(library, f, ensure_ascii=False, indent=1)
    with open(f'{out_dir}/library-review.csv', 'w', newline='', encoding='utf-8-sig') as f:
        w = csv.DictWriter(f, fieldnames=list(review[0].keys())); w.writeheader(); w.writerows(review)
    with open(f'{out_dir}/excluded.csv', 'w', newline='', encoding='utf-8-sig') as f:
        w = csv.writer(f); w.writerow(['reason', 'file', 'folder', 'link'])
        for p, why in sorted(excluded, key=lambda x: x[1]): w.writerow([why, p['source']['fileName'], p['source']['path'], p['method']])
    return library, review, excluded

if __name__ == '__main__':
    if len(sys.argv) < 4: sys.exit(__doc__)
    lib, rev, exc = main(sys.argv[1], sys.argv[2], sys.argv[3])
    print(f'{len(lib)} practicals from {sum(r["files"] for r in rev)} files · {len(exc)} files left out')
