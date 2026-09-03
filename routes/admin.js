const express = require("express");
const router = express.Router();
const supabase = require("../config/supabase");
const multer = require("multer");
const XLSX = require("xlsx");

const uploadExcel = multer({ storage: multer.memoryStorage() });

// Password Mapping for Classes from .env
const CLASS_PASSWORDS = {
  JSS1: process.env.TLMPS_JSS1_PASS || "tlmpsjunior001",
  JSS2: process.env.TLMPS_JSS2_PASS || "tlmpsjunior002",
  JSS3: process.env.TLMPS_JSS3_PASS || "tlmpsjunior003",
  SSS1: process.env.TLMPS_SSS1_PASS || "tlmpssenior001",
  SSS2: process.env.TLMPS_SSS2_PASS || "tlmpssenior002",
  SSS3: process.env.TLMPS_SSS3_PASS || "tlmpssenior003",
};

// 1. GET Admin Login Page
router.get("/login", async (req, res) => {
  try {
    const { data: subjects } = await supabase.from("subjects").select("*");
    res.render("admin/login", { subjects: subjects || [], error: null });
  } catch (err) {
    res.status(500).send("Database Error: " + err.message);
  }
});

// 2. POST Admin Login Verification
router.post("/login", async (req, res) => {
  const { class_name, subject_id, password } = req.body;

  const expectedPassword = CLASS_PASSWORDS[class_name];

  if (!expectedPassword || password !== expectedPassword) {
    const { data: subjects } = await supabase.from("subjects").select("*");
    return res.render("admin/login", {
      subjects: subjects || [],
      error: "Invalid password for the selected class!",
    });
  }

  // Set session details
  req.session.adminUser = { class_name, subject_id };
  res.redirect("/admin/scores");
});

// 3. GET Score Entry Page
router.get("/scores", async (req, res) => {
  if (!req.session.adminUser) return res.redirect("/admin/login");

  const { class_name, subject_id } = req.session.adminUser;

  try {
    // Fetch Subject Info
    const { data: subject } = await supabase
      .from("subjects")
      .select("*")
      .eq("subject_id", subject_id)
      .single();

    // Fetch Active Terms
    const { data: terms } = await supabase
      .from("academic_terms")
      .select("term_id, term_name, academic_sessions(session_name)")
      .eq("is_published", false);

    // Fetch Students in this class
    const { data: enrollments } = await supabase
      .from("student_enrollments")
      .select("enrollment_id, admission_no, students(surname, last_name)")
      .eq("class_name", class_name);

    let studentsWithScores = [];

    if (enrollments && enrollments.length > 0) {
      const enrollmentIds = enrollments.map((e) => e.enrollment_id);

      // Fetch Existing Scores
      const { data: existingScores } = await supabase
        .from("subject_scores")
        .select("*")
        .eq("subject_id", subject_id)
        .in("enrollment_id", enrollmentIds);

      const scoreMap = {};
      if (existingScores) {
        existingScores.forEach((s) => (scoreMap[s.enrollment_id] = s));
      }

      studentsWithScores = enrollments.map((e) => ({
        enrollment_id: e.enrollment_id,
        admission_no: e.admission_no,
        surname: e.students ? e.students.surname : "",
        last_name: e.students ? e.students.last_name : "",
        ca_score: scoreMap[e.enrollment_id]
          ? scoreMap[e.enrollment_id].ca_score
          : 0,
        mcq_score: scoreMap[e.enrollment_id]
          ? scoreMap[e.enrollment_id].mcq_score
          : 0,
        theory_score: scoreMap[e.enrollment_id]
          ? scoreMap[e.enrollment_id].theory_score
          : 0,
      }));
    }

    res.render("admin/scores", {
      className: class_name,
      subject,
      students: studentsWithScores,
      terms: terms || [],
    });
  } catch (err) {
    res.status(500).send("Error loading score sheet: " + err.message);
  }
});

// 4. POST Manual Score Entry Save
router.post("/save-scores", async (req, res) => {
  if (!req.session.adminUser) return res.redirect("/admin/login");
  const { subject_id } = req.session.adminUser;
  const { scores } = req.body; // Array of objects [{ enrollment_id, ca, mcq, theory }]

  try {
    if (scores && Array.isArray(scores)) {
      const upsertData = scores.map((item) => ({
        enrollment_id: item.enrollment_id,
        subject_id: subject_id,
        ca_score: parseFloat(item.ca) || 0,
        mcq_score: parseFloat(item.mcq) || 0,
        theory_score: parseFloat(item.theory) || 0,
      }));

      const { error } = await supabase
        .from("subject_scores")
        .upsert(upsertData, { onConflict: "enrollment_id,subject_id" });

      if (error) throw error;
    }

    res.redirect("/admin/scores?success=ScoresSaved");
  } catch (err) {
    res.status(500).send("Error saving scores: " + err.message);
  }
});

// 5. POST Excel Upload Parser
router.post(
  "/upload-excel",
  uploadExcel.single("excel_file"),
  async (req, res) => {
    if (!req.session.adminUser) return res.redirect("/admin/login");
    const { class_name, subject_id } = req.session.adminUser;

    try {
      if (!req.file)
        return res.status(400).send("Please upload a valid Excel file.");

      const workbook = XLSX.read(req.file.buffer, { type: "buffer" });
      const sheetName = workbook.SheetNames[0];
      const sheetData = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName]);

      // Expected Excel Columns: Admission_no, CA, MCQ, Theory
      const { data: enrollments } = await supabase
        .from("student_enrollments")
        .select("enrollment_id, admission_no")
        .eq("class_name", class_name);

      const enrollmentMap = {};
      if (enrollments) {
        enrollments.forEach(
          (e) => (enrollmentMap[e.admission_no.trim()] = e.enrollment_id),
        );
      }

      const upsertData = [];

      sheetData.forEach((row) => {
        const adminNo =
          row["Admission_no"] || row["ADMISSION_NO"] || row["admission_no"];
        if (adminNo && enrollmentMap[adminNo.toString().trim()]) {
          upsertData.push({
            enrollment_id: enrollmentMap[adminNo.toString().trim()],
            subject_id: subject_id,
            ca_score: parseFloat(row["CA"] || row["ca"] || 0),
            mcq_score: parseFloat(row["MCQ"] || row["mcq"] || 0),
            theory_score: parseFloat(
              row["Theory"] || row["THEORY"] || row["theory"] || 0,
            ),
          });
        }
      });

      if (upsertData.length > 0) {
        const { error } = await supabase
          .from("subject_scores")
          .upsert(upsertData, { onConflict: "enrollment_id,subject_id" });

        if (error) throw error;
      }

      res.redirect("/admin/scores?success=ExcelParsed");
    } catch (err) {
      res.status(500).send("Error parsing Excel file: " + err.message);
    }
  },
);

module.exports = router;
