import fs from 'fs';
import pg from 'pg';

const { Client } = pg;
const env = fs.readFileSync('/var/www/dev/.env', 'utf8');

function get(name) {
  const re = new RegExp('^' + name + '=(.*)$', 'm');
  const m = env.match(re);
  return m ? m[1].replace(/^"|"$/g, '') : null;
}

const client = new Client({
  connectionString: get('SUPABASE_DB_URL'),
  ssl: { rejectUnauthorized: false }
});

try {
  await client.connect();
  await client.query('begin');
  await client.query('alter table public.courses_nonila disable row level security');
  await client.query('drop policy if exists "Allow listed users to read non-ILA courses" on public.courses_nonila');
  await client.query('grant select on table public.courses_nonila to authenticated');
  await client.query('grant select on table public.courses_nonila to anon');
  await client.query('commit');

  const rls = await client.query("select relrowsecurity from pg_class where relname = 'courses_nonila'");
  const policies = await client.query("select policyname from pg_policies where schemaname='public' and tablename='courses_nonila'");

  console.log(JSON.stringify({
    applied: true,
    relrowsecurity: rls.rows?.[0]?.relrowsecurity,
    policyCount: policies.rowCount
  }, null, 2));
} catch (error) {
  try { await client.query('rollback'); } catch (_) {}
  console.error(error);
  process.exitCode = 1;
} finally {
  await client.end();
}
