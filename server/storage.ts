import { db } from "./db";
import { eq, and, gte, lte, desc, sql, count } from "drizzle-orm";
import {
  doctors,
  patients,
  appointments,
  doctorAvailability,
  clinicSettings,
  chatSessions,
  chatMessages,
  adminUsers,
  type Doctor,
  type Patient,
  type Appointment,
  type DoctorAvailability,
  type ClinicSettings,
  type ChatSession,
  type ChatMessage,
  type AdminUser,
  type InsertDoctor,
  type InsertPatient,
  type InsertAppointment,
  type InsertDoctorAvailability,
  type InsertClinicSettings,
  type InsertChatSession,
  type InsertChatMessage,
  type InsertAdminUser,
  users,
  type User,
  type UpsertUser,
} from "@shared/schema";

export interface IStorage {
  // Users (Replit Auth)
  getUser(id: string): Promise<User | undefined>;
  upsertUser(user: UpsertUser): Promise<User>;

  // Doctors
  getDoctors(): Promise<Doctor[]>;
  getDoctorById(id: number): Promise<Doctor | undefined>;
  getDoctorByUserId(userId: string): Promise<Doctor | undefined>;
  createDoctor(doctor: InsertDoctor): Promise<Doctor>;
  updateDoctor(id: number, doctor: Partial<InsertDoctor>): Promise<Doctor | undefined>;
  deleteDoctor(id: number): Promise<void>;

  // Patients
  getPatients(): Promise<Patient[]>;
  getPatientById(id: number): Promise<Patient | undefined>;
  getPatientByPhone(phone: string): Promise<Patient | undefined>;
  createPatient(patient: InsertPatient): Promise<Patient>;
  updatePatient(id: number, patient: Partial<InsertPatient>): Promise<Patient | undefined>;
  deletePatient(id: number): Promise<void>;

  // Appointments
  getAppointments(): Promise<(Appointment & { doctor: Doctor; patient: Patient })[]>;
  getAppointmentById(id: number): Promise<Appointment | undefined>;
  getAppointmentsByDoctorId(doctorId: number): Promise<(Appointment & { patient: Patient })[]>;
  getAppointmentsByPatientId(patientId: number): Promise<Appointment[]>;
  getAppointmentsForDate(date: Date): Promise<(Appointment & { doctor: Doctor; patient: Patient })[]>;
  createAppointment(appointment: InsertAppointment): Promise<Appointment>;
  updateAppointment(id: number, appointment: Partial<InsertAppointment>): Promise<Appointment | undefined>;
  deleteAppointment(id: number): Promise<void>;

  // Doctor Availability
  getDoctorAvailability(doctorId: number): Promise<DoctorAvailability[]>;
  createDoctorAvailability(availability: InsertDoctorAvailability): Promise<DoctorAvailability>;
  updateDoctorAvailability(id: number, availability: Partial<InsertDoctorAvailability>): Promise<DoctorAvailability | undefined>;
  deleteDoctorAvailability(id: number): Promise<void>;

  // Clinic Settings
  getClinicSettings(): Promise<ClinicSettings | undefined>;
  updateClinicSettings(settings: Partial<InsertClinicSettings>): Promise<ClinicSettings>;

  // Chat Sessions
  getChatSession(sessionId: string): Promise<ChatSession | undefined>;
  createChatSession(session: InsertChatSession): Promise<ChatSession>;
  updateChatSession(sessionId: string, session: Partial<InsertChatSession>): Promise<ChatSession | undefined>;

  // Chat Messages
  getChatMessages(sessionId: string): Promise<ChatMessage[]>;
  createChatMessage(message: InsertChatMessage): Promise<ChatMessage>;

  // Admin Users
  getAdminUser(userId: string): Promise<AdminUser | undefined>;
  getAdminUserByUsername(username: string): Promise<AdminUser | undefined>;
  getAdminUsers(): Promise<AdminUser[]>;
  createAdminUser(adminUser: InsertAdminUser): Promise<AdminUser>;

