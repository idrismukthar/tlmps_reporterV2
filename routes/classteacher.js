const express = require("express");
const router = express.Router();
const db = require("../config/db");

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
          db.all(
            `SELECT e.admission_no, s.surname, s.middle_name, s.last_name,
                COALESCE(r.teacher_name, '') AS teacher_name,
                COALESCE(r.days_present, 0) AS days_present,
                COALESCE(r.days_absent, 0) AS days_absent,
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
            [termId, sessionId, className],
            (studentErr, students) =>
              res.render("classteacher/remarks", {
                className,
                session,
                term,
                students: studentErr ? [] : students || [],
                query: req.query,
              }),
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
  const daysOpened = Number(req.body.days_opened);
  if (
    !Number.isInteger(Number(sessionId)) ||
    !Number.isInteger(Number(termId)) ||
    !Number.isInteger(daysOpened) ||
    daysOpened < 0
  ) {
    return res.status(400).send("Invalid session, term, or school days value.");
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
      const rows = submitted
        .filter((row) => allowed.has(row.admission_no))
        .map((row) => {
          const present = Math.min(
            daysOpened,
            Math.max(0, Number(row.days_present) || 0),
          );
          const rating = (trait) =>
            Math.min(5, Math.max(1, Number(row[trait]) || 5));
          return [
            row.admission_no,
            sessionId,
            termId,
            className,
            String(teacherName || "").trim(),
            present,
            daysOpened - present,
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
});

module.exports = router;
