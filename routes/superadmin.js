const express = require("express");
const router = express.Router();
const db = require("../config/db");
const uploadPassport = require("../middleware/upload");
const PDFDocument = require("pdfkit");
const path = require("path");
const fs = require("fs");
const nigeriaStates = require("../static/states.json");

// Auth Protection
const requireAuth = (req, res, next) => {
  if (req.session && req.session.isSuperAdmin) return next();
  res.redirect("/superadmin/login");
};

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
    } = req.body;

    const passport_url = req.file ? `/uploads/${req.file.filename}` : null;

    if (!session_id)
      return res.status(400).send("Academic session is required");
    const selectedState = nigeriaStates.find(
      (state) => state.name === state_of_origin,
    );
    if (!selectedState || !selectedState.lgas.includes(lga)) {
      return res.status(400).send("Please select a valid state and LGA");
    }

    db.run(
      `INSERT INTO students (admission_no, surname, middle_name, last_name, class_name, department, gender, phone_number, email, address, state_of_origin, lga, dob, club, society, passport_url) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
            `INSERT INTO student_subject_selections (admission_no, subject_id, session_id) VALUES (?, ?, ?)`,
          );
          selectedIds.forEach((id) => stmt.run(admission_no, id, session_id));
          stmt.finalize();
        }

        res.redirect(`/superadmin/sessions/${session_id}`);
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
  db.get(
    `SELECT * FROM students WHERE admission_no = ?`,
    [adm],
    (err, student) => {
      if (!student) return res.status(404).send("Student Not Found");

      db.all(
        `SELECT subjects.* FROM subjects JOIN student_subject_selections ON subjects.subject_id = student_subject_selections.subject_id WHERE student_subject_selections.admission_no = ? ORDER BY subject_name ASC`,
        [adm],
        (err, enrolledSubjects) => {
          res.render("superadmin/student-profile", {
            student,
            enrolledSubjects: enrolledSubjects || [],
          });
        },
      );
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
                  student,
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
    } = req.body;
    const newAdmissionNo = String(admission_no || "").trim();
    if (!/^\d{5}$/.test(newAdmissionNo)) {
      return res.status(400).send("Admission number must be exactly 5 digits");
    }
    const selectedState = nigeriaStates.find(
      (state) => state.name === state_of_origin,
    );
    if (!selectedState || !selectedState.lgas.includes(lga)) {
      return res.status(400).send("Please select a valid state and LGA");
    }

    db.get(
      `SELECT passport_url FROM students WHERE admission_no = ?`,
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
            db.serialize(() => {
              db.run(
                `UPDATE students SET admission_no = ?, surname = ?, middle_name = ?, last_name = ?, class_name = ?, department = ?, gender = ?, phone_number = ?, email = ?, address = ?, state_of_origin = ?, lga = ?, dob = ?, club = ?, society = ?, passport_url = ? WHERE admission_no = ?`,
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
                    `DELETE FROM student_subject_selections WHERE admission_no = ?`,
                    [oldAdmissionNo],
                  );
                  if (subject_ids) {
                    const selectedIds = Array.isArray(subject_ids)
                      ? subject_ids
                      : [subject_ids];
                    const stmt = db.prepare(
                      `INSERT INTO student_subject_selections (admission_no, subject_id, session_id) VALUES (?, ?, ?)`,
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
          },
        );
      },
    );
  });
});

// PDF Registration Slip Download Endpoint
router.get("/download-pdf/:admission_no", (req, res) => {
  const adm = req.params.admission_no;

  db.get(
    `SELECT * FROM students WHERE admission_no = ?`,
    [adm],
    (err, student) => {
      if (!student) return res.status(404).send("Student Not Found");

      db.all(
        `SELECT subjects.* FROM subjects JOIN student_subject_selections ON subjects.subject_id = student_subject_selections.subject_id WHERE student_subject_selections.admission_no = ? ORDER BY subject_name ASC`,
        [adm],
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
  db.all(`SELECT * FROM academic_sessions`, [], (err, sessions) => {
    res.render("superadmin/sessions", { sessions: sessions || [] });
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
            `SELECT e.*, s.surname, s.middle_name, s.last_name, s.gender, s.department FROM academic_session_enrollments e JOIN students s ON s.admission_no = e.admission_no WHERE e.session_id = ? AND e.enrollment_status = 'Enrolled' ORDER BY e.class_name ASC, e.admission_no ASC`,
            [sessionId],
            (rosterErr, students) =>
              res.render("superadmin/session-detail", {
                session,
                term,
                students: students || [],
              }),
          );
        },
      );
    },
  );
});

router.post("/conclude-term", (req, res) => {
  const {
    term_id,
    days_opened,
    vacation_date,
    resumption_date,
    next_term_resumes,
  } = req.body;
  db.run(
    `UPDATE academic_terms SET days_school_opened = ?, vacation_date = ?, resumption_date = ?, next_term_resumes = ?, term_status = 'Concluded' WHERE term_id = ?`,
    [days_opened, vacation_date, resumption_date, next_term_resumes, term_id],
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
              `INSERT INTO academic_terms (session_id, term_name, term_number, term_status, days_school_opened, resumption_date) VALUES (?, ?, ?, 'Active', 60, ?)`,
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

module.exports = router;
