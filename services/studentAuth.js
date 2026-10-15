const { createClient } = require("@supabase/supabase-js");

const STUDENT_AUTH_DOMAIN = "students.tlmps.invalid";

function normalizeAdmissionNumber(admissionNo) {
  const normalized = String(admissionNo || "").trim();
  if (!/^\d{3,}$/.test(normalized)) {
    throw new Error("Admission number must contain at least three digits.");
  }
  return normalized;
}

function studentAuthEmail(admissionNo) {
  return `student-${normalizeAdmissionNumber(admissionNo)}@${STUDENT_AUTH_DOMAIN}`;
}

function initialStudentPassword(admissionNo, surname) {
  const normalizedAdmissionNo = normalizeAdmissionNumber(admissionNo);
  const normalizedSurname = String(surname || "").trim().toLowerCase();
  if (!normalizedSurname) {
    throw new Error("A student surname is required to create the initial password.");
  }

  const password = `${normalizedSurname}${normalizedAdmissionNo.slice(-3)}`;
  if (password.length < 6) {
    throw new Error("The generated initial password does not meet Supabase's minimum length.");
  }
  return password;
}

class InvalidStudentCredentialsError extends Error {
  constructor() {
    super("Invalid student credentials.");
    this.name = "InvalidStudentCredentialsError";
    this.status = 401;
  }
}

async function signInStudent(admissionNo, password) {
  const normalizedAdmissionNo = normalizeAdmissionNumber(admissionNo);
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey =
    process.env.SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY;
  if (!supabaseUrl || !supabaseKey) {
    throw new Error("Supabase student authentication is not configured.");
  }

  const supabase = createClient(supabaseUrl, supabaseKey, {
    auth: {
      autoRefreshToken: false,
      detectSessionInUrl: false,
      persistSession: false,
    },
  });
  const email = studentAuthEmail(normalizedAdmissionNo);
  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password: String(password || "").trim().toLowerCase(),
  });

  if (error) throw error;
  if (
    !data.user ||
    data.user.email?.toLowerCase() !== email ||
    data.user.app_metadata?.role !== "student" ||
    data.user.app_metadata?.admission_no !== normalizedAdmissionNo
  ) {
    throw new InvalidStudentCredentialsError();
  }
  return data.user;
}

module.exports = {
  InvalidStudentCredentialsError,
  initialStudentPassword,
  signInStudent,
  studentAuthEmail,
};
