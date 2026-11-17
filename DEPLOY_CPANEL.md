# Evergreen Field Map – Deploy on cPanel shared hosting (Node.js + MySQL)

## Step 1 – Subdomain
cPanel > Domains (or Subdomains) > create e.g. `smart.evergreensolar.co.in`. Turn on free SSL (cPanel > SSL/TLS Status > Run AutoSSL).

## Step 2 – MySQL database
cPanel > MySQL Databases:
1. Create database, e.g. `fieldmap` (cPanel makes it `cpaneluser_fieldmap`).
2. Create user with a strong password.
3. Add user to database > tick **ALL PRIVILEGES**.
Tables are created automatically on first start.

## Step 3 – Upload files
cPanel > File Manager > create folder `fieldmap` in your home directory (NOT inside public_html).
Upload the zip into it and **Extract**. Do not upload `node_modules`.

## Step 4 – Node.js app
cPanel > **Setup Node.js App** > Create Application:
- Node.js version: **18 or higher** (20 recommended)
- Application mode: Production
- Application root: `fieldmap`
- Application URL: smart.evergreensolar.co.in
- Application startup file: `server.js`
Click Create, then **Run NPM Install**, then **Restart**.

## Step 5 – First-time setup in the browser (no file editing)
Open https://smart.evergreensolar.co.in – a **Setup** form appears.
Enter the database name, user and password from Step 2, and your admin username/password. Click **Save & start**.
The app tests the database, creates all tables, creates your admin login, and writes its own settings file with secure random keys.
**Copy the cron command and ERP API key shown on the success screen.**

## Step 6 – Cron job (very important on shared hosting)
cPanel > **Cron Jobs** > "Every 15 minutes" > paste the cron command from Step 5.

## Step 7 – Login
Wait 10 seconds and open the site again, then login.

## Step 8 – Set up inside the app
1. Open the subdomain, login as admin.
2. **Users** tab: add staff (admin / manager / engineer / sales).
3. **RMS / Generation** tab: enter Growatt, Deye (Solarman), Sungrow, PVblink keys > Save > Test connection.
4. **Import** tab: upload projects Excel until the ERP API is live.
5. **API Docs** tab: download spec and give to the ERP team with the ERP_API_KEY and URL `https://smart.evergreensolar.co.in/erp/v1`.

## Limits to know
- Each cron run polls inverters for up to 4 minutes. ~1000 inverters may need 2-3 runs to cover all; that is fine every 15 minutes. If your host kills long requests, lower CRON_MAX_SECONDS to 100.
- After changing `.env` or files, click **Restart** in Setup Node.js App.
- Back up the MySQL database weekly (cPanel > Backup).

## If something fails
- Blank page / 503: Setup Node.js App > check the log file (stderr.log in app folder). Most common: wrong DB password or Node version below 18.
- "Startup failed": database details in `.env` are wrong.

## Public page & WordPress
- https://smart.evergreensolar.co.in = public "Smart Evergreen Assistant" page (live totals, area map, no customer names).
- Staff login: https://smart.evergreensolar.co.in/app.html
- WordPress: create a page (e.g. /smart-monitoring) with a button or menu link to https://smart.evergreensolar.co.in, or use a redirect plugin.
- Area circles appear only where 3+ systems are monitored, for customer privacy.

## Rebuild / redeploy (Hostinger)
- Settings are saved outside the app folder (~/.evergreen-fieldmap.env) and keys are stored in the database, so a rebuild keeps everything.
- If the "Database connection" page ever appears after a rebuild: enter the same database name/user/password, leave the admin fields empty. All data stays; cron command and ERP key stay the same.
- The Setup page now lists every place it looked for the settings file (✅ found / ✗ not found), and the Setup-complete page lists where it saved it.
- If the database is briefly unreachable right after a redeploy, the app retries for about 1 minute before showing the Setup page.
- **Permanent fix (recommended):** in Hostinger's Web App settings, add Environment variables DB_HOST, DB_NAME, DB_USER, DB_PASSWORD once. Those are kept on every redeploy, so the Setup page never comes back.
- Admins can see the cron command and ERP key any time in the API Docs tab.

## Background data (app closed)
- The server fetches inverter data by itself every 15 min while it runs (built-in timer, `INTERNAL_SCHEDULER=1` by default).
- Keep the Hostinger cron as a backup (it wakes the app if Hostinger ever puts it to sleep). Both together never double-fetch: a run is skipped if one happened in the last 12 min.
- The app header shows "Inverter data updated X min ago". If it turns orange (over 40 min), the background job has stopped – check the Hostinger cron.

## Growatt online / offline
- Offline when: Growatt marks the device "lost", OR in daytime (9:30–16:30 IST) the plant shows 0 kW and 0 kWh today / kWh not rising.
- Online when: power > 0 (plant, plant list or the inverter itself) or today's kWh is rising.
- Night: shown as "Idle (night)" – no alerts at night.
- Growatt rate limit: calls are spaced 1.5 s apart (`GROWATT_GAP_MS`). If Growatt still says error_frequently_access, that round stops and old data is kept – no false "No data".
- The Test button shows the reason ("decision") for each inverter.
- An OFFLINE alert opens only after 45 minutes offline in daytime (`OFFLINE_ALERT_MINUTES`).
