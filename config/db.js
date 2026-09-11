const sqlite3 = require("sqlite3").verbose();
const path = require("path");
const fs = require("fs");

const bundledDbPath = path.resolve(__dirname, "../tlmps.db");
const dbPath = process.env.DB_PATH ? path.resolve(process.env.DB_PATH) : bundledDbPath;

if (dbPath !== bundledDbPath && !fs.existsSync(dbPath) && fs.existsSync(bundledDbPath)) {
  fs.copyFileSync(bundledDbPath, dbPath);
}

const db = new sqlite3.Database(dbPath);

db.serialize(() => {
  db.run("PRAGMA foreign_keys = ON");
  // 1. ACADEMIC SESSIONS & TERMS
  db.run(`CREATE TABLE IF NOT EXISTS academic_sessions (
    session_id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_name TEXT UNIQUE NOT NULL
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS academic_terms (
    term_id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id INTEGER,
    term_name TEXT NOT NULL,
    term_number INTEGER DEFAULT 1,
    term_status TEXT DEFAULT 'Active' CHECK (term_status IN ('Pending', 'Active', 'Concluded')),
    days_school_opened INTEGER DEFAULT 60,
    vacation_date TEXT,
    resumption_date TEXT,
    next_term_resumes TEXT,
    is_published INTEGER DEFAULT 0,
    FOREIGN KEY(session_id) REFERENCES academic_sessions(session_id) ON DELETE CASCADE
  )`);

  // 2. SUBJECTS
  db.run(`CREATE TABLE IF NOT EXISTS subjects (
    subject_id INTEGER PRIMARY KEY AUTOINCREMENT,
    subject_name TEXT NOT NULL,
    level_category TEXT CHECK (level_category IN ('JSS', 'SSS')),
    unit_weight INTEGER DEFAULT 1
  )`);

  // 3. STUDENTS
  db.run(`CREATE TABLE IF NOT EXISTS students (
    admission_no TEXT PRIMARY KEY,
    surname TEXT NOT NULL,
    middle_name TEXT,
    last_name TEXT NOT NULL,
    class_name TEXT NOT NULL,
    department TEXT,
    gender TEXT,
    phone_number TEXT,
    email TEXT,
    address TEXT,
    state_of_origin TEXT,
    lga TEXT,
    dob TEXT,
    club TEXT,
    society TEXT,
    passport_url TEXT,
    password_hash TEXT,
    nin_hash TEXT,
    lassra_hash TEXT,
    nin_encrypted TEXT,
    lassra_encrypted TEXT
  )`);

  // Migration: Ensure department column exists if table was created previously
  db.run(`ALTER TABLE students ADD COLUMN department TEXT`, (err) => {
    // Ignore error if column already exists
  });
  db.run(`ALTER TABLE students ADD COLUMN password_hash TEXT`, () => {});
  db.run(`ALTER TABLE students ADD COLUMN nin_hash TEXT`, () => {});
  db.run(`ALTER TABLE students ADD COLUMN lassra_hash TEXT`, () => {});
  db.run(`ALTER TABLE students ADD COLUMN nin_encrypted TEXT`, () => {});
  db.run(`ALTER TABLE students ADD COLUMN lassra_encrypted TEXT`, () => {});

  // Migrations for databases created before term lifecycle support.
  db.run(
    `ALTER TABLE academic_terms ADD COLUMN term_number INTEGER DEFAULT 1`,
    () => {},
  );
  db.run(
    `ALTER TABLE academic_terms ADD COLUMN term_status TEXT DEFAULT 'Active'`,
    () => {},
  );

  // Auto-heal term_number based on term_name to prevent term_number mismatch
  db.run(`UPDATE academic_terms SET term_number = 1 WHERE term_name = 'First Term' AND (term_number IS NULL OR term_number != 1)`);
  db.run(`UPDATE academic_terms SET term_number = 2 WHERE term_name = 'Second Term' AND (term_number IS NULL OR term_number != 2)`);
  db.run(`UPDATE academic_terms SET term_number = 3 WHERE term_name = 'Third Term' AND (term_number IS NULL OR term_number != 3)`);

  db.run(`CREATE TABLE IF NOT EXISTS academic_session_enrollments (
    enrollment_id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id INTEGER NOT NULL,
    admission_no TEXT NOT NULL,
    class_name TEXT NOT NULL,
    department TEXT,
    promotion_status TEXT DEFAULT 'Enrolled',
    promotion_average REAL,
    override_reason TEXT,
    enrollment_status TEXT DEFAULT 'Enrolled' CHECK (enrollment_status IN ('Enrolled', 'Graduated', 'Alumni')),
    UNIQUE(session_id, admission_no),
    FOREIGN KEY(session_id) REFERENCES academic_sessions(session_id) ON DELETE CASCADE,
    FOREIGN KEY(admission_no) REFERENCES students(admission_no) ON DELETE CASCADE
  )`);

  // 4. STUDENT SUBJECT SELECTIONS
  db.run(`CREATE TABLE IF NOT EXISTS student_subject_selections (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    admission_no TEXT,
    subject_id INTEGER,
    session_id INTEGER,
    FOREIGN KEY(admission_no) REFERENCES students(admission_no) ON DELETE CASCADE,
    FOREIGN KEY(subject_id) REFERENCES subjects(subject_id) ON DELETE CASCADE,
    FOREIGN KEY(session_id) REFERENCES academic_sessions(session_id) ON DELETE CASCADE
  )`);

  db.run(`ALTER TABLE academic_session_enrollments ADD COLUMN department TEXT`, () => {});
  db.run(`ALTER TABLE academic_session_enrollments ADD COLUMN promotion_status TEXT DEFAULT 'Enrolled'`, () => {});
  db.run(`ALTER TABLE academic_session_enrollments ADD COLUMN promotion_average REAL`, () => {});
  db.run(`ALTER TABLE academic_session_enrollments ADD COLUMN override_reason TEXT`, () => {});
  db.run(`ALTER TABLE academic_sessions ADD COLUMN is_archived INTEGER NOT NULL DEFAULT 0`, () => {});
  db.run(`ALTER TABLE academic_sessions ADD COLUMN original_session_name TEXT`, () => {});
  db.run(`UPDATE academic_sessions SET original_session_name = session_name WHERE original_session_name IS NULL`);

  db.run(`CREATE UNIQUE INDEX IF NOT EXISTS idx_subject_selection_once_per_session
    ON student_subject_selections(admission_no, session_id, subject_id)`);

  db.run(
    `ALTER TABLE student_subject_selections ADD COLUMN session_id INTEGER`,
    () => {
      db.run(`UPDATE student_subject_selections
      SET session_id = (
        SELECT e.session_id FROM academic_session_enrollments e
        WHERE e.admission_no = student_subject_selections.admission_no
        ORDER BY e.session_id DESC LIMIT 1
      )
      WHERE session_id IS NULL`);
    },
  );

  db.run(`CREATE TABLE IF NOT EXISTS student_scores (
    score_id INTEGER PRIMARY KEY AUTOINCREMENT,
    admission_no TEXT NOT NULL,
    session_id INTEGER NOT NULL,
    term_id INTEGER NOT NULL,
    subject_id INTEGER NOT NULL,
    class_name TEXT NOT NULL,
    ca_score REAL NOT NULL DEFAULT 0 CHECK(ca_score BETWEEN 0 AND 40),
    mcq_score REAL NOT NULL DEFAULT 0 CHECK(mcq_score BETWEEN 0 AND 60),
    theory_score REAL NOT NULL DEFAULT 0 CHECK(theory_score BETWEEN 0 AND 60),
    exam_score REAL NOT NULL DEFAULT 0 CHECK(exam_score BETWEEN 0 AND 60),
    total_score REAL NOT NULL DEFAULT 0 CHECK(total_score BETWEEN 0 AND 100),
    UNIQUE(admission_no, session_id, term_id, subject_id)
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS class_teacher_remarks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    admission_no TEXT NOT NULL,
    session_id INTEGER NOT NULL,
    term_id INTEGER NOT NULL,
    class_name TEXT NOT NULL,
    teacher_name TEXT,
    days_present INTEGER DEFAULT 0 CHECK(days_present >= 0),
    days_absent INTEGER DEFAULT 0 CHECK(days_absent >= 0),
    teacher_comment TEXT DEFAULT '',
    conduct_rating INTEGER DEFAULT 5 CHECK(conduct_rating BETWEEN 1 AND 5),
    UNIQUE(admission_no, session_id, term_id),
    FOREIGN KEY(admission_no) REFERENCES students(admission_no) ON DELETE CASCADE,
    FOREIGN KEY(session_id) REFERENCES academic_sessions(session_id) ON DELETE CASCADE,
    FOREIGN KEY(term_id) REFERENCES academic_terms(term_id) ON DELETE CASCADE
  )`);

  // 5. TERM ATTENDANCE
  // Attendance is scoped to a term so records remain tied to the enrolment
  // roster and cannot be confused across academic sessions.
  db.run(`CREATE TABLE IF NOT EXISTS attendance_days (
    attendance_day_id INTEGER PRIMARY KEY AUTOINCREMENT,
    term_id INTEGER NOT NULL,
    attendance_date TEXT NOT NULL,
    is_holiday INTEGER NOT NULL DEFAULT 0 CHECK(is_holiday IN (0, 1)),
    holiday_name TEXT,
    UNIQUE(term_id, attendance_date),
    FOREIGN KEY(term_id) REFERENCES academic_terms(term_id) ON DELETE CASCADE
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS attendance_records (
    attendance_id INTEGER PRIMARY KEY AUTOINCREMENT,
    term_id INTEGER NOT NULL,
    attendance_date TEXT NOT NULL,
    admission_no TEXT NOT NULL,
    status TEXT NOT NULL CHECK(status IN ('P', 'A')),
    UNIQUE(term_id, attendance_date, admission_no),
    FOREIGN KEY(term_id) REFERENCES academic_terms(term_id) ON DELETE CASCADE,
    FOREIGN KEY(admission_no) REFERENCES students(admission_no) ON DELETE CASCADE
  )`);

  db.run(`CREATE INDEX IF NOT EXISTS idx_attendance_days_term_date
    ON attendance_days(term_id, attendance_date)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_attendance_records_term_date
    ON attendance_records(term_id, attendance_date)`);

  ["punctuality", "neatness", "obedience", "honesty", "discipline"].forEach(
    (column) =>
      db.run(
        `ALTER TABLE class_teacher_remarks ADD COLUMN ${column} INTEGER DEFAULT 5 CHECK(${column} BETWEEN 1 AND 5)`,
        () => {},
      ),
  );

  db.get(
    `SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'student_scores'`,
    [],
    (err, table) => {
      if (
        !table ||
        (table.sql.includes("exam_score") &&
          table.sql.includes("mcq_score BETWEEN 0 AND 60") &&
          table.sql.includes("theory_score BETWEEN 0 AND 60") &&
          table.sql.includes("total_score BETWEEN 0 AND 100"))
      )
        return;
      db.serialize(() => {
        db.run(`ALTER TABLE student_scores RENAME TO student_scores_old`);
        db.run(`CREATE TABLE student_scores (
          score_id INTEGER PRIMARY KEY AUTOINCREMENT,
          admission_no TEXT NOT NULL,
          session_id INTEGER NOT NULL,
          term_id INTEGER NOT NULL,
          subject_id INTEGER NOT NULL,
          class_name TEXT NOT NULL,
          ca_score REAL NOT NULL DEFAULT 0 CHECK(ca_score BETWEEN 0 AND 40),
          mcq_score REAL NOT NULL DEFAULT 0 CHECK(mcq_score BETWEEN 0 AND 60),
          theory_score REAL NOT NULL DEFAULT 0 CHECK(theory_score BETWEEN 0 AND 60),
          exam_score REAL NOT NULL DEFAULT 0 CHECK(exam_score BETWEEN 0 AND 60),
          total_score REAL NOT NULL DEFAULT 0 CHECK(total_score BETWEEN 0 AND 100),
          UNIQUE(admission_no, session_id, term_id, subject_id)
        )`);
        db.run(
          `INSERT INTO student_scores (score_id, admission_no, session_id, term_id, subject_id, class_name, ca_score, mcq_score, theory_score, exam_score, total_score) SELECT score_id, admission_no, session_id, term_id, subject_id, class_name, MIN(ca_score, 40), MIN(mcq_score, 60), MIN(theory_score, 60), MIN(mcq_score + theory_score, 60), MIN(MIN(ca_score, 40) + MIN(mcq_score + theory_score, 60), 100) FROM student_scores_old`,
        );
        db.run(`DROP TABLE student_scores_old`);
      });
    },
  );

  // SQLite cannot alter a CHECK constraint in place. Rebuild this one table
  // (and its dependent remarks table) once so Pending terms work on databases
  // created before the term lifecycle was introduced.
  db.get(
    `SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'academic_terms'`,
    [],
    (err, table) => {
      if (err || !table || table.sql.includes("'Pending'")) return;
      db.exec(
        `PRAGMA foreign_keys = OFF;
         BEGIN TRANSACTION;
         ALTER TABLE class_teacher_remarks RENAME TO class_teacher_remarks_old;
         ALTER TABLE academic_terms RENAME TO academic_terms_old;
         CREATE TABLE academic_terms (
           term_id INTEGER PRIMARY KEY AUTOINCREMENT,
           session_id INTEGER,
           term_name TEXT NOT NULL,
           term_number INTEGER DEFAULT 1,
           term_status TEXT DEFAULT 'Active' CHECK (term_status IN ('Pending', 'Active', 'Concluded')),
           days_school_opened INTEGER DEFAULT 60,
           vacation_date TEXT,
           resumption_date TEXT,
           next_term_resumes TEXT,
           is_published INTEGER DEFAULT 0,
           FOREIGN KEY(session_id) REFERENCES academic_sessions(session_id) ON DELETE CASCADE
         );
         INSERT INTO academic_terms (term_id, session_id, term_name, term_number, term_status, days_school_opened, vacation_date, resumption_date, next_term_resumes, is_published)
           SELECT term_id, session_id, term_name, term_number, term_status, days_school_opened, vacation_date, resumption_date, next_term_resumes, is_published FROM academic_terms_old;
         CREATE TABLE class_teacher_remarks (
           id INTEGER PRIMARY KEY AUTOINCREMENT,
           admission_no TEXT NOT NULL, session_id INTEGER NOT NULL, term_id INTEGER NOT NULL,
           class_name TEXT NOT NULL, teacher_name TEXT, days_present INTEGER DEFAULT 0 CHECK(days_present >= 0),
           days_absent INTEGER DEFAULT 0 CHECK(days_absent >= 0), teacher_comment TEXT DEFAULT '',
           conduct_rating INTEGER DEFAULT 5 CHECK(conduct_rating BETWEEN 1 AND 5),
           punctuality INTEGER DEFAULT 5 CHECK(punctuality BETWEEN 1 AND 5), neatness INTEGER DEFAULT 5 CHECK(neatness BETWEEN 1 AND 5),
           obedience INTEGER DEFAULT 5 CHECK(obedience BETWEEN 1 AND 5), honesty INTEGER DEFAULT 5 CHECK(honesty BETWEEN 1 AND 5), discipline INTEGER DEFAULT 5 CHECK(discipline BETWEEN 1 AND 5),
           UNIQUE(admission_no, session_id, term_id),
           FOREIGN KEY(admission_no) REFERENCES students(admission_no) ON DELETE CASCADE,
           FOREIGN KEY(session_id) REFERENCES academic_sessions(session_id) ON DELETE CASCADE,
           FOREIGN KEY(term_id) REFERENCES academic_terms(term_id) ON DELETE CASCADE
         );
         INSERT INTO class_teacher_remarks (id, admission_no, session_id, term_id, class_name, teacher_name, days_present, days_absent, teacher_comment, conduct_rating, punctuality, neatness, obedience, honesty, discipline)
           SELECT id, admission_no, session_id, term_id, class_name, teacher_name, days_present, days_absent, teacher_comment, conduct_rating, punctuality, neatness, obedience, honesty, discipline FROM class_teacher_remarks_old;
         DROP TABLE class_teacher_remarks_old;
         DROP TABLE academic_terms_old;
         COMMIT;
         PRAGMA foreign_keys = ON;`,
        (migrationErr) => {
          if (migrationErr) console.error("Term lifecycle migration failed:", migrationErr.message);
        },
      );
    },
  );
});

module.exports = db;
