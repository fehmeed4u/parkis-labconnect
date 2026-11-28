import re, sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from extract import text, rel, IDX
H = {
 'kit': r"chemicals and apparatus|apparatus and reagents|equipment list|materials?(\s*(and|&)\s*(reagents?|equipment|apparatus))?|reagents?|apparatus(\s*(and|&)\s*(materials?|equipment|chemicals))?(\s*list)?|equipment(\s*(and|&)\s*(chemicals|materials|apparatus))?(\s*(list|needed|required|per group))?|you will need|requirements|chemicals(\s*needed)?|what you need|resources needed|equipment\s*/\s*chemicals?|chemicals?\s*/\s*equipment|materials\s*\(per group\)|per group",
 'method': r"method(\s*\(.*\))?|task|approach|procedure|experimental (procedure|method)|instructions|steps|what to do|the experiment|practical activity.*|activity\s*\d*.*|experiment\s*\d+.*|part\s+[a-z0-9]\b.*|investigation\s*\d*",
 'safety': r"safety( information( and measures)?| precautions| notes| considerations| and ethical considerations)?|risk assessment|risks?( assessment)?|hazards?( information| and risks)?|health and safety|precautions|required ppe|ppe|hazcards?",
 'prep': r"technician'?s?( notes| preparation| guidance| information)?|technical notes|preparation( of (solutions|reagents|materials))?( notes)?|teacher'?s?( and technician'?s?)? notes|notes for (the )?(teachers?|technicians?)|before the lesson|advance preparation|making the solutions|solution preparation|recipes?",
 'stop': r"pre-?lab( questions)?|prior to starting|for consideration|background|introduction|aims?|objectives?|theory|results?(\s*table)?|data( collection| analysis| processing)?|analysis|conclusions?|evaluation|questions?|variables|hypothesis|research question|discussion|extension( work)?|diagram|calculations?|disposal|example\s*[a-z]?|independent variable|dependent variable|control(led)? variables|key (words|terms)|learning (outcomes|objectives)|suggestions? for evaluation|further work|exam(ination)? questions?|past paper.*|references|answers?|observations?|graph|expected results|practical setup requirements|record sheet|student roles|interpretation|sources of error|uncertaint(y|ies)|processing|presentation|conclusion and evaluation|data table|table\s*\d*|follow.up|plenary|starter|success criteria|marks?",
}
HRX = {k: re.compile(r'^\s*(\d+[.)]?\s*|[A-Z][.)]\s*)?(' + v + r')\s*[:\-–]?\s*(\(.*?\))?\s*(:\s*(?P<rest>.*))?$', re.I) for k, v in H.items()}
def heading(s):
    s2 = s.strip().strip('*').strip()
    if len(s2) > 90: 
        m = re.match(r'^([A-Za-z &/\']{3,40}):\s*(.+)$', s2)
        if not m: return None, None
        for k, rx in HRX.items():
            if rx.match(m.group(1) + ':'): return k, m.group(2)
        return None, None
    for k, rx in HRX.items():
        m = rx.match(s2)
        if m:
            if k in ('method',) and len(s2) > 60 and not s2.isupper() and ':' not in s2: return None, None
            return k, (m.group('rest') or '').strip()
    return None, None

def lines_of(i):
    out = []
    for raw in text(i).replace('\r', '').split('\n'):
        s = raw.strip()
        m = re.fullmatch(r'(.{4,60})\1', s)
        if m: s = m.group(1)
        s = re.sub(r'^TS(?=PRACTICAL SETUP)', '', s)
        s = re.sub(r'^/\s*', '', s)
        if not s or s in ('[TABLE]', '[/TABLE]') or s.startswith('[TEXTBOX'): continue
        out.append(s)
    return out

