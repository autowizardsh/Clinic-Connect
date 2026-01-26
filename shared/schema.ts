import { sql, relations } from "drizzle-orm";
import { pgTable, text, varchar, integer, boolean, timestamp, time, serial, jsonb, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// Re-export auth models
export * from "./models/auth";
export * from "./models/chat";

// ============================================
// DOCTORS
// ============================================
export const doctors = pgTable("doctors", {
  id: serial("id").primaryKey(),
  userId: varchar("user_id").notNull().unique(), // Links to Replit Auth user
  name: text("name").notNull(),
  email: text("email").notNull(),
  phone: text("phone"),
  specialty: text("specialty").notNull(),
  bio: text("bio"),
  profileImage: text("profile_image"),
  isActive: boolean("is_active").default(true).notNull(),
  googleCalendarId: text("google_calendar_id"),
  googleRefreshToken: text("google_refresh_token"),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
});

export const insertDoctorSchema = createInsertSchema(doctors).omit({
  id: true,
  createdAt: true,
});
export type Doctor = typeof doctors.$inferSelect;
export type InsertDoctor = z.infer<typeof insertDoctorSchema>;

// ============================================
// PATIENTS
// ============================================
export const patients = pgTable("patients", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  phone: text("phone").notNull(),
  email: text("email"),
  notes: text("notes"),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
});

export const insertPatientSchema = createInsertSchema(patients).omit({
  id: true,
  createdAt: true,
});
export type Patient = typeof patients.$inferSelect;
export type InsertPatient = z.infer<typeof insertPatientSchema>;

// ============================================
// APPOINTMENTS
// ============================================
export const appointments = pgTable("appointments", {
  id: serial("id").primaryKey(),
  doctorId: integer("doctor_id").notNull().references(() => doctors.id),
  patientId: integer("patient_id").notNull().references(() => patients.id),
  date: timestamp("date").notNull(),
  duration: integer("duration").notNull().default(30), // in minutes
  status: text("status").notNull().default("scheduled"), // scheduled, completed, cancelled
  service: text("service").notNull(),
  notes: text("notes"),
  source: text("source").notNull().default("chat"), // chat, voice, manual
  googleEventId: text("google_event_id"),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
});

export const insertAppointmentSchema = createInsertSchema(appointments).omit({
  id: true,
  createdAt: true,
});
export type Appointment = typeof appointments.$inferSelect;
export type InsertAppointment = z.infer<typeof insertAppointmentSchema>;

// ============================================
// DOCTOR AVAILABILITY (Date-specific)
// ============================================
export const doctorAvailability = pgTable("doctor_availability", {
  id: serial("id").primaryKey(),
  doctorId: integer("doctor_id").notNull().references(() => doctors.id),
  date: varchar("date", { length: 10 }).notNull(), // YYYY-MM-DD format
  startTime: time("start_time").notNull(),
  endTime: time("end_time").notNull(),
  isAvailable: boolean("is_available").default(false).notNull(), // false = blocked/unavailable
  reason: text("reason"), // Optional reason for unavailability
});

export const insertDoctorAvailabilitySchema = createInsertSchema(doctorAvailability).omit({
  id: true,
});
export type DoctorAvailability = typeof doctorAvailability.$inferSelect;
export type InsertDoctorAvailability = z.infer<typeof insertDoctorAvailabilitySchema>;

// ============================================
// CLINIC SETTINGS
// ============================================
export const clinicSettings = pgTable("clinic_settings", {
  id: serial("id").primaryKey(),
  clinicName: text("clinic_name").notNull().default("Dental Clinic"),
  address: text("address"),
  phone: text("phone"),
  email: text("email"),
  appointmentDuration: integer("appointment_duration").notNull().default(30),
  workingDays: jsonb("working_days").$type<number[]>().default([1, 2, 3, 4, 5]), // Mon-Fri
  openTime: time("open_time").notNull().default("09:00"),
  closeTime: time("close_time").notNull().default("17:00"),
  timezone: text("timezone").default("Europe/Amsterdam"),
  welcomeMessage: text("welcome_message").default("Welcome to our dental clinic! How can I help you today?"),
  services: jsonb("services").$type<string[]>().default(["General Checkup", "Teeth Cleaning", "Fillings", "Root Canal", "Teeth Whitening", "Orthodontics"]),
});

