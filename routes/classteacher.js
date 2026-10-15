const express = require("express");
const router = express.Router();
const db = require("../config/db");
const { getNextAttendanceWeekday } = require("../services/attendanceDates");

const CLASSES = ["JSS1", "JSS2", "JSS3", "SSS1", "SSS2", "SSS3"];
const CLASS_PASSWORDS = {
  JSS1: process.env.TLMPS_JSS1_PASS || "tlmpsjunior001",
  JSS2: process.env.TLMPS_JSS2_PASS || "tlmpsjunior002",
  JSS3: process.env.TLMPS_JSS3_PASS || "tlmpsjunior003",
  SSS1: process.env.TLMPS_SSS1_PASS || "tlmpssenior001",
  SSS2: process.env.TLMPS_SSS2_PASS || "tlmpssenior002",
  SSS3: process.env.TLMPS_SSS3_PASS || "tlmpssenior003",
};

const requireClassTeacher = (req, res, next) => {
  if (req.session && req.session.classTeacher) return next();
  res.redirect("/classteacher/login");
};

const renderLogin = (res, error = null) =>
  res.render("classteacher/login", { classes: CLASSES, error });

const parseDate = (value) => {
  const text = String(value || "").trim();
  let match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (!match) {
    const legacy = /^(\d{2})-(\d{2})-(\d{4})$/.exec(text);
    if (legacy) match = [legacy[0], legacy[3], legacy[2], legacy[1]];
  }
  if (!match) return null;

  const date = new Date(
    Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])),
  );
  if (
    Number.isNaN(date.getTime()) ||
    date.getUTCFullYear() !== Number(match[1]) ||
    date.getUTCMonth() !== Number(match[2]) - 1 ||
    date.getUTCDate() !== Number(match[3])
  ) {
    return null;
  }
  return date;
};

const attendanceWeekdays = (startValue, endValue) => {
  const start = parseDate(startValue);
  const end = parseDate(endValue);
  if (!start || !end || start > end) return [];

  const dates = [];
  for (
    const date = new Date(start);
    date <= end;
    date.setUTCDate(date.getUTCDate() + 1)
  ) {
    const weekday = date.getUTCDay();
    if (weekday !== 0 && weekday !== 6) {
      dates.push(date.toISOString().slice(0, 10));
    }
  }
  return dates;
};

const validRecordId = (value) => /^\d+$/.test(String(value || ""));

router.get("/login", (req, res) => renderLogin(res));

router.post("/login", (req, res) => {
  const className = String(req.body.class_name || "")
    .trim()
    .toUpperCase();
  if (
    !CLASS_PASSWORDS[className] ||
    req.body.password !== CLASS_PASSWORDS[className]
  ) {
    return renderLogin(res, "Invalid class password.");
  }
  req.session.classTeacher = { assignedClass: className };
  res.redirect("/classteacher/dashboard");
});

router.get("/logout", (req, res) => {
  delete req.session.classTeacher;
  res.redirect("/classteacher/login");
});

router.get("/dashboard", requireClassTeacher, (req, res) => {
  db.all(
    `SELECT * FROM academic_sessions WHERE is_archived = 0 ORDER BY session_id ASC`,
    [],
    (sessionErr, sessions) => {
      db.all(
        `SELECT * FROM academic_terms ORDER BY session_id DESC, term_number ASC`,
        [],
        (termErr, terms) => {
          const termsBySession = {};
          (terms || []).forEach((term) => {
            if (!termsBySession[term.session_id])
              termsBySession[term.session_id] = [];
            termsBySession[term.session_id].push(term);
          });
          res.render("classteacher/dashboard", {
            className: req.session.classTeacher.assignedClass,
            sessions: sessionErr ? [] : sessions || [],
            termsBySession: termErr ? {} : termsBySession,
          });
        },
      );
    },
  );
});

