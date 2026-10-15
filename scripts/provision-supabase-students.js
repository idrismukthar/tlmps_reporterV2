require("dotenv").config();
const { createClient } = require("@supabase/supabase-js");
const { Client } = require("pg");
const {
  initialStudentPassword,
  studentAuthEmail,
} = require("../services/studentAuth");

async function listAllUsers(admin) {
  const users = [];
  let page = 1;
  let hasMore = true;

  while (hasMore) {
    const { data, error } = await admin.auth.admin.listUsers({
      page,
      perPage: 1000,
    });
    if (error) throw error;
    const pageUsers = data.users || [];
    users.push(...pageUsers);
    hasMore = pageUsers.length === 1000;
    page += 1;
  }
  return users;
}

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  const supabaseUrl = process.env.SUPABASE_URL;
  const secretKey =
    process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!databaseUrl || !supabaseUrl || !secretKey) {
    throw new Error(
      "Set DATABASE_URL, SUPABASE_URL, and SUPABASE_SECRET_KEY before provisioning students.",
    );
  }

  const database = new Client({ connectionString: databaseUrl });
  const admin = createClient(supabaseUrl, secretKey, {
    auth: {
      autoRefreshToken: false,
      detectSessionInUrl: false,
      persistSession: false,
    },
  });

  await database.connect();
  try {
    const { rows: students } = await database.query(
      "SELECT admission_no, surname FROM public.students ORDER BY admission_no",
    );
    if (!students.length) {
      throw new Error("No imported students were found in public.students.");
    }

    const seenEmails = new Set();
    const studentsToProvision = students.map((student) => {
      const admissionNo = String(student.admission_no || "").trim();
      const email = studentAuthEmail(admissionNo);
      const password = initialStudentPassword(admissionNo, student.surname);
      if (seenEmails.has(email)) {
        throw new Error("Duplicate admission numbers would create duplicate Auth identities.");
      }
      seenEmails.add(email);
      return { admissionNo, email, password };
    });

    const existingUsers = await listAllUsers(admin);
    const usersByEmail = new Map(
      existingUsers
        .filter((user) => user.email)
        .map((user) => [user.email.toLowerCase(), user]),
    );
    const existingMismatches = studentsToProvision.filter((student) => {
      const user = usersByEmail.get(student.email.toLowerCase());
      return (
        user &&
        (user.app_metadata?.role !== "student" ||
          user.app_metadata?.admission_no !== student.admissionNo)
      );
    });
    if (existingMismatches.length) {
      throw new Error(
        "Provisioning stopped because an Auth identity already exists without the expected server-managed student mapping.",
      );
    }

    let created = 0;
    let alreadyProvisioned = 0;
    for (const student of studentsToProvision) {
      if (usersByEmail.has(student.email.toLowerCase())) {
        alreadyProvisioned += 1;
        continue;
      }

      const { data, error } = await admin.auth.admin.createUser({
        email: student.email,
        password: student.password,
        email_confirm: true,
        app_metadata: {
          admission_no: student.admissionNo,
          role: "student",
        },
      });
      if (error) {
        throw new Error(
          `Could not provision a student Auth account after ${created} new account(s). Rerun after resolving the Supabase Auth error.`,
          { cause: error },
        );
      }
      if (!data.user) {
        throw new Error("Supabase returned no user for a successful Auth account creation.");
      }
      created += 1;
    }

    console.log(
      `Student Auth provisioning complete: ${created} created, ${alreadyProvisioned} already present.`,
    );
    console.log(
      "Initial passwords use lowercase surname plus the final three admission-number digits. Passwords were not printed.",
    );
  } finally {
    await database.end();
  }
}

main().catch((error) => {
  console.error("Student Auth provisioning failed.");
  console.error(error.message || error);
  if (error.cause) {
    console.error(`Supabase Auth error: ${error.cause.message || "unknown error"}`);
  }
  process.exitCode = 1;
});
