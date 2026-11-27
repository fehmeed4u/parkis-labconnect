# Science Practicals

A small website for a science department:

- **Teachers** order practicals in three steps: (1) pick the lesson on their own weekly timetable — green means it can still be booked on time, red means the deadline has passed (they can still send a late request), and any practical already ordered for that lesson is shown on it; (2) choose a **new lab request**, start **from the practical library** and adapt it, or **bring a practical from AI** — copy the app's prompt into ChatGPT, Gemini, Claude or Copilot with a worksheet/PDF, paste the answer back, and the app checks every item against the inventory (we have it / not enough / missing) and offers a “rethink” prompt to redo it with only the kit we have (the built-in *Use AI* option is shown as coming soon); (3) check and send the request form, with the lesson already filled in. They follow each one through Draft › Submitted › Accepted › In prep › Ready › In use › Closed. Questions from the technicians show up under *Needs your action*. They can pick from a library of past practicals and see straight away if equipment clashes with another booking. If their lesson is in a classroom, they can see which labs are free, have a lesson without a practical, or already have a practical booked (and by whom).
- **Lab technicians** work from a request queue with the prep sheet beside it (query, reject, or accept and reserve stock; pick list with where-to-find-it; shortages flagged). They also see the week as colour blocks (red = not started, amber = in progress, green = prepared). They can choose from five layouts and three colour schemes. Each request has an accept / change day-time / reject option and a prep sheet with a pick list, where-to-find-it and print labels.
- **The HOD** gets a department overview: late requests and purchases waiting for approval, stock alerts, technician prep load and how busy each lab is.
- **Everyone** can see the inventory: room by room, with the cabinet position and a picture. Technicians and the HOD can change it; teachers can only view it.
- **Booking rule:** requests are due a set number of working days ahead (default 3). Late requests are flagged, and the teacher chooses to talk to the technicians first or to send a draft anyway.
- **Hazcards:** the CLEAPSS hazcards for every chemical in an order pop up for the teacher when ordering and for the technician when preparing.
- **Records:** every request is kept with its date and time, so the practical library grows by itself. Every table can be exported and imported as JSON or CSV (CSV opens in Excel).

It is a plain static site (HTML, CSS, JavaScript; no build step). The landing page is the sign-in page. Where the data lives depends on `assets/js/config.js`:

| `API_URL` in config.js | Where data lives | Use it for |
|---|---|---|
| empty (as shipped) | This browser only (local storage), seeded from the anonymised sample data in `data/demo/` | Setting up and testing. Nothing is shared between computers. |
| your Apps Script URL | A Google Sheet in your school Google Workspace, through a Google Apps Script web app | Real use. Staff sign in with the username and password the HOD gives them (or, optionally, their school Google account). |

The sample data is anonymised (Teacher A–L). Your real timetable, inventory, staff names and library are **not** in this repository. They are in the separate `school-data` folder, which you load through **Import & export** once the site is connected to the Google Sheet. Do not commit that folder to a public repository.

---

## 1. Put the site on GitHub Pages

1. Create a new repository on GitHub (it can be public; there is no private data in it).
2. Upload **the contents** of this folder (so `index.html` is at the top level of the repository): **Add file → Upload files**, drag everything in, commit.
3. Go to **Settings → Pages**. Under *Build and deployment* choose **Deploy from a branch**, branch `main`, folder `/ (root)`, and save.
4. After a minute the site is at `https://<your-user>.github.io/<repo-name>/`.

The site opens on the sign-in page. Until you connect the Google Sheet (section 2), it keeps its data in your browser only, and these **test sign-ins** work:

| Role | Username | Password |
|---|---|---|
| Teacher (“Teacher C” on the sample timetable) | `test.teacher` | `Teacher-Test-2026` |
| Lab technician | `test.labtech` | `LabTech-Test-2026` |
| Head of department | `test.hod` | `Hod-Test-2026` |

They exist only in that browser-only setup; they do not work once the site is connected. For the live site, see *Test accounts* in 2.6.

## 2. Connect it to Google (live mode)

You need a school Google account that can create Sheets and Apps Script projects. Steps 2.1 to 2.4 are done once, by the HOD.

### 2.1 The Google Sheet and the script