router.get(
  "/attendance/:sessionId/:termId",
  requireClassTeacher,
  (req, res) => {
    const className = req.session.classTeacher.assignedClass;
    const { sessionId, termId } = req.params;
    if (!validRecordId(sessionId) || !validRecordId(termId)) {
      return res.status(400).send("Invalid academic session or term.");
    }

    db.get(
      `SELECT s.session_id, s.session_name, t.term_id, t.term_name,
              t.term_status, t.resumption_date, t.vacation_date
       FROM academic_sessions s
       JOIN academic_terms t ON t.session_id = s.session_id
       WHERE s.session_id = ? AND t.term_id = ?
         AND s.is_archived = 0 AND t.term_status = 'Active'`,
      [sessionId, termId],
      (termError, term) => {
        if (termError) return res.status(500).send("Unable to load the active term.");
        if (!term) return res.status(404).send("Active term not found.");

        const dates = attendanceWeekdays(
          term.resumption_date,
          term.vacation_date,
        );
        if (!dates.length) {
          return res.status(400).send(
            "Set valid term resumption and vacation dates before recording attendance.",
          );
        }
        const requestedDate = String(req.query.date || "");
        const selectedDate = dates.includes(requestedDate)
          ? requestedDate
          : dates.includes(getNextAttendanceWeekday())
            ? getNextAttendanceWeekday()
            : dates[0];

        db.all(
          `SELECT e.admission_no, s.surname, s.middle_name, s.last_name,
                  s.gender, ar.status
           FROM academic_session_enrollments e
           JOIN students s ON s.admission_no = e.admission_no
           LEFT JOIN attendance_records ar
             ON ar.admission_no = e.admission_no
            AND ar.term_id = ? AND ar.attendance_date = ?
           WHERE e.session_id = ? AND e.class_name = ?
             AND e.enrollment_status = 'Enrolled'
           ORDER BY s.surname, s.last_name, s.middle_name, e.admission_no`,
          [termId, selectedDate, sessionId, className],
          (studentsError, students) => {
            if (studentsError) {
              return res.status(500).send("Unable to load the class roster.");
            }
            db.get(
              `SELECT is_holiday, holiday_name
               FROM attendance_days
               WHERE term_id = ? AND attendance_date = ?`,
              [termId, selectedDate],
              (dayError, day) => {
                if (dayError) {
                  return res.status(500).send("Unable to load the attendance day.");
                }
                res.render("classteacher/attendance", {
                  className,
                  term,
                  dates,
                  selectedDate,
                  day,
                  students: students || [],
                  query: req.query,
                });
              },
            );
          },
        );
      },
    );
  },
);

router.post(
  "/attendance/:sessionId/:termId",
  requireClassTeacher,
  (req, res) => {
    const className = req.session.classTeacher.assignedClass;
    const { sessionId, termId } = req.params;
    const selectedDate = String(req.body.selected_date || "").trim();
    const attendance = req.body.attendance || {};
    const isHoliday = req.body.is_holiday === "1";
    const holidayName = String(req.body.holiday_name || "").trim();
    if (!validRecordId(sessionId) || !validRecordId(termId)) {
      return res.status(400).send("Invalid academic session or term.");
    }
    if (!attendance || typeof attendance !== "object" || Array.isArray(attendance)) {
      return res.status(400).send("Attendance submission is invalid.");
    }

    db.get(
      `SELECT s.session_id, s.session_name, t.term_id, t.term_status,
              t.resumption_date, t.vacation_date
       FROM academic_sessions s
       JOIN academic_terms t ON t.session_id = s.session_id
       WHERE s.session_id = ? AND t.term_id = ?
         AND s.is_archived = 0 AND t.term_status = 'Active'`,
      [sessionId, termId],
      (termError, term) => {
        if (termError) return res.status(500).send("Unable to validate the active term.");
        if (!term) return res.status(403).send("Attendance can be changed only in an active term.");

        const dates = attendanceWeekdays(term.resumption_date, term.vacation_date);
        if (!dates.includes(selectedDate)) {
          return res.status(400).send("Choose a weekday within this term.");
        }

        db.all(
          `SELECT admission_no
           FROM academic_session_enrollments
           WHERE session_id = ? AND class_name = ?
             AND enrollment_status = 'Enrolled'`,
          [sessionId, className],
          (rosterError, roster) => {
            if (rosterError) return res.status(500).send("Unable to verify the class roster.");
            const allowed = new Set((roster || []).map((student) => student.admission_no));
            const entries = Object.entries(attendance);
            if (entries.some(([admissionNo]) => !allowed.has(admissionNo))) {
              return res.status(400).send("Attendance includes a student outside your assigned class.");
            }
            if (entries.some(([, status]) => status !== "" && status !== "P" && status !== "A")) {
              return res.status(400).send("Each attendance mark must be present or absent.");
            }

            const marked = entries.filter(([, status]) => status === "P" || status === "A");
            db.serialize(() => {
              db.run("BEGIN TRANSACTION");
              db.run(
                `INSERT INTO attendance_days
                   (term_id, attendance_date, is_holiday, holiday_name)
                 VALUES (?, ?, ?, ?)
                 ON CONFLICT(term_id, attendance_date)
                 DO UPDATE SET is_holiday = excluded.is_holiday,
                               holiday_name = excluded.holiday_name`,
                [
                  termId,
                  selectedDate,
                  isHoliday ? 1 : 0,
                  isHoliday ? holidayName || "Holiday" : null,
                ],
              );
              db.run(
                `DELETE FROM attendance_records
                 WHERE term_id = ? AND attendance_date = ?
                   AND admission_no IN (
                     SELECT admission_no
                     FROM academic_session_enrollments
                     WHERE session_id = ? AND class_name = ?
                       AND enrollment_status = 'Enrolled'
                   )`,
                [termId, selectedDate, sessionId, className],
              );

              if (!isHoliday) {
                const statement = db.prepare(
                  `INSERT INTO attendance_records
                     (term_id, attendance_date, admission_no, status)
                   VALUES (?, ?, ?, ?)
                   ON CONFLICT(term_id, attendance_date, admission_no)
                   DO UPDATE SET status = excluded.status`,
                );
                marked.forEach(([admissionNo, status]) => {
                  statement.run([termId, selectedDate, admissionNo, status]);
                });
                statement.finalize((saveError) => {
                  if (saveError) {
                    return db.run("ROLLBACK", () =>
                      res.status(500).send("Attendance could not be saved."),
                    );
                  }
                  db.run("COMMIT", (commitError) => {
                    if (commitError) {
                      return res.status(500).send("Attendance could not be saved.");
                    }
                    res.redirect(
                      `/classteacher/attendance/${sessionId}/${termId}?date=${encodeURIComponent(selectedDate)}&saved=1`,
                    );
                  });
                });
              } else {
                db.run("COMMIT", (commitError) => {
                  if (commitError) {
                    return res.status(500).send("Attendance could not be saved.");
                  }
                  res.redirect(
                    `/classteacher/attendance/${sessionId}/${termId}?date=${encodeURIComponent(selectedDate)}&saved=1`,
                  );
                });
              }
            });
          },
        );
      },
    );
  },
);

