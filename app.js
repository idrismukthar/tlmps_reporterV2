require("dotenv").config();
const express = require("express");
const path = require("path");
const session = require("express-session");
const rateLimit = require("./middleware/rate-limit");

const app = express();

// 1. Core Middleware
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));
const writeLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 180 });
const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 10 });
app.use((req, res, next) => {
  if (req.method !== "POST") return next();
  if (/\/(login|forgot-password|reset-password)$/.test(req.path)) return loginLimiter(req, res, next);
  return writeLimiter(req, res, next);
});

// 2. View Engine Setup
app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));

// 3. Session Setup
app.use(
  session({
    secret: process.env.SESSION_SECRET || "tlmps_secret_key_2026",
    resave: false,
    saveUninitialized: false,
  }),
);

// 4. Route Handlers
const superadminRoutes = require("./routes/superadmin");
app.use("/superadmin", superadminRoutes);

const teacherRoutes = require("./routes/teacher");
app.use("/teacher", teacherRoutes);

const classTeacherRoutes = require("./routes/classteacher");
app.use("/classteacher", classTeacherRoutes);

const studentRoutes = require("./routes/student");
app.use("/", studentRoutes);

// Placeholder for future Subject Admin routes
try {
  const adminRoutes = require("./routes/admin");
  app.use("/admin", adminRoutes);
} catch (e) {
  // Gracefully skip if routes/admin.js is not created yet
}

// 5. Landing Page Route
app.get("/", (req, res) => {
  res.send(
    '<h1>Welcome to TLMPS Academic Portal</h1><p><a href="/superadmin/dashboard">Super-Admin Dashboard</a></p><p><a href="/teacher/login">Teacher Score Entry</a></p>',
  );
});

// 6. Server Initialization
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  const baseUrl = `http://localhost:${PORT}`;
  console.log(`\nTLMPS Academic Portal is running at ${baseUrl}\n`);
  console.log("Available routes:");
  console.log(`  Home:                 ${baseUrl}/`);
  console.log(`  Student Login:        ${baseUrl}/login`);
  console.log(`  Student Portal:       ${baseUrl}/portal`);
  console.log(`  Student Profile:      ${baseUrl}/profile`);
  console.log(`  Superadmin Login:     ${baseUrl}/superadmin/login`);
  console.log(`  Superadmin Dashboard: ${baseUrl}/superadmin/dashboard`);
  console.log(`  Teacher Login:        ${baseUrl}/teacher/login`);
  console.log(`  Class Teacher Portal: ${baseUrl}/teacher/dashboard`);
  console.log(`  Class Teacher Remarks: ${baseUrl}/classteacher/dashboard`);
  console.log(`  Subject Admin Login:  ${baseUrl}/admin/login`);
  console.log(`  Subject Admin Scores: ${baseUrl}/admin/scores\n`);
});
