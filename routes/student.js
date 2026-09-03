const express = require("express");
const router = express.Router();
const db = require("../config/db");

const renderLogin = (res, error = null) =>
  res.render("student/login", { error });

const requireStudent = (req, res, next) => {
  if (req.session && req.session.student) return next();
  res.redirect("/login");
};

const studentFor = (req, callback) => {
  db.get(
    `SELECT * FROM students WHERE admission_no = ?`,
    [req.session.student.admission_no],
    callback,
  );
};

const legacyStudent = (student) => ({
  ...student,
  Name: [student.surname, student.middle_name, student.last_name]
    .filter(Boolean)
    .join(" "),
  Admission_no: student.admission_no,
  Class: student.class_name,
  Sex: student.gender,
  Passport: student.passport_url,
});

const ordinal = (number) => {
  const value = number % 100;
  const suffix =
    value >= 11 && value <= 13
      ? "th"
      : { 1: "st", 2: "nd", 3: "rd" }[number % 10] || "th";
  return `${number}${suffix}`;
};

const gradePoints = (score, isSenior) => {
  if (isSenior) {
    if (score >= 75) return 9;
    if (score >= 71) return 8;
    if (score >= 65) return 7;
    if (score >= 61) return 6;
    if (score >= 55) return 5;
    if (score >= 50) return 4;
    if (score >= 45) return 3;
    if (score >= 40) return 2;
    return 1;
  }
  if (score >= 70) return 5;
  if (score >= 60) return 4;
  if (score >= 50) return 3;
  if (score >= 45) return 2;
  return 1;
};

const termOrder = (termName) => {
  const name = String(termName || "").toLowerCase();
  if (name.includes("first")) return 1;
  if (name.includes("second")) return 2;
  if (name.includes("third")) return 3;
  return 99;
};

router.get("/login", (req, res) => renderLogin(res));

router.post("/login", (req, res) => {
  const admissionNo = String(req.body.admission_no || "").trim();
  const surname = String(req.body.surname || "").trim();
  if (!admissionNo || !surname)
    return renderLogin(res, "Enter your admission number and surname.");

  db.get(
    `SELECT s.admission_no
     FROM students s
     JOIN academic_session_enrollments e ON e.admission_no = s.admission_no
     WHERE s.admission_no = ? AND LOWER(s.surname) = LOWER(?)
       AND e.enrollment_status = 'Enrolled'
     LIMIT 1`,
    [admissionNo, surname],
    (err, student) => {
      if (err || !student)
        return renderLogin(res, "Invalid admission number or surname.");
      req.session.student = { admission_no: student.admission_no };
      res.redirect("/portal");
    },
  );
});

router.get("/logout", (req, res) => {
  delete req.session.student;
  res.redirect("/login");
});

router.get("/audit", requireStudent, (req, res) => {
  studentFor(req, (studentErr, student) => {
    if (studentErr || !student) return res.redirect("/logout");
    db.all(
      `SELECT a.session_name AS session, e.class_name AS class,
              COUNT(DISTINCT ss.subject_id) AS totalSubjects,
              COUNT(DISTINCT CASE WHEN sc.total_score >= 50 THEN ss.subject_id END) AS totalPassed,
              COALESCE(AVG(sc.total_score), 0) AS average
       FROM academic_sessions a
       JOIN academic_session_enrollments e ON e.session_id = a.session_id
       LEFT JOIN student_subject_selections ss
         ON ss.admission_no = e.admission_no
        AND (ss.session_id = e.session_id OR ss.session_id IS NULL)
       LEFT JOIN student_scores sc
         ON sc.admission_no = e.admission_no
        AND sc.session_id = e.session_id
        AND sc.subject_id = ss.subject_id
       WHERE e.admission_no = ? AND e.enrollment_status = 'Enrolled'
       GROUP BY a.session_id, a.session_name, e.class_name
       ORDER BY a.session_id ASC`,
      [student.admission_no],
      (auditErr, auditData) => {
        res.render("student/audit", {
          student: legacyStudent(student),
          auditData: auditErr ? [] : auditData || [],
        });
      },
    );
  });
});

