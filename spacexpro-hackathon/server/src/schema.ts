import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const settings = sqliteTable("settings", {
  id: integer("id").primaryKey(),
  eventStart: text("event_start").notNull(),
  registrationDeadline: text("registration_deadline").notNull(),
  round1Deadline: text("round1_deadline").notNull(),
  round2Deadline: text("round2_deadline").notNull(),
  finalistDate: text("finalist_date").notNull(),
  minTeamSize: integer("min_team_size").notNull(),
  maxTeamSize: integer("max_team_size").notNull(),
  weightInnovation: integer("weight_innovation").notNull(),
  weightTechnical: integer("weight_technical").notNull(),
  weightImpact: integer("weight_impact").notNull(),
  weightPresentation: integer("weight_presentation").notNull(),
  resultsPublished: integer("results_published", { mode: "boolean" }).notNull().default(false),
  contactEmail: text("contact_email").notNull(),
  whatsappNumber: text("whatsapp_number"),
  registrationFeeInr: integer("registration_fee_inr"),
  registrationCountOverride: integer("registration_count_override"),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
});

export const organizers = sqliteTable("organizers", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  salt: text("salt").notNull(),
  displayName: text("display_name").notNull(),
  role: text("role", { enum: ["owner", "organizer"] }).notNull(),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
});

export const teams = sqliteTable("teams", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  code: text("code").notNull().unique(),
  track: text("track", { enum: ["AI/ML", "Cyber Security", "Web Development", "Student Innovation"] }).notNull(),
  college: text("college").notNull(),
  paymentRef: text("payment_ref"),
  paymentStatus: text("payment_status", { enum: ["pending_review", "verified", "rejected"] }).notNull().default("pending_review"),
  paymentNote: text("payment_note"),
  qualified: integer("qualified", { mode: "boolean" }).notNull().default(false),
  finalistSlot: text("finalist_slot"),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
});

export const participants = sqliteTable("participants", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  teamId: integer("team_id").notNull().references(() => teams.id),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  phone: text("phone"),
  college: text("college").notNull(),
  degree: text("degree", { enum: ["B.Tech", "M.Tech"] }).notNull(),
  track: text("track", { enum: ["AI/ML", "Cyber Security", "Web Development", "Student Innovation"] }).notNull(),
  passwordHash: text("password_hash").notNull(),
  salt: text("salt").notNull(),
  isLeader: integer("is_leader", { mode: "boolean" }).notNull().default(false),
  ideaTitle: text("idea_title"),
  ideaDescription: text("idea_description"),
  problemStatement: text("problem_statement"),
  intendedUsers: text("intended_users"),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
});

export const sessions = sqliteTable("sessions", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  tokenHash: text("token_hash").notNull().unique(),
  userType: text("user_type", { enum: ["participant", "organizer"] }).notNull(),
  userId: integer("user_id").notNull(),
  teamId: integer("team_id"),
  expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
});

export const resetTokens = sqliteTable("reset_tokens", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userType: text("user_type", { enum: ["participant", "organizer"] }).notNull(),
  email: text("email").notNull(),
  tokenHash: text("token_hash").notNull().unique(),
  expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
  used: integer("used", { mode: "boolean" }).notNull().default(false),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
});

export const submissionsRound1 = sqliteTable("submissions_round1", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  teamId: integer("team_id").notNull().unique().references(() => teams.id),
  idea: text("idea").notNull(),
  problem: text("problem").notNull(),
  solution: text("solution").notNull(),
  intendedUsers: text("intended_users").notNull(),
  techStack: text("tech_stack").notNull(),
  presentationLink: text("presentation_link"),
  description: text("description"),
  submittedAt: integer("submitted_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
});

export const submissionsRound2 = sqliteTable("submissions_round2", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  teamId: integer("team_id").notNull().unique().references(() => teams.id),
  prototypeDesc: text("prototype_desc").notNull(),
  githubLink: text("github_link"),
  demoVideoLink: text("demo_video_link"),
  readmeText: text("readme_text").notNull(),
  installInstructions: text("install_instructions").notNull(),
  rolesText: text("roles_text").notNull(),
  limitations: text("limitations").notNull(),
  submittedAt: integer("submitted_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
});

export const judges = sqliteTable("judges", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  email: text("email").notNull(),
  expertise: text("expertise").notNull(),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
});

export const judgeAssignments = sqliteTable("judge_assignments", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  judgeId: integer("judge_id").notNull().references(() => judges.id),
  teamId: integer("team_id").notNull().references(() => teams.id),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
});

export const scores = sqliteTable("scores", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  judgeId: integer("judge_id").notNull().references(() => judges.id),
  teamId: integer("team_id").notNull().references(() => teams.id),
  round: integer("round").notNull(),
  innovation: integer("innovation").notNull(),
  technical: integer("technical").notNull(),
  impact: integer("impact").notNull(),
  presentation: integer("presentation").notNull(),
  notes: text("notes"),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
});

export const announcements = sqliteTable("announcements", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  title: text("title").notNull(),
  body: text("body").notNull(),
  audience: text("audience", { enum: ["all", "teams", "finalists"] }).notNull().default("all"),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
});

export const enquiries = sqliteTable("enquiries", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  email: text("email").notNull(),
  message: text("message").notNull(),
  status: text("status", { enum: ["new", "read", "replied"] }).notNull().default("new"),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
});

export const emailOutbox = sqliteTable("email_outbox", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  recipient: text("recipient").notNull(),
  subject: text("subject").notNull(),
  body: text("body").notNull(),
  htmlBody: text("html_body"),
  kind: text("kind").notNull(),
  status: text("status", { enum: ["pending", "sent", "failed"] }).notNull().default("pending"),
  deliveryToken: text("delivery_token"),
  relatedId: integer("related_id"),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
});
