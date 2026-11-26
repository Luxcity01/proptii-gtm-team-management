# Permanent Comms image links

GTM Studio’s `/api/download-image/…` URLs die after a Render restart. The Comms log now stores images in **Supabase Storage** (`comms-images` bucket) so Download keeps working.

## One-time setup

### 1. Create the storage bucket

In Supabase → **SQL Editor**, run `supabase/comms-images.sql`.

That creates a public bucket `comms-images` (team can upload; anyone with the URL can view/download).

### 2. Deploy the Edge Function

```bash
cd /Users/USER/proptii-gtm-team-management
npx supabase login
npx supabase link --project-ref rvlnlkltorclmjupjwel
npx supabase functions deploy mirror-comms-image
```

`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are provided automatically. No extra secrets.

### 3. Confirm

1. Soft-refresh the GTM tracker and sign in.
2. Comms log → **Edit** a row → under **Image URL**, click **Upload** (preferred) or paste a live Studio URL and **Save permanently**.
3. The field should become a `…/storage/v1/object/public/comms-images/…` URL with **Saved permanently**.
4. **Download image** should work after a Render restart of GTM Studio.

**Save images** in the toolbar walks every temporary Studio link still in the log and mirrors each one that still exists on the server.

## Day-to-day

| Action | Result |
|---|---|
| **Upload** | File goes straight to Storage; Image URL is permanent |
| **Save permanently** | Fetches the current URL server-side and stores a copy |
| Paste Drive / Dropbox / CDN | Leave as-is (already durable) |
| Paste Studio download link | Temporary until you Save permanently or Upload |

If Save permanently fails with “Image not found”, the Studio file is already gone — regenerate the graphic and **Upload** the file instead of relying on the old link.
