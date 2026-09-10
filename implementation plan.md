# TLMPS Portal Implementation Plan

This document is a build plan only. It deliberately makes no application changes until the school rules below are agreed.

## Priority 1 — Session rollover: promotion, repetition, and fresh subject registration

### What we will build

When a super-admin creates a new academic session, the system will build its roster from the immediately preceding session:

- Students whose final result says **promote** move into the next class.
- Students whose final result says **repeat** stay in their present class.
- Repeating students display a red, circled `R` beside their name in the new-session roster.
- Graduating SSS3 students are marked graduated and are not automatically enrolled into another class.
- Every carried-forward student starts the new session with **no selected subjects**. The super-admin can then choose that student's current subjects for the new session.
- Past-session enrolment, chosen subjects, scores, remarks, and report cards remain unchanged.

### How we will do it

1. Define one authoritative promotion decision in code: **only after Third Term**, calculate each term's average, add First + Second + Third Term averages, then divide by **3**. A cumulative average of **51% or higher** promotes; **50% or lower** repeats. This rule applies to both JSS and SSS.
2. If any required Third-Term score is missing, give the student a `Pending Review` outcome instead of promoting or repeating them automatically. Show `Pending` visibly on the student's report card.
3. Add session-specific enrolment fields to preserve the decision, for example: `promotion_status` (`Promoted`, `Repeated`, `Pending Review`, `Graduated`, `Manual Override`), calculated average, override decision, override reason, and audit timestamp.
4. Make session creation a database transaction: create the session, create all three terms, calculate/copy the roster, then commit only if every step succeeds.
5. Copy only the roster into the new session. Do **not** copy `student_subject_selections`.
6. For a JSS3 student promoted to SSS1, open their edit/registration page in senior-school onboarding mode: retain bio-data, set the department to `Science` initially, and require their new senior-school subject registration. The super-admin can change the department when school resumes.
7. Keep the existing subject-registration behaviour: SSS compulsory three-unit subjects stay selected; JSS subjects are initially selected but can be unticked for alternatives such as CRS/IRS.
8. Add the red, circled `R` marker from the stored repeat status—not from a visual guess. Show it only beside the learner's name in the expanded class roster at `/superadmin/sessions/:session_id`.
9. Give the super-admin a review/override screen before finalising the rollover. An override must capture the reason, such as a passed resit examination.

### Problems this solves

- Stops a new session from promoting every student automatically without checking results.
- Stops repeated students being placed in the wrong class.
- Prevents last year's subject mix from leaking into the new year.
- Preserves historical results and ensures a correction in the current session cannot rewrite past records.
- Avoids partial rosters if session creation fails midway.

### Decisions needed from you before coding

- If Third-Term scores are incomplete, automatically carry the learner forward as promoted and show the incomplete result as `Pending Review` on the report card. The super-admin can later override to repeat, with a reason.

## Priority 2 — Make term lifecycle and result publication real

### What we will build

- Terms will have clear statuses: `Pending`, `Active`, `Concluded`.
- Only an active term accepts score entry or class-teacher remarks.
- A concluded term becomes read-only until a super-admin deliberately reopens it.
- A separate publish action controls whether students can view results.

### How we will do it

1. Correct the database constraint so `Pending` is valid.
2. Validate the term status on every manual score save, Excel import, export where appropriate, and remarks save route.
3. Add a publish/unpublish status and check it in student portal/result routes.
4. Show clear statuses and restricted actions in the staff dashboards.

### Problems this solves

- Stops scores from being entered into future or concluded terms.
- Stops students seeing draft results.
- Makes the dashboard term cards match actual permissions.

## Priority 3 — Protect historical enrolment and subject data

### What we will build

- Personal student details remain editable without changing old class history.
- Class, department, and subjects are managed per academic session.
- Each student can have a subject only once per session.

### How we will do it

1. Separate master student profile fields from session-specific data.
2. Change the edit flow so it updates only the selected session's enrolment and subjects.
3. Add database uniqueness for student/session/subject selections.
4. Preserve the subject units used for a historical result, rather than allowing a later subject-unit edit to rewrite old GPA meaning.

### Problems this solves

- Fixes the current edit operation, which can overwrite every previous class enrolment and delete every past subject selection.
- Stops duplicate students/subjects appearing in score sheets and calculations.
- Keeps old report cards truthful after curriculum changes.

## Priority 4 — Finalise grading, GPA/CGPA, ranking, and promotion policy