export const insertClinicSettingsSchema = createInsertSchema(clinicSettings).omit({
  id: true,
});
export type ClinicSettings = typeof clinicSettings.$inferSelect;
export type InsertClinicSettings = z.infer<typeof insertClinicSettingsSchema>;

// ============================================
// CHAT SESSIONS (for widget)
// ============================================
export const chatSessions = pgTable("chat_sessions", {
  id: serial("id").primaryKey(),
  sessionId: varchar("session_id").notNull().unique(),
  patientId: integer("patient_id").references(() => patients.id),
  language: text("language").default("en"), // en or nl
  status: text("status").default("active"), // active, completed, abandoned
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
  updatedAt: timestamp("updated_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
});

export const insertChatSessionSchema = createInsertSchema(chatSessions).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type ChatSession = typeof chatSessions.$inferSelect;
export type InsertChatSession = z.infer<typeof insertChatSessionSchema>;

// ============================================
// CHAT MESSAGES (for widget)
// ============================================
export const chatMessages = pgTable("chat_messages", {
  id: serial("id").primaryKey(),
  sessionId: varchar("session_id").notNull(),
  role: text("role").notNull(), // user, assistant, system
  content: text("content").notNull(),
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
});

export const insertChatMessageSchema = createInsertSchema(chatMessages).omit({
  id: true,
  createdAt: true,
});
export type ChatMessage = typeof chatMessages.$inferSelect;
export type InsertChatMessage = z.infer<typeof insertChatMessageSchema>;

// ============================================
// ADMIN USERS (role-based with username/password)
// ============================================
export const adminUsers = pgTable("admin_users", {
  id: serial("id").primaryKey(),
  userId: varchar("user_id").notNull().unique(),
  username: varchar("username", { length: 50 }).notNull().unique(),
  password: text("password").notNull(), // Hashed password
  name: text("name"),
  role: text("role").notNull().default("admin"), // admin, doctor
  doctorId: integer("doctor_id").references(() => doctors.id), // Only for doctor role
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
});

export const insertAdminUserSchema = createInsertSchema(adminUsers).omit({
  id: true,
  createdAt: true,
});
export type AdminUser = typeof adminUsers.$inferSelect;
export type InsertAdminUser = z.infer<typeof insertAdminUserSchema>;

// ============================================
// RELATIONS
// ============================================
export const doctorsRelations = relations(doctors, ({ many }) => ({
  appointments: many(appointments),
  availability: many(doctorAvailability),
}));

export const patientsRelations = relations(patients, ({ many }) => ({
  appointments: many(appointments),
  chatSessions: many(chatSessions),
}));

export const appointmentsRelations = relations(appointments, ({ one }) => ({
  doctor: one(doctors, {
    fields: [appointments.doctorId],
    references: [doctors.id],
  }),
  patient: one(patients, {
    fields: [appointments.patientId],
    references: [patients.id],
  }),
}));

export const doctorAvailabilityRelations = relations(doctorAvailability, ({ one }) => ({
  doctor: one(doctors, {
    fields: [doctorAvailability.doctorId],
    references: [doctors.id],
  }),
}));

export const chatSessionsRelations = relations(chatSessions, ({ one, many }) => ({
  patient: one(patients, {
    fields: [chatSessions.patientId],
    references: [patients.id],
  }),
}));

export const adminUsersRelations = relations(adminUsers, ({ one }) => ({
  doctor: one(doctors, {
    fields: [adminUsers.doctorId],
    references: [doctors.id],
  }),
}));
