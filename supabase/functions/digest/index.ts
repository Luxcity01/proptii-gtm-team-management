// Proptii 09:30 Google Chat digest.
// Reads the GTM tracker state (account log, scorecard, friction note), posts to Chat, saves a snapshot for movement.
// Auth: Authorization Bearer <user JWT> for "Send now", or header x-digest-secret matching DIGEST_CRON_SECRET for cron.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const LADDER = [
  "Outreached",
  "Interested",
  "Committed",
  "Activated",
  "Got value",
  "Came back",
  "Brought someone",
  "Would pay",
];

type LogRow = {
  name?: string;
  src?: string;
  code?: string;
  ladder?: string | number;
  prop?: number | boolean;
  inv?: number | boolean;
  stalled?: number | boolean;
  lastActive?: string;
};

type Snapshot = {
  date: string;
  accounts: number;
  property: number;
  invite: number;
  contacted: number;
  ladderAbove: number[];
  sentAt: string;
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-digest-secret",
      },
    });
  }

  try {
    const allowed = await authorize(req);
    if (!allowed.ok) {
      return json({ error: allowed.error }, 401);
    }

    const url = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const chatWebhook = Deno.env.get("GOOGLE_CHAT_WEBHOOK_URL");
    if (!chatWebhook) {
      return json({ error: "GOOGLE_CHAT_WEBHOOK_URL is not set. Add it in Edge Function secrets." }, 500);
    }

    const dry = new URL(req.url).searchParams.get("dry") === "1";
    const sb = createClient(url, serviceKey);

    const { data: rows, error } = await sb.from("state").select("key,value");
    if (error) throw error;

    const state: Record<string, unknown> = {};
    for (const r of rows || []) state[r.key] = r.value;

    const log = Array.isArray(state.log) ? (state.log as LogRow[]) : [];
    const score = (state.score && typeof state.score === "object" ? state.score : {}) as Record<
      string,
      { c?: string | number; r?: string | number }
    >;
    const frictionNote = String(state.n_friction_log || "").trim();
    const prev = (state.digest_last && typeof state.digest_last === "object"
      ? state.digest_last
      : null) as Snapshot | null;

    const now = new Date();
    const today = londonDate(now);
    const accounts = log.length;
    const property = log.filter((r) => !!r.prop).length;
    const invite = log.filter((r) => !!r.inv).length;
    const contacted = Object.values(score).reduce((n, v) => n + (parseInt(String(v?.c ?? 0), 10) || 0), 0);
    const ladderAbove = ladderCounts(log);
    const stalled = stalledNames(log, now);

    const snapshot: Snapshot = {
      date: today,
      accounts,
      property,
      invite,
      contacted,
      ladderAbove,
      sentAt: now.toISOString(),
    };

    const message = formatMessage({
      today,
      weekday: londonWeekday(now),
      accounts,
      property,
      invite,
      contacted,
      ladderAbove,
      stalled,
      frictionNote,
      prev,
      isMonday: londonWeekday(now) === "Monday",
    });

    if (!dry) {
      const chatRes = await fetch(chatWebhook, {
        method: "POST",
        headers: { "Content-Type": "application/json; charset=UTF-8" },
        body: JSON.stringify({ text: message }),
      });
      if (!chatRes.ok) {
        const body = await chatRes.text();
        return json({ error: "Google Chat webhook failed", status: chatRes.status, body }, 502);
      }

      const { error: upErr } = await sb.from("state").upsert(
        { key: "digest_last", value: snapshot, client: "digest-fn" },
        { onConflict: "key" },
      );
      if (upErr) throw upErr;

      const history = Array.isArray(state.digest_history) ? (state.digest_history as Snapshot[]) : [];
      history.push(snapshot);
      while (history.length > 40) history.shift();
      await sb.from("state").upsert(
        { key: "digest_history", value: history, client: "digest-fn" },
        { onConflict: "key" },
      );
    }

    return json({
      ok: true,
      dry,
      date: today,
      numbers: { accounts, property, invite, contacted },
      stalled,
      message,
    });
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});

async function authorize(req: Request): Promise<{ ok: true } | { ok: false; error: string }> {
  const cronSecret = Deno.env.get("DIGEST_CRON_SECRET") || "";
  const headerSecret = req.headers.get("x-digest-secret") || "";
  if (cronSecret && headerSecret && headerSecret === cronSecret) return { ok: true };

  const auth = req.headers.get("Authorization") || "";
  const jwt = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!jwt) return { ok: false, error: "Sign in, or pass x-digest-secret for cron." };

  const url = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const sb = createClient(url, serviceKey);
  const { data, error } = await sb.auth.getUser(jwt);
  if (error || !data.user) return { ok: false, error: "Invalid or expired sign-in." };
  return { ok: true };
}

function rung(r: LogRow): number {
  const n = parseInt(String(r.ladder ?? ""), 10);
  return Number.isNaN(n) ? 0 : n;
}

