/**
 * MongoDB Optimization Migration
 * ================================
 * Applies TTL indexes and missing query indexes to existing collections
 * so that ephemeral data auto-purges and common queries hit indexes.
 *
 * Run ONCE against the live Atlas cluster:
 *   node scripts/mongo-optimize.mjs
 *
 * Safe to re-run: createIndex is idempotent. Atlas applies background
 * rolling index builds so there is no downtime.
 *
 * Required env: MONGO_URI (same value used by the app)
 */

import { MongoClient } from "mongodb";

const uri = process.env.MONGO_URI;
if (!uri) {
  console.error("ERROR: MONGO_URI env var is not set.");
  process.exit(1);
}

const client = new MongoClient(uri);

async function run() {
  await client.connect();
  const db = client.db(); // uses the database in the URI
  console.log(`Connected to: ${db.databaseName}\n`);

  const ops = [
    // ── notifications ─────────────────────────────────────────────────────
    // Primary query filter: find unread by receiver
    {
      col: "notifications",
      index: { receiverId: 1, isRead: 1, createdAt: -1 },
      opts: { name: "receiverId_isRead_createdAt", background: true },
    },
    // Auto-delete notifications older than 90 days
    {
      col: "notifications",
      index: { createdAt: 1 },
      opts: { name: "ttl_notifications_90d", expireAfterSeconds: 90 * 86400, background: true },
    },

    // ── auth_sessions ──────────────────────────────────────────────────────
    // Auto-delete sessions 7 days after expiry (grace period for audit)
    {
      col: "auth_sessions",
      index: { expiresAt: 1 },
      opts: { name: "ttl_auth_sessions_7d_after_expiry", expireAfterSeconds: 7 * 86400, background: true },
    },

    // ── user_activity ──────────────────────────────────────────────────────
    // Auto-purge activity events older than 30 days
    {
      col: "user_activity",
      index: { createdAt: 1 },
      opts: { name: "ttl_user_activity_30d", expireAfterSeconds: 30 * 86400, background: true },
    },

    // ── user_presence ──────────────────────────────────────────────────────
    // Auto-purge stale presence records after 24 hours of no update
    {
      col: "user_presence",
      index: { last_seen_at: 1 },
      opts: { name: "ttl_user_presence_24h", expireAfterSeconds: 86400, background: true },
    },

    // ── signup_verification_otps ───────────────────────────────────────────
    // Already has expires_at; add TTL so MongoDB GC fires automatically
    {
      col: "signup_verification_otps",
      index: { expires_at: 1 },
      opts: { name: "ttl_signup_otps", expireAfterSeconds: 0, background: true },
    },

    // ── ops_events ─────────────────────────────────────────────────────────
    // Delete resolved info/warning events older than 60 days
    {
      col: "ops_events",
      index: { createdAt: 1 },
      opts: {
        name: "ttl_ops_events_resolved_60d",
        expireAfterSeconds: 60 * 86400,
        partialFilterExpression: { severity: { $in: ["info", "warning"] }, resolution_status: "resolved" },
        background: true,
      },
    },

    // ── schedule_inventory ─────────────────────────────────────────────────
    // One inventory doc per trainer — index the lookup field
    {
      col: "schedule_inventory",
      index: { trainer_id: 1 },
      opts: { name: "trainer_id_unique", unique: true, background: true },
    },

    // ── user ───────────────────────────────────────────────────────────────
    // Every login does findOne({email}) — without this it's a full collection scan
    {
      col: "user",
      index: { email: 1 },
      opts: { name: "email_unique", unique: true, background: true },
    },
    // Broadcast / cron re-engagement / trainer discovery segment queries
    {
      col: "user",
      index: { account_type: 1, status: 1, createdAt: -1 },
      opts: { name: "account_type_status_createdAt", background: true },
    },

    // ── booked_sessions ────────────────────────────────────────────────────
    {
      col: "booked_sessions",
      index: { trainer_id: 1, status: 1, booked_date: 1 },
      opts: { name: "trainer_status_date", background: true },
    },
    {
      col: "booked_sessions",
      index: { trainee_id: 1, status: 1, booked_date: 1 },
      opts: { name: "trainee_status_date", background: true },
    },
    {
      col: "booked_sessions",
      index: { trainee_id: 1, status: 1, createdAt: -1 },
      opts: { name: "trainee_status_createdAt", background: true },
    },
    // Instant-lesson recovery cron
    {
      col: "booked_sessions",
      index: { is_instant: 1, instant_phase: 1, accept_deadline_at: 1 },
      opts: { name: "instant_phase_accept_deadline", sparse: true, background: true },
    },
    {
      col: "booked_sessions",
      index: { is_instant: 1, instant_phase: 1, join_deadline_at: 1 },
      opts: { name: "instant_phase_join_deadline", sparse: true, background: true },
    },
    // Meeting confirmation cron — aggregate filter
    {
      col: "booked_sessions",
      index: { status: 1, booked_date: 1, session_start_time: 1 },
      opts: { name: "status_date_start_time", background: true },
    },

    // ── escrow_holds ───────────────────────────────────────────────────────
    {
      col: "escrow_holds",
      index: { status: 1, release_eligible_at: 1 },
      opts: { name: "status_release_eligible", background: true },
    },

    // ── chat_conversation ─────────────────────────────────────────────────
    {
      col: "chat_conversation",
      index: { participants: 1, lastMessageAt: -1 },
      opts: { name: "participants_lastMessageAt", background: true },
    },

    // ── availability ───────────────────────────────────────────────────────
    {
      col: "availability",
      index: { trainer_id: 1, status: 1 },
      opts: { name: "trainer_status", background: true },
    },

    // ── clip ──────────────────────────────────────────────────────────────
    {
      col: "clip",
      index: { user_id: 1, clip_scope: 1, status: 1 },
      opts: { name: "user_scope_status", background: true },
    },
    {
      col: "clip",
      index: { clip_scope: 1, status: 1 },
      opts: { name: "scope_status", background: true },
    },

    // ── wallet_ledger_entries ──────────────────────────────────────────────
    {
      col: "wallet_ledger_entries",
      index: { wallet_account_id: 1, createdAt: -1 },
      opts: { name: "wallet_account_createdAt", background: true },
    },

    // ── chat_message ───────────────────────────────────────────────────────
    // Already has these; creating again is a no-op but explicit for safety
    {
      col: "chat_message",
      index: { conversationId: 1, createdAt: -1 },
      opts: { name: "conversation_createdAt", background: true },
    },
  ];

  let ok = 0, skipped = 0, failed = 0;

  for (const op of ops) {
    const col = db.collection(op.col);
    try {
      const existing = await col.indexExists(op.opts.name);
      if (existing) {
        console.log(`  SKIP  ${op.col}.${op.opts.name} — already exists`);
        skipped++;
        continue;
      }
      await col.createIndex(op.index, op.opts);
      console.log(`  OK    ${op.col}.${op.opts.name}`);
      ok++;
    } catch (err) {
      console.error(`  FAIL  ${op.col}.${op.opts.name}: ${err.message}`);
      failed++;
    }
  }

  console.log(`\nDone — ${ok} created, ${skipped} skipped, ${failed} failed`);

  // ── Drop redundant single-field indexes superseded by compound ones ──────
  // These use more RAM than they save because the compound indexes cover them.
  const toDrop = [
    { col: "booked_sessions", name: "status_1" },
    { col: "booked_sessions", name: "trainer_id_1" },
    { col: "booked_sessions", name: "trainee_id_1" },
    { col: "booked_sessions", name: "booked_date_1" },
    { col: "booked_sessions", name: "createdAt_-1" },
  ];

  console.log("\nDropping redundant single-field indexes...");
  for (const op of toDrop) {
    const col = db.collection(op.col);
    try {
      await col.dropIndex(op.name);
      console.log(`  DROPPED  ${op.col}.${op.name}`);
    } catch (err) {
      if (err.codeName === "IndexNotFound") {
        console.log(`  SKIP     ${op.col}.${op.name} — not found`);
      } else {
        console.error(`  FAIL     ${op.col}.${op.name}: ${err.message}`);
      }
    }
  }
}

run()
  .catch(err => { console.error(err); process.exit(1); })
  .finally(() => client.close());
