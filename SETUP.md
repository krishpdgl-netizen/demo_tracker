# Demo Unit Tracker — Setup Guide
## Panache DigiLife

---

## How it works

```
Browser (any office)  →  Render backend (always on)  →  Google Sheet (live data)
```

The Express server runs 24/7 on Render. Both offices open the same URL in their browser and see identical live data. Every write goes straight to Google Sheets.

---

## Step 1 — Create the Google Sheet

1. Go to [sheets.google.com](https://sheets.google.com)
2. Create a **new blank spreadsheet**
3. Name it: `Panache Demo Units`
4. Copy the **Sheet ID** from the URL:
   ```
   https://docs.google.com/spreadsheets/d/  <-- COPY THIS -->  /edit
   ```
   Keep it — you'll need it in Step 3.

---

## Step 2 — Create a Google Service Account

This gives the backend permission to read/write the sheet without you being logged in.

1. Go to [console.cloud.google.com](https://console.cloud.google.com)
2. Create a new project (name it anything, e.g. `panache-demo-tracker`)
3. In the left sidebar: **APIs & Services → Enable APIs and Services**
4. Search for **Google Sheets API** → Enable it
5. Go to **APIs & Services → Credentials**
6. Click **+ Create Credentials → Service Account**
   - Name: `demo-tracker`
   - Click **Create and Continue** → **Done**
7. Click on the service account you just created
8. Go to the **Keys** tab → **Add Key → Create new key → JSON**
9. A `.json` file downloads — **keep this safe, never share it publicly**

---

## Step 3 — Share the Sheet with the Service Account

1. Open the downloaded JSON file in a text editor
2. Find the `"client_email"` field — it looks like:
   ```
   demo-tracker@your-project.iam.gserviceaccount.com
   ```
3. Open your Google Sheet
4. Click **Share** (top right)
5. Paste that email address → give it **Editor** access → Share

---

## Step 4 — Push code to GitHub

```bash
git init
git add .
git commit -m "Initial commit"
git remote add origin https://github.com/YOUR_USERNAME/panache-demo-tracker.git
git push -u origin main
```

---

## Step 5 — Deploy to Render

1. Go to [render.com](https://render.com) and log in
2. Click **New → Web Service**
3. Connect your GitHub repo
4. Settings:
   - **Name**: `panache-demo-tracker`
   - **Runtime**: Node
   - **Build Command**: `npm install`
   - **Start Command**: `npm start`
   - **Plan**: Free (or Starter for always-on)

5. Under **Environment Variables**, add these:

   | Key | Value |
   |-----|-------|
   | `GOOGLE_SHEET_ID` | The Sheet ID from Step 1 |
   | `GOOGLE_SERVICE_ACCOUNT_JSON` | Paste the **entire contents** of the downloaded JSON file as one value |

   > For the JSON: open the file, select all (Ctrl+A), copy, paste as the value. Render handles multi-line values fine.

6. Click **Deploy**

7. Once deployed, Render gives you a URL like:
   ```
   https://panache-demo-tracker.onrender.com
   ```

---

## Step 6 — Open in both offices

Both offices open the same URL in Chrome or Edge:
```
https://panache-demo-tracker.onrender.com
```

That's it. No install, no setup per computer. Just a URL.

---

## Local development (optional)

```bash
npm install
```

Create a `.env` file:
```
GOOGLE_SHEET_ID=your_sheet_id
GOOGLE_KEY_FILE=./service-account.json
```

Copy the downloaded JSON to `service-account.json` in the project root, then:

```bash
npm run dev
```

Open `http://localhost:3000`

---

## API endpoints (for reference)

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | /api/health | Check server + sheet connection |
| GET | /api/units | Get all units |
| POST | /api/units | Add new unit |
| PUT | /api/units/:id | Update unit |
| PATCH | /api/units/:id/return | Mark as returned |
| DELETE | /api/units/:id | Delete unit |
| GET | /api/logs | Get activity log |

---

## Render free tier note

On the free tier, Render spins down after 15 minutes of inactivity. The first load after idle takes ~30 seconds. Upgrade to the **Starter plan ($7/month)** for always-on — worth it for a shared office tool.
