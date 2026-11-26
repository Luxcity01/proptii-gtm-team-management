// Mirror a temporary image URL (or uploaded file) into permanent Supabase Storage.
// Auth: Authorization Bearer <team user JWT>

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const BUCKET = "comms-images";
const MAX_BYTES = 10 * 1024 * 1024;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
      },
    });
  }

  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  try {
    const auth = req.headers.get("Authorization") || "";
    const jwt = auth.startsWith("Bearer ") ? auth.slice(7) : "";
    if (!jwt) return json({ error: "Sign in to save images permanently." }, 401);

    const url = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const sb = createClient(url, serviceKey);

    const { data: userData, error: userErr } = await sb.auth.getUser(jwt);
    if (userErr || !userData.user) return json({ error: "Invalid or expired sign-in." }, 401);

    const ct = (req.headers.get("content-type") || "").toLowerCase();
    let bytes: Uint8Array;
    let mime = "image/png";
    let baseName = "image";

    if (ct.includes("multipart/form-data")) {
      const form = await req.formData();
      const file = form.get("file");
      if (!(file instanceof File)) return json({ error: "Missing file field." }, 400);
      if (!String(file.type || "").startsWith("image/")) {
        return json({ error: "Only image files are allowed." }, 400);
      }
      if (file.size > MAX_BYTES) return json({ error: "Image is larger than 10MB." }, 400);
      bytes = new Uint8Array(await file.arrayBuffer());
      mime = file.type || "image/png";
      baseName = (file.name || "upload").replace(/\.[^.]+$/, "") || "upload";
    } else {
      const body = await req.json().catch(() => ({})) as { url?: string };
      const source = String(body.url || "").trim();
      if (!source) return json({ error: "Provide url or a file upload." }, 400);
      let sourceUrl: URL;
      try {
        sourceUrl = new URL(source);
      } catch {
        return json({ error: "Invalid image URL." }, 400);
      }
      if (sourceUrl.protocol !== "http:" && sourceUrl.protocol !== "https:") {
        return json({ error: "Only http(s) image URLs are allowed." }, 400);
      }
      // Already in our permanent bucket — return as-is.
      if (source.includes(`/storage/v1/object/public/${BUCKET}/`)) {
        return json({ ok: true, url: source, alreadyPermanent: true });
      }

      const res = await fetch(sourceUrl.href, {
        headers: { Accept: "image/*,application/octet-stream;q=0.9,*/*;q=0.8" },
      });
      if (!res.ok) {
        const text = await res.text();
        let detail = `HTTP ${res.status}`;
        try {
          const j = JSON.parse(text);
          if (j.error) detail = String(j.error);
        } catch { /* ignore */ }
        return json({
          error: `Could not fetch image (${detail}). If this is a GTM Studio link, generate the image again and save it before the file disappears.`,
        }, 502);
      }
      const resCt = (res.headers.get("content-type") || "").toLowerCase();
      if (resCt.includes("application/json")) {
        const j = await res.json().catch(() => ({}));
        return json({ error: j.error || "Image not found at that URL." }, 404);
      }
      const buf = new Uint8Array(await res.arrayBuffer());
      if (buf.byteLength > MAX_BYTES) return json({ error: "Image is larger than 10MB." }, 400);
      if (buf.byteLength < 32) return json({ error: "Response was too small to be an image." }, 502);
      bytes = buf;
      mime = resCt.startsWith("image/") ? resCt.split(";")[0].trim() : guessMime(sourceUrl.pathname);
      baseName = (sourceUrl.pathname.split("/").pop() || "image").replace(/\.[^.]+$/, "") || "image";
    }

    const ext = extForMime(mime);
    const safe = baseName.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "image";
    const path = `${userData.user.id}/${Date.now()}-${safe}.${ext}`;

    const { error: upErr } = await sb.storage.from(BUCKET).upload(path, bytes, {
      contentType: mime,
      upsert: false,
    });
    if (upErr) return json({ error: upErr.message }, 500);

    const { data: pub } = sb.storage.from(BUCKET).getPublicUrl(path);
    return json({ ok: true, url: pub.publicUrl, path });
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});

function extForMime(mime: string): string {
  if (mime.includes("jpeg") || mime.includes("jpg")) return "jpg";
  if (mime.includes("webp")) return "webp";
  if (mime.includes("gif")) return "gif";
  return "png";
}

function guessMime(pathname: string): string {
  const p = pathname.toLowerCase();
  if (p.endsWith(".jpg") || p.endsWith(".jpeg")) return "image/jpeg";
  if (p.endsWith(".webp")) return "image/webp";
  if (p.endsWith(".gif")) return "image/gif";
  return "image/png";
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
    },
  });
}
