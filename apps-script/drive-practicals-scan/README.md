# Drive practicals scan

A standalone Google Apps Script that searches the whole Google Drive (My Drive, Shared with me and all
shared drives) for **Grade 11 and Grade 12 practicals (IB DP or A Level)**. It reads each file and writes
one JSON file to upload to the app for the practical library.

## Run it
1. Open <https://script.google.com>, click **New project** and name it *Practical library scan*.
2. Paste `Scan.gs` into `Code.gs`.
3. Open **Project Settings**, tick **Show "appsscript.json"**, then paste `appsscript.json` from this folder. It switches on the Drive API (v3).
4. Choose `startScan` in the toolbar, click **Run** and allow the permissions.
5. The scan carries on by itself, one part every minute, because Google stops each run after 6 minutes. You get an email when it's done.
   Run `scanStatus()` to check progress, or `buildOutputNow()` for a partial file.
6. Download `practicals-grade11-12.json` from the Drive folder **Practical Library Export**.

## What gets picked
* **Practical:** the file name or one of its folders says *practical, lab, experiment, investigation, required/core practical, PAG, CPAC, tech sheet…*
* **Grade:** from names like *Grade 11 / G12 / DP1 / IB Year 2 / Year 12–13 / AS / A2 / Lower–Upper Sixth*. The folder nearest the file wins. British Year 12 = Grade 11, and you can change this with `YEAR_TO_GRADE_OFFSET`.
* **Skipped:** Grades 6–10, IGCSE/MYP/KS3, student hand-ins (Classroom folder, *submissions, marked, student work*) and mark schemes or past papers.
* Files that are clearly IB/A Level but don't name a grade are kept with `grade: null`.

## Output
Each entry has the app's Library fields (`id, title, grade, subject, course, topic, kit, prepMinutes, method`).
It also has `source` (Drive path, and why it was picked) and `content` (aim, equipment, method, safety, hazcard numbers and a text excerpt).
