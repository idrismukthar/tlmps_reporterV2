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

const seniorGradePoint = (score) => {
  if (score >= 75) return 5;
  if (score >= 71) return 4.5;
  if (score >= 65) return 4;
  if (score >= 61) return 3.5;
  if (score >= 55) return 3;
  if (score >= 50) return 2.5;
  if (score >= 45) return 2;
  if (score >= 40) return 1;
  return 0;
};

const calculateGpa = (rows) => {
  const scoredRows = (rows || []).filter(
    (row) => row.score_id != null || row.total_score != null,
  );
  const totals = scoredRows.reduce(
    (result, row) => {
      const units = Number(row.unit_weight) > 0 ? Number(row.unit_weight) : 1;
      const qualityPoints =
        seniorGradePoint(Number(row.total_score || 0)) * units;
      result.qualityPoints += qualityPoints;
      result.units += units;
      return result;
    },
    { qualityPoints: 0, units: 0 },
  );
  return {
    ...totals,
    value: totals.units ? totals.qualityPoints / totals.units : null,
  };
};

const calculateTermAveragePercent = (rows) => {
  const scoredRows = (rows || []).filter(
    (row) => row.score_id != null || row.total_score != null,
  );

  if (!scoredRows.length) return null;

  const totalMarksObtained = scoredRows.reduce(
    (total, row) => total + Number(row.total_score || 0),
    0,
  );
  const maxObtainable = scoredRows.length * 100;

  if (!maxObtainable) return null;
  return (totalMarksObtained / maxObtainable) * 100;
};

const buildPromotionMessage = (currentClass, cumulativeAverage) => {
  const className = String(currentClass || "")
    .trim()
    .toUpperCase();
  const average = Number(cumulativeAverage || 0);

  if (!className) return null;

  if (average < 51) {
    return `You are advised to repeat ${className}`;
  }

  const nextClassMap = {
    JSS1: "JSS2",
    JSS2: "JSS3",
    JSS3: "Congratulations on finishing Junior Secondary School! You have been promoted to SSS1",
    SSS1: "SSS2",
    SSS2: "SSS3",
    SSS3: "Congratulations on completing Secondary School! You have successfully completed your Secondary Education.",
  };

  if (nextClassMap[className]) {
    const nextClass = nextClassMap[className];
    if (className === "JSS3" || className === "SSS3") {
      return nextClass;
    }
    return `Congratulations! You have been promoted to ${nextClass}`;
  }

  return "Congratulations! You have been promoted to the next class";
};

