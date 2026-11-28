# Drive practicals scan

A standalone Google Apps Script that scans **one Google Drive folder and every folder inside it**
for **practicals of every grade** (KS3, IGCSE, A Level, IB DP). Nothing outside that folder is read. It reads each file and writes
one JSON file to upload to the app for the practical library.

## Run it
1. Open <https://script.google.com>, click **New project** and name it *Practical library scan*.
2. Paste `Scan.gs` into `Code.gs`.
3. Open **Project Settings**, tick **Show "appsscript.json"**, then paste `appsscript.json` from this folder. It switches on the Drive API (v3).
4. At the top of the script, set `FOLDER_ID` to your folder's ID: the part after `/folders/` in the folder's link. You can also paste the whole link.
5. Choose `startScan` in the toolbar, click **Run** and allow the permissions.
6. The scan carries on by itself, one part every minute, because Google stops each run after 6 minutes. You get an email when it's done.
   Run `scanStatus()` to check progress, or `buildOutputNow()` for a partial file.
7. Download `practicals-all-grades.json` from the Drive folder **Practical Library Export**.

## What gets picked
* **Practical:** the file name or one of its folders says *practical, lab, experiment, investigation, required/core practical, PAG, CPAC, tech sheet…*
* **Grades:** read from names like *Grade 8*, *Grade 9 & 10*, *Key Stage 4 (9 - 10)*, *DP1*, *Year 12*. The folder nearest the file wins. The result is a list, e.g. `[9, 10]`.
  To keep only some grades, set `GRADES: [11, 12]` in `CONFIG`.
* **Course:** IB, A Level, IGCSE, MYP or KS3. A course that doesn't fit the grade is ignored. With no course in the name, Grades 6–8 count as KS3 and Grades 9–10 as IGCSE.
* **Skipped:** student hand-ins (the *Classroom* folder, *homework, submissions, marked, student work*), mark schemes, past papers, and `…_files` folders left over from web pages saved in a browser.

## Output
Each entry has the app's Library fields (`id, title, grade, subject, course, topic, kit, prepMinutes, method`). `grade` is set only when exactly one grade applies, and `grades` lists them all.
It also has `source` (Drive path, and why it was picked) and `content` (aim, equipment, method, safety, hazcard numbers and a text excerpt).
