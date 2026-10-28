# eX Construction LC booking

Customers describe a job, get an itemized quote from your rate sheet, hold a time for 24 hours, and pay. You see the day's route by crew, the review queue, and every rate.

The first time you run it on your own computer, it does not need any paid account. Quotes, the service-area ZIP list, invoices starting at 1000, and sample sign-in all work from a file on that computer. Emails print in the terminal. The Pay button records a demo payment. Road miles are straight-line distance times 1.25 until you add a free routing key.

Do not put that demo mode on the internet. Sample sign-in would let a stranger open the owner screen. Connect the free Supabase project first, then deploy. Once `NODE_ENV` is `production`, or the Supabase URL, anon key, and service role key are set, the sample buttons disappear unless you explicitly set `DEMO_MODE=true`. Leave that unset on the public site.

## Run it on your computer

1. Install Node.js 20 or newer from [https://nodejs.org](https://nodejs.org).
2. Open a terminal in this folder.
3. Run `npm install`.
4. Run `npm run dev`.
5. Open [http://127.0.0.1:43123](http://127.0.0.1:43123).

On the sign-in page, use the sample buttons: **Sample customer**, **Worker A**, and **Dale (owner)**. The sample customer already has a Cadillac billing address, so you can request a quote immediately.

Sample crews are named Crew 1 and Crew 2, with workers labeled “(sample)”. Rename or delete them under **Rates** after you sign in as the owner.

To check the pricing rules on their own, run `npm test`.

## Connect your free Supabase project

Supabase is the database and the sign-in system. The free project is enough. It pauses after about a week of no use. Open the Supabase site once in a while, or the booking site will sleep until you wake the project.

1. Create a free account at [https://supabase.com](https://supabase.com) and create a new project. Pick a region close to Michigan. Save the database password somewhere safe.
2. In the project, open **SQL Editor**, then **New query**.
3. Open the file `supabase/migrations/20261026120000_init.sql` from this folder, copy the whole file, paste it into the query, and run it. You should see success.
4. Do the same with `supabase/migrations/20261026120100_seed_zips.sql`. That loads the 161 ZIP codes. Run it second. Running it twice is safe.
5. Do the same with `supabase/migrations/20261026140000_cost_library.sql`. That loads the 37-job cost library for work that is not on the rate sheet. Run it third. Running it twice will not overwrite prices you already changed.
6. Do the same with `supabase/migrations/20261027120000_ai_usage.sql`. That stores the daily AI quote counts and the IP limits. Run it after the cost library. Running it twice is safe.
7. Still in the SQL Editor, run this with your real email:

```sql
update public.app_settings
set owner_email = 'you@your-email.com'
where id = 1;
```

The first person who signs up with that exact email becomes the owner. Everyone else becomes a customer, unless their email matches a worker you already added.

8. Open **Authentication**, then **Providers**, then **Email**. Turn **Confirm email** off. If it stays on, new accounts cannot sign in until they click a message, and the free email setup is easy to get wrong.
9. Open **Project Settings**, then **API**. Copy three values:
   - Project URL
   - `anon` public key
   - `service_role` secret key

The service role key can read every job. It stays in `.env.local` on the server. Never paste it into a web page or a public chat.

10. In this folder, copy `.env.example` to a new file named `.env.local`. Fill in:

```
NEXT_PUBLIC_SUPABASE_URL=the project URL
NEXT_PUBLIC_SUPABASE_ANON_KEY=the anon key
SUPABASE_SERVICE_ROLE_KEY=the service_role key
OWNER_EMAIL=the same email you put in the SQL update
NEXT_PUBLIC_APP_URL=http://127.0.0.1:43123
```

11. Stop the app (Ctrl+C) and run `npm run dev` again.
12. Open the site and create an account with that owner email. You should land on the day-route screen, not the customer job list.

If you already created the account before setting `owner_email`, you are a customer. In the SQL Editor run, with your user id from **Authentication → Users**:

```sql
update public.profiles set role = 'owner' where email = 'you@your-email.com';
```

Workers: add them under **Rates** with their email and a password. They can then sign in. On Supabase, a person who signs up later with a worker's email is also linked to that worker.

Photos use a private bucket named `job-photos`. The first SQL file creates it. If that step prints a notice instead, open **Storage** and create a private bucket with that exact name.

## Turn on email (Resend, free tier)

Until this is set, every email is printed in the terminal and saved in the owner queue under **Email log**.

1. Create a free account at [https://resend.com](https://resend.com).
2. Create an API key and put it in `.env.local` as `RESEND_API_KEY`.
3. On the free plan, Resend will only deliver to your own Resend login email until you verify a domain. Verifying a domain is free. Add the domain in Resend, then set `RESEND_FROM_EMAIL` to something like `eX Construction LC <jobs@your-domain.com>`.
4. Set **Email for owner notices** on the Rates screen to the inbox you actually read.

Restart `npm run dev` after changing `.env.local`.

Customer messages: booking confirmation with the pay link, receipts, the approval request, cancellation, and refund. Owner messages: a worker marks a job done, any payment, a cancellation request, and a finished job that is not approved yet. The same events appear in **Queue**.

## Turn on PayPal

PayPal standard checkout has no monthly fee. PayPal keeps a percentage of each payment. That is how PayPal works. This app does not use PayPal Pro or their monthly invoicing product.

1. Create a PayPal business account if you do not have one.
2. Open the [PayPal Developer Dashboard](https://developer.paypal.com/dashboard/) and create an app.
3. Start with the **Sandbox** client id and secret. Put them in `.env.local`:

```
PAYPAL_CLIENT_ID=
PAYPAL_CLIENT_SECRET=
PAYPAL_ENV=sandbox
```

4. Restart the app. The job page shows **Pay with PayPal** instead of the demo button.
5. Pay with a sandbox personal account. You should come back to the job, see a receipt, and the time should be booked.
6. When you are ready for real customers, create **Live** credentials, set `PAYPAL_ENV=live`, and set `NEXT_PUBLIC_APP_URL` to the public site address, including `https://`. PayPal sends the customer back to that address.

You can still mark a job paid by cash or check. Those buttons are only on your owner view.

Invoices are numbered 1000, 1001, 1002, and so on. The number comes from the database and is not reused when a save fails.

Refunds are not sent automatically. The app tells you the amount. You refund it in PayPal (or by hand for cash and check), then click **Mark refund sent**.

## How unlisted jobs are priced

Painting, TV mounting, blinds, furniture assembly, yard cleanup, cleaning, and hire-a-helper still use the rate sheet. Those numbers are unchanged.

Anything else is priced from the cost library under **Library**:

- The quote uses the high end of each matching range. A ZIP starting with 496 takes 4% off a national figure. A ZIP starting with 497 takes 5% off. A local Michigan range is used as printed, with no extra discount.
- The quote cannot go below your hourly rate times the estimated hours times 1.25, plus estimated materials. Travel and the area premium are added after that. The customer pays whichever is higher, the library price or that floor, and never less than the job minimum.
- If the description is vague, or the match is not confident, the job waits for you. The customer does not see a price range. You still see the range and any referral estimate. They see that you are reviewing it and will send one firm price, usually within 1 business day, and they approve that price before anything is booked or paid.
- Licensed trades and builder work start as refer-out. A builder-scope total of $600 or more also waits for you, even if you flip that switch on. You can release a job with **No license needed** when you have looked at it.

The model only picks library items, quantities, hours, materials, and whether it is confident. The dollar amount is calculated in the app. Unlisted jobs ask Claude first, then OpenAI, then the keyword matcher. With neither key, the same rules run from keywords in the description.

The Rates screen caps model calls at 100 a day and 10 per customer a day. Those two numbers are limits, not prices. Set either one to 0 to stop model calls. Past the cap, listed jobs still use the rate sheet. Unlisted jobs use the keyword library and wait for you. Today’s count is on that same Rates screen and resets at midnight Eastern.

## Turn on the AI match (optional)

Listed services can still get a short note from the description. That note uses OpenAI (`gpt-4.1-mini`). Unlisted jobs use Claude to pick library items, then OpenAI if Claude is unavailable, then keywords. No model sets a dollar amount. If both keys are missing or the calls fail, the quote still works.

1. Create an Anthropic key and set `ANTHROPIC_API_KEY`. Leave `ANTHROPIC_MODEL=claude-sonnet-5-5` unless you want a different Claude model.
2. Create an OpenAI key at [https://platform.openai.com](https://platform.openai.com). Put a spending limit on it.
3. Set `OPENAI_API_KEY` in `.env.local`. Leave `OPENAI_MODEL=gpt-4.1-mini` unless you want a different model. Listed jobs use this key. Unlisted jobs use it only when Claude does not answer.

## Road miles (optional)

Travel is $1 per one-way mile with a $50 minimum, unless you change those numbers. The first stop of a crew's day is measured from the shop (1339 N Mitchell St, Cadillac, by default). Later stops are measured from that crew's previous job. A paid job keeps its travel number even if you move the crew.

Without a routing key, miles are straight-line distance times the road factor (1.25). ZIP codes that have no map point use the miles column in the ZIP table the same way.

For real road miles, create a free key at [https://openrouteservice.org](https://openrouteservice.org) and set `ORS_API_KEY`. The free key has a daily limit, which is enough for this booking volume. Leave `OSRM_BASE_URL` blank unless you are running your own road-routing server.

Addresses are looked up with the free OpenStreetMap search. If that lookup fails, the ZIP center is used.

## Deploying to Vercel

This app is set up for Vercel’s free Hobby plan, with Supabase as the database. Do this only after the SQL files have been run and you have signed in once as the owner on your computer. A deploy without the Supabase keys shows a “not connected” page on purpose.

Sample one-click sign-in stays off on Vercel. It turns off when `NODE_ENV` is `production` or when the Supabase URL, anon key, and service role key are all set. Leave `DEMO_MODE` unset. Setting `DEMO_MODE=true` turns the sample buttons back on, which you do not want on the public site.

1. Push this folder to a Git host Vercel can read.
2. In Vercel, import the repository. Framework preset: Next.js. The build command is `npm run build`.
3. Add these environment variables. Mark the secret ones as sensitive.

Required:

- `NEXT_PUBLIC_SUPABASE_URL` — Project URL from Supabase → Project Settings → API
- `NEXT_PUBLIC_SUPABASE_ANON_KEY` — the anon public key
- `SUPABASE_SERVICE_ROLE_KEY` — the service_role secret. Server only. Never put it in a page or a public chat.
- `ANTHROPIC_API_KEY` — unlisted jobs ask Claude first, inside the daily caps on the Rates screen (100 calls a day and 10 per customer, until you change them)
- `OPENAI_API_KEY` — listed jobs use this for the short note. Unlisted jobs use it when Claude does not answer. Same daily caps, one count per quote.
- `OWNER_EMAIL` — the same email you set as the owner
- `NEXT_PUBLIC_APP_URL` — the `https://` address Vercel gives you, or your custom domain. PayPal sends customers back here.

Optional:

- `RESEND_API_KEY` and `RESEND_FROM_EMAIL` — live email. Without them, messages stay in the owner queue and are not delivered.
- `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET`, and `PAYPAL_ENV` (`sandbox` or `live`)
- `ORS_API_KEY` — real road miles. Without it, travel uses straight-line distance times 1.25.
- `OPENAI_MODEL` — leave as `gpt-4.1-mini` unless you want a different model for listed-job notes and the unlisted fallback.
- `ANTHROPIC_MODEL` — leave as `claude-sonnet-5-5` unless you want a different Claude model for unlisted jobs.

4. In Supabase, open **Authentication → URL configuration**. Set **Site URL** to the Vercel `https://` domain. Add that same domain under **Redirect URLs**, including `https://your-app.vercel.app/**`. Sign-in fails if these still point at localhost.
5. Deploy, open the site, and sign in with the owner email and password. The sample buttons should not be on the sign-in page.
6. On **Rates**, the AI quotes card shows how many model calls have been used today. When the cap is hit, listed jobs still quote from the rate sheet. Unlisted jobs use the keyword library and wait for you.

Run `supabase/migrations/20261027120000_ai_usage.sql` in the SQL Editor if you have not already. That table is what the daily cap and the IP limits use.

If the Supabase free project pauses, open the Supabase dashboard and restore it. The site works again after that. No jobs are deleted by the pause.

## What you should change first

- Shop address, if it is ever not 1339 N Mitchell St. Latitude and longitude should match. The starting point is the shop’s map location.
- Every rate marked **example**. Those are public-range starting numbers, not a promise of what you charge.
- Helper rate, travel, cancel fee, deposit threshold, hold hours, and the area-premium counties, if your rules change. They are editable and the booking math uses whatever you save.
- Crew names and workers. Add a password so each person can sign in.
- The email address that receives owner notices.
- The cost library switches under **Library**, when you are licensed for a trade and want it to book directly. Handyman extras start on. Trades and builder work start off.

Leave **RRP certified** off until you actually have the EPA firm certification. While it is off, painting in a pre-1978 home goes to you for review instead of quoting itself.

## How a job moves

1. The customer has an account with a phone number and billing address.
2. They pick a service, answer that service’s questions, and describe the job.
3. Painting, cleaning, mounting, assembly, and hire-a-helper quote from the rate sheet immediately. Other handyman work can quote from the cost library when the description is clear and the library says we do it. The customer sees one firm price. Vague jobs, licensed trades, and builder work at $600 or more wait for you, and the customer sees no range while they wait. You confirm no license is needed, or you refer it out with a note you write yourself. When you release the quote, they approve that one price.
4. A ZIP that is not on the auto-book list also waits for you. The customer can request a time, but the 24-hour payment clock and the invoice start only after you approve the address.
5. Under $1,500 is paid in full. $1,500 or more is half down, and the leftover cent stays on the balance. The balance is due after the customer approves the finished work.
6. Before work starts, cancel or reschedule keeps $50 (or whatever cancel fee you saved) and refunds the rest. If they paid that fee or less, the refund is $0.
7. On site, before work starts, you or the crew can cancel and refund everything except that job's travel charge. The usual cancel fee does not also apply. Or you can enter a new total and a short reason. The customer approves or declines. A higher price follows the same deposit rule on the new total. A lower price refunds the difference. Declining refunds everything except travel. Work cannot start while that approval is waiting, or while an extra amount from the new price is still unpaid.
8. After work starts, the customer can only request a cancellation. You approve or decline and type the refund yourself. The box starts empty on purpose.
9. The area premium (20% in Grand Traverse, Leelanau, Emmet, and Charlevoix) applies to labor and service, including helpers. It is never applied to travel.

The closest free crew is assigned automatically. A tie goes to the crew with fewer jobs that day. You can reassign. A paid job keeps its locked travel.