const buildPrincipalRemark = (average, rank, weakSubjects, studentKey = "") => {
  const avg = Number(average || 0);
  const rankNumber = Number(rank || 0);
  const subjectList = [
    ...new Set(
      (weakSubjects || [])
        .filter(Boolean)
        .map((subject) => String(subject).trim())
        .filter(Boolean),
    ),
  ].slice(0, 3);

  const comments =
    avg >= 80
      ? [
          "Congratulations on an exceptional performance this term. Your hard work and discipline are producing excellent results. Keep reaching for greater heights.",
          "Excellent work this term. You have shown impressive commitment to your studies and a commendable desire to succeed. Maintain this standard.",
          "You have delivered an outstanding performance this term. Your dedication is clearly reflected in your results. Keep up the excellent work.",
          "This is a remarkable result. Your focus, consistency, and determination deserve great commendation. Continue to lead by example.",
          "Congratulations on your brilliant performance. You have demonstrated a strong understanding of your work and admirable academic discipline.",
          "You have performed excellently this term. Your results show that sincere effort and regular preparation bring rewarding outcomes. Keep progressing.",
          "What an impressive performance this term. You have made excellent use of your abilities and should be proud of this achievement.",
          "Your performance is truly commendable. You have displayed confidence, diligence, and a strong commitment to academic excellence.",
          "Congratulations on a distinguished result. Your persistence and positive attitude have made a meaningful difference in your academic work.",
          "You have achieved a superb performance this term. Continue with this level of seriousness and you will accomplish even more.",
        ]
      : avg >= 59
        ? [
            "You have had a very good term and your steady effort is commendable. Continue working consistently to reach an even higher level.",
            "This is a good performance. Your determination is showing in your results, and greater focus will help you make an excellent improvement.",
            "You have made commendable progress this term. Keep revising regularly and remain focused so that you can achieve even more next term.",
            "Your result is encouraging and reflects good effort. With stronger consistency and attention to detail, you can move closer to excellence.",
            "Well done on a good performance this term. Do not become complacent; keep building on this foundation through regular study.",
            "You have shown a good level of commitment to your studies. Continue to work hard and aim for a stronger result next term.",
            "This is a pleasing performance. Your effort is evident, and a little more concentration and persistence will help you improve further.",
            "You have performed well this term. Keep asking questions, revising your lessons, and applying yourself more consistently.",
            "Your results show promising ability and good progress. Stay disciplined in your preparation and you can achieve a much higher result.",
            "You have done well this term and should be encouraged by your progress. Continue working diligently to turn this good performance into an excellent one.",
          ]
        : [
            "Your performance this term is encouraging, but you need to apply yourself more consistently. With greater effort, you can make a strong improvement next term.",
            "You have the ability to do better. Please devote more time to revision, complete your work diligently, and remain focused in class.",
            "There is room for improvement in your performance. A more serious study routine and regular practice will help you achieve better results.",
            "Your result shows that you can improve with greater commitment. Work harder, seek help when necessary, and prepare more thoroughly for assessments.",
            "You made an effort this term, but you must be more consistent in your studies. Stay focused and work steadily toward a better result.",
            "This performance can improve considerably. Take your lessons seriously, revise often, and do not hesitate to ask your teachers for guidance.",
            "You have made a beginning, but more determination is needed. With discipline and sustained effort, you can produce a much stronger performance.",
            "Your academic work requires more attention next term. Set clear study goals, practise regularly, and remain committed to improving.",
            "You are capable of achieving more than this result shows. Increase your effort, strengthen your preparation, and approach your studies with confidence.",
            "Keep working toward improvement. Greater concentration in class and a regular revision timetable will help you make meaningful progress next term.",
          ];

  const selectionKey = `${studentKey}-${Math.round(avg * 10)}-${rankNumber}-${subjectList.join("|")}`;
  const selectionIndex =
    [...selectionKey].reduce(
      (total, character) => total + character.charCodeAt(0),
      0,
    ) % comments.length;
  const opening = comments[selectionIndex];

  const formatSubjectList = (subjects) => {
    if (subjects.length === 1) return subjects[0];
    if (subjects.length === 2) return `${subjects[0]} and ${subjects[1]}`;
    return `${subjects.slice(0, -1).join(", ")} and ${subjects[subjects.length - 1]}`;
  };

  let topThreeNote = "";
  if (Number.isFinite(rankNumber) && rankNumber > 0 && rankNumber <= 3) {
    topThreeNote =
      rankNumber === 1
        ? " Congratulations on being the top of the class."
        : " Congratulations on being one of the top three students in the class.";
  }

  const subjectReminder = subjectList.length
    ? ` You need to work harder on ${formatSubjectList(subjectList)} so that your performance improves in those areas next term.`
    : " Keep working consistently and keep your focus on your studies.";

  return `${opening}${topThreeNote}${subjectReminder}`.trim();
};

