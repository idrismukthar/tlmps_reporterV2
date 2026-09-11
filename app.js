require("dotenv").config();
const express = require("express");
const path = require("path");
const fs = require("fs");
const session = require("express-session");
const SQLiteStore = require("connect-sqlite3")(session);
const rateLimit = require("./middleware/rate-limit");

const app = express();
const sessionDirectory = process.env.SESSION_DIR
  ? path.resolve(process.env.SESSION_DIR)
  : path.join(__dirname, "data");
const uploadDirectory = process.env.UPLOAD_DIR
  ? path.resolve(process.env.UPLOAD_DIR)
  : path.join(__dirname, "public/uploads");
fs.mkdirSync(sessionDirectory, { recursive: true });
fs.mkdirSync(uploadDirectory, { recursive: true });
const bundledUploadDirectory = path.join(__dirname, "public/uploads");
if (uploadDirectory !== bundledUploadDirectory && fs.existsSync(bundledUploadDirectory)) {
  for (const fileName of fs.readdirSync(bundledUploadDirectory)) {
    const sourcePath = path.join(bundledUploadDirectory, fileName);
    const targetPath = path.join(uploadDirectory, fileName);
    if (fs.statSync(sourcePath).isFile() && !fs.existsSync(targetPath)) {
      fs.copyFileSync(sourcePath, targetPath);
    }
  }
}

// 1. Core Middleware
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));
app.use("/uploads", express.static(uploadDirectory));
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
app.set("trust proxy", 1);
app.use(
  session({
    secret: process.env.SESSION_SECRET || "tlmps_secret_key_2026",
    resave: false,
    saveUninitialized: false,
    store: new SQLiteStore({
      db: "sessions.sqlite",
      dir: sessionDirectory,
      concurrentDB: true,
    }),
    cookie: {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      maxAge: 7 * 24 * 60 * 60 * 1000,
    },
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

// 5. Student Login Home Page
app.get("/", (req, res) => {
  res.render("student/login", { error: null });
});

// Quick-links dashboard
app.get("/homepage", (req, res) => {
  res.render("home");
});

// 6. Server Initialization
const PORT = process.env.PORT || 3000;
app.get("/health", (req, res) => {
  res.status(200).json({ status: "ok" });
});
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
