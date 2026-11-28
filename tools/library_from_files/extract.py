import re, json, docx, os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
REPO = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..'))
R = os.path.join(REPO, 'practical-files-for-libraries')
TXT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '.txt')   # made by conv.py
IDX = json.load(open(os.path.join(TXT, 'index.json')))
def text(i): return open(os.path.join(TXT, IDX[i]['txt'])).read()
def rel(i): return IDX[i]['rel']

def rows_of(path):
    d=docx.Document(path); out=[]
    def walk(tbl):
        for r in tbl.rows:
            cells=[]; prev=None
            for c in r.cells:
                if c._tc is prev: continue
                prev=c._tc; cells.append(c.text.strip())
            out.append(cells)
            for c in r.cells:
                for t in c.tables: walk(t)
    for t in d.tables: walk(t)
    return out

def is_req(i):
    t=text(i); return 'PRACTICAL REQUISITION' in t[:300].upper() or 'EQUIPMENT AND CHEMICALS' in t

def parse_req(i):
    rows=rows_of(os.path.join(R,rel(i)))
    res={'title':'','sets':'','kit':[],'method':'','flags':[],'notes':[]}
    mode=None; section=''
    for cells in rows:
        c0=cells[0].strip() if cells else ''
        joined=' | '.join(cells)
        u=c0.upper()
        if re.match(r'practical title',c0,re.I): res['title']=cells[-1].strip(); continue
        if re.match(r'number of sets',c0,re.I): res['sets']=cells[-1].strip(); continue
        if u.startswith('EQUIPMENT AND CHEMICALS'): mode='kit'; continue
        if u.startswith('METHOD'): mode='method'; 
        if u.startswith('PRACTICAL SETUP'): mode='setup'; continue
        if u.startswith('PRACTICAL DETAILS'): continue
        if mode=='kit':
            if re.match(r'^(equipment(\s*/\s*chemicals?)?|chemicals?|item)$',c0,re.I) and len(cells)>1 and re.search(r'quantity|set|qty|^$',cells[1],re.I): continue
            if all(not x.strip() for x in cells): continue
            if len(set(cells))==1 or (len(cells)>1 and all(not x.strip() for x in cells[1:]) and re.match(r'^(to share|for the class|for class|demo\w*|shared|teacher|per class|class|practical \d|part [a-z0-9]|station)',c0,re.I)):
                section=c0.strip(); continue
            name=cells[0]; qty=cells[1] if len(cells)>1 else ''; com=cells[2] if len(cells)>2 else ''
            res['kit'].append({'name':name,'qty':qty,'comment':com,'section':section})
        elif mode=='method':
            m='\n'.join(x for x in dict.fromkeys(cells) if x.strip() and x.strip().upper()!='METHOD')
            m=re.sub(r'^METHOD\s*','',m)
            res['method']+=('\n' if res['method'] else '')+m
        elif mode=='setup':
            if len(cells)>1 and cells[0].strip(): res['flags'].append(cells[1].strip()+' ('+cells[0].strip()+')')
    return res

HEAD=[('kit',r'(materials?( and reagents?| & reagents)?|reagents?|apparatus( and materials)?|equipment( list| needed| required)?|you will need|requirements|chemicals( needed)?|materials and equipment|equipment and materials|resources|what you need)'),
      ('method',r'(method|procedure|instructions|steps|experimental procedure|experimental method|what to do|plan|part [a-z0-9]+\b.*|practical activity.*|activity \d.*|experiment \d.*)'),
      ('safety',r'(safety( precautions| notes| information)?|risk assessment|risks?|hazards?( and risks)?|health and safety|safety and ethical( considerations)?|precautions)'),
      ('prep',r"(technician'?s? notes|technical notes|preparation( of solutions| notes)?|teacher'?s? notes|notes for (teachers|technicians)|before the lesson|advance preparation|making the solutions|solutions?|prep)"),
      ('other',r'(background|introduction|aim|aims|objectives?|theory|results?|data( collection| analysis| processing)?|analysis|conclusion|evaluation|questions?|variables|hypothesis|research question|discussion|extension|diagram|calculations?|disposal|waste|example [a-z]|results table|independent variable|dependent variable|controlled variables|key words|learning outcomes|suggestion for evaluation|further work|exam questions?|past paper|references|answers?|observations|graph|expected results)')]
HEAD=[(k,re.compile(r'^\s*(\d+[.)]?\s*)?'+p+r'\s*[:\-–]?\s*(\(.*\))?\s*:?\s*$',re.I)) for k,p in HEAD]
def sections(t):
    out=[('top',[])]
    for line in t.replace('\r','').split('\n'):
        s=line.strip()
        if not s or s in ('[TABLE]','[/TABLE]'): continue
        hit=None
        if len(s)<70:
            for k,rx in HEAD:
                if rx.match(s.replace('|','').strip()): hit=k; break
        if hit: out.append((hit,[s])) 
        else: out[-1][1].append(s)
    return out
