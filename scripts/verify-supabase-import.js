require("dotenv").config();
const path = require("path");
const sqlite3 = require("sqlite3").verbose();
const { Client } = require("pg");

async function fetchSqliteCounts(dbPath) {
  return new Promise((resolve, reject) => {
    const db = new sqlite3.Database(dbPath, sqlite3.OPEN_READONLY, (openError) => {
      if (openError) {
        reject(openError);
        return;
      }

      db.all(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
        [],
        async (error, tables) => {
          if (error) {
            reject(error);
            return;
          }

          const counts = {};
          for (const row of tables) {
            const tableName = row.name;
            const result = await new Promise((resolveRow, rejectRow) => {
              db.get(`SELECT COUNT(*) AS count FROM "${tableName}"`, [], (countError, countRow) => {
                if (countError) {
                  rejectRow(countError);
                  return;
                }
                resolveRow(countRow.count);
              });
            });
            counts[tableName] = Number(result);
          }

          db.close();
          resolve(counts);
        },
      );
    });
  });
}

async function fetchPostgresCounts(connectionString) {
  const client = new Client({ connectionString });
  await client.connect();

  const tables = await client.query({
    text: "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE' ORDER BY table_name",
  });

  const counts = {};
  for (const row of tables.rows) {
    const name = row.table_name;
    const result = await client.query({ text: `SELECT COUNT(*) AS count FROM "${name}"` });
    counts[name] = Number(result.rows[0].count);
  }

  await client.end();
  return counts;
}

async function main() {
  const connectionString = process.env.SUPABASE_DATABASE_URL || process.env.DATABASE_URL;
  if (!connectionString) {
    console.log("Skipped import verification because no Postgres connection string was configured.");
    return;
  }

  const dbPath = process.env.DB_PATH || path.resolve(__dirname, "../tlmps.db");
  const sqliteCounts = await fetchSqliteCounts(dbPath);
  const postgresCounts = await fetchPostgresCounts(connectionString);

  const mismatches = [];
  for (const [tableName, sqliteCount] of Object.entries(sqliteCounts)) {
    const postgresCount = postgresCounts[tableName];
    if (postgresCount === undefined || postgresCount !== sqliteCount) {
      mismatches.push({ tableName, sqliteCount, postgresCount });
    }
  }

  if (!mismatches.length) {
    console.log("Supabase import verification passed: row counts match the live SQLite source data.");
    return;
  }

  console.error("Supabase import verification failed. Row-count mismatches:");
  for (const mismatch of mismatches) {
    console.error(`- ${mismatch.tableName}: SQLite=${mismatch.sqliteCount}, Supabase=${mismatch.postgresCount ?? "missing"}`);
  }
  process.exitCode = 1;
}

main().catch((error) => {
  console.error("Could not verify the Supabase import.");
  console.error(error.message || error);
  process.exitCode = 1;
});