router.get("/remarks/:sessionId/:termId", requireClassTeacher, (req, res) => {
  const { sessionId, termId } = req.params;
  const className = req.session.classTeacher.assignedClass;
  db.get(
    `SELECT * FROM academic_sessions WHERE session_id = ? AND is_archived = 0`,
    [sessionId],
    (sessionErr, session) => {
      db.get(
        `SELECT * FROM academic_terms WHERE term_id = ? AND session_id = ?`,
        [termId, sessionId],
        (termErr, term) => {
          if (sessionErr || termErr || !session || !term)
            return res.status(404).send("Session or term not found");
          db.get(
            `SELECT COUNT(DISTINCT r.attendance_date) AS days_opened
             FROM attendance_records r
             LEFT JOIN attendance_days d
               ON d.term_id = r.term_id AND d.attendance_date = r.attendance_date
             WHERE r.term_id = ? AND COALESCE(d.is_holiday, 0) = 0`,
            [termId],
            (daysErr, attendanceSummary) => {
              db.all(
                `SELECT e.admission_no, s.surname, s.middle_name, s.last_name,
                COALESCE(r.teacher_name, '') AS teacher_name,
                (SELECT COUNT(*) FROM attendance_records ap
                 WHERE ap.term_id = ? AND ap.admission_no = e.admission_no AND ap.status = 'P') AS days_present,
                (SELECT COUNT(*) FROM attendance_records aa
                 WHERE aa.term_id = ? AND aa.admission_no = e.admission_no AND aa.status = 'A') AS days_absent,
                COALESCE(r.teacher_comment, '') AS teacher_comment,
                COALESCE(r.punctuality, 5) AS punctuality,
                COALESCE(r.neatness, 5) AS neatness,
                COALESCE(r.obedience, 5) AS obedience,
                COALESCE(r.honesty, 5) AS honesty,
                COALESCE(r.discipline, 5) AS discipline
         FROM academic_session_enrollments e
         JOIN students s ON s.admission_no = e.admission_no
         LEFT JOIN class_teacher_remarks r ON r.admission_no = e.admission_no
           AND r.session_id = e.session_id AND r.term_id = ?
                WHERE e.session_id = ? AND e.class_name = ? AND e.enrollment_status = 'Enrolled'
                ORDER BY e.admission_no ASC`,
                [termId, termId, termId, sessionId, className],
                (studentErr, students) =>
                  res.render("classteacher/remarks", {
                    className,
                    session,
                    term: { ...term, live_days_opened: daysErr ? 0 : attendanceSummary?.days_opened || 0 },
                    students: studentErr ? [] : students || [],
                    query: req.query,
                  }),
              );
            },
          );
        },
      );
    },
  );
});

