import zipfile, re, sys
def xmltext(p):
    x = zipfile.ZipFile(p).read('word/document.xml').decode('utf8')
    x = re.sub(r'<mc:Fallback>.*?</mc:Fallback>', '', x, flags=re.S)
    paras = re.findall(r'<w:p[ >].*?</w:p>', x, flags=re.S)
    out=[]
    for pa in paras:
        t=''.join(re.findall(r'<w:t[^>]*>([^<]*)</w:t>', pa)).strip()
        if t and (not out or out[-1]!=t): out.append(t)
    return '\n'.join(out)
if __name__=='__main__': print(xmltext(sys.argv[1]))
