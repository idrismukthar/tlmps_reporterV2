# Student Supabase Auth

Student portal sign-in uses Supabase Auth. Students enter their admission number
and password; the app maps the admission number to a non-deliverable internal
Auth email (`student-<admission-number>@students.tlmps.invalid`). The alias is
not a student contact address and must not be used for email recovery.

Initial passwords are the lowercase surname followed by the final three digits
of the admission number. For example, admission number `26001` and surname
`Wale` produces `wale001`. This is a weak, predictable initial password; keep
the existing rate limit enabled and replace this scheme with verified SMS OTP
or stronger initial credentials before opening the portal to untrusted users.

## Provision student accounts

1. Set `SUPABASE_SECRET_KEY` locally using the project's server-side secret
   key. The legacy `SUPABASE_SERVICE_ROLE_KEY` name is also accepted. Never put
   either key in browser code or source control.
2. Confirm `DATABASE_URL` points to the imported Supabase Postgres database and
   `SUPABASE_URL` points to the same project.
3. Run `npm run db:auth:provision-students`. The script creates confirmed Auth
   users from `public.students`, is safe to rerun, and does not print passwords.
4. Keep `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY` set in the web service.
   For compatibility, the app also accepts `SUPABASE_ANON_KEY`. The application
   does not need the secret or service-role key at runtime.

## Staff-assisted password reset

Self-service recovery is disabled until verified SMS OTP is configured. A
student's parent or guardian must be independently verified by school staff;
phone number or knowledge of an admission number alone is not proof.

After verification, staff can reset the account password in the Supabase
Dashboard under **Authentication → Users**. Search by the internal Auth email
`student-<admission-number>@students.tlmps.invalid`, set the replacement
password, and communicate it privately to the verified parent or guardian. The
portal treats password input case-insensitively, so issue the replacement in
lowercase. Do not use the dashboard's email-recovery action for these internal
aliases.
