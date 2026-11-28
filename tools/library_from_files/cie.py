import re, sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from extract import text, rel
def clean(t):
    t = re.sub(r'.*Cambridge International AS and A Level Biology 9700.*\n', '', t)
    t = re.sub(r'.*Biology Practical \d+ – (Guidance for teachers|Information for technicians|Worksheet).*\n', '', t)
    t = re.sub(r'^\s*(Practical \d+ – (Information for technicians|Worksheet))\s*$', r'@@\1', t, flags=re.M)
    return t
def bullets(block):
    block = re.sub(r'\s*\[[HN]\]\s*', '\n', block)
    items, cur = [], ''
    for l in block.split('\n'):
        s = l.strip()
        if not s: continue
        if re.match(r'^(\([a-z]{1,2}\)|•|\d+\.)\s*', s):
            if cur: items.append(cur)
            cur = re.sub(r'^(\([a-z]{1,2}\)|•)\s*', '', s)
        else: cur = (cur + ' ' + s) if cur else s
    if cur: items.append(cur)
    return [re.sub(r'\s+', ' ', x).strip() for x in items]
def parse_cie(i):
    t = clean(text(i))
    res = {'kit': [], 'method': [], 'safety': [], 'prep': []}
    tech = re.search(r'@@Practical \d+ – Information for technicians(.*?)(@@Practical \d+ – Worksheet|$)', t, re.S)
    work = re.search(r'@@Practical \d+ – Worksheet(.*)$', t, re.S)
    if tech:
        T = tech.group(1)
        m = re.search(r'(Each (learner|group)[^\n]*require[^\n]*:)(.*?)(Additional instructions|Safety|$)', T, re.S)
        if m:
            req = m.group(3)
            haz = [l.strip() for l in req.split('\n') if re.search(r'hazard|safety|goggles|eye protection|irritant|harmful|flammable|corrosive', l, re.I) and not re.match(r'\s*\([a-z]', l)]
            res['safety'] += haz
            for h in haz: req = req.replace(h, '')
            res['kit'] = [{'name': x, 'qty': '', 'comment': '', 'section': ''} for x in bullets(req) if len(x) < 220]
        m = re.search(r'Additional instructions(.*?)$', T, re.S)
        if m: res['prep'] = [re.sub(r'\s+', ' ', p).strip() for p in re.split(r'\n\s*(?=\d+\.|•|\([a-z]\))', m.group(1)) if p.strip()]
        sm = re.findall(r'(?:Safety|Hazards?)[^\n]*\n((?:.*\n){1,6})', T)
    if work:
        W = work.group(1)
        m = re.search(r'\bMethod\b(.*?)(\n\s*Results\b|\n\s*Interpretation|\n\s*Questions|$)', W, re.S)
        if m:
            lines = []
            for l in m.group(1).split('\n'):
                s = re.sub(r'\s+', ' ', l).strip()
                if not s: continue
                if re.match(r'^(\d+\.|•|Experiment \d|Part \d|Step \d)', s) or not lines: lines.append(s)
                else: lines[-1] += ' ' + s
            res['method'] = lines
        res['safety'] += [re.sub(r'\s+', ' ', x) for x in re.findall(r'(?:Safety|Wear eye protection)[^\n]*(?:\n[^\n]+){0,2}', W)][:3]
    return res
if __name__ == '__main__':
    import json
    for a in sys.argv[1:]:
        r = parse_cie(int(a)); print(a, rel(int(a))); print(json.dumps(r, ensure_ascii=False, indent=0)[:2500])