const buildSessionPerformance = (rows) => {
  const groupedSessions = new Map();

  (rows || []).forEach((row) => {
    const sessionId =
      row.session_id ?? row.session ?? row.session_name ?? "unknown";
    const sessionName = row.session_name || row.session || "Unknown Session";
    const className = row.class_name || row.class || "N/A";

    if (!groupedSessions.has(sessionId)) {
      groupedSessions.set(sessionId, {
        session_id: sessionId,
        session_name: sessionName,
        class_name: className,
        terms: new Map(),
      });
    }

    const sessionEntry = groupedSessions.get(sessionId);
    const termKey =
      row.term_id ?? `${row.term_name || "Term"}-${row.term_number || 0}`;

    if (!sessionEntry.terms.has(termKey)) {
      sessionEntry.terms.set(termKey, {
        term_id: row.term_id,
        term_name: row.term_name || "Term",
        term_number: row.term_number || 1,
        rows: [],
      });
    }

    const termEntry = sessionEntry.terms.get(termKey);
    if (row.score_id != null || row.total_score != null) {
      termEntry.rows.push(row);
    }
  });

  return Array.from(groupedSessions.values())
    .map((sessionEntry) => {
      let cumulativeQualityPoints = 0;
      let cumulativeUnits = 0;

      const terms = Array.from(sessionEntry.terms.values())
        .sort(
          (left, right) =>
            Number(left.term_number || 0) - Number(right.term_number || 0),
        )
        .map((termEntry) => {
          const stats = calculateGpa(termEntry.rows);
          const qualityPoints = Number(stats.qualityPoints || 0);
          const units = Number(stats.units || 0);
          cumulativeQualityPoints += qualityPoints;
          cumulativeUnits += units;
          const runningCgpa = cumulativeUnits
            ? cumulativeQualityPoints / cumulativeUnits
            : null;

          return {
            term_id: termEntry.term_id,
            term_name: termEntry.term_name,
            term_number: termEntry.term_number,
            gpa: stats.value == null ? null : Number(stats.value).toFixed(2),
            cgpa: runningCgpa == null ? null : Number(runningCgpa).toFixed(2),
          };
        });

      return {
        session_id: sessionEntry.session_id,
        session_name: sessionEntry.session_name,
        class_name: sessionEntry.class_name,
        terms,
        cgpa: cumulativeUnits
          ? Number(cumulativeQualityPoints / cumulativeUnits).toFixed(2)
          : null,
      };
    })
    .sort(
      (left, right) =>
        Number(left.session_id || 0) - Number(right.session_id || 0),
    );
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
      `SELECT a.session_id, a.session_name AS session, e.class_name AS class,
              t.term_id, t.term_name, t.term_number,
              ss.subject_id, sub.unit_weight,
              sc.score_id, sc.total_score
       FROM academic_sessions a
       JOIN academic_session_enrollments e ON e.session_id = a.session_id
       LEFT JOIN academic_terms t ON t.session_id = a.session_id
       LEFT JOIN student_subject_selections ss
         ON ss.admission_no = e.admission_no
        AND (ss.session_id = e.session_id OR ss.session_id IS NULL)
       LEFT JOIN subjects sub ON sub.subject_id = ss.subject_id
       LEFT JOIN student_scores sc
         ON sc.admission_no = e.admission_no
        AND sc.session_id = e.session_id
        AND sc.term_id = t.term_id
        AND sc.subject_id = ss.subject_id
       WHERE e.admission_no = ? AND e.enrollment_status = 'Enrolled'
       ORDER BY a.session_id ASC, t.term_number ASC, sub.subject_name ASC`,
      [student.admission_no],
      (auditErr, sessionRows) => {
        const detailedRows = auditErr ? [] : sessionRows || [];

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
          (summaryErr, auditData) => {
            res.render("student/audit", {
              student: legacyStudent(student),
              auditData: summaryErr ? [] : auditData || [],
              sessionSummaries: buildSessionPerformance(detailedRows),
            });
          },
        );
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
      `SELECT a.session_id, a.session_name, e.class_name,
              t.term_id, t.term_name, t.term_number,
              ss.subject_id, sub.subject_name, sub.unit_weight,
              sc.score_id, sc.total_score
       FROM academic_sessions a
       JOIN academic_session_enrollments e ON e.session_id = a.session_id
       LEFT JOIN academic_terms t ON t.session_id = a.session_id
       LEFT JOIN student_subject_selections ss
         ON ss.admission_no = e.admission_no
        AND (ss.session_id = e.session_id OR ss.session_id IS NULL)
       LEFT JOIN subjects sub ON sub.subject_id = ss.subject_id
       LEFT JOIN student_scores sc
         ON sc.admission_no = e.admission_no
        AND sc.session_id = e.session_id
        AND sc.term_id = t.term_id
        AND sc.subject_id = ss.subject_id
       WHERE e.admission_no = ? AND e.enrollment_status = 'Enrolled'
       ORDER BY a.session_id ASC, t.term_number ASC, sub.subject_name ASC`,
      [student.admission_no],
      (err, sessionRows) => {
        const sessionSummaries = buildSessionPerformance(
          err ? [] : sessionRows || [],
        );
        res.render("student/profile", {
          student,
          sessionSummaries,
          sessions: sessionSummaries,
        });
      },
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
              `SELECT sub.subject_id, sub.subject_name, sub.unit_weight, sc.score_id,
                      COALESCE(sc.ca_score, 0) AS ca_score,
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
                    const maxObtainable = totalSubjects * 100;
                    const currentAvg = maxObtainable
                      ? ((grandTotal / maxObtainable) * 100).toFixed(1)
                      : "0.0";
                    db.all(
                      `SELECT t.term_id, t.term_name, sub.unit_weight, sc.score_id,
                              sc.total_score
                       FROM academic_terms t
                       JOIN student_subject_selections ss
                         ON ss.admission_no = ?
                        AND (ss.session_id = ? OR ss.session_id IS NULL)
                       JOIN subjects sub ON sub.subject_id = ss.subject_id
                       LEFT JOIN student_scores sc
                         ON sc.admission_no = ?
                        AND sc.session_id = ?
                        AND sc.term_id = t.term_id
                        AND sc.subject_id = ss.subject_id
                       WHERE t.session_id = ?
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
                        const historyByTerm = new Map();
                        (historyErr ? [] : historyRows || []).forEach((row) => {
                          if (!historyByTerm.has(row.term_id))
                            historyByTerm.set(row.term_id, []);
                          historyByTerm.get(row.term_id).push(row);
                        });
                        const termGpas = Array.from(historyByTerm.entries())
                          .map(([termIdValue, rows]) => ({
                            termId: termIdValue,
                            termName: rows[0].term_name,
                            stats: calculateGpa(rows),
                          }))
                          .filter((entry) => entry.stats.units > 0)
                          .filter(
                            (entry) =>
                              termOrder(entry.termName) <= currentTermOrder,
                          )
                          .sort(
                            (left, right) =>
                              termOrder(left.termName) -
                              termOrder(right.termName),
                          );

                        const termAverageEntries = Array.from(
                          historyByTerm.entries(),
                        )
                          .map(([termIdValue, rows]) => ({
                            termId: termIdValue,
                            termName: rows[0].term_name,
                            average: calculateTermAveragePercent(rows),
                          }))
                          .filter(
                            (entry) =>
                              entry.average !== null &&
                              termOrder(entry.termName) <= currentTermOrder,
                          )
                          .sort(
                            (left, right) =>
                              termOrder(left.termName) -
                              termOrder(right.termName),
                          );

                        const currentGpa = calculateGpa(
                          scoresErr ? [] : scores || [],
                        );
                        const cumulativeStats = termGpas.reduce(
                          (result, entry) => ({
                            qualityPoints:
                              result.qualityPoints + entry.stats.qualityPoints,
                            units: result.units + entry.stats.units,
                          }),
                          { qualityPoints: 0, units: 0 },
                        );
                        const cumulativeGpa = cumulativeStats.units
                          ? cumulativeStats.qualityPoints /
                            cumulativeStats.units
                          : null;
                        const firstTermAverage = termAverageEntries.find(
                          (entry) => termOrder(entry.termName) === 1,
                        );
                        const secondTermAverage = termAverageEntries.find(
                          (entry) => termOrder(entry.termName) === 2,
                        );
                        const cumulativeAverageValue = termAverageEntries.length
                          ? termAverageEntries.reduce(
                              (total, entry) =>
                                total + Number(entry.average || 0),
                              0,
                            ) / termAverageEntries.length
                          : Number(currentAvg);
                        const promoMsg = String(term.term_name || "")
                          .toLowerCase()
                          .includes("third term")
                          ? buildPromotionMessage(
                              enrollment.class_name,
                              cumulativeAverageValue,
                            )
                          : null;
                        const classRank = positionByStudent.get(
                          student.admission_no,
                        );
                        const lowScoringSubjects = (reportScores || [])
                          .filter(
                            (score) => Number(score.total_score || 0) <= 50,
                          )
                          .map(
                            (score) =>
                              score.subject_name || score.subject || "Subject",
                          );
                        const finalPrincipalRemark = buildPrincipalRemark(
                          currentAvg,
                          classRank,
                          lowScoringSubjects,
                          student.admission_no,
                        );
                        res.render("student/dashboard", {
                          student: legacyStudent(student),
                          session: enrollment.session_name,
                          term: term.term_name,
                          scores: reportScores,
                          grandTotal,
                          totalSubjects,
                          currentAvg,
                          t1Avg: firstTermAverage
                            ? Number(firstTermAverage.average).toFixed(1)
                            : "0.0",
                          t2Avg: secondTermAverage
                            ? Number(secondTermAverage.average).toFixed(1)
                            : "0.0",
                          cumulativeAvg: cumulativeAverageValue.toFixed(1),
                          gpa: currentGpa.value,
                          cgpa: cumulativeGpa,
                          position: positionByStudent.has(student.admission_no)
                            ? ordinal(
                                positionByStudent.get(student.admission_no),
                              )
                            : "-",
                          promoMsg,
                          finalPrincipalRemark,
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

router.buildSessionPerformance = buildSessionPerformance;

module.exports = router;
