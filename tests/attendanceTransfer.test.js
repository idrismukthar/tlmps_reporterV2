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
    {
      sessionName: "2026/2027",
      termNumber: 1,
      termName: "First Term",
      date: "2026-09-03",
      isHoliday: 0,
      holidayName: null,
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
    {
      sessionName: "2026/2027",
      termNumber: 1,
      termName: "First Term",
      date: "2026-09-03",
      admissionNo: "B200",
      status: "P",
    },
  ],
  students: [
    {
      admissionNo: "A100",
      surname: "One",
      middleName: null,
      lastName: "Existing",
      className: "JSS1",
      department: null,
      gender: "Female",
    },
    {
      admissionNo: "B200",
      surname: "Two",
      middleName: "Local",
      lastName: "Only",
      className: "JSS2",
      department: null,
      gender: "Male",
    },
  ],
  enrollments: [
    {
      sessionName: "2026/2027",
      admissionNo: "A100",
      className: "JSS1",
      department: null,
      enrollmentStatus: "Withdrawn",
    },
    {
      sessionName: "2026/2027",
      admissionNo: "B200",
      className: "JSS2",
      department: null,
      enrollmentStatus: "Withdrawn",
    },
  ],
};

const main = async () => {
  try {
    await exec(`
      PRAGMA foreign_keys = ON;
      CREATE TABLE academic_sessions (session_id INTEGER PRIMARY KEY, session_name TEXT UNIQUE NOT NULL);
      CREATE TABLE academic_terms (term_id INTEGER PRIMARY KEY, session_id INTEGER NOT NULL, term_name TEXT NOT NULL, term_number INTEGER NOT NULL);
      CREATE TABLE students (
        admission_no TEXT PRIMARY KEY, surname TEXT NOT NULL, middle_name TEXT,
        last_name TEXT NOT NULL, class_name TEXT NOT NULL, department TEXT,
        gender TEXT, password_hash TEXT
      );
      CREATE TABLE academic_session_enrollments (
        session_id INTEGER NOT NULL, admission_no TEXT NOT NULL,
        class_name TEXT NOT NULL, department TEXT,
        enrollment_status TEXT NOT NULL DEFAULT 'Enrolled',
        UNIQUE(session_id, admission_no),
        FOREIGN KEY(session_id) REFERENCES academic_sessions(session_id),
        FOREIGN KEY(admission_no) REFERENCES students(admission_no)
      );
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
      INSERT INTO students (admission_no, surname, last_name, class_name)
        VALUES ('A100', 'Old', 'Name', 'JSS2');
      INSERT INTO academic_session_enrollments
        (session_id, admission_no, class_name, enrollment_status)
        VALUES (1, 'A100', 'JSS2', 'Enrolled');
      INSERT INTO attendance_days (term_id, attendance_date, is_holiday, holiday_name)
        VALUES (11, '2026-09-01', 1, 'Incorrect holiday');
      INSERT INTO attendance_records (term_id, attendance_date, admission_no, status)
        VALUES (11, '2026-09-01', 'A100', 'A');
    `);

    const result = await importAttendance(databasePath, transfer);
    assert.deepEqual(result, {
      daysAdded: 2,
      daysUpdated: 1,
      daysSkipped: 0,
      recordsAdded: 2,
      recordsUpdated: 1,
      recordsSkipped: 0,
      enrollmentsAdded: 1,
      enrollmentsUpdated: 1,
      enrollmentStatusesUpdated: 1,
      studentsAdded: 1,
      studentsUpdated: 1,
    });
    const existingRecord = await get(
      `SELECT status FROM attendance_records WHERE term_id = 11 AND attendance_date = '2026-09-01' AND admission_no = 'A100'`,
    );
    assert.equal(existingRecord.status, "P", "Local attendance must replace conflicting Render marks");
    const correctedDay = await get(
      `SELECT is_holiday, holiday_name FROM attendance_days
       WHERE term_id = 11 AND attendance_date = '2026-09-01'`,
    );
    assert.deepEqual(correctedDay, { is_holiday: 0, holiday_name: null });
    const correctedStudent = await get(
      `SELECT surname, last_name, class_name FROM students WHERE admission_no = 'A100'`,
    );
    assert.deepEqual(correctedStudent, {
      surname: "One",
      last_name: "Existing",
      class_name: "JSS1",
    });
    const importedRecord = await get(
      `SELECT status FROM attendance_records WHERE term_id = 11 AND attendance_date = '2026-09-02' AND admission_no = 'A100'`,
    );
    assert.equal(importedRecord.status, "A");
    const addedStudent = await get(
      `SELECT surname, middle_name, last_name, class_name, gender, password_hash
       FROM students WHERE admission_no = 'B200'`,
    );
    assert.deepEqual(addedStudent, {
      surname: "Two",
      middle_name: "Local",
      last_name: "Only",
      class_name: "JSS2",
      gender: "Male",
      password_hash: null,
    });
    const addedEnrollment = await get(
      `SELECT class_name, enrollment_status FROM academic_session_enrollments
       WHERE session_id = 1 AND admission_no = 'B200'`,
    );
    assert.deepEqual(addedEnrollment, {
      class_name: "JSS2",
      enrollment_status: "Withdrawn",
    });
    const withdrawnEnrollment = await get(
      `SELECT enrollment_status FROM academic_session_enrollments
       WHERE session_id = 1 AND admission_no = 'A100'`,
    );
    assert.equal(withdrawnEnrollment.enrollment_status, "Withdrawn");

    const missingTermTransfer = {
      ...transfer,
      students: [
        ...transfer.students,
        {
          admissionNo: "C300",
          surname: "Three",
          middleName: null,
          lastName: "Unimported",
          className: "JSS1",
          department: null,
          gender: "Male",
        },
      ],
      records: [
        {
          ...transfer.records[0],
          sessionName: "Missing Session",
        },
      ],
      enrollments: [
        ...transfer.enrollments,
        {
          sessionName: "Missing Session",
          admissionNo: "A100",
          className: "JSS1",
          enrollmentStatus: "Enrolled",
        },
      ],
    };
    await assert.rejects(
      importAttendance(databasePath, missingTermTransfer),
      AttendanceTransferError,
    );
    const rolledBackDay = await get(
      `SELECT attendance_day_id FROM attendance_days WHERE term_id = 11 AND attendance_date = '2026-09-04'`,
    );
    assert.equal(rolledBackDay, undefined, "Unmatched imports must roll back atomically");
    const rolledBackStudent = await get(
      `SELECT admission_no FROM students WHERE admission_no = 'C300'`,
    );
    assert.equal(rolledBackStudent, undefined, "Rejected imports must not add roster rows");

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
