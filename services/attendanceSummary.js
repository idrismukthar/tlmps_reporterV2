const getStudentAttendanceSummary = (db, termId, admissionNo) =>
  new Promise((resolve, reject) => {
    db.get(
      `SELECT (
                SELECT COUNT(DISTINCT opened.attendance_date)
                FROM attendance_records opened
                LEFT JOIN attendance_days opened_day
                  ON opened_day.term_id = opened.term_id
                 AND opened_day.attendance_date = opened.attendance_date
                WHERE opened.term_id = ?
                  AND opened.status IN ('P', 'A')
                  AND COALESCE(opened_day.is_holiday, 0) = 0
              ) AS days_opened,
              COUNT(DISTINCT CASE WHEN r.status = 'P' THEN r.attendance_date END) AS days_present,
              COUNT(DISTINCT CASE WHEN r.status = 'A' THEN r.attendance_date END) AS days_absent
       FROM attendance_records r
       LEFT JOIN attendance_days d
         ON d.term_id = r.term_id AND d.attendance_date = r.attendance_date
       WHERE r.term_id = ? AND r.admission_no = ? AND COALESCE(d.is_holiday, 0) = 0`,
      [termId, termId, admissionNo],
      (error, summary) => {
        if (error) return reject(error);
        resolve(summary);
      },
    );
  });

module.exports = { getStudentAttendanceSummary };
