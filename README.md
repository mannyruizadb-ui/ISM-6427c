# Fleet Repair Log

Truck and plant-equipment repair log with parts inventory, preventive maintenance, fuel tracking and cost reports.
React + Vite PWA on Netlify, Supabase for the database, login, photo storage and real-time sync.

It starts empty: no sample data. The first person to sign up becomes the admin and gets a setup checklist.

## Roles

| Role     | Can do                                                                                      | Sees costs |
|----------|---------------------------------------------------------------------------------------------|------------|
| Admin    | Everything: assets, parts, vendors, people, maintenance schedules, reports, CSV import      | Yes        |
| Mechanic | Create and close work orders, log parts used, set asset status and mileage                  | Yes        |
| Driver   | Report a problem on a truck with photos; log fill-ups; sees only their own reports and fill-ups | Own fill-ups only |
| Pending  | Just signed up, waiting for an admin to pick their role; sees nothing                        | No         |

Rules are enforced in the database with Row Level Security, not just hidden in the UI:

- Work-order costs live in a separate table (`work_order_costs`) that drivers can't read.
- Parts, vendors and settings are also off-limits to drivers.
- Mechanics can change only an asset's status and mileage, and can't change roles.
- The last active admin can't be demoted.

## Setup

### 1. Supabase

1. Create a project at [supabase.com](https://supabase.com).
2. Open **SQL Editor**, paste all of [`supabase/migrations/001_schema.sql`](supabase/migrations/001_schema.sql) and run it once, then do the same with [`002_fuel.sql`](supabase/migrations/002_fuel.sql). Together they create:
   - every table, with RLS enabled on each, and the policies
   - the triggers for stock deduction, PM reset and mileage
   - the private `work-order-photos` and `fuel-receipts` storage buckets
   - realtime publishing
3. Under **Authentication → URL Configuration**, set **Site URL** to your Netlify URL (e.g. `https://your-site.netlify.app`) and add it to **Redirect URLs**.
4. **Email.** Supabase's built-in email sender only delivers to your own team's addresses and is rate-limited, so mechanics and drivers won't get confirmation emails. Pick one:
   - **Simplest:** Authentication → Sign In / Providers → Email → turn **off** "Confirm email". People can sign in right after creating an account. They still see nothing until you approve them.
   - **Better:** set up custom SMTP under Authentication → Emails → SMTP Settings (e.g. Resend, Postmark, SendGrid). This also makes "Forgot password" work for everyone.
5. Copy the **Project URL** and the **publishable / anon key** from Project Settings → API Keys. Never use the `service_role` or secret key in this app.

### 2. Netlify

1. New site → Import from Git → pick this repo. Build settings come from [`netlify.toml`](netlify.toml) (`npm run build`, publish `dist`).
2. Site configuration → Environment variables:
   - `VITE_SUPABASE_URL` = your project URL
   - `VITE_SUPABASE_ANON_KEY` = the publishable / anon key
3. Deploy. If you add the variables after the first deploy, trigger a redeploy. Vite bakes them in at build time.

### 3. First login

1. Open the site and **Create account**. The first account becomes **admin**.
   - Do this right after deploying: until an admin exists, whoever signs up first gets admin.
2. Follow the dashboard checklist:
   1. Trucks
   2. Plant equipment
   3. Mechanics
   4. Vendors
   5. Parts
   6. Labor rate
3. To add a person, send them the site link. They create an account, then you approve them under **People** as mechanic, driver or admin.

### Install on phones

- iPhone (Safari): Share → **Add to Home Screen**.
- Android (Chrome): menu → **Install app**.

## Fuel tracking

- **One odometer reading per fill-up.** Miles and MPG come from the previous full-tank fill-up, so nobody goes back to edit an earlier row.
  - The old gas tracker's Starting/Ending layout was why about 124 rows had a blank ending reading.
- **Partial fills** are fine: untick "Filled the tank all the way". Their gallons roll into the next full fill-up's MPG.
- **Rentals and other vehicles** (U-Haul, a rental) can be logged by name. They count toward spend but not MPG.
- **The fill-up odometer keeps the truck's mileage current,** so mileage-based maintenance stays accurate without anyone updating it.
  - Jumps of more than 3,000 miles are ignored for this, so a typo can't make every oil change overdue.
- **Entries are flagged for checking** when:
  - the odometer goes backwards or jumps
  - MPG is far from that truck's normal
  - the price per gallon is far from what the fleet paid within a month either side
  - the odometer is missing
- **Drivers** see only their own fill-ups and can fix a typo for 24 hours; after that a mechanic or admin corrects it.
- **Reports → Fuel & cost per mile** shows spend, MPG and fuel $/mile per truck, plus **fuel + repairs per mile**: the number to compare trucks on when deciding what to replace.

## Importing the old Excel log

**Import CSV** (admin) takes three kinds of file. In Excel, use *Save As → CSV*.

1. **Trucks & equipment.** Import these first: repairs and parts are matched to assets by unit number or name.
2. **Parts.** Unknown vendors are created. Existing part numbers are skipped.
3. **Past repairs.** Parts cost goes in as a dollar amount and does not change inventory.
   - Re-importing the same file creates duplicates.
4. **Fuel log.** Map the old tracker's *Starting Odometer Reading* to "Odometer at fill-up".
   - Vehicles that aren't trucks in the app (Yaris, U-haul, Rental) are logged as "other". Add the Yaris as a truck first if you want its MPG.
   - Rows already imported are skipped, so re-running the file is safe.

Each screen has a *Download blank template* button. Column names don't have to match exactly: you match them up on screen before importing, and bad rows are listed with their line number.

## How things work

- **Parts.** Adding a part to a work order deducts it from stock (database trigger). Removing it or deleting the work order puts it back.
  - Stock can go negative if a mechanic logs more than the count shows. It then shows as "Out" so the count gets corrected.
- **Receiving stock.** *Receive* on the Parts screen adds stock atomically and can update the unit cost.
  - Past work orders keep the cost they were logged at.
- **Preventive maintenance.** Trucks are scheduled by miles and/or days (whichever comes first); equipment by days.
  - Linking a work order to a schedule and closing it resets the schedule.
  - Overdue items show on the dashboard.
- **Mileage.** A work order's mileage updates the truck's current mileage when it's higher.
- **Real-time.** Every device subscribes to changes, so a repair logged on one phone appears on the others within a second or two. The app also resyncs when it returns to the foreground.
- **Reports** (admin), each with PDF export:
  - cost per asset (parts + labor + vendor), by month and year to date
  - downtime per asset
  - repair vs. replace: lifetime repairs as a % of the replacement cost you enter on each asset

## Things to know

- **Free-plan Supabase projects pause after about a week with no activity.** Unpause from the dashboard, or use a paid plan for something people rely on daily.
- **Photos are resized on the phone** (about 1600 px JPEG) before upload, to save data and storage. They're in a private bucket and shown through short-lived signed links.
- **Offline.** The app shell loads offline, but logging work needs a connection; there's no offline queue.

## Local development

```bash
cp .env.example .env.local   # fill in URL + publishable/anon key
npm install
npm run dev
```

`npm run build` type-checks and builds to `dist/`.
