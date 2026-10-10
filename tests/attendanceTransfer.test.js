const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const sqlite3 = require("sqlite3").verbose();
const {
  TRANSFER_FORMAT,
  AttendanceTransferError,
  importAttendance,
  validateTransfer,
} = require("../services/attendanceTransfer");

const databasePath = path.join(
  fs.mkdtempSync(path.join(os.tmpdir(), "tlmps-attendance-transfer-")),
  "test.sqlite",
);
const db = new sqlite3.Database(databasePath);

const exec = (sql) =>
  new Promise((resolve, reject) =>
    db.exec(sql, (error) => (error ? reject(error) : resolve())),
  );
const run = (sql, params = []) =>
  new Promise((resolve, reject) =>
    db.run(sql, params, (error) => (error ? reject(error) : resolve())),
  );
const get = (sql, params = []) =>
  new Promise((resolve, reject) =>
    db.get(sql, params, (error, row) => (error ? reject(error) : resolve(row))),
  );
const close = () =>
  new Promise((resolve, reject) =>
    db.close((error) => (error ? reject(error) : resolve())),
  );

const transfer = {
  format: TRANSFER_FORMAT,
  exportedAt: "2026-10-03T09:00:00.000Z",
  days: [
    {
      sessionName: "2026/2027",
      termNumber: 1,
      termName: "First Term",
      date: "2026-09-01",
      isHoliday: 0,
      holidayName: null,
    },
    {
      sessionName: "2026/2027",
      termNumber: 1,
      termName: "First Term",
      date: "2026-09-02",
      isHoliday: 1,
      holidayName: "School Holiday",
    },
  ],
  records: [
    {
      sessionName: "2026/2027",
      termNumber: 1,
      termName: "First Term",
      date: "2026-09-01",
      admissionNo: "A100",
      status: "P",
    },
    {
      sessionName: "2026/2027",
      termNumber: 1,
      termName: "First Term",
      date: "2026-09-02",
      admissionNo: "A100",
      status: "A",
    },
  ],
};

const main = async () => {
  try {
    await exec(`
      PRAGMA foreign_keys = ON;
      CREATE TABLE academic_sessions (session_id INTEGER PRIMARY KEY, session_name TEXT UNIQUE NOT NULL);
      CREATE TABLE academic_terms (term_id INTEGER PRIMARY KEY, session_id INTEGER NOT NULL, term_name TEXT NOT NULL, term_number INTEGER NOT NULL);
      CREATE TABLE students (admission_no TEXT PRIMARY KEY);
      CREATE TABLE attendance_days (
        attendance_day_id INTEGER PRIMARY KEY, term_id INTEGER NOT NULL,
        attendance_date TEXT NOT NULL, is_holiday INTEGER NOT NULL DEFAULT 0,
        holiday_name TEXT, UNIQUE(term_id, attendance_date),
        FOREIGN KEY(term_id) REFERENCES academic_terms(term_id)
      );
      CREATE TABLE attendance_records (
        attendance_id INTEGER PRIMARY KEY, term_id INTEGER NOT NULL,
        attendance_date TEXT NOT NULL, admission_no TEXT NOT NULL,
        status TEXT NOT NULL CHECK(status IN ('P', 'A')),
        UNIQUE(term_id, attendance_date, admission_no),
        FOREIGN KEY(term_id) REFERENCES academic_terms(term_id),
        FOREIGN KEY(admission_no) REFERENCES students(admission_no)
      );
      INSERT INTO academic_sessions VALUES (1, '2026/2027');
      INSERT INTO academic_terms VALUES (11, 1, 'First Term', 1);
      INSERT INTO students VALUES ('A100');
      INSERT INTO attendance_days (term_id, attendance_date, is_holiday, holiday_name)
        VALUES (11, '2026-09-01', 0, NULL);
      INSERT INTO attendance_records (term_id, attendance_date, admission_no, status)
        VALUES (11, '2026-09-01', 'A100', 'A');
    `);

    const result = await importAttendance(databasePath, transfer);
    assert.deepEqual(result, {
      daysAdded: 1,
      daysSkipped: 1,
      recordsAdded: 1,
      recordsSkipped: 1,
    });
    const existingRecord = await get(
      `SELECT status FROM attendance_records WHERE term_id = 11 AND attendance_date = '2026-09-01' AND admission_no = 'A100'`,
    );
    assert.equal(existingRecord.status, "A", "Existing Render attendance must be preserved");
    const importedRecord = await get(
      `SELECT status FROM attendance_records WHERE term_id = 11 AND attendance_date = '2026-09-02' AND admission_no = 'A100'`,
    );
    assert.equal(importedRecord.status, "A");

    const missingStudentTransfer = {
      ...transfer,
      records: [
        {
          ...transfer.records[0],
          date: "2026-09-03",
          admissionNo: "MISSING",
        },
      ],
    };
    await assert.rejects(
      importAttendance(databasePath, missingStudentTransfer),
      AttendanceTransferError,
    );
    const rolledBackDay = await get(
      `SELECT attendance_day_id FROM attendance_days WHERE term_id = 11 AND attendance_date = '2026-09-03'`,
    );
    assert.equal(rolledBackDay, undefined, "Unmatched imports must roll back atomically");

    assert.throws(
      () => validateTransfer({ ...transfer, records: [{ ...transfer.records[0], status: "X" }] }),
      AttendanceTransferError,
    );
    console.log("attendance transfer test passed");
  } finally {
    await close();
    fs.rmSync(path.dirname(databasePath), { recursive: true, force: true });
  }
};

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
