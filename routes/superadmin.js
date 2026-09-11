const express = require("express");
const router = express.Router();
const db = require("../config/db");
const uploadPassport = require("../middleware/upload");
const PDFDocument = require("pdfkit");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const nigeriaStates = require("../static/states.json");
const studentRoutes = require("./student");

// Auth Protection
const requireAuth = (req, res, next) => {
  if (req.session && req.session.isSuperAdmin) return next();
  res.redirect("/superadmin/login");
};

const formatDOBInWords = (dobStr) => {
  if (!dobStr) return "N/A";
  const parts = String(dobStr).split("/");
  if (parts.length !== 3) return dobStr;

  const day = Number(parts[0]);
  const month = Number(parts[1]) - 1;
  const year = Number(parts[2]);
  const birthDate = new Date(year, month, day);
  if (
    Number.isNaN(birthDate.getTime()) ||
    birthDate.getFullYear() !== year ||
    birthDate.getMonth() !== month ||
    birthDate.getDate() !== day
  ) {
    return dobStr;
  }

  const daysOfWeek = [
    "Sunday",
    "Monday",
    "Tuesday",
    "Wednesday",
    "Thursday",
    "Friday",
    "Saturday",
  ];
  const monthsOfYear = [
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December",
  ];
  const suffix =
    day % 100 >= 11 && day % 100 <= 13
      ? "th"
      : day % 10 === 1
        ? "st"
        : day % 10 === 2
          ? "nd"
          : day % 10 === 3
            ? "rd"
            : "th";
  const today = new Date();
  let age = today.getFullYear() - year;
  if (
    today.getMonth() < month ||
    (today.getMonth() === month && today.getDate() < day)
  ) {
    age -= 1;
  }

  return `${daysOfWeek[birthDate.getDay()]}, ${day}${suffix} ${
    monthsOfYear[month]
  } ${year} (${age} ${age === 1 ? "year" : "years"} old)`;
};

const hashOptionalIdentifier = (value, callback) => {
  if (!value) return callback(null, null);
  bcrypt.hash(value, 12, callback);
};

const identifierKey = crypto
  .createHash("sha256")
  .update(
    process.env.IDENTIFIER_ENCRYPTION_KEY ||
      process.env.SESSION_SECRET ||
      "tlmps_identifier_key_change_in_production",
  )
  .digest();

const encryptIdentifier = (value) => {
  if (!value) return null;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", identifierKey, iv);
  const encrypted = Buffer.concat([
    cipher.update(value, "utf8"),
    cipher.final(),
  ]);
  return `v1:${iv.toString("hex")}:${cipher
    .getAuthTag()
    .toString("hex")}:${encrypted.toString("hex")}`;
};

const decryptIdentifier = (value) => {
  if (!value || !value.startsWith("v1:")) return null;
  const [, ivHex, tagHex, encryptedHex] = value.split(":");
  try {
    const decipher = crypto.createDecipheriv(
      "aes-256-gcm",
      identifierKey,
      Buffer.from(ivHex, "hex"),
    );
    decipher.setAuthTag(Buffer.from(tagHex, "hex"));
    return Buffer.concat([
      decipher.update(Buffer.from(encryptedHex, "hex")),
      decipher.final(),
    ]).toString("utf8");
  } catch (error) {
    return null;
  }
};

const exposeIdentifiers = (student) => ({
  ...student,
  nin: decryptIdentifier(student.nin_encrypted),
  lassra: decryptIdentifier(student.lassra_encrypted),
});

const allRows = (query, params = []) =>
  new Promise((resolve, reject) => {
    db.all(query, params, (error, rows) => (error ? reject(error) : resolve(rows || [])));
  });

const getRow = (query, params = []) =>
  new Promise((resolve, reject) => {
    db.get(query, params, (error, row) => (error ? reject(error) : resolve(row || null)));
  });

const analyticsSessionName = (value) =>
  value === "2025_and_2026" ? "2025/2026" : "2026/2027";

const analyticsTermName = (value) =>
  String(value || "First_term").replace(/_/g, " ");

router.get("/login", (req, res) =>
  res.render("superadmin/login", { error: null }),
);
router.post("/login", (req, res) => {
  if (req.body.password === (process.env.SUPERADMIN_PASSWORD || "tlmps")) {
    req.session.isSuperAdmin = true;
    res.redirect("/superadmin/dashboard");
  } else {
    res.render("superadmin/login", { error: "Invalid Password" });
  }
});
router.get("/logout", (req, res) => {
  req.session.destroy();
  res.redirect("/superadmin/login");
});

router.use(requireAuth);

