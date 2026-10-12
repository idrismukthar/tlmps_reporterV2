const assert = require("assert");
const { execFileSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");
const sqlite3 = require("sqlite3").verbose();

const tempDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "tlmps-export-attendance-"));
const databasePath = path.join(tempDirectory, "source.sqlite");
const outputPath = path.join(tempDirectory, "attendance.json");
const db = new sqlite3.Database(databasePath);

const exec = (sql) =>
  new Promise((resolve, reject) =>
    db.exec(sql, (error) => (error ? reject(error) : resolve())),
  );
const close = () =>
  new Promise((resolve, reject) =>
    db.close((error) => (error ? reject(error) : resolve())),
  );

const main = async () => {
  try {
    await exec(`
      CREATE TABLE academic_sessions (session_id INTEGER PRIMARY KEY, session_name TEXT);
      CREATE TABLE academic_terms (
        term_id INTEGER PRIMARY KEY, session_id INTEGER, term_name TEXT, term_number INTEGER
      );
      CREATE TABLE attendance_days (
        attendance_date TEXT, term_id INTEGER, is_holiday INTEGER, holiday_name TEXT
      );
      CREATE TABLE attendance_records (
        attendance_date TEXT, term_id INTEGER, admission_no TEXT, status TEXT
      );
      CREATE TABLE students (
        admission_no TEXT PRIMARY KEY, surname TEXT, middle_name TEXT, last_name TEXT,
        class_name TEXT, department TEXT, gender TEXT
      );
      CREATE TABLE academic_session_enrollments (
        session_id INTEGER, admission_no TEXT, class_name TEXT, department TEXT,
        enrollment_status TEXT
      );

      INSERT INTO academic_sessions VALUES (4, '2026/2027');
      INSERT INTO academic_terms VALUES (13, 4, 'First Term', 1);
      INSERT INTO attendance_days VALUES ('2026-09-01', 13, 0, NULL);
      INSERT INTO attendance_records VALUES ('2026-09-01', 13, '26002', 'P');
      INSERT INTO students VALUES ('26002', 'Student', NULL, 'WithMarks', 'JSS1', NULL, 'Female');
      INSERT INTO students VALUES ('26001', 'Student', NULL, 'NoMarksYet', 'JSS1', NULL, 'Male');
      INSERT INTO academic_session_enrollments VALUES (4, '26002', 'JSS1', NULL, 'Enrolled');
      INSERT INTO academic_session_enrollments VALUES (4, '26001', 'JSS1', NULL, 'Enrolled');
    `);
    await close();

    execFileSync(
      process.execPath,
      [path.resolve(__dirname, "../scripts/export-attendance.js"), outputPath, databasePath],
      { stdio: "pipe" },
    );

    const transfer = JSON.parse(fs.readFileSync(outputPath, "utf8"));
    assert.deepEqual(
      transfer.students.map((student) => student.admissionNo),
      ["26001", "26002"],
      "The export must include enrolled students even when they have no marks.",
    );
    assert.deepEqual(
      transfer.enrollments.map((enrollment) => enrollment.admissionNo),
      ["26001", "26002"],
    );
    assert.equal(transfer.records.length, 1);
    assert.equal(Object.hasOwn(transfer.students[0], "passwordHash"), false);
  } finally {
    fs.rmSync(tempDirectory, { recursive: true, force: true });
  }
};

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
