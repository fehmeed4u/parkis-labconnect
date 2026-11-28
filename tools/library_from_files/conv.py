import sys, os, subprocess, json, hashlib
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from dump import dump
from xmltext import xmltext
import pptx
root, out = sys.argv[1], sys.argv[2]
os.makedirs(out, exist_ok=True)
DOCS = ('docx', 'pdf', 'pptx', 'doc', 'txt')
index = []
for dp, dn, fn in os.walk(root):
    for f in sorted(fn):
        p = os.path.join(dp, f); rel = os.path.relpath(p, root); ext = f.rsplit('.',1)[-1].lower()
        if ext not in DOCS: continue
        txt = ''
        try:
            if ext == 'docx':
                txt = dump(p); full = xmltext(p)
                if len(full) > len(txt) * 1.3 + 50: txt += '\n[TEXTBOX/FULL TEXT]\n' + full   # text boxes python-docx misses
            elif ext == 'pdf': txt = subprocess.run(['pdftotext','-layout',p,'-'],capture_output=True,text=True,timeout=60).stdout
            elif ext == 'pptx':
                pr = pptx.Presentation(p); txt='\n'.join(sh.text_frame.text for s in pr.slides for sh in s.shapes if sh.has_text_frame)
            elif ext == 'doc':
                subprocess.run(['soffice','--headless','--convert-to','txt:Text',p,'--outdir',out],capture_output=True,timeout=120)
                tp=os.path.join(out, f[:-4]+'.txt'); txt=open(tp,errors='ignore').read(); os.remove(tp)
        except Exception as e: txt = 'ERROR '+str(e)
        name = hashlib.md5(rel.encode()).hexdigest()[:10]+'.txt'
        open(os.path.join(out,name),'w').write(txt)
        index.append({'rel':rel,'txt':name,'chars':len(txt)})
json.dump(index, open(os.path.join(out,'index.json'),'w'), indent=1)
print(len(index))
