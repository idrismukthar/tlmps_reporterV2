const express = require("express");
const router = express.Router();
const db = require("../config/db");
const multer = require("multer");
const XLSX = require("xlsx");

const uploadExcel = multer({ storage: multer.memoryStorage() });

const CLASSES = ["JSS1", "JSS2", "JSS3", "SSS1", "SSS2", "SSS3"];
const CLASS_PASSWORDS = {
  JSS1: process.env.TLMPS_JSS1_PASS || "tlmpsjunior001",
  JSS2: process.env.TLMPS_JSS2_PASS || "tlmpsjunior002",
  JSS3: process.env.TLMPS_JSS3_PASS || "tlmpsjunior003",
  SSS1: process.env.TLMPS_SSS1_PASS || "tlmpssenior001",
  SSS2: process.env.TLMPS_SSS2_PASS || "tlmpssenior002",
  SSS3: process.env.TLMPS_SSS3_PASS || "tlmpssenior003",
};

const requireTeacher = (req, res, next) => {
  if (req.session.teacher) return next();
  res.redirect("/teacher/login");
};

router.get("/login", (req, res) => {
  db.all(
    `SELECT * FROM subjects ORDER BY subject_name ASC`,
    [],
    (err, subjects) => {
      res.render("teacher/login", {
        classes: CLASSES,
        subjects: subjects || [],
        error: null,
      });
    },
  );
});

router.post("/login", (req, res) => {
  const { class_name, subject_id, password } = req.body;
  const category = class_name && class_name.startsWith("SSS") ? "SSS" : "JSS";
  db.get(
    `SELECT * FROM subjects WHERE subject_id = ? AND level_category = ?`,
    [subject_id, category],
    (err, subject) => {
      if (
        !CLASS_PASSWORDS[class_name] ||
        password !== CLASS_PASSWORDS[class_name] ||
        !subject
      ) {
        return db.all(
          `SELECT * FROM subjects ORDER BY subject_name ASC`,
          [],
          (subjectsErr, subjects) => {
            res.status(401).render("teacher/login", {
              classes: CLASSES,
              subjects: subjects || [],
              error: "Invalid class password or subject selection.",
            });
          },
        );
      }
      req.session.teacher = { class_name, subject_id: Number(subject_id) };
      res.redirect("/teacher/dashboard");
    },
  );
});

router.get("/logout", (req, res) => {
  delete req.session.teacher;
  res.redirect("/teacher/login");
});

router.get("/dashboard", requireTeacher, (req, res) => {
  const { class_name, subject_id } = req.session.teacher;
  db.get(
    `SELECT * FROM subjects WHERE subject_id = ?`,
    [subject_id],
    (subjectErr, subject) => {
      db.all(
        `SELECT * FROM academic_sessions ORDER BY session_id DESC`,
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
              res.render("teacher/dashboard", {
                className: class_name,
                subject,
                sessions: sessions || [],
                termsBySession,
              });
            },
          );
        },
      );
    },
  );
});

