const { AsyncLocalStorage } = require("async_hooks");
const { Pool } = require("pg");

const primaryKeys = {
  academic_sessions: "session_id",
  academic_terms: "term_id",
  subjects: "subject_id",
  students: "admission_no",
  academic_session_enrollments: "enrollment_id",
  student_subject_selections: "id",
  student_scores: "score_id",
  attendance_days: "attendance_day_id",
  attendance_records: "attendance_id",
  class_teacher_remarks: "id",
  subject_scores: "score_id",
};

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: Number(process.env.PG_POOL_MAX) || 5,
  connectionTimeoutMillis: 10000,
  idleTimeoutMillis: 30000,
});
const transactions = new AsyncLocalStorage();

pool.on("error", (error) => {
  console.error("Idle Supabase Postgres connection error:", error.code || "unknown");
});

function replacePlaceholders(sql) {
  let result = "";
  let parameter = 0;
  let inSingleQuote = false;
  let inDoubleQuote = false;
  let inLineComment = false;
  let inBlockComment = false;

  for (let index = 0; index < sql.length; index += 1) {
    const character = sql[index];
    const next = sql[index + 1];

    if (inLineComment) {
      result += character;
      if (character === "\n") inLineComment = false;
      continue;
    }
    if (inBlockComment) {
      result += character;
      if (character === "*" && next === "/") {
        result += next;
        index += 1;
        inBlockComment = false;
      }
      continue;
    }
    if (!inSingleQuote && !inDoubleQuote && character === "-" && next === "-") {
      result += "--";
      index += 1;
      inLineComment = true;
      continue;
    }
    if (!inSingleQuote && !inDoubleQuote && character === "/" && next === "*") {
      result += "/*";
      index += 1;
      inBlockComment = true;
      continue;
    }
    if (character === "'" && !inDoubleQuote) {
      result += character;
      if (inSingleQuote && next === "'") {
        result += next;
        index += 1;
      } else {
        inSingleQuote = !inSingleQuote;
      }
      continue;
    }
    if (character === '"' && !inSingleQuote) {
      result += character;
      if (inDoubleQuote && next === '"') {
        result += next;
        index += 1;
      } else {
        inDoubleQuote = !inDoubleQuote;
      }
      continue;
    }
    if (character === "?" && !inSingleQuote && !inDoubleQuote) {
      parameter += 1;
      result += `$${parameter}`;
      continue;
    }
    result += character;
  }

  return result;
}

