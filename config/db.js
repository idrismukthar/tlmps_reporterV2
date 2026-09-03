const sqlite3 = require("sqlite3").verbose();
const path = require("path");

const dbPath = path.resolve(__dirname, "../tlmps.db");
const db = new sqlite3.Database(dbPath);

db.serialize(() => {
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
    term_status TEXT DEFAULT 'Active' CHECK (term_status IN ('Active', 'Concluded')),
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
    passport_url TEXT
  )`);

  // Migration: Ensure department column exists if table was created previously
  db.run(`ALTER TABLE students ADD COLUMN department TEXT`, (err) => {
    // Ignore error if column already exists
  });

  // Migrations for databases created before term lifecycle support.
  db.run(
    `ALTER TABLE academic_terms ADD COLUMN term_number INTEGER DEFAULT 1`,
    () => {},
  );
  db.run(
    `ALTER TABLE academic_terms ADD COLUMN term_status TEXT DEFAULT 'Active'`,
    () => {},
  );

  db.run(`CREATE TABLE IF NOT EXISTS academic_session_enrollments (
    enrollment_id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id INTEGER NOT NULL,
    admission_no TEXT NOT NULL,
    class_name TEXT NOT NULL,
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
});

module.exports = db;
