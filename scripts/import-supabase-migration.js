require("dotenv").config();
const fs = require("fs");
const path = require("path");
const { Client } = require("pg");

async function main() {
  const connectionString = process.env.DATABASE_URL || process.env.SUPABASE_DATABASE_URL;
  if (!connectionString) {
    throw new Error("Set DATABASE_URL or SUPABASE_DATABASE_URL before importing.");
  }
  if (/\[PASSWORD\]|\[PROJECT-REF\]|YOUR_NEW_DATABASE_PASSWORD|YOUR_PROJECT_REF|\[YOUR-PASSWORD\]/i.test(connectionString)) {
    throw new Error("The Postgres connection string still contains placeholders.");
  }

  const inputPath = path.resolve(
    process.argv[2] || path.resolve(__dirname, "../backups/tlmps-supabase-migration.sql"),
  );
  const sql = fs.readFileSync(inputPath, "utf8");
  const tableNames = [...sql.matchAll(/^-- Table: ([A-Za-z0-9_]+)$/gm)].map((match) => match[1]);
  if (!tableNames.length || !sql.includes("BEGIN;") || !sql.includes("COMMIT;")) {
    throw new Error("The migration file is missing table definitions or transaction boundaries.");
  }

  const client = new Client({ connectionString, connectionTimeoutMillis: 15000 });
  await client.connect();
  try {
    const existing = await client.query(
      "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE' AND table_name = ANY($1::text[]) ORDER BY table_name",
      [tableNames],
    );
    if (existing.rows.length) {
      throw new Error(
        `Import stopped without changes: target tables already exist (${existing.rows.map((row) => row.table_name).join(", ")}).`,
      );
    }

    await client.query(sql);
    console.log(`Imported ${tableNames.length} tables into Supabase in one transaction.`);
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error("Supabase import failed; connection details were not printed.");
  console.error(error.message || error);
  process.exitCode = 1;
});