1. Create a new Google Sheet, e.g. *Science Practicals data*.
2. **Extensions → Apps Script.** Delete what is in `Code.gs` and paste in `apps-script/Code.gs` from this repository.
3. Click the gear (**Project Settings**), tick **Show "appsscript.json" manifest file in editor**, then replace that file’s contents with `apps-script/appsscript.json`.
4. Back in the editor, choose the function **`setup`** in the toolbar and click **Run**. Accept the permission prompts. This creates one tab per table (Settings, Users, Labs, Timetable, Inventory, InventoryLog, Hazcards, Library, Requests).

### 2.2 (Optional) A Google sign-in client ID

Skip this if staff will only use usernames and passwords.

1. Open <https://console.cloud.google.com/>, create (or pick) a project for the school.
2. **APIs & Services → OAuth consent screen**: choose **Internal** (only your school domain), give it a name, save.
3. **APIs & Services → Credentials → Create credentials → OAuth client ID** → *Web application*.
   Under **Authorised JavaScript origins** add `https://<your-user>.github.io` (no path, no trailing slash). Create it and copy the **Client ID** (it ends in `.apps.googleusercontent.com`).

### 2.3 Script properties

In Apps Script, **Project Settings → Script properties → Add**:

| Property | Value |
|---|---|
| `CLIENT_ID` | the Client ID from 2.2 (leave out if you skipped it) |
| `SCHOOL_DOMAIN` | your email domain, e.g. `yourschool.pt` (only these accounts can sign in) |
| `ADMIN_EMAILS` | the HOD’s email or username; separate several with commas. These people are always admins. |
| `ADMIN_USERNAME` | (optional) the HOD’s username for the first sign-in, default `hod` |
| `HAZCARD_FOLDER_ID` | (optional, see 2.6) the Drive folder ID of your hazcard PDFs |

### 2.4 Deploy the web app

1. **Deploy → New deployment → Select type: Web app.**
2. *Execute as:* **Me**. *Who has access:* **Anyone**. (The site checks every request against a Google sign-in token, the domain and the Users tab, so “Anyone” only means the address is reachable.)
3. Deploy and copy the **Web app URL** (ends in `/exec`).

When you change `Code.gs` later, use **Deploy → Manage deployments → edit (pencil) → Version: New version** so the URL stays the same.

> **Updating from an earlier version:** recent updates added columns (`passwordHash`, `salt`, `mustChange` on Users; `query`, `reply`, `hodApproved` on Requests; `orderApproved` on Inventory). Paste the new `Code.gs`, deploy a new version, then run **`setup`** once — it adds the missing column headers to your existing tabs without touching the data.

### 2.5 Connect the site to the Google Sheet

Edit `assets/js/config.js` on GitHub:

```js
export const CONFIG = {
  API_URL: 'https://script.google.com/macros/s/…/exec',
  GOOGLE_CLIENT_ID: '…apps.googleusercontent.com',   // or '' for usernames and passwords only
  SCHOOL_DOMAIN: 'yourschool.pt'
};
```

Commit.

**First sign-in as the HOD.** In Apps Script choose the function **`makeFirstAdmin`** and click **Run**. Open **Execution log**: it shows the username (`hod`, or your `ADMIN_USERNAME`) and a temporary password. Sign in with them on the site; you’ll be asked to choose your own password straight away. (If you set up Google sign-in and put your email in `ADMIN_EMAILS`, you can use the Google button instead.)

### 2.6 Load your school’s data

In the site, go to **Admin → Import & export → Import**, choose a table, choose the matching file from the `school-data` folder and click **Import** (Replace). Do this for each file:

| Table | File |
|---|---|
| Settings | `settings.json` |
| Labs | `labs.json` |
| Timetable | `timetable.json` |
| Inventory | `inventory.json` |
| Hazcards | `hazcards.json` |
| Library | `library.json` |

**Building the library from Google Drive.** `apps-script/drive-practicals-scan` scans a Drive folder and writes one JSON file (see its README). Turn that file into `library.json` with:

```
python3 tools/build_library.py practicals-all-grades.json school-data/inventory.json school-data/
```

