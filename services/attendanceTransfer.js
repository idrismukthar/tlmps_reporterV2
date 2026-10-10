const path = require("path");
const sqlite3 = require("sqlite3").verbose();

const MAX_TRANSFER_ROWS = 200000;
const TRANSFER_FORMAT = "tlmps-attendance-v1";
class AttendanceTransferError extends Error {
  constructor(message) {
    super(message);
    this.name = "AttendanceTransferError";
  }
}

const isValidDate = (value) => {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
};

const validateTransfer = (transfer) => {
  if (!transfer || transfer.format !== TRANSFER_FORMAT) {
    throw new AttendanceTransferError("This is not a supported TLMPS attendance export.");
  }
  if (!Array.isArray(transfer.days) || !Array.isArray(transfer.records)) {
    throw new AttendanceTransferError("The attendance export is missing its days or records.");
  }
  if (transfer.days.length + transfer.records.length > MAX_TRANSFER_ROWS) {
    throw new AttendanceTransferError("The attendance export exceeds the allowed size.");
  }

  const uniqueRows = (rows, keyFor, description) => {
    const seen = new Set();
    rows.forEach((row, index) => {
      if (!row || typeof row !== "object" || Array.isArray(row)) {
        throw new AttendanceTransferError(`Invalid ${description} at row ${index + 1}.`);
      }
      const key = keyFor(row);
      if (key === null) {
        throw new AttendanceTransferError(`Invalid ${description} at row ${index + 1}.`);
      }
      if (seen.has(key)) {
        throw new AttendanceTransferError(`Duplicate ${description} at row ${index + 1}.`);
      }
      seen.add(key);
    });
  };

  const termKeyIsValid = (row) =>
    typeof row.sessionName === "string" &&
    row.sessionName.trim().length > 0 &&
    row.sessionName.length <= 100 &&
    Number.isInteger(row.termNumber) &&
    row.termNumber >= 1 &&
    row.termNumber <= 3 &&
    typeof row.termName === "string" &&
    row.termName.trim().length > 0 &&
    row.termName.length <= 100 &&
    isValidDate(row.date);

  uniqueRows(
    transfer.days,
    (row) =>
      termKeyIsValid(row) &&
      (row.isHoliday === 0 || row.isHoliday === 1) &&
      (row.holidayName == null ||
        (typeof row.holidayName === "string" && row.holidayName.length <= 200))
        ? JSON.stringify([row.sessionName, row.termNumber, row.date])
        : null,
    "attendance day",
  );
  uniqueRows(
    transfer.records,
    (row) =>
      termKeyIsValid(row) &&
      typeof row.admissionNo === "string" &&
      row.admissionNo.trim().length > 0 &&
      row.admissionNo.length <= 100 &&
      (row.status === "P" || row.status === "A")
        ? JSON.stringify([row.sessionName, row.termNumber, row.date, row.admissionNo])
        : null,
    "attendance record",
  );

  return transfer;
};

const queryAll = (db, sql, params = []) =>
  new Promise((resolve, reject) => {
    db.all(sql, params, (error, rows) => (error ? reject(error) : resolve(rows || [])));
  });

const run = (db, sql, params = []) =>
  new Promise((resolve, reject) => {
    db.run(sql, params, function (error) {
      if (error) return reject(error);
      resolve(this.changes || 0);
    });
  });

const importAttendance = async (databasePath, rawTransfer) => {
  const transfer = validateTransfer(rawTransfer);
  const db = new sqlite3.Database(databasePath);
  let transactionOpen = false;

  try {
    await run(db, "PRAGMA foreign_keys = ON");
    await run(db, "BEGIN IMMEDIATE");
    transactionOpen = true;

    const [sessions, terms, students] = await Promise.all([
      queryAll(db, `SELECT session_id, session_name FROM academic_sessions`),
      queryAll(db, `SELECT session_id, term_id, term_name, term_number FROM academic_terms`),
      queryAll(db, `SELECT admission_no FROM students`),
    ]);
    const sessionIds = new Map(sessions.map((session) => [session.session_name, session.session_id]));
    const termIds = new Map(
      terms.map((term) => [
        JSON.stringify([term.session_id, Number(term.term_number), term.term_name.toLowerCase()]),
        term.term_id,
      ]),
    );
    const studentIds = new Set(students.map((student) => student.admission_no));

    const findTermId = (row) => {
      const sessionId = sessionIds.get(row.sessionName);
      if (sessionId == null) return null;
      return termIds.get(
        JSON.stringify([sessionId, row.termNumber, row.termName.toLowerCase()]),
      ) || null;
    };

    const mappedDays = transfer.days.map((day) => ({
      ...day,
      termId: findTermId(day),
    }));
    const mappedRecords = transfer.records.map((record) => ({
      ...record,
      termId: findTermId(record),
    }));
    const missingTerms =
      mappedDays.filter((day) => day.termId == null).length +
      mappedRecords.filter((record) => record.termId == null).length;
    const missingStudents = mappedRecords.filter(
      (record) => !studentIds.has(record.admissionNo),
    ).length;
    if (missingTerms || missingStudents) {
      throw new AttendanceTransferError(
        `Nothing was imported. ${missingTerms} attendance rows could not be matched to a Render session/term and ${missingStudents} records could not be matched to a Render student.`,
      );
    }

    let daysAdded = 0;
    let recordsAdded = 0;
    for (const day of mappedDays) {
      daysAdded += await run(
        db,
        `INSERT INTO attendance_days (term_id, attendance_date, is_holiday, holiday_name)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(term_id, attendance_date) DO NOTHING`,
        [day.termId, day.date, day.isHoliday, day.holidayName || null],
      );
    }
    for (const record of mappedRecords) {
      recordsAdded += await run(
        db,
        `INSERT INTO attendance_records (term_id, attendance_date, admission_no, status)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(term_id, attendance_date, admission_no) DO NOTHING`,
        [record.termId, record.date, record.admissionNo, record.status],
      );
    }

    await run(db, "COMMIT");
    transactionOpen = false;
    return {
      daysAdded,
      daysSkipped: mappedDays.length - daysAdded,
      recordsAdded,
      recordsSkipped: mappedRecords.length - recordsAdded,
    };
  } catch (error) {
    if (transactionOpen) {
      await run(db, "ROLLBACK");
      transactionOpen = false;
    }
    throw error;
  } finally {
    await new Promise((resolve, reject) =>
      db.close((error) => (error ? reject(error) : resolve())),
    );
  }
};

const defaultDatabasePath = path.resolve(__dirname, "../tlmps.db");

module.exports = {
  TRANSFER_FORMAT,
  AttendanceTransferError,
  defaultDatabasePath,
  importAttendance,
  validateTransfer,
};
