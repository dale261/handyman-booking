# eX Construction LC booking

Customers describe a job, get an itemized quote from your rate sheet, hold a time for 24 hours, and pay. You see the day's route by crew, the review queue, and every rate.

The first time you run it on your own computer, it does not need any paid account. Quotes, the service-area ZIP list, invoices starting at 1000, and sample sign-in all work from a file on that computer. Emails print in the terminal. The Pay button records a demo payment. Road miles are straight-line distance times 1.25 until you add a free routing key.

Do not put that demo mode on the internet. Sample sign-in would let a stranger open the owner screen. Connect the free Supabase project first, then deploy.

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
5. Still in the SQL Editor, run this with your real email:

```sql
update public.app_settings
set owner_email = 'you@your-email.com'
where id = 1;
```

The first person who signs up with that exact email becomes the owner. Everyone else becomes a customer, unless their email matches a worker you already added.

6. Open **Authentication**, then **Providers**, then **Email**. Turn **Confirm email** off. If it stays on, new accounts cannot sign in until they click a message, and the free email setup is easy to get wrong.
7. Open **Project Settings**, then **API**. Copy three values:
   - Project URL
   - `anon` public key
   - `service_role` secret key

The service role key can read every job. It stays in `.env.local` on the server. Never paste it into a web page or a public chat.

8. In this folder, copy `.env.example` to a new file named `.env.local`. Fill in:

```
NEXT_PUBLIC_SUPABASE_URL=the project URL
NEXT_PUBLIC_SUPABASE_ANON_KEY=the anon key
SUPABASE_SERVICE_ROLE_KEY=the service_role key
OWNER_EMAIL=the same email you put in the SQL update
NEXT_PUBLIC_APP_URL=http://127.0.0.1:43123
```

9. Stop the app (Ctrl+C) and run `npm run dev` again.
10. Open the site and create an account with that owner email. You should land on the day-route screen, not the customer job list.

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

## Turn on the AI note (optional)

The price always comes from your rate table. The AI only reads the description and may add a short note or a license warning. It cannot set a dollar amount. If the key is missing or the call fails, the quote still works.

1. Create an API key at [https://platform.openai.com](https://platform.openai.com).
2. Put a spending limit on the key. This is a paid API. A few quotes cost very little, but the limit is what keeps it that way.
3. Set `OPENAI_API_KEY` in `.env.local`. Leave `OPENAI_MODEL=gpt-4.1-mini` unless you want a different model.

## Road miles (optional)

Travel is $1 per one-way mile with a $50 minimum, unless you change those numbers. The first stop of a crew's day is measured from the shop (1339 N Mitchell St, Cadillac, by default). Later stops are measured from that crew's previous job. A paid job keeps its travel number even if you move the crew.

Without a routing key, miles are straight-line distance times the road factor (1.25). ZIP codes that have no map point use the miles column in the ZIP table the same way.

For real road miles, create a free key at [https://openrouteservice.org](https://openrouteservice.org) and set `ORS_API_KEY`. The free key has a daily limit, which is enough for this booking volume. Leave `OSRM_BASE_URL` blank unless you are running your own road-routing server.

Addresses are looked up with the free OpenStreetMap search. If that lookup fails, the ZIP center is used.

## Put it on the internet for free

Do this only after Supabase is connected and you have signed in once as the owner. A deploy without those keys shows a “not connected” page on purpose.

Cloudflare Pages is a free host that allows a business site. Vercel’s free Hobby plan is for personal projects, not a company, so don’t use that for eX Construction.

1. Push this folder to a private Git hosting account.
2. In Cloudflare, create a Pages project from that repository. Build command: `npm run build`. Build output is handled by the Next.js adapter. If Cloudflare asks, use the Next.js preset (OpenNext).
3. Add the same variables from `.env.local` in the Pages environment settings. Set `NEXT_PUBLIC_APP_URL` to the `https://` address Cloudflare gives you.
4. Deploy, open the site, and sign in with the owner email.

Netlify’s free Next.js hosting is another option with the same environment variables. Keep the service role key, Resend key, PayPal secret, and OpenAI key marked as secrets.

Supabase’s free project is the database. If it pauses, open the Supabase dashboard and restore it. The site will work again after that. No jobs are deleted by the pause.

## What you should change first

- Shop address, if it is ever not 1339 N Mitchell St. Latitude and longitude should match. The starting point is the shop’s map location.
- Every rate marked **example**. Those are public-range starting numbers, not a promise of what you charge.
- Helper rate, travel, cancel fee, deposit threshold, hold hours, and the area-premium counties, if your rules change. They are editable and the booking math uses whatever you save.
- Crew names and workers. Add a password so each person can sign in.
- The email address that receives owner notices.

Leave **RRP certified** off until you actually have the EPA firm certification. While it is off, painting in a pre-1978 home goes to you for review instead of quoting itself.

## How a job moves

1. The customer has an account with a phone number and billing address.
2. They pick a service, answer that service’s questions, and describe the job.
3. Painting, cleaning, mounting, assembly, and hire-a-helper quote immediately. Anything else waits for you. You confirm no license is needed, or you refer it out with a note you write yourself.
4. A ZIP that is not on the auto-book list also waits for you. The customer can request a time, but the 24-hour payment clock and the invoice start only after you approve the address.
5. Under $1,500 is paid in full. $1,500 or more is half down, and the leftover cent stays on the balance. The balance is due after the customer approves the finished work.
6. Before work starts, cancel or reschedule keeps $50 (or whatever cancel fee you saved) and refunds the rest. If they paid that fee or less, the refund is $0.
7. After work starts, the customer can only request a cancellation. You approve or decline and type the refund yourself. The box starts empty on purpose.
8. The area premium (20% in Grand Traverse, Leelanau, Emmet, and Charlevoix) applies to labor and service, including helpers. It is never applied to travel.

The closest free crew is assigned automatically. A tie goes to the crew with fewer jobs that day. You can reassign. A paid job keeps its locked travel.