  // Stats
  getAdminStats(): Promise<{
    totalAppointments: number;
    todayAppointments: number;
    totalDoctors: number;
    totalPatients: number;
    recentAppointments: (Appointment & { doctor: Doctor; patient: Patient })[];
  }>;
  getDoctorStats(doctorId: number): Promise<{
    todayAppointments: number;
    weekAppointments: number;
    totalPatients: number;
    upcomingAppointments: (Appointment & { patient: Patient })[];
  }>;
}

export class DatabaseStorage implements IStorage {
  // Users (Replit Auth)
  async getUser(id: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.id, id));
    return user;
  }

  async upsertUser(user: UpsertUser): Promise<User> {
    const [result] = await db
      .insert(users)
      .values(user)
      .onConflictDoUpdate({
        target: users.id,
        set: {
          email: user.email,
          firstName: user.firstName,
          lastName: user.lastName,
          profileImageUrl: user.profileImageUrl,
          updatedAt: new Date(),
        },
      })
      .returning();
    return result;
  }

  // Doctors
  async getDoctors(): Promise<Doctor[]> {
    return db.select().from(doctors).orderBy(desc(doctors.createdAt));
  }

  async getDoctorById(id: number): Promise<Doctor | undefined> {
    const [doctor] = await db.select().from(doctors).where(eq(doctors.id, id));
    return doctor;
  }

  async getDoctorByUserId(userId: string): Promise<Doctor | undefined> {
    const [doctor] = await db.select().from(doctors).where(eq(doctors.userId, userId));
    return doctor;
  }

  async createDoctor(doctor: InsertDoctor): Promise<Doctor> {
    const [result] = await db.insert(doctors).values(doctor).returning();
    return result;
  }

  async updateDoctor(id: number, doctor: Partial<InsertDoctor>): Promise<Doctor | undefined> {
    const [result] = await db.update(doctors).set(doctor).where(eq(doctors.id, id)).returning();
    return result;
  }

  async deleteDoctor(id: number): Promise<void> {
    await db.delete(doctors).where(eq(doctors.id, id));
  }

  // Patients
  async getPatients(): Promise<Patient[]> {
    return db.select().from(patients).orderBy(desc(patients.createdAt));
  }

  async getPatientById(id: number): Promise<Patient | undefined> {
    const [patient] = await db.select().from(patients).where(eq(patients.id, id));
    return patient;
  }

  async getPatientByPhone(phone: string): Promise<Patient | undefined> {
    const [patient] = await db.select().from(patients).where(eq(patients.phone, phone));
    return patient;
  }

  async createPatient(patient: InsertPatient): Promise<Patient> {
    const [result] = await db.insert(patients).values(patient).returning();
    return result;
  }

  async updatePatient(id: number, patient: Partial<InsertPatient>): Promise<Patient | undefined> {
    const [result] = await db.update(patients).set(patient).where(eq(patients.id, id)).returning();
    return result;
  }

  async deletePatient(id: number): Promise<void> {
    await db.delete(patients).where(eq(patients.id, id));
  }

  // Appointments
  async getAppointments(): Promise<(Appointment & { doctor: Doctor; patient: Patient })[]> {
    const result = await db
      .select()
      .from(appointments)
      .leftJoin(doctors, eq(appointments.doctorId, doctors.id))
      .leftJoin(patients, eq(appointments.patientId, patients.id))
      .orderBy(desc(appointments.date));

    return result.map((row) => ({
      ...row.appointments,
      doctor: row.doctors!,
      patient: row.patients!,
    }));
  }

  async getAppointmentById(id: number): Promise<Appointment | undefined> {
    const [result] = await db.select().from(appointments).where(eq(appointments.id, id));
    return result;
  }

  async getAppointmentsByDoctorId(doctorId: number): Promise<(Appointment & { patient: Patient })[]> {
    const result = await db
      .select()
      .from(appointments)
      .leftJoin(patients, eq(appointments.patientId, patients.id))
      .where(eq(appointments.doctorId, doctorId))
      .orderBy(desc(appointments.date));

    return result.map((row) => ({
      ...row.appointments,
      patient: row.patients!,
    }));
  }

  async getAppointmentsByPatientId(patientId: number): Promise<Appointment[]> {
    return db
      .select()
      .from(appointments)
      .where(eq(appointments.patientId, patientId))
      .orderBy(desc(appointments.date));
  }

  async getAppointmentsForDate(date: Date): Promise<(Appointment & { doctor: Doctor; patient: Patient })[]> {
    const startOfDay = new Date(date);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(date);
    endOfDay.setHours(23, 59, 59, 999);

    const result = await db
      .select()
      .from(appointments)
      .leftJoin(doctors, eq(appointments.doctorId, doctors.id))
      .leftJoin(patients, eq(appointments.patientId, patients.id))
      .where(and(gte(appointments.date, startOfDay), lte(appointments.date, endOfDay)))
      .orderBy(appointments.date);

    return result.map((row) => ({
      ...row.appointments,
      doctor: row.doctors!,
      patient: row.patients!,
    }));
  }

  async createAppointment(appointment: InsertAppointment): Promise<Appointment> {
    const [result] = await db.insert(appointments).values(appointment).returning();
    return result;
  }

  async updateAppointment(id: number, appointment: Partial<InsertAppointment>): Promise<Appointment | undefined> {
    const [result] = await db.update(appointments).set(appointment).where(eq(appointments.id, id)).returning();
    return result;
  }

  async deleteAppointment(id: number): Promise<void> {
    await db.delete(appointments).where(eq(appointments.id, id));
  }

  // Doctor Availability
  async getDoctorAvailability(doctorId: number): Promise<DoctorAvailability[]> {
    return db
      .select()
      .from(doctorAvailability)
      .where(eq(doctorAvailability.doctorId, doctorId))
      .orderBy(doctorAvailability.dayOfWeek);
  }

  async createDoctorAvailability(availability: InsertDoctorAvailability): Promise<DoctorAvailability> {
    const [result] = await db.insert(doctorAvailability).values(availability).returning();
    return result;
  }

  async updateDoctorAvailability(id: number, availability: Partial<InsertDoctorAvailability>): Promise<DoctorAvailability | undefined> {
    const [result] = await db.update(doctorAvailability).set(availability).where(eq(doctorAvailability.id, id)).returning();
    return result;
  }

  async deleteDoctorAvailability(id: number): Promise<void> {
    await db.delete(doctorAvailability).where(eq(doctorAvailability.id, id));
  }

  // Clinic Settings
  async getClinicSettings(): Promise<ClinicSettings | undefined> {
    const [result] = await db.select().from(clinicSettings).limit(1);
    return result;
  }

  async updateClinicSettings(settings: Partial<InsertClinicSettings>): Promise<ClinicSettings> {
    const existing = await this.getClinicSettings();
    if (existing) {
      const [result] = await db.update(clinicSettings).set(settings).where(eq(clinicSettings.id, existing.id)).returning();
      return result;
    }
    const [result] = await db.insert(clinicSettings).values(settings as InsertClinicSettings).returning();
    return result;
  }

  // Chat Sessions
  async getChatSession(sessionId: string): Promise<ChatSession | undefined> {
    const [result] = await db.select().from(chatSessions).where(eq(chatSessions.sessionId, sessionId));
    return result;
  }

  async createChatSession(session: InsertChatSession): Promise<ChatSession> {
    const [result] = await db.insert(chatSessions).values(session).returning();
    return result;
  }

  async updateChatSession(sessionId: string, session: Partial<InsertChatSession>): Promise<ChatSession | undefined> {
    const [result] = await db.update(chatSessions).set({ ...session, updatedAt: new Date() }).where(eq(chatSessions.sessionId, sessionId)).returning();
    return result;
  }

  // Chat Messages
  async getChatMessages(sessionId: string): Promise<ChatMessage[]> {
    return db.select().from(chatMessages).where(eq(chatMessages.sessionId, sessionId)).orderBy(chatMessages.createdAt);
  }

  async createChatMessage(message: InsertChatMessage): Promise<ChatMessage> {
    const [result] = await db.insert(chatMessages).values(message).returning();
    return result;
  }

  // Admin Users
  async getAdminUser(userId: string): Promise<AdminUser | undefined> {
    const [result] = await db.select().from(adminUsers).where(eq(adminUsers.userId, userId));
    return result;
  }

  async getAdminUserByUsername(username: string): Promise<AdminUser | undefined> {
    const [result] = await db.select().from(adminUsers).where(eq(adminUsers.username, username));
    return result;
  }

  async getAdminUsers(): Promise<AdminUser[]> {
    return db.select().from(adminUsers);
  }

  async createAdminUser(adminUser: InsertAdminUser): Promise<AdminUser> {
    const [result] = await db.insert(adminUsers).values(adminUser).returning();
    return result;
  }

  // Stats
  async getAdminStats() {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const [totalAppts] = await db.select({ count: count() }).from(appointments);
    const [todayAppts] = await db
      .select({ count: count() })
      .from(appointments)
      .where(and(gte(appointments.date, today), lte(appointments.date, tomorrow)));
    const [totalDocs] = await db.select({ count: count() }).from(doctors).where(eq(doctors.isActive, true));
    const [totalPats] = await db.select({ count: count() }).from(patients);

    const recentAppts = await db
      .select()
      .from(appointments)
      .leftJoin(doctors, eq(appointments.doctorId, doctors.id))
      .leftJoin(patients, eq(appointments.patientId, patients.id))
      .orderBy(desc(appointments.createdAt))
      .limit(5);

    return {
      totalAppointments: totalAppts?.count || 0,
      todayAppointments: todayAppts?.count || 0,
      totalDoctors: totalDocs?.count || 0,
      totalPatients: totalPats?.count || 0,
      recentAppointments: recentAppts.map((row) => ({
        ...row.appointments,
        doctor: row.doctors!,
        patient: row.patients!,
      })),
    };
  }

  async getDoctorStats(doctorId: number) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    const weekEnd = new Date(today);
    weekEnd.setDate(weekEnd.getDate() + 7);

    const [todayAppts] = await db
      .select({ count: count() })
      .from(appointments)
      .where(
        and(
          eq(appointments.doctorId, doctorId),
          gte(appointments.date, today),
          lte(appointments.date, tomorrow)
        )
      );

    const [weekAppts] = await db
      .select({ count: count() })
      .from(appointments)
      .where(
        and(
          eq(appointments.doctorId, doctorId),
          gte(appointments.date, today),
          lte(appointments.date, weekEnd)
        )
      );

    const uniquePatients = await db
      .selectDistinct({ patientId: appointments.patientId })
      .from(appointments)
      .where(eq(appointments.doctorId, doctorId));

    const upcomingAppts = await db
      .select()
      .from(appointments)
      .leftJoin(patients, eq(appointments.patientId, patients.id))
      .where(
        and(
          eq(appointments.doctorId, doctorId),
          gte(appointments.date, new Date()),
          eq(appointments.status, "scheduled")
        )
      )
      .orderBy(appointments.date)
      .limit(10);

    return {
      todayAppointments: todayAppts?.count || 0,
      weekAppointments: weekAppts?.count || 0,
      totalPatients: uniquePatients.length,
      upcomingAppointments: upcomingAppts.map((row) => ({
        ...row.appointments,
        patient: row.patients!,
      })),
    };
  }
}

export const storage = new DatabaseStorage();