router.post("/remarks/save", requireClassTeacher, (req, res) => {
  const {
    session_id: sessionId,
    term_id: termId,
    teacher_name: teacherName,
  } = req.body;
  const className = req.session.classTeacher.assignedClass;
  const submitted = Array.isArray(req.body.students) ? req.body.students : [];
  if (
    !Number.isInteger(Number(sessionId)) ||
    !Number.isInteger(Number(termId))
  ) {
    return res.status(400).send("Invalid session or term.");
  }
  db.get(
    `SELECT term_id FROM academic_terms WHERE term_id = ? AND session_id = ? AND term_status = 'Active'`,
    [termId, sessionId],
    (termErr, activeTerm) => {
      if (termErr || !activeTerm) return res.status(403).send("Remarks can be changed only while this term is active.");
  db.all(
    `SELECT admission_no FROM academic_session_enrollments WHERE session_id = ? AND class_name = ? AND enrollment_status = 'Enrolled'`,
    [sessionId, className],
    (err, allowedRows) => {
      if (err) return res.status(500).send("Unable to load class roster.");
      const allowed = new Set(
        (allowedRows || []).map((row) => row.admission_no),
      );
      if (!allowed.size) {
        return res.status(400).send("There are no enrolled students in this class for the selected session.");
      }
      db.all(
        `SELECT admission_no,
                SUM(CASE WHEN status = 'P' THEN 1 ELSE 0 END) AS days_present,
                SUM(CASE WHEN status = 'A' THEN 1 ELSE 0 END) AS days_absent
         FROM attendance_records
         WHERE term_id = ? AND admission_no IN (${Array(allowed.size).fill("?").join(",")})
         GROUP BY admission_no`,
        [termId, ...allowed],
        (attendanceErr, attendanceRows) => {
      if (attendanceErr) return res.status(500).send("Unable to load attendance records.");
      const attendanceByStudent = new Map((attendanceRows || []).map((row) => [row.admission_no, row]));
      const rows = submitted
        .filter((row) => allowed.has(row.admission_no))
        .map((row) => {
          const attendance = attendanceByStudent.get(row.admission_no) || {};
          const present = Number(attendance.days_present) || 0;
          const absent = Number(attendance.days_absent) || 0;
          const rating = (trait) =>
            Math.min(5, Math.max(1, Number(row[trait]) || 5));
          return [
            row.admission_no,
            sessionId,
            termId,
            className,
            String(teacherName || "").trim(),
            present,
            absent,
            String(row.teacher_comment || "").trim(),
            rating("punctuality"),
            rating("neatness"),
            rating("obedience"),
            rating("honesty"),
            rating("discipline"),
          ];
        });
      db.serialize(() => {
        db.run("BEGIN TRANSACTION");
        const statement = db.prepare(
          `INSERT INTO class_teacher_remarks (admission_no, session_id, term_id, class_name, teacher_name, days_present, days_absent, teacher_comment, punctuality, neatness, obedience, honesty, discipline) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(admission_no, session_id, term_id) DO UPDATE SET class_name = excluded.class_name, teacher_name = excluded.teacher_name, days_present = excluded.days_present, days_absent = excluded.days_absent, teacher_comment = excluded.teacher_comment, punctuality = excluded.punctuality, neatness = excluded.neatness, obedience = excluded.obedience, honesty = excluded.honesty, discipline = excluded.discipline`,
        );
        rows.forEach((row) => statement.run(row));
        statement.finalize((finalizeErr) => {
          if (finalizeErr)
            return db.run("ROLLBACK", () =>
              res.status(500).send("Unable to save class remarks."),
            );
          db.run("COMMIT", (commitErr) => {
            if (commitErr)
              return res.status(500).send("Unable to save class remarks.");
            res.redirect(
              `/classteacher/remarks/${sessionId}/${termId}?saved=1`,
            );
          });
        });
      });
        },
      );
    },
  );
    },
  );
});

module.exports = router;