def parse(i):
    res = {'title': '', 'sets': '', 'kit': [], 'method': [], 'safety': [], 'prep': [], 'flags': []}
    mode = None; section = ''
    L = lines_of(i)
    for n, s in enumerate(L):
        if re.match(r'^practical title\s*/?\s*(reference)?:?', s, re.I):
            res['title'] = s.split('|')[-1].strip(); continue
        if re.match(r'^number of sets', s, re.I):
            res['sets'] = s.split('|')[-1].strip(); continue
        U = s.upper().replace(' ', '')
        if U.startswith('EQUIPMENTANDCHEMICALS'): mode = 'kit'; continue
        if U.startswith('PRACTICALSETUP'): mode = 'setup'; continue
        if U.startswith('PRACTICALDETAILS') or U.startswith('PRACTICALREQUISITION') or s.startswith('Note: Before handling'): continue
        if mode == 'setup':
            m = re.match(r'^(☑|y|yes|x|some|✓)\s*\|?\s*(.+)$', s, re.I)
            if m: res['flags'].append(m.group(2).strip()); continue
            if re.match(r'^(☐|\|)', s): continue
        cells = [c.strip() for c in s.split('|')]
        # a table row in kit mode
        if mode == 'kit' and len(cells) > 1:
            c0 = cells[0]
            if re.match(r'^(equipment|item|chemicals?|apparatus|materials?)(\s*/\s*(chemicals?|equipment))?$', c0, re.I) and (not any(re.search(r'\d', c) for c in cells[1:]) or re.match(r'^(qty|quantity|/?\s*set|amount|per group)', cells[1], re.I)):
                continue
            if not c0 and not any(cells): continue
            if not c0:
                blob = max(cells, key=len)
                if ' / ' in blob or len(blob) > 40:
                    for part in re.split(r'\s+/\s+', blob):
                        part = part.strip()
                        if not part: continue
                        if re.match(r'^(materials?|equipment|chemicals?)\s*(\(.*\))?:?$', part, re.I): continue
                        if re.match(r'^\(?optional', part, re.I): res['kit'].append({'name': part, 'qty': '', 'comment': '', 'section': 'Optional'}); continue
                        res['kit'].append({'name': part, 'qty': '', 'comment': '', 'section': section})
                continue
            if all(not x for x in cells[1:]) and (len(c0) > 45 or re.match(r'^(practical|part|station|experiment|activity|demo|for (the )?(class|teacher)|to share|item shared|equipment|chemicals)\b', c0, re.I)):
                section = c0; continue
            k, rest = heading(c0)
            if k == 'method': mode = 'method'; res['method'] += [x for x in re.split(r'\s+/\s+', ' / '.join(cells[1:]) if not rest else rest) if x.strip()]; continue
            qty = cells[1] if len(cells) > 1 else ''
            com = cells[-1] if len(cells) > 2 else ''
            total = cells[2] if len(cells) > 3 else ''
            res['kit'].append({'name': c0, 'qty': qty, 'comment': com, 'total': total, 'section': section})
            continue
        # expand cells and " / " lists (protocol tables)
        parts = []
        for c in cells:
            parts += [x.strip() for x in re.split(r'\s+/\s+|^/\s*|\s*/$', c) if x and x.strip()]
        for p in parts:
            p = re.sub(r'^/\s*', '', p).strip()
            if not p: continue
            k, rest = heading(p)
            if mode == 'kit' and k is None and re.match(r'^(for (the )?class|to share|shared|demo(nstration)?s?\b.*|teacher demo.*|per class|class (set|items?)|item shared.*|equipment|chemicals?|reagents?|station \d.*|optional.*)\s*:?$', p, re.I) and len(p) < 50:
                section = p.rstrip(':'); continue
            if k:
                mode = k if k != 'stop' else None
                if k == 'kit':
                    section = 'Reagents' if re.match(r'reagent|chemical', p, re.I) else ''
                if rest and mode: 
                    if mode == 'kit': res['kit'].append({'name': rest, 'qty': '', 'comment': '', 'section': section})
                    else: res[mode].append(rest)
                continue
            if mode == 'kit':
                if len(p) > 140 or (p.endswith('.') and len(p.split()) > 12): 
                    continue
                res['kit'].append({'name': p, 'qty': '', 'comment': '', 'section': section})
            elif mode in ('method', 'safety', 'prep'):
                res[mode].append(p)
    return res
if __name__ == '__main__':
    import json
    for a in sys.argv[1:]:
        r = parse(int(a)); print('#####', a, rel(int(a))); print(json.dumps(r, ensure_ascii=False)[:3000])
