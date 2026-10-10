const assert = require("assert");
const sqlite3 = require("sqlite3").verbose();
const { getStudentAttendanceSummary } = require("../services/attendanceSummary");

const db = new sqlite3.Database(":memory:");

const setup = () =>
  new Promise((resolve, reject) => {
    db.exec(
      `CREATE TABLE attendance_records (
         term_id INTEGER NOT NULL, attendance_date TEXT NOT NULL,
         admission_no TEXT NOT NULL, status TEXT NOT NULL
       );
       CREATE TABLE attendance_days (
         term_id INTEGER NOT NULL, attendance_date TEXT NOT NULL,
         is_holiday INTEGER NOT NULL DEFAULT 0
       );
       INSERT INTO attendance_records VALUES
         (1, '2026-09-01', 'STUDENT-1', 'P'),
         (1, '2026-09-01', 'STUDENT-2', 'A'),
         (1, '2026-09-02', 'STUDENT-2', 'P'),
         (1, '2026-09-03', 'STUDENT-2', 'A');
       INSERT INTO attendance_days VALUES (1, '2026-09-03', 1);`,
      (error) => (error ? reject(error) : resolve()),
    );
  });

const close = () =>
  new Promise((resolve, reject) =>
    db.close((error) => (error ? reject(error) : resolve())),
  );

const main = async () => {
  try {
    await setup();
    const firstStudent = await getStudentAttendanceSummary(db, 1, "STUDENT-1");
    assert.equal(firstStudent.days_opened, 2, "Opened days count marked dates across all students/classes");
    assert.equal(firstStudent.days_present, 1, "Present count remains specific to the student");
    assert.equal(firstStudent.days_absent, 0, "Absent count remains specific to the student");

    const unmarkedStudent = await getStudentAttendanceSummary(db, 1, "STUDENT-3");
    assert.equal(unmarkedStudent.days_opened, 2, "Opened-day count is term-wide even without this student's records");
    assert.equal(unmarkedStudent.days_present, 0);
    assert.equal(unmarkedStudent.days_absent, 0);

    console.log("attendance summary test passed");
  } finally {
    await close();
  }
};

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
