DROP TABLE entries;
--> statement-breakpoint
CREATE TABLE settings (
  id INTEGER PRIMARY KEY NOT NULL,
  event_start TEXT NOT NULL,
  registration_deadline TEXT NOT NULL,
  round1_deadline TEXT NOT NULL,
  round2_deadline TEXT NOT NULL,
  finalist_date TEXT NOT NULL,
  min_team_size INTEGER NOT NULL,
  max_team_size INTEGER NOT NULL,
  weight_innovation INTEGER NOT NULL,
  weight_technical INTEGER NOT NULL,
  weight_impact INTEGER NOT NULL,
  weight_presentation INTEGER NOT NULL,
  results_published INTEGER NOT NULL DEFAULT 0,
  contact_email TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
--> statement-breakpoint
CREATE TABLE organizers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  salt TEXT NOT NULL,
  display_name TEXT NOT NULL,
  role TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
--> statement-breakpoint
CREATE TABLE teams (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  code TEXT NOT NULL UNIQUE,
  track TEXT NOT NULL,
  college TEXT NOT NULL,
  payment_ref TEXT,
  payment_status TEXT NOT NULL DEFAULT 'pending_review',
  payment_note TEXT,
  qualified INTEGER NOT NULL DEFAULT 0,
  finalist_slot TEXT,
  created_at INTEGER NOT NULL
);
--> statement-breakpoint
CREATE TABLE participants (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  team_id INTEGER NOT NULL REFERENCES teams(id),
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  college TEXT NOT NULL,
  degree TEXT NOT NULL,
  track TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  salt TEXT NOT NULL,
  is_leader INTEGER NOT NULL DEFAULT 0,
  idea_title TEXT,
  idea_description TEXT,
  problem_statement TEXT,
  intended_users TEXT,
  created_at INTEGER NOT NULL
);
--> statement-breakpoint
CREATE TABLE sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  token_hash TEXT NOT NULL UNIQUE,
  user_type TEXT NOT NULL,
  user_id INTEGER NOT NULL,
  team_id INTEGER,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
--> statement-breakpoint
CREATE TABLE reset_tokens (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_type TEXT NOT NULL,
  email TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at INTEGER NOT NULL,
  used INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
--> statement-breakpoint
CREATE TABLE submissions_round1 (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  team_id INTEGER NOT NULL UNIQUE REFERENCES teams(id),
  idea TEXT NOT NULL,
  problem TEXT NOT NULL,
  solution TEXT NOT NULL,
  intended_users TEXT NOT NULL,
  tech_stack TEXT NOT NULL,
  presentation_link TEXT,
  description TEXT,
  submitted_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
--> statement-breakpoint
CREATE TABLE submissions_round2 (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  team_id INTEGER NOT NULL UNIQUE REFERENCES teams(id),
  prototype_desc TEXT NOT NULL,
  github_link TEXT,
  demo_video_link TEXT,
  readme_text TEXT NOT NULL,
  install_instructions TEXT NOT NULL,
  roles_text TEXT NOT NULL,
  limitations TEXT NOT NULL,
  submitted_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
--> statement-breakpoint
CREATE TABLE judges (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  expertise TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
--> statement-breakpoint
CREATE TABLE judge_assignments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  judge_id INTEGER NOT NULL REFERENCES judges(id),
  team_id INTEGER NOT NULL REFERENCES teams(id),
  created_at INTEGER NOT NULL
);
--> statement-breakpoint
CREATE TABLE scores (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  judge_id INTEGER NOT NULL REFERENCES judges(id),
  team_id INTEGER NOT NULL REFERENCES teams(id),
  round INTEGER NOT NULL,
  innovation INTEGER NOT NULL,
  technical INTEGER NOT NULL,
  impact INTEGER NOT NULL,
  presentation INTEGER NOT NULL,
  notes TEXT,
  created_at INTEGER NOT NULL
);
--> statement-breakpoint
CREATE TABLE announcements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  audience TEXT NOT NULL DEFAULT 'all',
  created_at INTEGER NOT NULL
);
--> statement-breakpoint
CREATE TABLE enquiries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  message TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'new',
  created_at INTEGER NOT NULL
);
--> statement-breakpoint
CREATE TABLE email_outbox (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  recipient TEXT NOT NULL,
  subject TEXT NOT NULL,
  body TEXT NOT NULL,
  kind TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  related_id INTEGER,
  created_at INTEGER NOT NULL
);
