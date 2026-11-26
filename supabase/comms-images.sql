-- Permanent storage for Comms log images.
-- Run once in Supabase → SQL Editor. Safe to run again.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'comms-images',
  'comms-images',
  true,
  10485760,
  array['image/png','image/jpeg','image/jpg','image/webp','image/gif']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- Anyone can read (so Image URL links keep working in the log, CSV and Chat).
drop policy if exists "comms images public read" on storage.objects;
create policy "comms images public read"
  on storage.objects for select
  to public
  using (bucket_id = 'comms-images');

-- Only signed-in team members can upload.
drop policy if exists "comms images team upload" on storage.objects;
create policy "comms images team upload"
  on storage.objects for insert
  to authenticated
  with check (bucket_id = 'comms-images');

-- Team can replace/delete if needed.
drop policy if exists "comms images team update" on storage.objects;
create policy "comms images team update"
  on storage.objects for update
  to authenticated
  using (bucket_id = 'comms-images')
  with check (bucket_id = 'comms-images');

drop policy if exists "comms images team delete" on storage.objects;
create policy "comms images team delete"
  on storage.objects for delete
  to authenticated
  using (bucket_id = 'comms-images');
