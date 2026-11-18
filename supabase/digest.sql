-- Proptii 09:30 digest: schedule the Edge Function Mon–Fri at 09:30 Europe/London.
-- Run AFTER you have deployed the digest function and set secrets (see docs/digest-setup.md).
-- Requires: pg_cron and pg_net extensions (usually available on Supabase).

create extension if not exists pg_cron with schema extensions;
create extension if not exists pg_net with schema extensions;

-- Replace YOUR_DIGEST_CRON_SECRET with the same value you set as DIGEST_CRON_SECRET.
-- Replace the project URL if it ever changes.
--
-- To rotate the secret later: update Edge Function secrets, then re-run the schedule block below.

do $$
begin
  -- Unschedule a previous job with the same name, if any.
  if exists (select 1 from cron.job where jobname = 'proptii-digest') then
    perform cron.unschedule('proptii-digest');
  end if;
end $$;

-- 09:30 London ≈ 09:30 UTC in winter (GMT), 08:30 UTC in summer (BST).
-- Supabase cron is UTC. For winter 2026 (until late March): use 30 9 * * 1-5.
-- After clocks change to BST: switch to 30 8 * * 1-5, or use a London-aware runner.
select cron.schedule(
  'proptii-digest',
  '30 9 * * 1-5',
  $$
  select net.http_post(
    url := 'https://rvlnlkltorclmjupjwel.supabase.co/functions/v1/Digest',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-digest-secret', 'YOUR_DIGEST_CRON_SECRET'
    ),
    body := '{}'::jsonb
  );
  $$
);

-- Check it is scheduled:
-- select jobid, jobname, schedule, active from cron.job where jobname = 'proptii-digest';