function toPostgres(sql) {
  let query = String(sql || "").trim();
  let ignoreConflicts = false;
  query = query.replace(/^INSERT\s+OR\s+IGNORE\s+INTO\b/i, () => {
    ignoreConflicts = true;
    return "INSERT INTO";
  });
  query = query.replace(/^BEGIN\s+TRANSACTION\b/i, "BEGIN");
  query = query.replace(
    /GROUP_CONCAT\s*\(\s*DISTINCT\s+([\s\S]*?)\s*\)/gi,
    "STRING_AGG(DISTINCT ($1)::text, ',')",
  );

  const insertMatch = query.match(/^\s*INSERT\s+INTO\s+(?:public\.)?["`]?([a-zA-Z0-9_]+)["`]?/i);
  const table = insertMatch?.[1];
  const primaryKey = table && primaryKeys[table];
  const hasReturning = /\bRETURNING\b/i.test(query);

  if (ignoreConflicts && !/\bON\s+CONFLICT\b/i.test(query)) {
    query = query.replace(/;?\s*$/, " ON CONFLICT DO NOTHING");
  }
  if (primaryKey && !hasReturning) {
    query = query.replace(/;?\s*$/, ` RETURNING "${primaryKey}"`);
  }
  return replacePlaceholders(query);
}

function callbackArgs(args) {
  const values = [...args];
  const callback =
    typeof values[values.length - 1] === "function" ? values.pop() : null;
  const params =
    values.length === 1 && Array.isArray(values[0]) ? values[0] : values;
  return { callback, params };
}

function runQuery(sql, params, callback, mode) {
  const context = transactions.getStore();
  const executor = context?.client || pool;
  const normalizedSql = toPostgres(sql);
  const execute = () => executor.query(normalizedSql, params);

  if (!context) {
    execute()
      .then((result) => {
        if (!callback) return;
        const row = result.rows[0];
        if (mode === "get") callback(null, row);
        else if (mode === "all") callback(null, result.rows);
        else {
          callback.call(
            {
              changes: result.rowCount,
              lastID: row ? Number(row[Object.keys(row)[0]]) || row[Object.keys(row)[0]] : undefined,
            },
            null,
          );
        }
      })
      .catch((error) => {
        if (callback) callback(error);
        else console.error("Supabase Postgres query failed:", error.code || "unknown");
      });
    return;
  }

  const task = context.pending.then(execute).then(
    (result) => {
      if (/^\s*BEGIN\b/i.test(normalizedSql)) context.inTransaction = true;
      if (/^\s*(COMMIT|ROLLBACK)\b/i.test(normalizedSql)) {
        context.inTransaction = false;
      }
      if (!callback) return result;
      const row = result.rows[0];
      if (mode === "get") callback(null, row);
      else if (mode === "all") callback(null, result.rows);
      else {
        const lastValue = row ? row[Object.keys(row)[0]] : undefined;
        callback.call(
          {
            changes: result.rowCount,
            lastID: lastValue === undefined ? undefined : Number(lastValue) || lastValue,
          },
          null,
        );
      }
      return result;
    },
    (error) => {
      if (callback) {
        callback(error);
        return null;
      }
      throw error;
    },
  );
  context.pending = task;
}

function get(sql, params, callback) {
  if (typeof params === "function") {
    callback = params;
    params = [];
  }
  runQuery(sql, params || [], callback, "get");
}

function all(sql, params, callback) {
  if (typeof params === "function") {
    callback = params;
    params = [];
  }
  runQuery(sql, params || [], callback, "all");
}

function run(sql, params, callback) {
  const parsed = callbackArgs(arguments.length > 1 ? [...arguments].slice(1) : []);
  runQuery(sql, parsed.params, parsed.callback, "run");
  return this;
}

function prepare(sql) {
  return {
    run(...args) {
      const parsed = callbackArgs(args);
      runQuery(sql, parsed.params, parsed.callback, "run");
      return this;
    },
    finalize(callback) {
      const context = transactions.getStore();
      if (context && callback) {
        const task = context.pending.then(
          () => callback(null),
          (error) => callback(error),
        );
        context.pending = task;
      } else if (callback) {
        Promise.resolve().then(() => callback(null));
      }
      return this;
    },
  };
}

function serialize(callback) {
  if (transactions.getStore()) {
    callback();
    return;
  }

  pool
    .connect()
    .then((client) => {
      const context = {
        client,
        pending: Promise.resolve(),
        inTransaction: false,
      };
      transactions.run(context, () => {
        try {
          callback();
        } catch (error) {
          context.pending = context.pending.then(() => {
            throw error;
          });
        }
      });

      const drain = async () => {
        try {
          let pending;
          do {
            pending = context.pending;
            await pending;
          } while (pending !== context.pending);
          if (context.inTransaction) await client.query("ROLLBACK");
        } catch (error) {
          if (context.inTransaction) {
            try {
              await client.query("ROLLBACK");
            } catch (rollbackError) {
              console.error("Could not roll back Supabase Postgres transaction:", rollbackError.code || "unknown");
            }
          }
          console.error("Supabase Postgres transaction failed:", error.code || "unknown");
        } finally {
          client.release();
        }
      };
      drain();
    })
    .catch((error) => {
      console.error("Could not acquire a Supabase Postgres connection:", error.code || "unknown");
    });
}

function exec(sql, callback) {
  runQuery(sql, [], callback, "run");
}

module.exports = {
  all,
  close: (callback) => pool.end().then(() => callback?.(null)).catch((error) => callback?.(error)),
  exec,
  get,
  prepare,
  run,
  serialize,
};