router.get("/portal", requireStudent, (req, res) => {
  studentFor(req, (studentErr, student) => {
    if (studentErr || !student) return res.redirect("/logout");
    db.all(
      `SELECT a.session_id, a.session_name, e.class_name,
              GROUP_CONCAT(DISTINCT t.term_id || '|' || t.term_name) AS term_list
       FROM academic_sessions a
       JOIN academic_session_enrollments e ON e.session_id = a.session_id
       JOIN student_scores sc ON sc.admission_no = e.admission_no AND sc.session_id = a.session_id
       JOIN academic_terms t ON t.term_id = sc.term_id AND t.session_id = a.session_id
       WHERE e.admission_no = ? AND e.enrollment_status = 'Enrolled'
       GROUP BY a.session_id, a.session_name, e.class_name
       ORDER BY a.session_id DESC`,
      [student.admission_no],
      (err, sessions) => {
        const normalizedSessions = (sessions || []).map((session) => ({
          ...session,
          terms: (session.term_list || "")
            .split(",")
            .filter(Boolean)
            .map((term) => {
              const separator = term.indexOf("|");
              return {
                term_id: term.slice(0, separator),
                term_name: term.slice(separator + 1),
              };
            }),
        }));
        res.render("student/portal", {
          student: legacyStudent(student),
          sessions: normalizedSessions,
        });
      },
    );
  });
});

router.get("/profile", requireStudent, (req, res) => {
  studentFor(req, (studentErr, student) => {
    if (studentErr || !student) return res.redirect("/logout");
    db.all(
      `SELECT a.session_name, e.class_name,
              GROUP_CONCAT(DISTINCT sub.subject_name) AS subjects
       FROM academic_sessions a
       JOIN academic_session_enrollments e ON e.session_id = a.session_id
       LEFT JOIN student_subject_selections ss
         ON ss.admission_no = e.admission_no
        AND (ss.session_id = e.session_id OR ss.session_id IS NULL)
       LEFT JOIN subjects sub ON sub.subject_id = ss.subject_id
       WHERE e.admission_no = ? AND e.enrollment_status = 'Enrolled'
       GROUP BY a.session_id, a.session_name, e.class_name
       ORDER BY a.session_id DESC`,
      [student.admission_no],
      (err, sessions) =>
        res.render("student/profile", { student, sessions: sessions || [] }),
    );
  });
});