function ladderCounts(log: LogRow[]): number[] {
  const above = LADDER.map(() => 0);
  let contactedProxy = 0;
  // Outreached is filled by the caller from the scorecard; leave index 0 for contacted overlay in the message.
  for (const r of log) {
    const n = rung(r);
    if (n > 1) for (let k = 1; k < n; k++) above[k]++;
  }
  void contactedProxy;
  return above;
}

function stalledNames(log: LogRow[], now: Date): string[] {
  const names: string[] = [];
  for (const r of log) {
    if (r.stalled) {
      names.push(r.name || "(unnamed)");
      continue;
    }
    if (!r.lastActive) continue;
    const last = parseLooseDate(r.lastActive);
    if (!last) continue;
    if (workingDaysBetween(last, now) >= 3) names.push(r.name || "(unnamed)");
  }
  return names;
}

function parseLooseDate(s: string): Date | null {
  const t = String(s).trim().toLowerCase();
  const months = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
  let m = t.match(/(\d{1,2})(?:st|nd|rd|th)?\s*([a-z]{3})/);
  if (m) {
    const d = +m[1];
    const mo = months.indexOf(m[2]);
    if (mo >= 0) return new Date(2026, mo, d);
  }
  m = t.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return new Date(+m[1], +m[2] - 1, +m[3]);
  m = t.match(/^(\d{1,2})[\/.-](\d{1,2})/);
  if (m) return new Date(2026, +m[2] - 1, +m[1]);
  return null;
}

function workingDaysBetween(from: Date, to: Date): number {
  const a = new Date(from);
  a.setHours(0, 0, 0, 0);
  const b = new Date(to);
  b.setHours(0, 0, 0, 0);
  let n = 0;
  for (let d = new Date(a); d < b; d.setDate(d.getDate() + 1)) {
    const day = d.getDay();
    if (day !== 0 && day !== 6) n++;
  }
  return n;
}

function londonDate(d: Date): string {
  return d.toLocaleDateString("en-CA", { timeZone: "Europe/London" });
}

function londonWeekday(d: Date): string {
  return d.toLocaleDateString("en-GB", { timeZone: "Europe/London", weekday: "long" });
}

function delta(cur: number, prev: number | undefined, weekend: boolean): string {
  if (prev == null) return " (no prior digest)";
  const d = cur - prev;
  const label = weekend ? " since Friday" : " since yesterday";
  if (d === 0) return `  (±0${label})`;
  return `  (${d > 0 ? "+" : ""}${d}${label})`;
}

function formatMessage(p: {
  today: string;
  weekday: string;
  accounts: number;
  property: number;
  invite: number;
  contacted: number;
  ladderAbove: number[];
  stalled: string[];
  frictionNote: string;
  prev: Snapshot | null;
  isMonday: boolean;
}): string {
  const weekend = p.isMonday;
  const prev = p.prev;
  const lines: string[] = [];
  lines.push(`*Proptii digest · ${p.weekday} ${formatUk(p.today)}*`);
  lines.push("");
  lines.push("*Objective*");
  lines.push(`• Landlord accounts: ${p.accounts}${delta(p.accounts, prev?.accounts, weekend)}`);
  lines.push(`• With a property: ${p.property}${delta(p.property, prev?.property, weekend)}`);
  lines.push(`• Sent an invite: ${p.invite}${delta(p.invite, prev?.invite, weekend)}`);
  lines.push("");
  lines.push("*Funnel and ladder*");
  lines.push(`• Outreached (Contacted on scorecard): ${p.contacted}${delta(p.contacted, prev?.contacted, weekend)}`);
  lines.push(`• Activated or higher: ${p.ladderAbove[3] || 0}`);
  lines.push(`• Came back or higher: ${p.ladderAbove[5] || 0}`);
  lines.push(`• Brought someone or higher: ${p.ladderAbove[6] || 0}`);
  lines.push("");
  lines.push("*Stalled (3+ working days)*");
  if (p.stalled.length) p.stalled.forEach((n) => lines.push(`• ${n}`));
  else {
    lines.push("• None flagged. Tick Stalled on the account log, or set Last active, to list names here.");
  }
  lines.push("");
  lines.push("*New friction*");
  if (p.frictionNote) {
    p.frictionNote.split(/\n+/).map((l) => l.trim()).filter(Boolean).forEach((l) => {
      lines.push(`• ${l.replace(/^[-•*]\s*/, "")}`);
    });
  } else {
    lines.push("• None on the Plan page yet. Paste UI/UX friction notes into Daily dashboard → Friction for the digest.");
  }
  lines.push("");
  lines.push("_Source: GTM tracker account log, scorecard and friction note. Stand-up at 11:00._");
  return lines.join("\n");
}

function formatUk(isoDate: string): string {
  const [y, m, d] = isoDate.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  return dt.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
    },
  });
}
