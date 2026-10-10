const fs = require("fs");
const path = require("path");
const sqlite3 = require("sqlite3").verbose();
const { TRANSFER_FORMAT, defaultDatabasePath } = require("../services/attendanceTransfer");

const outputPath = process.argv[2];
const databasePath = path.resolve(process.argv[3] || process.env.DB_PATH || defaultDatabasePath);
if (!outputPath) {
  console.error("Usage: node scripts/export-attendance.js <private-output-file> [database-file]");
  process.exit(1);
}

const db = new sqlite3.Database(databasePath, sqlite3.OPEN_READONLY, (openError) => {
  if (openError) {
    console.error("Could not open the local attendance database:", openError.message);
    process.exitCode = 1;
    return;
  }

  db.serialize(() => {
    db.all(
      `SELECT s.session_name AS sessionName, t.term_number AS termNumber,
              t.term_name AS termName, d.attendance_date AS date,
              d.is_holiday AS isHoliday, d.holiday_name AS holidayName
       FROM attendance_days d
       JOIN academic_terms t ON t.term_id = d.term_id
       JOIN academic_sessions s ON s.session_id = t.session_id
       ORDER BY s.session_name, t.term_number, d.attendance_date`,
      [],
      (daysError, days) => {
        if (daysError) return closeWithError(daysError);
        db.all(
          `SELECT s.session_name AS sessionName, t.term_number AS termNumber,
                  t.term_name AS termName, r.attendance_date AS date,
                  r.admission_no AS admissionNo, r.status
           FROM attendance_records r
           JOIN academic_terms t ON t.term_id = r.term_id
           JOIN academic_sessions s ON s.session_id = t.session_id
           ORDER BY s.session_name, t.term_number, r.attendance_date, r.admission_no`,
          [],
          (recordsError, records) => {
            if (recordsError) return closeWithError(recordsError);
            const transfer = {
              format: TRANSFER_FORMAT,
              exportedAt: new Date().toISOString(),
              days,
              records,
            };
            fs.writeFile(outputPath, JSON.stringify(transfer), { flag: "wx", mode: 0o600 }, (writeError) => {
              if (writeError) return closeWithError(writeError);
              console.log(
                `Created attendance-only export with ${days.length} days and ${records.length} records.`,
              );
              db.close((closeError) => {
                if (closeError) {
                  console.error("Could not close the local database:", closeError.message);
                  process.exitCode = 1;
                }
              });
            });
          },
        );
      },
    );
  });
});

function closeWithError(error) {
  console.error("Could not export local attendance:", error.message);
  process.exitCode = 1;
  db.close((closeError) => {
    if (closeError) console.error("Could not close the local database:", closeError.message);
  });
}
