import sys, docx
from docx.document import Document
from docx.table import Table
from docx.text.paragraph import Paragraph
def iter_block(parent):
    body = parent.element.body if isinstance(parent, Document) else parent._tc
    for ch in body.iterchildren():
        tag = ch.tag.split('}')[1]
        if tag == 'p': yield Paragraph(ch, parent)
        elif tag == 'tbl': yield Table(ch, parent)
def dump(path):
    d = docx.Document(path); out=[]
    for b in iter_block(d):
        if isinstance(b, Paragraph):
            t=b.text.strip()
            if t: out.append(t)
        else:
            out.append('[TABLE]')
            for r in b.rows:
                cells=[]; prev=None
                for c in r.cells:
                    if c._tc is prev: continue
                    prev=c._tc
                    cells.append(c.text.strip().replace('\n',' / '))
                out.append(' | '.join(cells))
            out.append('[/TABLE]')
    return '\n'.join(out)
if __name__=="__main__": print(dump(sys.argv[1]))
