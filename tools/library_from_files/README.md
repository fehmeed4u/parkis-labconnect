# Practical library from the uploaded files

Rebuilds `data/demo/library.json` and `practical-files-for-libraries/library-missing-report.csv`
from the requisition sheets and protocols in `practical-files-for-libraries/`.

```bash
python3 conv.py ../../practical-files-for-libraries .txt   # 1. convert every .docx/.pdf/.pptx/.doc to text (needs pdftotext and LibreOffice)
python3 final.py                                            # 2. build library.json and the report
```

- `groups.py` says which files make up each practical (requisition sheet first, then the protocol), with grade, course and subject.
  The numbers are the file positions in `.txt/index.json`; check them again after adding or removing files.
- `overrides.py` holds the fixes typed in by hand: protocols that are images only, sheets without a kit list or method, and topics.
- Kit is taken from the requisition sheet when there is one, otherwise from the protocol's materials list; it is matched to
  `data/demo/inventory.json` (set `INVENTORY_JSON` to use another export).