// Dashboard
router.get("/dashboard", (req, res) => {
  db.all(`SELECT * FROM academic_sessions`, [], (err, sessions) => {
    res.render("superadmin/dashboard", { sessions: sessions || [] });
  });

  router.get("/analytics", async (req, res) => {
    try {
      const session = req.query.session || "2026_and_2027";
      const term = req.query.term || "First_term";
      const filterClass = req.query.class || "";
      const sessionName = analyticsSessionName(session);
      const termName = analyticsTermName(term);
      const classCondition =
        filterClass === "JUNIOR"
          ? "AND e.class_name LIKE 'JSS%'"
          : filterClass === "SENIOR"
            ? "AND e.class_name LIKE 'SSS%'"
            : filterClass
              ? "AND e.class_name = ?"
              : "";
      const params = [sessionName, termName];
      if (filterClass && !["JUNIOR", "SENIOR"].includes(filterClass))
        params.push(filterClass);
      const rows = await allRows(
        `SELECT e.class_name, s.admission_no,
                TRIM(s.surname || ' ' || COALESCE(s.middle_name, '') || ' ' || COALESCE(s.last_name, '')) AS name,
                COALESCE(AVG(sc.total_score), 0) AS average
         FROM academic_sessions a
         JOIN academic_terms t ON t.session_id = a.session_id AND LOWER(t.term_name) = LOWER(?)
         JOIN academic_session_enrollments e ON e.session_id = a.session_id AND e.enrollment_status = 'Enrolled'
         JOIN students s ON s.admission_no = e.admission_no
         LEFT JOIN student_scores sc ON sc.admission_no = e.admission_no
           AND sc.session_id = a.session_id AND sc.term_id = t.term_id
         WHERE a.session_name = ? ${classCondition}
         GROUP BY e.class_name, s.admission_no, s.surname, s.middle_name, s.last_name
         ORDER BY average DESC, name ASC`,
        [termName, sessionName, ...params.slice(2)],
      );
      const classAverages = {};
      rows.forEach((row) => {
        if (!classAverages[row.class_name]) classAverages[row.class_name] = [];
        classAverages[row.class_name].push(Number(row.average));
      });
      Object.keys(classAverages).forEach((className) => {
        const values = classAverages[className];
        classAverages[className] =
          values.reduce((total, value) => total + value, 0) / values.length;
      });
      const stats = {
        totalStudents: rows.length,
        topStudents: rows.slice(0, 10).map((row) => ({
          name: row.name,
          class: row.class_name,
          average: Number(row.average),
        })),
        worstStudents: rows.slice().sort((a, b) => Number(a.average) - Number(b.average)).slice(0, 10).map((row) => ({
          name: row.name,
          class: row.class_name,
          average: Number(row.average),
        })),
        classAverages,
        subjectStats: {},
      };
      const subjectRows = await allRows(
        `SELECT sub.subject_name,
                SUM(CASE WHEN sc.total_score >= 50 THEN 1 ELSE 0 END) AS passed,
                SUM(CASE WHEN sc.total_score < 50 THEN 1 ELSE 0 END) AS failed
         FROM academic_sessions a
         JOIN academic_terms t ON t.session_id = a.session_id AND LOWER(t.term_name) = LOWER(?)
         JOIN academic_session_enrollments e ON e.session_id = a.session_id AND e.enrollment_status = 'Enrolled'
         JOIN student_subject_selections ss ON ss.admission_no = e.admission_no
           AND (ss.session_id = e.session_id OR ss.session_id IS NULL)
         JOIN subjects sub ON sub.subject_id = ss.subject_id
         LEFT JOIN student_scores sc ON sc.admission_no = e.admission_no
           AND sc.session_id = a.session_id AND sc.term_id = t.term_id AND sc.subject_id = sub.subject_id
         WHERE a.session_name = ? ${classCondition}
         GROUP BY sub.subject_id, sub.subject_name`,
        [termName, sessionName, ...params.slice(2)],
      );
      subjectRows.forEach((row) => {
        stats.subjectStats[row.subject_name] = {
          passed: Number(row.passed || 0),
          failed: Number(row.failed || 0),
        };
      });
      res.render("superadmin/total_data_analytics/super_admin_view_dashboard", {
        session, term, filterClass, stats,
      });
    } catch (error) {
      res.status(500).send(`Unable to load analytics: ${error.message}`);
    }
  });

  router.get("/analytics/results", async (req, res) => {
    try {
      const session = req.query.session || "2026_and_2027";
      const term = req.query.term || "First_term";
      const className = req.query.class || "JSS1";
      const students = await allRows(
        `SELECT s.admission_no, s.surname, s.middle_name AS m_name, s.last_name AS l_name, s.gender,
                a.session_id, t.term_id
         FROM academic_sessions a
         JOIN academic_terms t ON t.session_id = a.session_id AND LOWER(t.term_name) = LOWER(?)
         JOIN academic_session_enrollments e ON e.session_id = a.session_id
           AND e.class_name = ? AND e.enrollment_status = 'Enrolled'
         JOIN students s ON s.admission_no = e.admission_no
         WHERE a.session_name = ?
         ORDER BY s.gender DESC, s.surname ASC, s.middle_name ASC, s.last_name ASC`,
        [analyticsTermName(term), className, analyticsSessionName(session)],
      );
      res.render("superadmin/total_data_analytics/super_admin_view_results", {
        session, term, className, students,
      });
    } catch (error) {
      res.status(500).send(`Unable to load result list: ${error.message}`);
    }
  });

  router.get("/analytics/report/:sessionId/:termId/:admissionNo", async (req, res) => {
    try {
      const { sessionId, termId, admissionNo } = req.params;
      const student = await getRow(`SELECT * FROM students WHERE admission_no = ?`, [admissionNo]);
      const enrollment = await getRow(
        `SELECT e.class_name, a.session_name, t.term_name, t.next_term_resumes
         FROM academic_session_enrollments e
         JOIN academic_sessions a ON a.session_id = e.session_id
         JOIN academic_terms t ON t.session_id = a.session_id AND t.term_id = ?
         WHERE e.session_id = ? AND e.admission_no = ?`,
        [termId, sessionId, admissionNo],
      );
      if (!student || !enrollment) return res.status(404).send("Report card not found");
      const scores = await allRows(
        `SELECT sub.subject_id, sub.subject_name, sub.unit_weight, COALESCE(sc.ca_score, 0) AS ca_score,
                COALESCE(sc.mcq_score, 0) AS mcq_score,
                COALESCE(sc.theory_score, 0) AS theory_score,
                COALESCE(sc.total_score, 0) AS total_score, sc.score_id
         FROM student_subject_selections ss
         JOIN subjects sub ON sub.subject_id = ss.subject_id
         LEFT JOIN student_scores sc ON sc.admission_no = ss.admission_no
           AND sc.session_id = ? AND sc.term_id = ? AND sc.subject_id = ss.subject_id
         WHERE ss.admission_no = ? AND (ss.session_id = ? OR ss.session_id IS NULL)
         ORDER BY sub.subject_name ASC`,
        [sessionId, termId, admissionNo, sessionId],
      );
      const classRows = await allRows(
        `SELECT e.admission_no, ss.subject_id, COALESCE(sc.total_score, 0) AS total_score
         FROM academic_session_enrollments e
         JOIN student_subject_selections ss
           ON ss.admission_no = e.admission_no
          AND (ss.session_id = e.session_id OR ss.session_id IS NULL)
         LEFT JOIN student_scores sc
           ON sc.admission_no = e.admission_no AND sc.session_id = ?
          AND sc.term_id = ? AND sc.subject_id = ss.subject_id
         WHERE e.session_id = ? AND e.class_name = ? AND e.enrollment_status = 'Enrolled'`,
        [sessionId, termId, sessionId, enrollment.class_name],
      );
      const subjectRankRows = new Map();
      const studentTotals = new Map();
      classRows.forEach((row) => {
        if (!subjectRankRows.has(row.subject_id)) subjectRankRows.set(row.subject_id, []);
        subjectRankRows.get(row.subject_id).push(row);
        if (!studentTotals.has(row.admission_no)) {
          studentTotals.set(row.admission_no, { total: 0, subjects: 0 });
        }
        const total = Number(row.total_score || 0);
        studentTotals.get(row.admission_no).total += total;
        studentTotals.get(row.admission_no).subjects += 1;
      });
      const rankBySubject = new Map();
      subjectRankRows.forEach((rows, subjectId) => {
        const ordered = rows.slice().sort((left, right) =>
          Number(right.total_score) - Number(left.total_score),
        );
        const ranks = new Map();
        ordered.forEach((row, index) => {
          const previous = ordered[index - 1];
          ranks.set(
            row.admission_no,
            previous && Number(previous.total_score) === Number(row.total_score)
              ? ranks.get(previous.admission_no)
              : index + 1,
          );
        });
        rankBySubject.set(subjectId, ranks);
      });
      const orderedStudents = Array.from(studentTotals.entries()).sort(
        (left, right) =>
          right[1].total / (right[1].subjects || 1) -
            left[1].total / (left[1].subjects || 1) ||
          left[0].localeCompare(right[0]),
      );
      let classPosition = "-";
      let classPositionNumber = 0;
      orderedStudents.forEach((entry, index) => {
        if (entry[0] === admissionNo) {
          classPositionNumber = index + 1;
          classPosition = `${index + 1}${index === 0 ? "st" : index === 1 ? "nd" : index === 2 ? "rd" : "th"}`;
        }
      });
      const visibleStudent = exposeIdentifiers({
        ...student,
        Name: [student.surname, student.middle_name, student.last_name].filter(Boolean).join(" "),
        Admission_no: student.admission_no,
        Class: enrollment.class_name,
        Sex: student.gender,
        Passport: student.passport_url,
      });
      const reportScores = scores.map((score) => ({
        ...score,
        subject: score.subject_name,
        exam_score: Number(score.mcq_score || 0) + Number(score.theory_score || 0),
        rank: (() => {
          const rank = rankBySubject.get(score.subject_id)?.get(admissionNo);
          if (!rank) return "-";
          return `${rank}${rank === 1 ? "st" : rank === 2 ? "nd" : rank === 3 ? "rd" : "th"}`;
        })(),
      }));
      const grandTotal = reportScores.reduce(
        (total, score) => total + Number(score.total_score || 0),
        0,
      );
      const totalSubjects = reportScores.length;
      const currentAvg = totalSubjects
        ? ((grandTotal / (totalSubjects * 100)) * 100).toFixed(1)
        : "0.0";
      const historyRows = await allRows(
        `SELECT t.term_name, t.term_number, sc.total_score, sc.score_id, sub.unit_weight
         FROM academic_terms t
         JOIN student_subject_selections ss ON ss.admission_no = ? AND (ss.session_id = ? OR ss.session_id IS NULL)
         JOIN subjects sub ON sub.subject_id = ss.subject_id
         LEFT JOIN student_scores sc ON sc.admission_no = ? AND sc.session_id = ?
          AND sc.term_id = t.term_id AND sc.subject_id = ss.subject_id
         WHERE t.session_id = ? ORDER BY t.term_number ASC`,
        [admissionNo, sessionId, admissionNo, sessionId, sessionId],
      );
      const termAverages = new Map();
      historyRows.forEach((row) => {
        if (row.score_id == null) return;
        if (!termAverages.has(row.term_name)) termAverages.set(row.term_name, []);
        termAverages.get(row.term_name).push(Number(row.total_score || 0));
      });
      const averageFor = (name) => {
        const values = termAverages.get(name) || [];
        return values.length
          ? (values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(1)
          : "0.0";
      };
      const firstTermAverage = averageFor("First Term");
      const secondTermAverage = averageFor("Second Term");
      const currentTermAverage = averageFor(enrollment.term_name);
      const averageValues = Array.from(termAverages.values()).filter(Boolean).flat();
      const cumulativeAvg = averageValues.length
        ? (averageValues.reduce((sum, value) => sum + value, 0) / averageValues.length).toFixed(1)
        : currentAvg;
      const promotionAverage = Number(cumulativeAvg);
      const promoMsg = /third term/i.test(enrollment.term_name) && promotionAverage >= 51
        ? (/JSS3/i.test(enrollment.class_name)
          ? "Congratulations on finishing Junior Secondary School! You have been promoted to SSS1"
          : /SSS3/i.test(enrollment.class_name)
            ? "Congratulations on completing Secondary School! You have successfully completed your Secondary Education."
            : `Congratulations! You have been promoted to the next class`)
        : null;
      const weakSubjects = reportScores
        .filter((score) => Number(score.total_score || 0) <= 50)
        .map((score) => score.subject_name || score.subject);
      const finalPrincipalRemark = studentRoutes.buildPrincipalRemark(
        currentAvg,
        classPositionNumber,
        weakSubjects,
        admissionNo,
      );
      const attendance = await getRow(
        `SELECT COUNT(DISTINCT r.attendance_date) AS days_opened,
                COUNT(DISTINCT CASE WHEN r.status = 'P' THEN r.attendance_date END) AS days_present,
                COUNT(DISTINCT CASE WHEN r.status = 'A' THEN r.attendance_date END) AS days_absent
         FROM attendance_records r
         LEFT JOIN attendance_days d
           ON d.term_id = r.term_id AND d.attendance_date = r.attendance_date
         WHERE r.term_id = ? AND r.admission_no = ? AND COALESCE(d.is_holiday, 0) = 0`,
        [termId, admissionNo],
      );
      const remarks = await getRow(
        `SELECT * FROM class_teacher_remarks WHERE admission_no = ? AND session_id = ? AND term_id = ?`,
        [admissionNo, sessionId, termId],
      );
      return res.render("student/dashboard", {
        student: visibleStudent,
        session: enrollment.session_name,
        term: enrollment.term_name,
        scores: reportScores,
        grandTotal,
        totalSubjects,
        currentAvg,
        t1Avg: firstTermAverage,
        t2Avg: secondTermAverage,
        cumulativeAvg,
        gpa: null,
        cgpa: null,
        position: classPosition,
        promoMsg,
        resultStatus: null,
        finalPrincipalRemark,
        extra: {
          days_opened: attendance?.days_opened || "",
          days_present: attendance?.days_present || "",
          days_absent: attendance?.days_absent || "",
          reason: "",
          next_term: enrollment.next_term_resumes || "",
          teacher_comment: remarks?.teacher_comment || "",
          teacher_name: remarks?.teacher_name || "",
          conduct_rating: remarks?.conduct_rating || 5,
          punctuality: remarks?.punctuality || "",
          neatness: remarks?.neatness || "",
          obedience: remarks?.obedience || "",
          honesty: remarks?.honesty || "",
          discipline: remarks?.discipline || "",
        },
      });
    } catch (error) {
      res.status(500).send(`Unable to load report card: ${error.message}`);
    }
  });
});

// Registration is always scoped to an academic session.
router.get("/register-student", (req, res) => {
  const sessionId = req.query.session_id;
  if (!sessionId) return res.redirect("/superadmin/sessions");
  db.all(
    `SELECT * FROM subjects ORDER BY subject_name ASC`,
    [],
    (err, subjects) => {
      db.get(
        `SELECT * FROM academic_sessions WHERE session_id = ?`,
        [sessionId],
        (sessionErr, session) => {
          if (!session)
            return res.status(404).send("Academic Session Not Found");
          res.render("superadmin/register-student", {
            subjects: subjects || [],
            session,
            states: nigeriaStates,
          });
        },
      );
    },
  );
});

router.get("/api/check-admission/:admission_no", (req, res) => {
  const admissionNo = String(req.params.admission_no || "").trim();
  if (!/^\d{5}$/.test(admissionNo)) {
    return res.json({ exists: false });
  }

  db.get(
    `SELECT surname, middle_name, last_name
     FROM students
     WHERE admission_no = ?`,
    [admissionNo],
    (err, student) => {
      if (err) return res.status(500).json({ error: "Admission lookup failed" });
      res.json({
        exists: Boolean(student),
        name: student
          ? [student.surname, student.middle_name, student.last_name]
              .filter(Boolean)
              .join(" ")
          : null,
      });
    },
  );
});

// POST Register Student
router.post("/register-student", (req, res) => {
  uploadPassport.single("passport")(req, res, (err) => {
    if (err) return res.status(400).send(`Upload Error: ${err.message}`);

    const {
      session_id,
      admission_no,
      class_name,
      department,
      surname,
      middle_name,
      last_name,
      gender,
      phone_number,
      email,
      address,
      state_of_origin,
      lga,
      dob,
      club,
      society,
      subject_ids,
      nin,
      lassra,
    } = req.body;

    const passport_url = req.file ? `/uploads/${req.file.filename}` : null;

    if (!session_id)
      return res.status(400).send("Academic session is required");
    if (!/^\d{5}$/.test(String(admission_no || "").trim()))
      return res.status(400).send("Admission number must be exactly 5 digits");
    if (nin && !/^\d{11}$/.test(nin))
      return res.status(400).send("NIN must contain exactly 11 digits");
    if (lassra && !/^LA-\d{10}$/.test(lassra))
      return res.status(400).send("LASSRA must use the format LA- followed by 10 digits");
    const selectedState = nigeriaStates.find(
      (state) => state.name === state_of_origin,
    );
    if (!selectedState || !selectedState.lgas.includes(lga)) {
      return res.status(400).send("Please select a valid state and LGA");
    }

    db.get(
      `SELECT surname, middle_name, last_name
       FROM students
       WHERE admission_no = ?`,
      [admission_no],
      (lookupErr, existingStudent) => {
        if (lookupErr)
          return res.status(500).send("Admission lookup failed");
        if (existingStudent) {
          const owner = [
            existingStudent.surname,
            existingStudent.middle_name,
            existingStudent.last_name,
          ]
            .filter(Boolean)
            .join(" ");
          return res
            .status(409)
            .send(
              `Admission number ${admission_no} already belongs to ${owner}. Please check again.`,
            );
        }

    hashOptionalIdentifier(nin, (ninErr, ninHash) => {
      if (ninErr) return res.status(500).send("NIN protection error");
      hashOptionalIdentifier(lassra, (lassraErr, lassraHash) => {
        if (lassraErr) return res.status(500).send("LASSRA protection error");
        const ninEncrypted = encryptIdentifier(nin);
        const lassraEncrypted = encryptIdentifier(lassra);
        db.run(
          `INSERT INTO students (admission_no, surname, middle_name, last_name, class_name, department, gender, phone_number, email, address, state_of_origin, lga, dob, club, society, passport_url, nin_hash, lassra_hash, nin_encrypted, lassra_encrypted) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            admission_no,
            surname,
            middle_name,
            last_name,
            class_name,
            department || null,
            gender,
            phone_number,
            email,
            address,
            state_of_origin,
            lga,
            dob,
            club,
            society,
            passport_url,
            ninHash,
            lassraHash,
            ninEncrypted,
            lassraEncrypted,
          ],
          function (dbErr) {
        if (dbErr)
          return res.status(500).send("Registration Error: " + dbErr.message);

        db.run(
          `INSERT INTO academic_session_enrollments (session_id, admission_no, class_name) VALUES (?, ?, ?)`,
          [session_id, admission_no, class_name],
          (enrollmentErr) => {
            if (enrollmentErr)
              return res
                .status(500)
                .send("Enrolment Error: " + enrollmentErr.message);
          },
        );

        if (subject_ids) {
          const selectedIds = Array.isArray(subject_ids)
            ? subject_ids
            : [subject_ids];
          const stmt = db.prepare(
            `INSERT OR IGNORE INTO student_subject_selections (admission_no, subject_id, session_id) VALUES (?, ?, ?)`,
          );
          selectedIds.forEach((id) => stmt.run(admission_no, id, session_id));
          stmt.finalize();
        }

        res.redirect(`/superadmin/sessions/${session_id}`);
          },
        );
      });
    });
      },
    );
  });
});

// All Students Page (Sorted by Admission No)
router.get("/all-students", (req, res) => {
  db.all(
    `SELECT * FROM students ORDER BY admission_no ASC`,
    [],
    (err, students) => {
      res.render("superadmin/all-students", { students: students || [] });
    },
  );
});

// Single Student Profile Page
router.get("/student/:admission_no", (req, res) => {
  const adm = req.params.admission_no;
  const requestedSessionId = req.query.session_id || null;

  db.get(
    `SELECT * FROM students WHERE admission_no = ?`,
    [adm],
    (err, student) => {
      if (!student) return res.status(404).send("Student Not Found");
      student = exposeIdentifiers(student);

      const getEnrollmentSession = (callback) => {
        if (requestedSessionId) {
          return db.get(
            `SELECT a.*, e.class_name AS enrolled_class, e.department AS enrolled_department
             FROM academic_sessions a
             LEFT JOIN academic_session_enrollments e
               ON e.session_id = a.session_id AND e.admission_no = ?
             WHERE a.session_id = ? AND a.is_archived = 0`,
            [adm, requestedSessionId],
            callback,
          );
        }
        db.get(
          `SELECT a.*, e.class_name AS enrolled_class, e.department AS enrolled_department
           FROM academic_sessions a
           JOIN academic_session_enrollments e ON e.session_id = a.session_id
           WHERE e.admission_no = ? AND a.is_archived = 0 AND e.enrollment_status = 'Enrolled'
           ORDER BY a.session_id DESC LIMIT 1`,
          [adm],
          (enrErr, enrolledSession) => {
            if (enrolledSession) return callback(null, enrolledSession);
            db.get(
              `SELECT * FROM academic_sessions WHERE is_archived = 0 ORDER BY session_id DESC LIMIT 1`,
              callback,
            );
          },
        );
      };

      getEnrollmentSession((sessionErr, session) => {
        const targetSessionId = session ? session.session_id : null;

        db.all(
          `SELECT subjects.* FROM subjects
           JOIN student_subject_selections ON subjects.subject_id = student_subject_selections.subject_id
           WHERE student_subject_selections.admission_no = ?
             AND (student_subject_selections.session_id = ? OR (? IS NULL AND student_subject_selections.session_id IS NULL))
           ORDER BY subject_name ASC`,
          [adm, targetSessionId, targetSessionId],
          (err, enrolledSubjects) => {
            const currentClass = (session && session.enrolled_class) || student.class_name;
            const currentDept = (session && session.enrolled_department) || student.department;
            const visibleStudent = exposeIdentifiers(student);

            res.render("superadmin/student-profile", {
              student: {
                ...visibleStudent,
                class_name: currentClass,
                department: currentDept,
              },
              session,
              dobInWords: formatDOBInWords(student.dob),
              enrolledSubjects: enrolledSubjects || [],
            });
          },
        );
      });
    },
  );
});

// Edit Student Profile
router.get("/student/:admission_no/edit", (req, res) => {
  const adm = req.params.admission_no;
  db.get(
    `SELECT * FROM students WHERE admission_no = ?`,
    [adm],
    (err, student) => {
      if (!student) return res.status(404).send("Student Not Found");
      const visibleStudent = exposeIdentifiers(student);

      db.all(
        `SELECT * FROM subjects ORDER BY subject_name ASC`,
        [],
        (subjectsErr, subjects) => {
          db.all(
            `SELECT subject_id FROM student_subject_selections WHERE admission_no = ?`,
            [adm],
            (selectionErr, selections) => {
              const sessionId = req.query.session_id || "";
              const renderEditor = (session) =>
                res.render("superadmin/register-student", {
                  student: visibleStudent,
                  subjects: subjects || [],
                  selectedSubjectIds: (selections || []).map(
                    (selection) => selection.subject_id,
                  ),
                  states: nigeriaStates,
                  session: session || {
                    session_id: sessionId,
                    session_name: "Student Profile",
                  },
                  editMode: true,
                  originalAdmissionNo: adm,
                });
              if (sessionId) {
                db.get(
                  `SELECT * FROM academic_sessions WHERE session_id = ?`,
                  [sessionId],
                  (sessionErr, session) => renderEditor(session),
                );
              } else {
                db.get(
                  `SELECT a.* FROM academic_sessions a JOIN academic_session_enrollments e ON e.session_id = a.session_id WHERE e.admission_no = ? ORDER BY a.session_id DESC LIMIT 1`,
                  [adm],
                  (sessionErr, session) => renderEditor(session),
                );
              }
            },
          );
        },
      );
    },
  );
});

router.post("/student/:admission_no/edit", (req, res) => {
  uploadPassport.single("passport")(req, res, (err) => {
    if (err) return res.status(400).send(`Upload Error: ${err.message}`);

    const oldAdmissionNo = req.params.admission_no;
    const {
      admission_no,
      class_name,
      department,
      surname,
      middle_name,
      last_name,
      gender,
      phone_number,
      email,
      address,
      state_of_origin,
      lga,
      dob,
      club,
      society,
      subject_ids,
      session_id,
      nin,
      lassra,
    } = req.body;
    const newAdmissionNo = String(admission_no || "").trim();
    if (!/^\d{5}$/.test(newAdmissionNo)) {
      return res.status(400).send("Admission number must be exactly 5 digits");
    }
    if (nin && !/^\d{11}$/.test(nin))
      return res.status(400).send("NIN must contain exactly 11 digits");
    if (lassra && !/^LA-\d{10}$/.test(lassra))
      return res.status(400).send("LASSRA must use the format LA- followed by 10 digits");
    const selectedState = nigeriaStates.find(
      (state) => state.name === state_of_origin,
    );
    if (!selectedState || !selectedState.lgas.includes(lga)) {
      return res.status(400).send("Please select a valid state and LGA");
    }

    db.get(
      `SELECT passport_url, nin_hash, lassra_hash, nin_encrypted, lassra_encrypted FROM students WHERE admission_no = ?`,
      [oldAdmissionNo],
      (findErr, student) => {
        if (!student) return res.status(404).send("Student Not Found");
        const passportUrl = req.file
          ? `/uploads/${req.file.filename}`
          : student.passport_url;
        db.get(
          `SELECT admission_no FROM students WHERE admission_no = ? AND admission_no != ?`,
          [newAdmissionNo, oldAdmissionNo],
          (duplicateErr, duplicate) => {
            if (duplicate)
              return res
                .status(400)
                .send("That admission number is already in use");
            hashOptionalIdentifier(nin, (ninErr, ninHash) => {
              if (ninErr) return res.status(500).send("NIN protection error");
              hashOptionalIdentifier(lassra, (lassraErr, lassraHash) => {
                if (lassraErr)
                  return res.status(500).send("LASSRA protection error");
                const ninEncrypted = encryptIdentifier(nin);
                const lassraEncrypted = encryptIdentifier(lassra);
                db.serialize(() => {
              db.run(
                `UPDATE students SET admission_no = ?, surname = ?, middle_name = ?, last_name = ?, class_name = ?, department = ?, gender = ?, phone_number = ?, email = ?, address = ?, state_of_origin = ?, lga = ?, dob = ?, club = ?, society = ?, passport_url = ?, nin_hash = ?, lassra_hash = ?, nin_encrypted = ?, lassra_encrypted = ? WHERE admission_no = ?`,
                [
                  newAdmissionNo,
                  surname,
                  middle_name,
                  last_name,
                  class_name,
                  class_name.startsWith("SSS") ? department || null : null,
                  gender,
                  phone_number,
                  email,
                  address,
                  state_of_origin,
                  lga,
                  dob,
                  club,
                  society,
                  passportUrl,
                  ninHash || student.nin_hash || null,
                  lassraHash || student.lassra_hash || null,
                  ninEncrypted || student.nin_encrypted || null,
                  lassraEncrypted || student.lassra_encrypted || null,
                  oldAdmissionNo,
                ],
                (updateErr) => {
                  if (updateErr)
                    return res
                      .status(500)
                      .send("Update Error: " + updateErr.message);
                  db.run(
                    `UPDATE academic_session_enrollments SET admission_no = ?, class_name = ? WHERE admission_no = ?`,
                    [newAdmissionNo, class_name, oldAdmissionNo],
                  );
                  db.run(
                    `DELETE FROM student_subject_selections WHERE admission_no = ? AND session_id = ?`,
                    [oldAdmissionNo, session_id],
                  );
                  if (subject_ids) {
                    const selectedIds = Array.isArray(subject_ids)
                      ? subject_ids
                      : [subject_ids];
                    const stmt = db.prepare(
                      `INSERT OR IGNORE INTO student_subject_selections (admission_no, subject_id, session_id) VALUES (?, ?, ?)`,
                    );
                    selectedIds.forEach((id) =>
                      stmt.run(newAdmissionNo, id, session_id),
                    );
                    stmt.finalize();
                  }
                  const redirectPath = session_id
                    ? `/superadmin/sessions/${session_id}`
                    : `/superadmin/student/${newAdmissionNo}`;
                  res.redirect(redirectPath);
                },
              );
                });
              });
            });
          },
        );
      },
    );
  });
});

// PDF Registration Slip Download Endpoint
router.get("/download-pdf/:admission_no", (req, res) => {
  const adm = req.params.admission_no;
  const requestedSessionId = req.query.session_id || null;

  db.get(
    `SELECT * FROM students WHERE admission_no = ?`,
    [adm],
    (err, student) => {
      if (!student) return res.status(404).send("Student Not Found");
      student = exposeIdentifiers(student);

      const getEnrollmentSession = (callback) => {
        if (requestedSessionId) {
          return db.get(
            `SELECT a.*, e.class_name AS enrolled_class, e.department AS enrolled_department
             FROM academic_sessions a
             LEFT JOIN academic_session_enrollments e
               ON e.session_id = a.session_id AND e.admission_no = ?
             WHERE a.session_id = ? AND a.is_archived = 0`,
            [adm, requestedSessionId],
            callback,
          );
        }
        db.get(
          `SELECT a.*, e.class_name AS enrolled_class, e.department AS enrolled_department
           FROM academic_sessions a
           JOIN academic_session_enrollments e ON e.session_id = a.session_id
           WHERE e.admission_no = ? AND a.is_archived = 0 AND e.enrollment_status = 'Enrolled'
           ORDER BY a.session_id DESC LIMIT 1`,
          [adm],
          (enrErr, enrolledSession) => {
            if (enrolledSession) return callback(null, enrolledSession);
            db.get(
              `SELECT * FROM academic_sessions WHERE is_archived = 0 ORDER BY session_id DESC LIMIT 1`,
              callback,
            );
          },
        );
      };

      getEnrollmentSession((sessionErr, session) => {
        const targetSessionId = session ? session.session_id : null;

        db.all(
          `SELECT subjects.* FROM subjects
           JOIN student_subject_selections ON subjects.subject_id = student_subject_selections.subject_id
           WHERE student_subject_selections.admission_no = ?
             AND (student_subject_selections.session_id = ? OR (? IS NULL AND student_subject_selections.session_id IS NULL))
           ORDER BY subject_name ASC`,
          [adm, targetSessionId, targetSessionId],
          (err, enrolledSubjects) => {
            const doc = new PDFDocument({ margin: 40, size: "A4" });

            const filename = `${student.admission_no}_${student.surname}_${student.last_name}_registration_form.pdf`;

          res.setHeader("Content-Type", "application/pdf");
          res.setHeader(
            "Content-Disposition",
            `attachment; filename="${filename}"`,
          );

          doc.pipe(res);

          // --- Helper Function: Format DOB into Words + Age Calculation ---
          const formatDOBInWords = (dobStr) => {
            if (!dobStr) return "N/A";
            const parts = dobStr.split("/");
            if (parts.length !== 3) return dobStr;

            const dayNum = parseInt(parts[0], 10);
            const monthNum = parseInt(parts[1], 10) - 1;
            const yearNum = parseInt(parts[2], 10);

            const birthDate = new Date(yearNum, monthNum, dayNum);
            if (isNaN(birthDate.getTime())) return dobStr;

            // Day of week & Month Name
            const daysOfWeek = [
              "Sunday",
              "Monday",
              "Tuesday",
              "Wednesday",
              "Thursday",
              "Friday",
              "Saturday",
            ];
            const monthsOfYear = [
              "January",
              "February",
              "March",
              "April",
              "May",
              "June",
              "July",
              "August",
              "September",
              "October",
              "November",
              "December",
            ];

            const dayOfWeek = daysOfWeek[birthDate.getDay()];
            const monthName = monthsOfYear[birthDate.getMonth()];

            // Ordinal suffix (1st, 2nd, 3rd, 31st, etc.)
            const getOrdinal = (n) => {
              const s = ["th", "st", "nd", "rd"];
              const v = n % 100;
              return n + (s[(v - 20) % 10] || s[v] || s[0]);
            };

            // Age Calculation relative to current year
            const today = new Date();
            let age = today.getFullYear() - birthDate.getFullYear();
            const m = today.getMonth() - birthDate.getMonth();
            if (m < 0 || (m === 0 && today.getDate() < birthDate.getDate())) {
              age--;
            }

            const ageText = age === 1 ? "1 year old" : `${age} years old`;
            return `${dayOfWeek}, ${getOrdinal(dayNum)} ${monthName} ${yearNum} (${ageText})`;
          };

          // --- 1. Top Header & Passport Photo ---
          doc
            .fillColor("#000000")
            .fontSize(22)
            .font("Helvetica-Bold")
            .text(
              `${student.surname} ${student.middle_name || ""} ${student.last_name}`.toUpperCase(),
            );
          doc
            .fillColor("#6c757d")
            .fontSize(11)
            .font("Helvetica")
            .text(`Admission Number: ${student.admission_no}`);

          // Passport Image (Top Right Box)
          if (student.passport_url) {
            try {
              const relativePath = student.passport_url.replace(
                "/uploads/",
                "",
              );
              const fullPath = path.join(
                __dirname,
                "../public/uploads",
                relativePath,
              );
              if (fs.existsSync(fullPath)) {
                doc
                  .roundedRect(465, 35, 90, 90, 4)
                  .strokeColor("#0d6efd")
                  .lineWidth(1.5)
                  .stroke();
                doc.image(fullPath, 467, 37, { width: 86, height: 86 });
              }
            } catch (e) {}
          }

          // Horizontal Accent Line
          doc
            .moveTo(40, 135)
            .lineTo(555, 135)
            .strokeColor("#0d6efd")
            .lineWidth(2)
            .stroke();

          // --- 2. Grid Cards Layout Engine ---
          let currentY = 150;

          const drawGridCard = (x, y, width, height, label, value) => {
            // Gray background container
            doc.roundedRect(x, y, width, height, 4).fill("#f8f9fa");
            // Left Blue Accent Border
            doc
              .moveTo(x, y)
              .lineTo(x, y + height)
              .strokeColor("#0d6efd")
              .lineWidth(3)
              .stroke();

            // Label text
            doc
              .fillColor("#6c757d")
              .fontSize(8)
              .font("Helvetica-Bold")
              .text(label.toUpperCase(), x + 10, y + 6);
            // Value text
            doc
              .fillColor("#212529")
              .fontSize(10)
              .font("Helvetica-Bold")
              .text(value || "N/A", x + 10, y + 18, { width: width - 15 });
          };

          const formGrid = [
            [
              { label: "CLASS", val: student.class_name, width: 250 },
              {
                label: "DEPARTMENT",
                val: student.department || "N/A",
                width: 255,
              },
            ],
            [
              { label: "GENDER", val: student.gender, width: 250 },
              {
                label: "DATE OF BIRTH",
                val: formatDOBInWords(student.dob),
                width: 255,
              },
            ],
            [
              { label: "PHONE NUMBER", val: student.phone_number, width: 250 },
              { label: "EMAIL", val: student.email || "N/A", width: 255 },
            ],
            [
              { label: "NIN", val: student.nin || "N/A", width: 250 },
              { label: "LASSRA", val: student.lassra || "N/A", width: 255 },
            ],
            [
              {
                label: "STATE OF ORIGIN",
                val: student.state_of_origin,
                width: 250,
              },
              { label: "LGA", val: student.lga, width: 255 },
            ],
            [
              { label: "CLUB", val: student.club || "N/A", width: 250 },
              { label: "SOCIETY", val: student.society || "N/A", width: 255 },
            ],
            [
              {
                label: "RESIDENTIAL ADDRESS",
                val: student.address,
                width: 515,
              },
            ],
          ];

          formGrid.forEach((row) => {
            let currentX = 40;
            let rowHeight = 36;

            row.forEach((item) => {
              // Give DOB extra height if formatted string wraps
              if (item.label === "DATE OF BIRTH" && item.val.length > 30) {
                rowHeight = 44;
              }
              drawGridCard(
                currentX,
                currentY,
                item.width,
                rowHeight,
                item.label,
                item.val,
              );
              currentX += item.width + 10;
            });

            currentY += rowHeight + 8;
          });

          // --- 3. Enrolled Subjects Section ---
          currentY += 10;
          doc
            .fillColor("#000000")
            .fontSize(14)
            .font("Helvetica-Bold")
            .text("Enrolled Subjects", 40, currentY);
          currentY += 20;

          (enrolledSubjects || []).forEach((s) => {
            const unitText =
              s.level_category === "SSS"
                ? ` (${s.unit_weight} Unit${s.unit_weight > 1 ? "s" : ""})`
                : "";

            // Bullet point dot
            doc.circle(48, currentY + 4, 2).fill("#000000");
            doc
              .fillColor("#212529")
              .fontSize(10)
              .font("Helvetica")
              .text(`${s.subject_name}${unitText}`, 58, currentY);
            currentY += 15;
          });

          doc.end();
        },
      );
    },
  );
});
});
// Subject Routes
router.get("/subjects", (req, res) => {
  db.all(
    `SELECT * FROM subjects ORDER BY subject_name ASC`,
    [],
    (err, subjects) => {
      res.render("superadmin/subjects", { subjects: subjects || [] });
    },
  );
});

router.post("/add-subject", (req, res) => {
  const { subject_name, level_category, unit_weight } = req.body;
  const weight = level_category === "SSS" ? parseInt(unit_weight) || 1 : 1;
  db.run(
    `INSERT INTO subjects (subject_name, level_category, unit_weight) VALUES (?, ?, ?)`,
    [subject_name, level_category, weight],
    () => {
      res.redirect("/superadmin/subjects");
    },
  );
});

router.post("/update-subject-unit", (req, res) => {
  db.run(
    `UPDATE subjects SET unit_weight = ? WHERE subject_id = ?`,
    [parseInt(req.body.unit_weight) || 1, req.body.subject_id],
    () => {
      res.redirect("/superadmin/subjects");
    },
  );
});

router.get("/delete-subject/:id", (req, res) => {
  db.run(`DELETE FROM subjects WHERE subject_id = ?`, [req.params.id], () => {
    res.redirect("/superadmin/subjects");
  });
});

// Sessions
router.get("/sessions", (req, res) => {
  const archived = req.query.archived === "1";
  db.all(
    `SELECT * FROM academic_sessions WHERE is_archived = ? ORDER BY session_id ASC`,
    [archived ? 1 : 0],
    (err, sessions) => {
      res.render("superadmin/sessions", {
        sessions: sessions || [],
        archived,
      });
  });
});

router.post("/create-session", (req, res) => {
  db.run(
    `INSERT INTO academic_sessions (session_name) VALUES (?)`,
    [req.body.session_name],
    function (err) {
      if (err)
        return res.status(400).send("Session Creation Error: " + err.message);
      const sessionId = this.lastID;
      db.run(
        `INSERT INTO academic_terms (session_id, term_name, term_number, term_status) VALUES (?, ?, 1, 'Active')`,
        [sessionId, "First Term"],
        () => {
          db.get(
            `SELECT session_id FROM academic_sessions WHERE session_id < ? ORDER BY session_id DESC LIMIT 1`,
            [sessionId],
            (previousErr, previous) => {
              if (previous) {
                db.all(
                  `SELECT admission_no, class_name FROM academic_session_enrollments WHERE session_id = ? AND enrollment_status = 'Enrolled'`,
                  [previous.session_id],
                  (rosterErr, roster) => {
                    const promote = {
                      JSS1: "JSS2",
                      JSS2: "JSS3",
                      JSS3: "SSS1",
                      SSS1: "SSS2",
                      SSS2: "SSS3",
                    };
                    const stmt = db.prepare(
                      `INSERT INTO academic_session_enrollments (session_id, admission_no, class_name, enrollment_status) VALUES (?, ?, ?, ?)`,
                    );
                    (roster || []).forEach((student) => {
                      const nextClass = promote[student.class_name];
                      if (nextClass)
                        stmt.run(
                          sessionId,
                          student.admission_no,
                          nextClass,
                          "Enrolled",
                        );
                      else
                        db.run(
                          `UPDATE academic_session_enrollments SET enrollment_status = 'Graduated' WHERE session_id = ? AND admission_no = ?`,
                          [previous.session_id, student.admission_no],
                        );
                    });
                    stmt.finalize(() =>
                      res.redirect(`/superadmin/sessions/${sessionId}`),
                    );
                  },
                );
              } else {
                res.redirect(`/superadmin/sessions/${sessionId}`);
              }
            },
          );
        },
      );
    },
  );
});

router.get("/sessions/:session_id", (req, res) => {
  const sessionId = req.params.session_id;
  db.get(
    `SELECT * FROM academic_sessions WHERE session_id = ?`,
    [sessionId],
    (err, session) => {
      if (!session) return res.status(404).send("Academic Session Not Found");
      db.get(
        `SELECT * FROM academic_terms WHERE session_id = ? AND term_status = 'Active' ORDER BY term_number LIMIT 1`,
        [sessionId],
        (termErr, term) => {
          db.all(
            `SELECT t.*,
                    (
                      SELECT COUNT(DISTINCT r.attendance_date)
                      FROM attendance_records r
                      LEFT JOIN attendance_days d
                        ON d.term_id = r.term_id AND d.attendance_date = r.attendance_date
                      WHERE r.term_id = t.term_id AND COALESCE(d.is_holiday, 0) = 0
                    ) AS live_days_opened
             FROM academic_terms t
             WHERE t.session_id = ? ORDER BY t.term_number ASC`,
            [sessionId],
            (termsErr, terms) => {
              db.all(
                `SELECT e.*, s.surname, s.middle_name, s.last_name, s.gender, s.department FROM academic_session_enrollments e JOIN students s ON s.admission_no = e.admission_no WHERE e.session_id = ? AND e.enrollment_status = 'Enrolled' ORDER BY e.class_name ASC, e.admission_no ASC`,
                [sessionId],
                (rosterErr, students) =>
                  res.render("superadmin/session-detail", {
                    session,
                    term,
                    terms: terms || [],
                    students: students || [],
                  }),
              );
            },
          );
        },
      );
    },
  );
});

router.post("/update-term", (req, res) => {
  const { term_id, vacation_date, resumption_date, next_term_resumes } = req.body;
  db.run(
    `UPDATE academic_terms
     SET vacation_date = ?, resumption_date = ?, next_term_resumes = ?
     WHERE term_id = ?`,
    [vacation_date, resumption_date, next_term_resumes, term_id],
    function (err) {
      if (err) return res.status(500).send("Term Update Error: " + err.message);
      const referrer = req.get("Referrer");
      let redirectPath = "/superadmin/sessions";
      if (referrer) {
        try {
          const referrerUrl = new URL(referrer, `${req.protocol}://${req.get("host")}`);
          if (referrerUrl.origin === `${req.protocol}://${req.get("host")}`) {
            redirectPath = `${referrerUrl.pathname}${referrerUrl.search}`;
          }
        } catch (redirectError) {
          redirectPath = "/superadmin/sessions";
        }
      }
      res.redirect(redirectPath);
    },
  );
});

router.post("/conclude-term", (req, res) => {
  const {
    term_id,
    vacation_date,
    resumption_date,
    next_term_resumes,
  } = req.body;
  db.run(
    `UPDATE academic_terms
     SET vacation_date = ?, resumption_date = ?, next_term_resumes = ?, term_status = 'Concluded'
     WHERE term_id = ?`,
    [vacation_date, resumption_date, next_term_resumes, term_id],
    function (err) {
      if (err) return res.status(500).send("Term Update Error: " + err.message);
      db.get(
        `SELECT * FROM academic_terms WHERE term_id = ?`,
        [term_id],
        (termErr, concluded) => {
          if (!concluded) return res.status(404).send("Term Not Found");
          if (concluded.term_number < 3) {
            const nextNumber = concluded.term_number + 1;
            const names = { 2: "Second Term", 3: "Third Term" };
            db.run(
              `INSERT INTO academic_terms (session_id, term_name, term_number, term_status, days_school_opened, resumption_date) VALUES (?, ?, ?, 'Active', 0, ?)`,
              [
                concluded.session_id,
                names[nextNumber],
                nextNumber,
                next_term_resumes,
              ],
              () =>
                res.redirect(`/superadmin/sessions/${concluded.session_id}`),
            );
          } else {
            db.get(
              `SELECT session_name FROM academic_sessions WHERE session_id = ?`,
              [concluded.session_id],
              (sessionErr, current) => {
                const match = (current.session_name || "").match(
                  /^(\d{4})\/(\d{4})$/,
                );
                const nextName = match
                  ? `${Number(match[1]) + 1}/${Number(match[2]) + 1}`
                  : `${current.session_name} (Next)`;
                db.run(
                  `INSERT INTO academic_sessions (session_name) VALUES (?)`,
                  [nextName],
                  function (createErr) {
                    if (createErr)
                      return res
                        .status(400)
                        .send("Next Session Error: " + createErr.message);
                    const nextSessionId = this.lastID;
                    db.run(
                      `INSERT INTO academic_terms (session_id, term_name, term_number, term_status) VALUES (?, 'First Term', 1, 'Active')`,
                      [nextSessionId],
                      () =>
                        res.redirect(`/superadmin/sessions/${nextSessionId}`),
                    );
                  },
                );
              },
            );
          }
        },
      );
    },
  );
});

// Attendance workspace -----------------------------------------------------
const parseTermDate = (value) => {
  if (!value) return null;
  const text = String(value).trim();
  let match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (!match) match = /^(\d{2})-(\d{2})-(\d{4})$/.exec(text) && [
    null,
    RegExp.$3,
    RegExp.$2,
    RegExp.$1,
  ];
  if (!match) return null;
  const date = new Date(
    Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])),
  );
  if (
    Number.isNaN(date.getTime()) ||
    date.getUTCFullYear() !== Number(match[1]) ||
    date.getUTCMonth() !== Number(match[2]) - 1 ||
    date.getUTCDate() !== Number(match[3])
  )
    return null;
  return date;
};

const formatAttendanceDate = (date) => date.toISOString().slice(0, 10);
const displayAttendanceDate = (dateString) => {
  const date = parseTermDate(dateString);
  if (!date) return dateString || "";
  return date.toLocaleDateString("en-GB", {
    weekday: "short",
    day: "2-digit",
    month: "short",
  });
};

const displayAttendanceDateLong = (dateString) => {
  const date = parseTermDate(dateString);
  if (!date) return dateString || "";
  return date.toLocaleDateString("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
};

const weekdayDates = (resumptionDate, vacationDate) => {
  const start = parseTermDate(resumptionDate);
  const end = parseTermDate(vacationDate);
  if (!start || !end || start > end) return [];
  const dates = [];
  for (const date = new Date(start); date <= end; date.setUTCDate(date.getUTCDate() + 1)) {
    const day = date.getUTCDay();
    if (day !== 0 && day !== 6) dates.push(formatAttendanceDate(date));
  }
  return dates;
};

const attendanceTerm = (sessionId, termId, callback) => {
  db.get(
    `SELECT t.*, s.session_name
     FROM academic_terms t
     JOIN academic_sessions s ON s.session_id = t.session_id
     WHERE t.term_id = ? AND t.session_id = ?`,
    [termId, sessionId],
    callback,
  );
};

router.get("/attendance", (req, res) => {
  db.all(
    `SELECT * FROM academic_sessions WHERE is_archived = 0 ORDER BY session_id DESC`,
    [],
    (err, sessions) => {
      if (err) return res.status(500).send("Attendance sessions could not be loaded");
      res.render("superadmin/attendance/sessions", { sessions: sessions || [] });
    },
  );
});

router.get("/attendance/:session_id", (req, res) => {
  db.get(
    `SELECT * FROM academic_sessions WHERE session_id = ?`,
    [req.params.session_id],
    (err, session) => {
      if (err) return res.status(500).send("Attendance session could not be loaded");
      if (!session) return res.status(404).send("Academic Session Not Found");
      db.all(
        `SELECT * FROM academic_terms WHERE session_id = ? ORDER BY term_number`,
        [session.session_id],
        (termsErr, terms) => {
          if (termsErr) return res.status(500).send("Attendance terms could not be loaded");
          res.render("superadmin/attendance/terms", { session, terms: terms || [] });
        },
      );
    },
  );
});

router.get("/attendance/:session_id/:term_id", (req, res) => {
  attendanceTerm(req.params.session_id, req.params.term_id, (err, term) => {
    if (err) return res.status(500).send("Attendance term could not be loaded");
    if (!term) return res.status(404).send("Academic Term Not Found");
    db.get(
      `SELECT COUNT(DISTINCT r.attendance_date) AS days_opened
       FROM attendance_records r
       LEFT JOIN attendance_days d
         ON d.term_id = r.term_id AND d.attendance_date = r.attendance_date
       WHERE r.term_id = ? AND COALESCE(d.is_holiday, 0) = 0`,
      [term.term_id],
      (daysErr, dayCount) => {
        if (daysErr) return res.status(500).send("Attendance days could not be loaded");
        db.all(
          `SELECT class_name, COUNT(*) AS student_count
           FROM academic_session_enrollments
           WHERE session_id = ? AND enrollment_status = 'Enrolled'
           GROUP BY class_name ORDER BY class_name`,
          [req.params.session_id],
          (classesErr, classes) => {
            if (classesErr) return res.status(500).send("Attendance classes could not be loaded");
            res.render("superadmin/attendance/classes", {
              term,
              classes: classes || [],
              daysOpened: dayCount ? dayCount.days_opened || 0 : 0,
            });
          },
        );
      },
    );
  });
});

router.get("/attendance/:session_id/:term_id/class", (req, res) => {
  const className = String(req.query.class_name || "").trim();
  attendanceTerm(req.params.session_id, req.params.term_id, (err, term) => {
    if (err) return res.status(500).send("Attendance term could not be loaded");
    if (!term) return res.status(404).send("Academic Term Not Found");
    if (!className) return res.redirect(`/superadmin/attendance/${req.params.session_id}/${req.params.term_id}`);
    const dates = weekdayDates(term.resumption_date, term.vacation_date);
    const requestedDate = String(req.query.date || "").trim();
    const selectedDate = dates.includes(requestedDate)
      ? requestedDate
      : dates[0] || requestedDate;
    if (req.query.view === "register") {
      return db.all(
        `SELECT e.admission_no, e.class_name, s.surname, s.middle_name, s.last_name, s.gender
         FROM academic_session_enrollments e
         JOIN students s ON s.admission_no = e.admission_no
         WHERE e.session_id = ? AND e.class_name = ? AND e.enrollment_status = 'Enrolled'
         ORDER BY CASE WHEN UPPER(COALESCE(s.gender, '')) IN ('M', 'MALE') THEN 0 ELSE 1 END,
                  s.surname, s.middle_name, s.last_name, e.admission_no`,
        [req.params.session_id, className],
        (studentsErr, registerStudents) => {
          if (studentsErr) return res.status(500).send("Attendance students could not be loaded");
          db.all(
            `SELECT attendance_date, is_holiday, holiday_name
             FROM attendance_days WHERE term_id = ?`,
            [term.term_id],
            (daysErr, dayRows) => {
              if (daysErr) return res.status(500).send("Attendance days could not be loaded");
              db.all(
                `SELECT attendance_date, admission_no, status
                 FROM attendance_records WHERE term_id = ?`,
                [term.term_id],
                (recordsErr, records) => {
                  if (recordsErr) return res.status(500).send("Attendance records could not be loaded");
                  const dayMap = Object.fromEntries((dayRows || []).map((day) => [day.attendance_date, day]));
                  const recordMap = Object.fromEntries(
                    (records || []).map((record) => [
                      `${record.attendance_date}:${record.admission_no}`,
                      record.status,
                    ]),
                  );
                  const weeks = [];
                  for (let index = 0; index < dates.length; index += 5) {
                    const weekDates = dates.slice(index, index + 5);
                    weeks.push({
                      number: weeks.length + 1,
                      dates: weekDates,
                      label: `Week ${weeks.length + 1} (${displayAttendanceDate(weekDates[0])} - ${displayAttendanceDate(weekDates[weekDates.length - 1])})`,
                    });
                  }
                  return res.render("superadmin/attendance/register", {
                    term,
                    className,
                    weeks,
                    displayAttendanceDate,
                    dayMap,
                    recordMap,
                    maleStudents: (registerStudents || []).filter((student) =>
                      ["M", "MALE"].includes(String(student.gender || "").toUpperCase()),
                    ),
                    femaleStudents: (registerStudents || []).filter((student) =>
                      !["M", "MALE"].includes(String(student.gender || "").toUpperCase()),
                    ),
                    error: dates.length ? null : "Set valid resumption and vacation dates for this term before viewing the register.",
                  });
                },
              );
            },
          );
        },
      );
    }
    db.all(
      `SELECT e.admission_no, e.class_name, s.surname, s.middle_name, s.last_name
       FROM academic_session_enrollments e
       JOIN students s ON s.admission_no = e.admission_no
       WHERE e.session_id = ? AND e.class_name = ? AND e.enrollment_status = 'Enrolled'
       ORDER BY s.surname, s.last_name, s.middle_name, e.admission_no`,
      [req.params.session_id, className],
      (studentsErr, students) => {
        if (studentsErr) return res.status(500).send("Attendance students could not be loaded");
        db.all(
          `SELECT attendance_date, is_holiday, holiday_name
          FROM attendance_days
          WHERE term_id = ? AND attendance_date = ?`,
          [term.term_id, selectedDate],
          (daysErr, dayRows) => {
            if (daysErr) return res.status(500).send("Attendance days could not be loaded");
            db.all(
              `SELECT attendance_date, admission_no, status
               FROM attendance_records
               WHERE term_id = ? AND attendance_date = ?`,
              [term.term_id, selectedDate],
              (recordsErr, records) => {
                if (recordsErr) return res.status(500).send("Attendance records could not be loaded");
                const dayMap = Object.fromEntries((dayRows || []).map((day) => [day.attendance_date, day]));
                const recordMap = Object.fromEntries(
                  (records || []).map((record) => [
                    `${record.attendance_date}:${record.admission_no}`,
                    record.status,
                  ]),
                );
                res.render("superadmin/attendance/table", {
                  term,
                  className,
                  dates,
                  selectedDate,
                  displayAttendanceDateLong,
                  dayMap,
                  recordMap,
                  students: students || [],
                  error: dates.length ? null : "Set valid resumption and vacation dates for this term before recording attendance.",
                });
              },
            );
          },
        );
      },
    );
  });
});

router.post("/attendance/:session_id/:term_id/class", (req, res) => {
  const className = String(req.body.class_name || "").trim();
  attendanceTerm(req.params.session_id, req.params.term_id, (err, term) => {
    if (err) return res.status(500).send("Attendance term could not be loaded");
    if (!term) return res.status(404).send("Academic Term Not Found");
    const dates = weekdayDates(term.resumption_date, term.vacation_date);
    const selectedDate = String(req.body.selected_date || "").trim();
    if (!dates.includes(selectedDate)) {
      return res.status(400).send("Please select a valid weekday in this term.");
    }
    const attendance = req.body.attendance || {};
    const isHoliday = req.body.is_holiday === "1";
    const holidayName = String(req.body.holiday_name || "").trim();
    db.serialize(() => {
      db.run("BEGIN TRANSACTION");
      db.run(
        `INSERT INTO attendance_days (term_id, attendance_date, is_holiday, holiday_name)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(term_id, attendance_date)
         DO UPDATE SET is_holiday = excluded.is_holiday, holiday_name = excluded.holiday_name`,
        [term.term_id, selectedDate, isHoliday ? 1 : 0, isHoliday ? (holidayName || "Holiday") : null],
      );
      if (isHoliday) {
        db.run(
          `DELETE FROM attendance_records WHERE term_id = ? AND attendance_date = ?`,
          [term.term_id, selectedDate],
        );
      } else {
        Object.keys(attendance).forEach((admissionNo) => {
          const status = attendance[admissionNo];
          if (status === "P" || status === "A") {
            db.run(
              `INSERT INTO attendance_records (term_id, attendance_date, admission_no, status)
               VALUES (?, ?, ?, ?)
               ON CONFLICT(term_id, attendance_date, admission_no)
               DO UPDATE SET status = excluded.status`,
              [term.term_id, selectedDate, admissionNo, status],
            );
          }
        });
      }
      db.run("COMMIT", (commitErr) => {
        if (commitErr) return res.status(500).send("Attendance could not be saved: " + commitErr.message);
        const selectedIndex = dates.indexOf(selectedDate);
        const nextDate = dates[selectedIndex + 1] || selectedDate;
        res.redirect(`/superadmin/attendance/${req.params.session_id}/${req.params.term_id}/class?class_name=${encodeURIComponent(className)}&date=${encodeURIComponent(nextDate)}`);
      });
    });
  });
});

module.exports = router;
