import sys, os, re, json, csv
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
from assemble import build, kit_item, fmt_method, risks_from, G, BL
from overrides import O, TOPIC
REPO = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..'))
NOT_INV = re.compile(r'^(water|tap water|distilled water|deionised water|deionized water|paper towels?|paper|a4 (plain |white )?paper|pencil|pen|graph paper|ice|crushed ice|string|plasticine|blu.?tack|blue tack)\b', re.I)
def slug(s): return re.sub(r'[^a-z0-9]+', '-', s.lower()).strip('-')[:48]
lib, rep, seen = [], [], set()
for gi in range(len(G)):
    b = build(gi); o = O.get(f"{G[gi][0]}|{G[gi][2]}", {})
    title = o.get('title', b['title'])
    if 'kit' in o:
        kit = [x for x in (kit_item({'name': t[1], 'qty': str(t[0]), 'comment': '', 'section': 'For the class' if len(t) > 2 else ''}) for t in o['kit']) if x]
    else: kit = b['kit']
    method = o.get('method', b['method'])
    safety = o.get('safety', b['safety']); prep = o.get('prep', b['prep'])
    sets_txt = o.get('sets', b['sets'])
    m = re.match(r'^\s*(\d{1,2})\b', sets_txt or ''); sets = int(m.group(1)) if m else ''
    grade, course, subj = b['grade'], b['course'], b['subject']
    topic = TOPIC.get(title) or BL.topic_for(subj, title, '') or ''
    if not topic and subj == 'Environmental Systems and Societies': topic = 'Ecosystems'
    pid = 'lib-' + slug(f'{course}-{grade}-{subj[:4]}-{title}')
    while pid in seen: pid += '-2'
    seen.add(pid)
    flags = b['flags']
    notes = [re.sub(r'^[•·▪●◦\-–]\s*', '', re.sub(r'\s+', ' ', l)).strip() for l in prep if l.strip()]
    if flags: notes.append('Requisition sheet: ' + '; '.join(flags) + '.')
    if sets_txt and not sets: notes.append('Sets: ' + sets_txt)
    if o.get('note'): notes.append(o['note'])
    risks = risks_from(safety)
    clean_kit = [{k: v for k, v in it.items() if not k.startswith('_')} for it in kit]
    lib.append({'id': pid, 'title': title, 'grade': grade, 'subject': subj, 'course': course, 'topic': topic,
                'kit': clean_kit, 'sets': sets, 'prepMinutes': '', 'method': method, 'risks': risks,
                'prepNotes': '\n'.join(notes), 'sources': ' | '.join(b['files'])})
    # ---- report
    missing = list(o.get('missing', []))
    if not method and not any(x.startswith('method') for x in missing): missing.append('method')
    if not kit: missing.append('kit list')
    if not sets: missing.append('number of sets')
    unmatched = [k['name'] for k in kit if not k['itemId'] and not NOT_INV.match(k['name'])]
    kit_status = 'missing' if not kit else ('typed in from an image-only file' if o.get('fromImage') else 'written from the method – check' if o.get('inferred') else 'from ' + ('requisition sheet' if 'equisition' in (b['kitFrom'] or '') or re.search(r'request|G6|G7|G8|ESS', b['kitFrom'] or '') else 'protocol'))
    method_status = 'missing' if not method else ('written by hand – check' if 'method' in o and any('method' in x for x in missing) else ('typed in from an image-only file' if o.get('fromImage') else 'ok'))
    actions = []
    if any(x.startswith('method') for x in missing): actions.append('add or check the method')
    if not kit or o.get('inferred'): actions.append('add or check the kit list')
    if not sets: actions.append('add the number of sets')
    if unmatched: actions.append(f'link {len(unmatched)} kit item(s) to the inventory')
    if not risks: actions.append('no safety notes on the sheet – check the risk assessment when ordering')
    actions.append('add prep time (none of the sheets give one)')
    rep.append({'id': pid, 'title': title, 'grade': grade, 'course': course, 'subject': subj, 'topic': topic,
                'missing': '; '.join(missing), 'method': method_status, 'kit': kit_status, 'kitItems': len(kit),
                'kitNotInInventory': len(unmatched), 'kitItemsToLink': ' | '.join(unmatched),
                'sets': sets if sets else (sets_txt or 'missing'), 'safetyNotes': 'yes' if risks else 'none on the sheet',
                'notes': o.get('note', ''), 'todo': '; '.join(actions), 'sourceFiles': ' | '.join(b['files'])})
order = lambda r: ({'KS3': 0, 'IGCSE': 1, 'IB': 2, 'A Level': 3}.get(r['course'], 9), str(r['grade']), r['subject'], r['title'].lower())
lib.sort(key=order); rep.sort(key=lambda r: (0 if r['missing'] else 1,) + order(r))
json.dump(lib, open(f'{REPO}/data/demo/library.json', 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
with open(f'{REPO}/practical-files-for-libraries/library-missing-report.csv', 'w', newline='', encoding='utf-8-sig') as f:
    w = csv.DictWriter(f, fieldnames=list(rep[0].keys())); w.writeheader(); w.writerows(rep)
print(len(lib), 'practicals;', sum(1 for r in rep if r['missing']), 'with something missing;',
      sum(len(x['kit']) for x in lib), 'kit items,', sum(1 for x in lib for k in x['kit'] if k['itemId']), 'linked to inventory')