router.get("/view-result/:sessionId/:termId", requireStudent, (req, res) => {
  const { sessionId, termId } = req.params;
  studentFor(req, (studentErr, student) => {
    if (studentErr || !student) return res.redirect("/logout");
    db.get(
      `SELECT a.*, e.class_name
       FROM academic_sessions a
       JOIN academic_session_enrollments e ON e.session_id = a.session_id
       WHERE a.session_id = ? AND e.admission_no = ? AND e.enrollment_status = 'Enrolled'`,
      [sessionId, student.admission_no],
      (enrollmentErr, enrollment) => {
        db.get(
          `SELECT * FROM academic_terms WHERE term_id = ? AND session_id = ?`,
          [termId, sessionId],
          (termErr, term) => {
            if (enrollmentErr || termErr || !enrollment || !term)
              return res.status(404).send("Result not found");
            db.all(
              `SELECT sub.subject_id, sub.subject_name, COALESCE(sc.ca_score, 0) AS ca_score,
                      COALESCE(sc.mcq_score, 0) AS mcq_score,
                      COALESCE(sc.theory_score, 0) AS theory_score,
                      COALESCE(sc.total_score, 0) AS total_score
               FROM subjects sub
               LEFT JOIN student_scores sc
                 ON sc.subject_id = sub.subject_id
                AND sc.admission_no = ? AND sc.session_id = ? AND sc.term_id = ?
               WHERE EXISTS (
                 SELECT 1 FROM student_subject_selections ss
                 WHERE ss.admission_no = ? AND ss.subject_id = sub.subject_id
                   AND (ss.session_id = ? OR ss.session_id IS NULL)
               )
               ORDER BY sub.subject_name ASC`,
              [
                student.admission_no,
                sessionId,
                termId,
                student.admission_no,
                sessionId,
              ],
              (scoresErr, scores) => {
                db.all(
                  `SELECT e.admission_no, e.class_name, ss.subject_id,
                          COALESCE(sc.total_score, 0) AS total_score
                   FROM academic_session_enrollments e
                   JOIN student_subject_selections ss
                     ON ss.admission_no = e.admission_no
                    AND (ss.session_id = e.session_id OR ss.session_id IS NULL)
                   LEFT JOIN student_scores sc
                     ON sc.admission_no = e.admission_no
                    AND sc.session_id = e.session_id
                    AND sc.term_id = ?
                    AND sc.subject_id = ss.subject_id
                   WHERE e.session_id = ? AND e.class_name = ?
                     AND e.enrollment_status = 'Enrolled'`,
                  [termId, sessionId, enrollment.class_name],
                  (rankingErr, rankingRows) => {
                    const isSenior = /^SSS?/i.test(enrollment.class_name || "");
                    const classRows = rankingErr ? [] : rankingRows || [];
                    const subjectScores = new Map();
                    const studentTotals = new Map();

                    classRows.forEach((row) => {
                      const totalScore = Number(row.total_score || 0);
                      if (!subjectScores.has(row.subject_id))
                        subjectScores.set(row.subject_id, []);
                      subjectScores.get(row.subject_id).push({
                        admission_no: row.admission_no,
                        total_score: totalScore,
                      });
                      if (!studentTotals.has(row.admission_no)) {
                        studentTotals.set(row.admission_no, {
                          total: 0,
                          subjects: 0,
                          gradePoints: 0,
                        });
                      }
                      const studentTotal = studentTotals.get(row.admission_no);
                      studentTotal.total += totalScore;
                      studentTotal.subjects += 1;
                      studentTotal.gradePoints += gradePoints(
                        totalScore,
                        isSenior,
                      );
                    });

                    const rankBySubject = new Map();
                    subjectScores.forEach((subjectRows, subjectId) => {
                      const ordered = subjectRows
                        .slice()
                        .sort(
                          (left, right) => right.total_score - left.total_score,
                        );
                      const ranks = new Map();
                      ordered.forEach((row, index) => {
                        const previous = ordered[index - 1];
                        ranks.set(
                          row.admission_no,
                          previous && previous.total_score === row.total_score
                            ? ranks.get(previous.admission_no)
                            : index + 1,
                        );
                      });
                      rankBySubject.set(subjectId, ranks);
                    });

                    const classRanking = Array.from(
                      studentTotals.entries(),
                    ).sort((left, right) => {
                      const leftData = left[1];
                      const rightData = right[1];
                      const leftAverage = leftData.subjects
                        ? leftData.total / leftData.subjects
                        : 0;
                      const rightAverage = rightData.subjects
                        ? rightData.total / rightData.subjects
                        : 0;
                      return (
                        rightAverage - leftAverage ||
                        rightData.gradePoints - leftData.gradePoints ||
                        rightData.total - leftData.total ||
                        left[0].localeCompare(right[0])
                      );
                    });
                    const positionByStudent = new Map();
                    classRanking.forEach((entry, index) => {
                      const previous = classRanking[index - 1];
                      const data = entry[1];
                      const previousData = previous && previous[1];
                      const average = data.subjects
                        ? data.total / data.subjects
                        : 0;
                      const previousAverage =
                        previousData && previousData.subjects
                          ? previousData.total / previousData.subjects
                          : null;
                      const sameResult =
                        previousData &&
                        average === previousAverage &&
                        data.gradePoints === previousData.gradePoints &&
                        data.total === previousData.total;
                      positionByStudent.set(
                        entry[0],
                        sameResult
                          ? positionByStudent.get(previous[0])
                          : index + 1,
                      );
                    });

                    const reportScores = (scoresErr ? [] : scores || []).map(
                      (score) => ({
                        ...score,
                        subject: score.subject_name,
                        exam_score:
                          Number(score.mcq_score || 0) +
                          Number(score.theory_score || 0),
                        rank: ordinal(
                          rankBySubject
                            .get(score.subject_id)
                            ?.get(student.admission_no) || 0,
                        ),
                      }),
                    );
                    const grandTotal = reportScores.reduce(
                      (total, score) => total + Number(score.total_score || 0),
                      0,
                    );
                    const totalSubjects = reportScores.length;
                    const currentAvg = totalSubjects
                      ? (grandTotal / totalSubjects).toFixed(1)
                      : "0.0";
                    db.all(
                      `SELECT t.term_id, t.term_name,
                              COUNT(ss.subject_id) AS total_subjects,
                              COUNT(sc.score_id) AS scored_subjects,
                              COALESCE(AVG(COALESCE(sc.total_score, 0)), 0) AS average
                       FROM academic_terms t
                       LEFT JOIN student_subject_selections ss
                         ON ss.admission_no = ?
                        AND (ss.session_id = ? OR ss.session_id IS NULL)
                       LEFT JOIN student_scores sc
                         ON sc.admission_no = ?
                        AND sc.session_id = ?
                        AND sc.term_id = t.term_id
                        AND sc.subject_id = ss.subject_id
                       WHERE t.session_id = ?
                       GROUP BY t.term_id, t.term_name
                       ORDER BY t.term_id ASC`,
                      [
                        student.admission_no,
                        sessionId,
                        student.admission_no,
                        sessionId,
                        sessionId,
                      ],
                      (historyErr, historyRows) => {
                        const currentTermOrder = termOrder(term.term_name);
                        const averagesThroughCurrent = (
                          historyErr ? [] : historyRows || []
                        )
                          .filter(
                            (row) =>
                              termOrder(row.term_name) <= currentTermOrder &&
                              row.scored_subjects > 0,
                          )
                          .sort(
                            (left, right) =>
                              termOrder(left.term_name) -
                              termOrder(right.term_name),
                          )
                          .map((row) => Number(row.average || 0));
                        const firstAverage = (historyRows || []).find(
                          (row) =>
                            termOrder(row.term_name) === 1 &&
                            row.scored_subjects > 0,
                        );
                        const secondAverage = (historyRows || []).find(
                          (row) =>
                            termOrder(row.term_name) === 2 &&
                            row.scored_subjects > 0,
                        );
                        const cumulativeAverage = averagesThroughCurrent.length
                          ? averagesThroughCurrent.reduce(
                              (total, average) => total + average,
                              0,
                            ) / averagesThroughCurrent.length
                          : Number(currentAvg);
                        res.render("student/dashboard", {
                          student: legacyStudent(student),
                          session: enrollment.session_name,
                          term: term.term_name,
                          scores: reportScores,
                          grandTotal,
                          totalSubjects,
                          currentAvg,
                          t1Avg: firstAverage
                            ? Number(firstAverage.average).toFixed(1)
                            : "0.0",
                          t2Avg: secondAverage
                            ? Number(secondAverage.average).toFixed(1)
                            : "0.0",
                          cumulativeAvg: cumulativeAverage.toFixed(1),
                          position: positionByStudent.has(student.admission_no)
                            ? ordinal(
                                positionByStudent.get(student.admission_no),
                              )
                            : "-",
                          promoMsg: null,
                          finalPrincipalRemark:
                            "Keep working hard and aiming higher.",
                          extra: {
                            days_opened: term.days_school_opened || "",
                            days_present: "",
                            days_absent: "",
                            reason: "",
                            next_term: term.next_term_resumes || "",
                            teacher_comment: "",
                            punctuality: "",
                            neatness: "",
                            obedience: "",
                            honesty: "",
                            discipline: "",
                          },
                        });
                      },
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
});

module.exports = router;
