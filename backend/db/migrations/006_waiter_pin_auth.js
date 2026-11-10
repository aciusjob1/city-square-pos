require('dotenv').config();
const crypto = require('crypto');
const bcrypt = require('bcryptjs');

exports.up = async function (knex) {
  // 1) Columns on users
  await knex.raw(`ALTER TABLE users ADD COLUMN IF NOT EXISTS pin_hash TEXT NULL;`);
  await knex.raw(`ALTER TABLE users ADD COLUMN IF NOT EXISTS pin_lookup TEXT NULL;`);
  await knex.raw(`ALTER TABLE users ADD COLUMN IF NOT EXISTS pin_set_at TIMESTAMPTZ NULL;`);

  // 2) Duplicate-PIN prevention.
  //    Postgres forbids subqueries inside partial-index predicates, so this
  //    is a plain partial index on pin_lookup. The namespace is global —
  //    no two users (any role) can share a PIN. That's correct: if we ever
  //    give cashiers or admins a PIN, they must not collide with waiters.
  await knex.raw(`
    CREATE UNIQUE INDEX IF NOT EXISTS users_pin_lookup_unique
      ON users (pin_lookup)
      WHERE pin_lookup IS NOT NULL;
  `);

  // 3) Rate-limit log: one row per PIN attempt, keyed by IP.
  await knex.raw(`
    CREATE TABLE IF NOT EXISTS pin_attempts_log (
      id BIGSERIAL PRIMARY KEY,
      ip_address TEXT NOT NULL,
      attempted_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
  await knex.raw(`
    CREATE INDEX IF NOT EXISTS pin_attempts_log_ip_time_index
      ON pin_attempts_log (ip_address, attempted_at DESC);
  `);

  // 4) Backfill: assign PINs to active WAITERs that don't have one yet.
  const secret = process.env.JWT_SECRET || 'dev-only-change-me';

  const waiters = await knex.raw(`
    SELECT u.id, u.username
      FROM users u
      JOIN roles r ON r.id = u.role_id
     WHERE r.name = 'WAITER'
       AND u.is_active = true
       AND u.pin_lookup IS NULL
     ORDER BY u.username
  `);
  const rows = waiters.rows;

  if (rows.length > 0) {
    // Distinct PINs: 1234, 1235, 1236…
    for (let i = 0; i < rows.length; i++) {
      const pin = String(1234 + i);
      const lookup = crypto.createHash('sha256')
        .update(pin + ':' + secret)
        .digest('hex');
      const hash = await bcrypt.hash(pin, 10);
      await knex.raw(
        `UPDATE users SET pin_hash = ?, pin_lookup = ?, pin_set_at = now() WHERE id = ?`,
        [hash, lookup, rows[i].id],
      );
      console.log(`  PIN ${pin} assigned to ${rows[i].username}`);
    }
  }
};

exports.down = async function (knex) {
  await knex.raw(`DROP TABLE IF EXISTS pin_attempts_log;`);
  await knex.raw(`DROP INDEX IF EXISTS users_pin_lookup_unique;`);
  await knex.raw(`ALTER TABLE users DROP COLUMN IF EXISTS pin_set_at;`);
  await knex.raw(`ALTER TABLE users DROP COLUMN IF EXISTS pin_lookup;`);
  await knex.raw(`ALTER TABLE users DROP COLUMN IF EXISTS pin_hash;`);
};
