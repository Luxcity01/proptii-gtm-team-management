# 09:30 Google Chat digest — your setup checklist

The digest Edge Function is in `supabase/functions/digest/`. It reads the GTM tracker (account log, channel scorecard Contacted total, traction ladder, and the friction note on the Plan page), posts to Google Chat, and saves a snapshot so the next day can show movement.

Friction still comes from you / UI/UX: paste their notes into **Plan → Daily dashboard → Friction for the digest** before 09:30 when you have them.

---

## A. One-time setup (you)

### 1. Create a Google Chat webhook

1. Open the team Google Chat space (or create one named e.g. “Proptii stand-up”).
2. Open space **Apps & integrations** → **Webhooks** (wording varies: sometimes under the space name menu → Manage webhooks).
3. **Add webhook**, name it `Proptii digest`.
4. Copy the webhook URL. Treat it like a password — anyone with it can post to the space.

### 2. Deploy the Edge Function

On your machine, with the [Supabase CLI](https://supabase.com/docs/guides/cli) installed and logged in:

```bash
cd /Users/USER/proptii-gtm-team-management
supabase login
supabase link --project-ref rvlnlkltorclmjupjwel
supabase functions deploy digest
```

`verify_jwt` is off for this function so cron can call it with a shared secret. User “Send now” still checks a valid team sign-in inside the function.

### 3. Set Edge Function secrets

In [Supabase Dashboard](https://supabase.com/dashboard/project/rvlnlkltorclmjupjwel/settings/functions) → Edge Functions → Secrets (or CLI below), set:

| Secret | Value |
|---|---|
| `GOOGLE_CHAT_WEBHOOK_URL` | The webhook URL from step 1 |
| `DIGEST_CRON_SECRET` | A long random string you invent (e.g. from a password manager) |

CLI example:

```bash
supabase secrets set GOOGLE_CHAT_WEBHOOK_URL='https://chat.googleapis.com/v1/spaces/.../messages?key=...&token=...'
supabase secrets set DIGEST_CRON_SECRET='paste-a-long-random-secret-here'
```

`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are provided automatically to Edge Functions. Do not put the service role key in the frontend.

### 4. Schedule Mon–Fri 09:30

1. Open the SQL in `supabase/digest.sql`.
2. Replace `YOUR_DIGEST_CRON_SECRET` with the **same** value as `DIGEST_CRON_SECRET`.
3. Run the file in Supabase → **SQL Editor**.
4. Confirm the job exists:

```sql
select jobid, jobname, schedule, active from cron.job where jobname = 'proptii-digest';
```

**Timezone note:** cron runs in **UTC**. The file uses `30 9 * * 1-5` (09:30 UTC), which matches **09:30 London in winter (GMT)**. When the UK is on BST (from late March), change the schedule to `30 8 * * 1-5` so it still lands at 09:30 London, or re-run an updated `digest.sql`.

### 5. Smoke-test before you rely on it

1. Open the GTM site (local or deployed), sign in.
2. Plan → Daily dashboard → **Preview only**.  
   This works **before** the Edge Function is deployed. The message appears under the buttons.
3. After deploy + secrets (steps 2–3): **Send digest now**. You should see the same message in Google Chat.
4. Optional curl check once deployed:

```bash
curl -sS -X POST \
  'https://rvlnlkltorclmjupjwel.supabase.co/functions/v1/Digest?dry=1' \
  -H "x-digest-secret: YOUR_DIGEST_CRON_SECRET"
```

If Send says the function was not found / not deployed, finish steps 2–3. Preview does not need the function.

### 6. Mark the automation live

On the Plan page → Automation build list → set **09:30 Google Chat digest, Monday to Friday** to **Live**.

---

## B. Every working day (team habits)

| When | Who | What |
|---|---|---|
| Before 09:30 | Whoever updates the tracker | Keep the **account log** current (rows, Property, Invite, ladder). Update **Contacted** on the scorecard when you outreach. |
| When UI/UX has friction | You or UI/UX | Paste short bullets into **Friction for the digest** on the Daily dashboard. |
| Optional | Anyone | Tick **Stalled** on a landlord, or set **Last active**, so names appear under Stalled. |
| 09:30 | Cron | Digest posts itself. |
| 11:00 | You | Run stand-up from the digest. |
| If Chat is empty | You | Use **Send digest now**, then check secrets / cron / webhook. |

Monday’s movement is “since the last digest” (normally Friday).

---

## C. Ask UI/UX for

A short daily or weekday **friction log**: what slowed landlords on calls (one line each). You paste it into the Plan page field until they have a structured log the digest can read automatically.

---

## D. Ask Head of Engineering for (later)

Product events for account / property / invite / last activity, so the digest can stop relying on manual ticks and can detect stalls without a Stalled checkbox. Same Chat format; only the reader changes.

---

## E. What the message includes

- Three objective numbers + change since last digest  
- Outreached (scorecard Contacted), Activated / Came back / Brought someone from the ladder  
- Stalled names (from Stalled tick or Last active ≥ 3 working days)  
- Friction bullets from the Plan page note  
- Reminder that stand-up is at 11:00  

Source line in the message: GTM tracker, not the product event store (until you swap that in).