The tool leaves out exam papers, mark schemes, answer and guidance sheets, rubrics, IA samples, purchase requests and templates. It merges the copies of each practical (Word, PDF, "(1)", "old" and its requisition sheet). It reads the equipment from requisition-sheet tables and "Equipment / Apparatus" sections and matches each item to the inventory. It also writes `library-review.csv`, with every practical and the files it came from, and `excluded.csv`, with every file it left out and why. A practical used in both years gets the grade `11-12`, and it shows under G11 and under G12 in the library.
| Users | `users.json` |

Then open **People & roles** and click **+ Add person** for each member of staff: their name (exactly as on the timetable, so teachers see their own lessons), a username, and their role (*Teacher*, *Lab technician* or *Head of department*). The app makes a **temporary password** and shows it once — copy it and give it to the person with their username. The first time they sign in they must choose their own password (at least 8 characters).

- Forgotten password? **People & roles → Reset password** makes a new temporary one; the old password stops working at once.
- Untick **Can sign in** to lock someone out without deleting their history.
- Passwords are stored only as salted hashes in the Users tab (`passwordHash`, `salt`) — nobody, including the HOD, can read them. Importing or exporting the Users table never includes or overwrites passwords.
- Five wrong passwords in a row lock that username for 10 minutes. A sign-in lasts 12 hours (or until the browser tab is closed).
- **Test accounts:** in Apps Script run **`makeTestAccounts`**. The execution log lists `test.teacher`, `test.labtech` and `test.hod` with a random password each (no change needed at first sign-in), so you can try every role. Set the script property `TEST_TEACHER_NAME` to a teacher’s name from the timetable first if you want the test teacher to see that teacher’s lessons. Run **`removeTestAccounts`** when you are done. (The live passwords are random on purpose — fixed ones would be public in this repository.)
- If you also set up Google sign-in, use the person’s school email as their username and they can use either way to sign in.

**Hazcards.** CLEAPSS hazcards are copyright CLEAPSS and for members only, so they are not in this repository. To make them pop up:

1. Upload the hazcard PDFs to one folder in the school Google Drive. Leave it shared with the school only, not public. File names must start with the card number, e.g. `91A - Sodium Hydroxide.pdf`, as they do already.
2. Copy the folder ID (the part of the folder’s URL after `/folders/`) into the `HAZCARD_FOLDER_ID` script property.
3. In Apps Script run **`linkHazcards`**. The Hazcards tab now holds a preview link for each card. Staff signed in to the school Google account see the card itself in the pop-up.

### 2.7 Backups

In Apps Script run **`installBackup`** once. Every night a copy of the whole Sheet is saved to a Drive folder called *Practicals backups*. You can also download a full JSON backup at any time from **Admin → Import & export**.

## 3. Day-to-day

- **New timetable (e.g. January, new building):** export the new timetable to CSV with the columns `id, teacher, day, start, end, subject, code, class, grade, course, room` (day is Mon–Fri, times like 08:30) and import it into Timetable with *Replace*. Add or rename rooms in Labs (`type` is `lab`, `classroom` or `store`).
- **Holidays and the booking deadline:** **Admin → Settings**.
- **Editing the data directly:** the Google Sheet is the database. You can edit cells there. Columns holding lists (`rooms`, `storage`, `hazcards`, `kit`, `history`) are JSON, so take care with them.
- **Photos:** paste an image link into an item’s **Photo link** field (Inventory → item → edit). Items without a photo show a free icon, or “No picture yet”.

## 4. Files

```
index.html                 the page
assets/css/app.css         styles (three colour schemes + print)
assets/js/config.js        Apps Script URL (empty = data kept in this browser)
assets/js/app.js           sign-in, header, routing
assets/js/store.js         talks to Apps Script, or to local storage when not connected
assets/js/logic.js         deadlines, lab status, clashes, CSV
assets/js/ui.js            dialogs, hazcard viewer, toasts
assets/js/views/*.js       one file per screen (aiimport.js: the copy-a-prompt AI import)
assets/icons/              item icons (see assets/icons/LICENSES.md)
data/demo/*.json           anonymised sample data used before the site is connected
apps-script/               the Google back end (Code.gs + manifest)
```

To run it locally: `python3 -m http.server` in this folder, then open <http://localhost:8000>. (Opening `index.html` straight from disk will not work, because browsers block module scripts from `file://`.)
