import json, re, os
REPO = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..'))
INVL = json.load(open(os.environ.get('INVENTORY_JSON') or os.path.join(REPO, 'data/demo/inventory.json'), encoding='utf-8'))
def inv_find(prefix, size=None):
    c = [x for x in INVL if x['name'].lower() == prefix.lower()] + [x for x in INVL if x['name'].lower().startswith(prefix.lower()) and x['name'].lower() != prefix.lower()]
    if not c: return None
    if size:
        for x in c:
            if re.search(r'(?<!\d)' + str(size) + r'(?!\d)', x['name'] + ' ' + str(x.get('size', ''))): return x
    return c[0]
A = [  # (regex on the kit name, inventory name prefix, use size)
 (r'\bbungs?\b|stopper|\bcork\b', 'Rubber bung, red, 1 hole', 0), (r'delivery tube', 'Delivery tube', 0),
 (r'boiling tubes? rack|rack.*boiling', 'Boiling tubes rack', 0),
 (r'test[\s-]?tubes? rack|\btt rack|tube rack', 'Z Shape Test Tube Rack', 0),
 (r'test[\s-]?tube holder|boiling tube holder|tt holder|test-tube holder', 'Wooden test tube holder', 0),
 (r'burette clamp', 'Burette clamp', 0),
 (r'\bburette', 'Burette 50ml', 0),
 (r'boiling tube', 'Test tube (boiling tube)', 0),
 (r'\btest[\s-]?tubes?\b', 'Test tubes medium wall', 0),
 (r'stop\s?-?(clock|watch)|\btimer\b|stopwatch', 'Digital timer, student', 0),
 (r'conical flask|erlenmeyer', 'Erlenmeyer/conical flask', 1),
 (r'measuring cylinder|graduated cylinder', 'Measuring cylinder', 1),
 (r'\bbeakers?\b(?! tongs)', 'Beaker', 1),
 (r'\b(10|20|25|50)\s*(cm3|cm³|ml)\s*(volumetric |bulb )?pipette', 'Volumetric pipette', 1),
 (r'(plastic|pasteur|dropping|teat) pipettes?|\bdropper\b|pipette, plastic', 'Pasteur pipette, plastic, 3 mL', 0),
 (r'pipette filler', 'Pipette filler', 0),
 (r'(stirring|glass) rod', 'Glass rod', 0),
 (r'\bfunnel\b', 'Funnel, various sizes', 0),
 (r'scalpel', 'Scalpel handle', 0),
 (r'heat[\s-]?(proof|resistant)\s?mat|heatproof', 'Heatproof mats', 0),
 (r'\btripod\b', 'Tripod', 0),
 (r'\bgauze\b', 'Gauze', 0),
 (r'(clamp|retort) stand|stand,? (clamp|boss)|stand and clamp|ring stand|clamp stand', 'Universal support/ retort stand', 0),
 (r'\bboss\b', 'Boss head', 0),
 (r'crucible tongs?|\btong(ue)?s\b', 'Crucible tong', 0),
 (r'spatula', 'Spatulas, various sizes', 0),
 (r'(top[\s-]?pan|digital|mass|electronic|analytical)? ?balance|weighing scale', 'Balance 500 g × 0.01 g', 0),
 (r'infrared thermometer', 'Infrared thermometer', 0),
 (r'digital thermometer|temperature probe', 'Digital thermometer with probe', 0),
 (r'thermometer', 'Thermometer -10 to 110°C, red fill', 0),
 (r'goggles|eye protection|safety (glasses|spectacles)', 'Safety goggles', 0),
 (r'oscilloscope', '2-channel digital oscilloscope', 0),
 (r'ammeter', 'Digital ammeter', 0), (r'voltmeter', 'Digital voltmeter CC', 0), (r'multimeter', 'Multimeter UNI-T UT33', 0),
 (r'power (supply|pack|unit)|\bpsu\b|low voltage supply', 'Power supply 3-12V', 0),
 (r'variable resistor|rheostat', 'Variable resistor', 0),
 (r'crocodile|connecting (leads|wires)|\bleads\b|\bcables?\b|wires? with', 'Crocodile clips w/wire', 0),
 (r'ray ?box', 'Ray boxes', 0), (r'plane mirror|\bmirrors?\b', 'Mirrors, flat', 0),
 (r'(glass|perspex|acrylic|rectangular) block', 'Lens: rectangular block', 0), (r'prism', 'Lens: triangular block', 0),
 (r'semi-?circular block', 'Lens: semicircular block', 0),
 (r'water ?bath', 'Digital water bath', 0), (r'kettle', 'Kettle', 0),
 (r'tweezers|forceps|tweesers', 'Tweezers', 0),
 (r'cavity slide', 'Microscope slides, ground edges 90º, 1 cavity', 0),
 (r'microscope slides?|glass slides?|\bslides?\b(?! covers)', 'Microscope slides', 0),
 (r'cover ?slips?|cover ?glass', 'Cover glass 22x22mm', 0),
 (r'microscope', 'Microscope, monocular, Zazi 116', 0),
 (r'mounted needle|teasing needle|dissecting needle', 'Teasing needle', 0),
 (r'(white|cutting) tile', 'White tiles', 0),
 (r'permanent marker|marker pen|\bmarker\b|chinagraph', 'Permanent marker', 0),
 (r'tape measure|measuring tape', 'Measuring tape', 0), (r'masking tape|sellotape|selotape|sticky tape|adhesive tape', 'Masking tape', 0),
 (r'slinky', 'Springs (slinky, metal)', 0), (r'\bsprings?\b', 'Helical spring (red marking)', 0),
 (r'mass hanger|mass holder|slotted mass|\bmasses\b|\bweights\b', 'Slotted masses hooks 100g', 0),
 (r'\bramps?\b', 'Wooden ramps', 0),
 (r'evaporating (basin|dish)', 'Evaporating basin', 1),
 (r'crucible', 'Crucible with lid (high form)', 0),
 (r'bunsen|gas burner|\bburners?\b', 'Bunsen', 0),
 (r'filter paper', 'Filter paper', 0), (r'mortar|pestle', 'Mortar', 0), (r'watch glass', 'Watch glass', 0),
 (r'magnifying glass|hand lens', 'Magnifying', 0), (r'protractor', 'Protractor', 0), (r'\bscissors\b', 'Scissors', 0),
 (r'lamp holder', 'Lampholder', 0), (r'\bbulbs?\b', 'Flashlamp bulbs', 0), (r'\bswitch\b', 'Switch', 0),
 (r'dissection kit|dissecting kit', 'Dissection kit', 0), (r'dissecting board|dissection board|dissection tray', 'Dissection', 0),
 (r'hot ?plate', 'Heating plate', 0), (r'light gate|photogate', 'Light gate', 0), (r'data ?logger', 'Data logger', 0),
 (r'signal generator', 'Signal generator', 0), (r'loudspeaker|speaker', 'Loudspeaker', 0), (r'tuning fork', 'Tuning fork', 0),
 (r'colorimeter', 'Colorimeter', 0), (r'cuvette', 'Cuvette', 0), (r'ph meter|ph probe', 'pH meter', 0),
 (r'lab(oratory)? coat', 'Lab coat', 0), (r'gloves', 'Gloves', 0), (r'quadrat', 'Quadrat', 0),
 (r'potometer', 'Potometer', 0), (r'respirometer', 'Respir', 0), (r'syringe', 'Syringe', 0), (r'volumetric flask', 'Volumetric flask', 1),
 (r'volumetric pipette|bulb pipette', 'Volumetric pipette', 1), (r'graduated pipette', 'Graduated pipette', 1), (r'wash bottle', 'Wash bottle', 0),
 (r'splints?', 'Splint', 0), (r'lighter|matches', 'Lighter', 0), (r'magnets?\b', 'Magnet', 0), (r'compass', 'Plotting compass', 0),
 (r'visking', 'Visking', 0), (r'capillary', 'Capillary', 0), (r'chromatography paper', 'Chromatography paper', 0), (r'\bclamp\b', 'Stand clamp', 0),
]
A = [(re.compile(a, re.I), b, s) for a, b, s in A]
CHEM = re.compile(r'acid|hydroxide|chloride|sulfate|sulphate|nitrate|carbonate|solution|oxide|iodine|ethanol|indicator|benedict|biuret|peroxide|reagent|\bstain\b|water|magnesium ribbon|metal|powder|crystals|salt\b', re.I)
def alias(name):
    base = re.sub(r'\(.*?\)', '', name)
    if CHEM.search(base) and not re.search(r'beaker|bottle of|tube|flask|cylinder|burette|pipette|bath|wash', base, re.I): return None
    size = None
    m = re.search(r'(\d{2,4})\s*(ml|cm3|cm³|cm 3|mL)', name, re.I)
    if m: size = int(m.group(1))
    for rx, pref, use in A:
        if rx.search(base):
            hit = inv_find(pref, size if use else None)
            if hit: return hit
            return False   # known kind of item, but not in the inventory
    return None