### What we will build

- One school-approved grading table.
- Correct GPA/CGPA calculation for senior students only, if that is the policy.
- Correct class ranking and promotion outcomes based on completed, published results.

### How we will do it

1. Complete the outstanding decisions in `requirements.md`.
2. Put grading and promotion rules in a central module instead of duplicating assumptions across pages.
3. Treat missing scores according to your policy; do not silently rank them as zero unless you explicitly want that.
4. Add worked-example tests supplied/approved by the school.

### Problems this solves

- Avoids showing an academically incorrect GPA, CGPA, rank, or promotion message.
- Stops incomplete score entry from unfairly making a learner last in class.

## Priority 5 — Database safety and recovery

### What we will build

- Enforced foreign keys, safer deletion rules, indexes, migrations, and a backup/restore process.

### How we will do it

1. Enable SQLite foreign-key enforcement for every connection.
2. Replace destructive GET links with confirmed, protected POST actions.
3. Prevent deletion of a subject that has historical scores; use archive/deactivate instead.
4. Add indexes for frequent result, roster, and ranking queries.
5. Version migrations and create a documented backup step before each schema upgrade.
6. Introduce reversible session archiving instead of permanent deletion. A session may be archived only while fewer than two terms are concluded. Archive it with its roster, selections, scores, remarks, and audit history intact.
7. Add an archived-session area where the super-admin can inspect archived data. Allow reinstatement only when the same academic-session name has not since been recreated. If it has been recreated, retain the archived session as read-only reference data and do not reconnect students to it.

### Problems this solves

- Prevents orphaned scores and subject selections.
- Makes historical data recoverable and safer to operate.
- Lets you restart an early session safely without losing the original work or mixing it into the newly recreated session.

## Priority 6 — Choose and clean up the score-admin architecture

### What we will build

- One supported score-entry system and one source of truth for data.

### How we will do it

1. Confirm whether the project should use SQLite or Supabase in production.
2. Keep and complete the chosen route set.
3. Remove or quarantine the unused `/admin` implementation, which currently expects a different Supabase schema from the SQLite app.

### Problems this solves

- Prevents staff using an admin page that reads/writes a different database model.
- Reduces maintenance and data-splitting risk.

## Priority 7 — Secure accounts and school data

### What we will build

- Safer staff/super-admin access, protected forms, and production-ready session storage.

### How we will do it

1. Remove fallback passwords and require environment-provided secrets.
2. Store password hashes or use a managed authentication provider.
3. Add rate limiting to login routes and CSRF protection to write routes.
4. Use a durable session store in production and secure cookie settings over HTTPS.
5. Restrict uploads by content validation and keep an audit log for sensitive changes.
6. Rate-limit every login route, duplicate-admission lookup, Excel upload, and other abuse-prone public endpoint. Use sensible limits with clear retry messages so normal school work is not interrupted.
7. Prevent insecure direct object references (IDOR): every route that accepts a student, session, term, score, or file identifier will verify both authentication and ownership/role scope on the server. A student may access only their own result; a teacher only their assigned class/subject; a class teacher only their assigned class; and only the super-admin may operate across the school.

### Problems this solves

- Protects student bio-data, photographs, scores, and report cards from avoidable access or tampering.
- Stops someone from changing a URL to view or alter another learner's records.

## Priority 8 — Testing and operational polish

### What we will build

- A dependable test suite and clear operational feedback for staff.

### How we will do it

1. Add a `npm test` command.
2. Fix the current failing GPA rounding expectation.
3. Add tests for rollover, repeated-student markers, subject reset, term access, publication, historical edits, ranking, and import validation.
4. Improve validation/error messages and add audit-friendly activity history.

### Problems this solves

- Stops future changes from quietly breaking results or promotion.
- Gives staff understandable feedback instead of hidden database errors.

## Recommended delivery sequence

1. Agree school policies and answer the questions below.
2. Back up the current database.
3. Build and test Priority 1 in a safe copy of the database.
4. Build Priorities 2 and 3 before allowing real next-session operations.
5. Finalise Priority 4 and verify it using school-approved examples.
6. Complete safety, security, and tests before deployment.

## Confirmed technology direction

SQLite remains the development database and is suitable for the current scale of fewer than 50 students, provided the safety and backup work above is completed. We will preserve the existing SQLite-based core functionality during this phase. A later migration to a managed production database can be planned separately, after the academic workflows are stable and tested.
