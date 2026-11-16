exports.up = async (knex) => {
  await knex.raw(`
    CREATE TABLE IF NOT EXISTS login_attempts_log (
      id BIGSERIAL PRIMARY KEY,
      ip_address TEXT NOT NULL,
      username TEXT NOT NULL,
      succeeded BOOLEAN NOT NULL DEFAULT false,
      attempted_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
  await knex.raw(`
    CREATE INDEX IF NOT EXISTS login_attempts_log_ip_time_index
      ON login_attempts_log (ip_address, attempted_at DESC);
  `);
  await knex.raw(`
    CREATE INDEX IF NOT EXISTS login_attempts_log_user_time_index
      ON login_attempts_log (username, attempted_at DESC);
  `);
};

exports.down = async (knex) => {
  await knex.raw(`DROP TABLE IF EXISTS login_attempts_log;`);
};