router.get("/scores/:sessionId/:termId", requireTeacher, (req, res) => {
  const { class_name, subject_id } = req.session.teacher;
  const { sessionId, termId } = req.params;
  const query = `SELECT e.admission_no, s.surname, COALESCE(sc.ca_score, 0) AS ca_score, COALESCE(sc.mcq_score, 0) AS mcq_score, COALESCE(sc.theory_score, 0) AS theory_score
		FROM academic_session_enrollments e
		JOIN students s ON s.admission_no = e.admission_no
    JOIN student_subject_selections ss ON ss.admission_no = e.admission_no AND ss.subject_id = ? AND (ss.session_id = e.session_id OR ss.session_id IS NULL)
		LEFT JOIN student_scores sc ON sc.admission_no = e.admission_no AND sc.session_id = e.session_id AND sc.term_id = ? AND sc.subject_id = ? AND sc.class_name = ?
		WHERE e.session_id = ? AND e.class_name = ? AND e.enrollment_status = 'Enrolled'
		ORDER BY e.admission_no ASC`;
  db.get(
    `SELECT * FROM academic_sessions WHERE session_id = ?`,
    [sessionId],
    (sessionErr, session) => {
      db.get(
        `SELECT * FROM academic_terms WHERE term_id = ? AND session_id = ?`,
        [termId, sessionId],
        (termErr, term) => {
          db.get(
            `SELECT * FROM subjects WHERE subject_id = ?`,
            [subject_id],
            (subjectErr, subject) => {
              if (!session || !term || !subject)
                return res
                  .status(404)
                  .send("Session, term, or subject not found");
              db.all(
                query,
                [
                  subject_id,
                  termId,
                  subject_id,
                  class_name,
                  sessionId,
                  class_name,
                ],
                (studentsErr, students) => {
                  res.render("teacher/scores", {
                    className: class_name,
                    subject,
                    session,
                    term,
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
});

router.post("/scores/:sessionId/:termId", requireTeacher, (req, res) => {
  const { class_name, subject_id } = req.session.teacher;
  const { sessionId, termId } = req.params;
  const scores = Array.isArray(req.body.scores) ? req.body.scores : [];
  db.all(
    `SELECT e.admission_no FROM academic_session_enrollments e JOIN student_subject_selections ss ON ss.admission_no = e.admission_no AND ss.subject_id = ? AND (ss.session_id = e.session_id OR ss.session_id IS NULL) WHERE e.session_id = ? AND e.class_name = ? AND e.enrollment_status = 'Enrolled'`,
    [subject_id, sessionId, class_name],
    (err, allowedRows) => {
      const allowed = new Set(
        (allowedRows || []).map((row) => row.admission_no),
      );
      const validationErrors = [];
      const cleanScores = scores
        .filter((score) => allowed.has(score.admission_no))
        .map((score) => {
          const ca = Number(score.ca);
          const mcq = Number(score.mcq);
          const theory = Number(score.theory);
          const exam = mcq + theory;
          if (
            ![ca, mcq, theory].every(Number.isFinite) ||
            ca < 0 ||
            ca > 40 ||
            mcq < 0 ||
            mcq > 60 ||
            theory < 0 ||
            theory > 60 ||
            mcq + theory > 60 ||
            ca + exam > 100
          ) {
            validationErrors.push(
              `Admission ${score.admission_no} has an invalid score. CA must be 0-40, and MCQ + Theory must not exceed 60.`,
            );
            return null;
          }
          return [
            score.admission_no,
            sessionId,
            termId,
            subject_id,
            class_name,
            ca,
            mcq,
            theory,
            exam,
            ca + exam,
          ];
        })
        .filter(Boolean);
      if (validationErrors.length) {
        return res.redirect(
          `/teacher/scores/${sessionId}/${termId}?error=${encodeURIComponent(validationErrors.slice(0, 3).join(" "))}`,
        );
      }
      db.serialize(() => {
        db.run("BEGIN TRANSACTION");
        const statement = db.prepare(
          `INSERT INTO student_scores (admission_no, session_id, term_id, subject_id, class_name, ca_score, mcq_score, theory_score, exam_score, total_score) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(admission_no, session_id, term_id, subject_id) DO UPDATE SET class_name = excluded.class_name, ca_score = excluded.ca_score, mcq_score = excluded.mcq_score, theory_score = excluded.theory_score, exam_score = excluded.exam_score, total_score = excluded.total_score`,
        );
        cleanScores.forEach((score) => statement.run(score));
        statement.finalize((statementError) => {
          if (statementError) {
            return db.run("ROLLBACK", () =>
              res.redirect(
                `/teacher/scores/${sessionId}/${termId}?error=${encodeURIComponent("Unable to save scores. Check that MCQ + Theory does not exceed 60.")}`,
              ),
            );
          }
          db.run("COMMIT", (commitError) => {
            if (commitError)
              return res.redirect(
                `/teacher/scores/${sessionId}/${termId}?error=${encodeURIComponent("Unable to save scores. Please try again.")}`,
              );
            res.redirect(`/teacher/scores/${sessionId}/${termId}?saved=1`);
          });
        });
      });
    },
  );
});

router.post(
  "/scores/:sessionId/:termId/bulk-upload",
  requireTeacher,
  uploadExcel.single("excel_file"),
  (req, res) => {
    const { class_name, subject_id } = req.session.teacher;
    const { sessionId, termId } = req.params;
    if (!req.file) return res.status(400).send("Please upload an Excel file.");

    let rows;
    try {
      const workbook = XLSX.read(req.file.buffer, { type: "buffer" });
      rows = XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]], {
        defval: "",
      });
    } catch (error) {
      return res
        .status(400)
        .send(`Unable to read Excel file: ${error.message}`);
    }

    db.all(
      `SELECT e.admission_no FROM academic_session_enrollments e
      JOIN student_subject_selections ss ON ss.admission_no = e.admission_no AND ss.subject_id = ? AND (ss.session_id = e.session_id OR ss.session_id IS NULL)
       WHERE e.session_id = ? AND e.class_name = ? AND e.enrollment_status = 'Enrolled'`,
      [subject_id, sessionId, class_name],
      (lookupError, allowedRows) => {
        if (lookupError) return res.status(500).send(lookupError.message);
        const allowed = new Set(
          (allowedRows || []).map((row) => String(row.admission_no).trim()),
        );
        const normalize = (value) =>
          String(value)
            .trim()
            .toLowerCase()
            .replace(/[()]/g, "")
            .replace(/\s+/g, "_");
        const importErrors = [];
        const imported = rows
          .map((row) => {
            const values = {};
            Object.entries(row).forEach(([key, value]) => {
              values[normalize(key)] = value;
            });
            const admissionNo = String(values.admission_no || "").trim();
            const ca = Number(values.ca_40_marks);
            const mcq = Number(values.mcq_30_marks);
            const theory = Number(values.theory_30_marks);
            if (!allowed.has(admissionNo)) return null;
            if (
              ![ca, mcq, theory].every(Number.isFinite) ||
              ca < 0 ||
              ca > 40 ||
              mcq < 0 ||
              mcq > 60 ||
              theory < 0 ||
              theory > 60 ||
              mcq + theory > 60 ||
              ca + mcq + theory > 100
            ) {
              importErrors.push(
                `Admission ${admissionNo || "(blank)"} has an invalid score. CA must be 0-40, and MCQ + Theory must not exceed 60.`,
              );
              return null;
            }
            return [
              admissionNo,
              sessionId,
              termId,
              subject_id,
              class_name,
              ca,
              mcq,
              theory,
              mcq + theory,
              ca + mcq + theory,
            ];
          })
          .filter(Boolean);

        if (importErrors.length) {
          return res.redirect(
            `/teacher/scores/${sessionId}/${termId}?error=${encodeURIComponent(importErrors.slice(0, 3).join(" "))}`,
          );
        }

        db.serialize(() => {
          db.run("BEGIN TRANSACTION");
          const statement = db.prepare(
            `INSERT INTO student_scores (admission_no, session_id, term_id, subject_id, class_name, ca_score, mcq_score, theory_score, exam_score, total_score)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT(admission_no, session_id, term_id, subject_id) DO UPDATE SET class_name = excluded.class_name, ca_score = excluded.ca_score, mcq_score = excluded.mcq_score, theory_score = excluded.theory_score, exam_score = excluded.exam_score, total_score = excluded.total_score`,
          );
          imported.forEach((score) => statement.run(score));
          statement.finalize((statementError) => {
            if (statementError) {
              return db.run("ROLLBACK", () =>
                res
                  .status(400)
                  .send(
                    `Unable to save uploaded scores: ${statementError.message}`,
                  ),
              );
            }
            db.run("COMMIT", (commitError) => {
              if (commitError)
                return res
                  .status(500)
                  .send(
                    `Unable to save uploaded scores: ${commitError.message}`,
                  );
              res.redirect(`/teacher/scores/${sessionId}/${termId}?saved=1`);
            });
          });
        });
      },
    );
  },
);

router.get("/scores/:sessionId/:termId/export", requireTeacher, (req, res) => {
  const { class_name, subject_id } = req.session.teacher;
  const { sessionId, termId } = req.params;
  db.get(
    `SELECT * FROM academic_sessions WHERE session_id = ?`,
    [sessionId],
    (sessionError, session) => {
      db.get(
        `SELECT * FROM academic_terms WHERE term_id = ? AND session_id = ?`,
        [termId, sessionId],
        (termError, term) => {
          db.get(
            `SELECT * FROM subjects WHERE subject_id = ?`,
            [subject_id],
            (subjectError, subject) => {
              if (
                sessionError ||
                termError ||
                subjectError ||
                !session ||
                !term ||
                !subject
              )
                return res.status(404).send("Score sheet not found");
              db.all(
                `SELECT e.admission_no, s.surname, COALESCE(sc.ca_score, 0) ca_score, COALESCE(sc.mcq_score, 0) mcq_score, COALESCE(sc.theory_score, 0) theory_score
           FROM academic_session_enrollments e JOIN students s ON s.admission_no = e.admission_no
           JOIN student_subject_selections ss ON ss.admission_no = e.admission_no AND ss.subject_id = ? AND (ss.session_id = e.session_id OR ss.session_id IS NULL)
           LEFT JOIN student_scores sc ON sc.admission_no = e.admission_no AND sc.session_id = e.session_id AND sc.term_id = ? AND sc.subject_id = ? AND sc.class_name = ?
           WHERE e.session_id = ? AND e.class_name = ? AND e.enrollment_status = 'Enrolled' ORDER BY e.admission_no ASC`,
                [
                  subject_id,
                  termId,
                  subject_id,
                  class_name,
                  sessionId,
                  class_name,
                ],
                (studentsError, students) => {
                  if (studentsError)
                    return res.status(500).send(studentsError.message);
                  const data = (students || []).map((student) => ({
                    Admission_no: student.admission_no,
                    SURNAME: student.surname,
                    "CA (40 MARKS)": student.ca_score,
                    "MCQ (30 MARKS)": student.mcq_score,
                    "THEORY (30 MARKS)": student.theory_score,
                    "TOTAL (100)":
                      student.ca_score +
                      student.mcq_score +
                      student.theory_score,
                  }));
                  const workbook = XLSX.utils.book_new();
                  XLSX.utils.book_append_sheet(
                    workbook,
                    XLSX.utils.json_to_sheet(data),
                    "Scores",
                  );
                  const sessionMatch = String(session.session_name).match(
                    /(\d{4})\D*(\d{4})/,
                  );
                  const sessionLabel = sessionMatch
                    ? `${sessionMatch[1].slice(2)}_${sessionMatch[2].slice(2)}`
                    : String(session.session_name).replace(/\s+/g, "_");
                  const filename = `${term.term_name.replace(/\s+/g, "_")}_${class_name}_${subject.subject_name.replace(/\s+/g, "_")}_${sessionLabel}`;
                  res.attachment(`${filename}.xlsx`).send(
                    XLSX.write(workbook, {
                      type: "buffer",
                      bookType: "xlsx",
                    }),
                  );
                },
              );
            },
          );
        },
      );
    },
  );
});

module.exports = router;
