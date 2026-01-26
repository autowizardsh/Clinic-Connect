import type { Express, Request, Response, NextFunction } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { z } from "zod";
import OpenAI from "openai";
import { randomUUID } from "crypto";
import bcrypt from "bcryptjs";
import { setupAuth, registerAuthRoutes } from "./replit_integrations/auth";
import {
  isOAuthConfigured,
  getAuthUrl,
  exchangeCodeForTokens,
  revokeAccess,
  createCalendarEvent,
  getCalendarEvents,
  deleteCalendarEvent,
  listCalendars,
} from "./google-calendar";

// Use Replit AI Integrations for OpenAI
const openai = new OpenAI({
  apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
  baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
});

// Auth middleware - ensures user is authenticated via session
function requireAuth(req: Request, res: Response, next: NextFunction) {
  const session = (req as any).session;
  if (!session?.user) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  next();
}

// Admin-only middleware - checks if user is admin (not doctor-only)
function requireAdmin(req: Request, res: Response, next: NextFunction) {
  const session = (req as any).session;
  if (!session?.user) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  if (session.user.role !== "admin") {
    return res
      .status(403)
      .json({ error: "Access denied. Admin privileges required." });
  }

  next();
}

// Doctor-only middleware - for doctor-specific routes
function requireDoctor(req: Request, res: Response, next: NextFunction) {
  const session = (req as any).session;
  if (!session?.user) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  // Allow if user is admin OR doctor
  if (session.user.role === "admin" || session.user.role === "doctor") {
    next();
  } else {
    return res.status(403).json({ error: "Access denied" });
  }
}

export async function registerRoutes(
  httpServer: Server,
  app: Express,
): Promise<Server> {
  // Setup session middleware and auth routes
  await setupAuth(app);
  registerAuthRoutes(app);

  // ========================================
  // ADMIN ROUTES
  // ========================================

  // Admin Stats
  app.get("/api/admin/stats", requireAdmin, async (req, res) => {
    try {
      const stats = await storage.getAdminStats();
      res.json(stats);
    } catch (error) {
      console.error("Error fetching admin stats:", error);
      res.status(500).json({ error: "Failed to fetch stats" });
    }
  });

  // Doctors CRUD
  app.get("/api/admin/doctors", requireAdmin, async (req, res) => {
    try {
      const doctors = await storage.getDoctors();
      res.json(doctors);
    } catch (error) {
      console.error("Error fetching doctors:", error);
      res.status(500).json({ error: "Failed to fetch doctors" });
    }
  });

  app.post("/api/admin/doctors", requireAdmin, async (req, res) => {
    try {
      const { username, password, ...doctorData } = req.body;

      // Generate a unique userId
      const userId = `doctor-${randomUUID()}`;
      doctorData.userId = userId;

      // Create the doctor first
      const doctor = await storage.createDoctor(doctorData);

      // If username and password provided, create admin user with doctor role
      if (username && password) {
        const hashedPassword = await bcrypt.hash(password, 10);
        await storage.createAdminUser({
          userId: userId,
          username: username,
          password: hashedPassword,
          name: doctorData.name,
          role: "doctor",
          doctorId: doctor.id,
        });
      }

      res.json(doctor);
    } catch (error: any) {
      console.error("Error creating doctor:", error);
      if (error.code === "23505" && error.constraint?.includes("username")) {
        return res.status(400).json({ error: "Username already exists" });
      }
      res.status(500).json({ error: "Failed to create doctor" });
    }
  });

  app.patch("/api/admin/doctors/:id", requireAdmin, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const doctor = await storage.updateDoctor(id, req.body);
      if (!doctor) {
        return res.status(404).json({ error: "Doctor not found" });
      }
      res.json(doctor);
    } catch (error) {
      console.error("Error updating doctor:", error);
      res.status(500).json({ error: "Failed to update doctor" });
    }
  });

  app.delete("/api/admin/doctors/:id", requireAdmin, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      await storage.deleteDoctor(id);
      res.json({ success: true });
    } catch (error) {
      console.error("Error deleting doctor:", error);
      res.status(500).json({ error: "Failed to delete doctor" });
    }
  });

  // Patients CRUD
  app.get("/api/admin/patients", requireAdmin, async (req, res) => {
    try {
      const patients = await storage.getPatients();
      res.json(patients);
    } catch (error) {
      console.error("Error fetching patients:", error);
      res.status(500).json({ error: "Failed to fetch patients" });
    }
  });

  app.post("/api/admin/patients", requireAdmin, async (req, res) => {
    try {
      const patient = await storage.createPatient(req.body);
      res.json(patient);
    } catch (error) {
      console.error("Error creating patient:", error);
      res.status(500).json({ error: "Failed to create patient" });
    }
  });

  app.get(
    "/api/admin/patients/:id/appointments",
    requireAdmin,
    async (req, res) => {
      try {
        const patientId = parseInt(req.params.id);
        const appointments =
          await storage.getAppointmentsByPatientId(patientId);
        res.json(appointments);
      } catch (error) {
        console.error("Error fetching patient appointments:", error);
        res.status(500).json({ error: "Failed to fetch appointments" });
      }
    },
  );

  app.delete("/api/admin/patients/:id", requireAdmin, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      await storage.deletePatient(id);
      res.json({ success: true });
    } catch (error) {
      console.error("Error deleting patient:", error);
      res.status(500).json({ error: "Failed to delete patient" });
    }
  });

  // Appointments CRUD
  app.get("/api/admin/appointments", requireAdmin, async (req, res) => {
    try {
      const appointments = await storage.getAppointments();
      res.json(appointments);
    } catch (error) {
      console.error("Error fetching appointments:", error);
      res.status(500).json({ error: "Failed to fetch appointments" });
    }
  });

  app.post("/api/admin/appointments", requireAdmin, async (req, res) => {
    try {
      const appointment = await storage.createAppointment(req.body);
      res.json(appointment);
    } catch (error) {
      console.error("Error creating appointment:", error);
      res.status(500).json({ error: "Failed to create appointment" });
    }
  });

  app.patch("/api/admin/appointments/:id", requireAdmin, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const appointment = await storage.updateAppointment(id, req.body);
      if (!appointment) {
        return res.status(404).json({ error: "Appointment not found" });
      }
      res.json(appointment);
    } catch (error) {
      console.error("Error updating appointment:", error);
      res.status(500).json({ error: "Failed to update appointment" });
    }
  });

  app.delete("/api/admin/appointments/:id", requireAdmin, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      await storage.deleteAppointment(id);
      res.json({ success: true });
    } catch (error) {
      console.error("Error deleting appointment:", error);
      res.status(500).json({ error: "Failed to delete appointment" });
    }
  });

  // Clinic Settings
  app.get("/api/admin/settings", requireAdmin, async (req, res) => {
    try {
      let settings = await storage.getClinicSettings();
      if (!settings) {
        // Create default settings
        settings = await storage.updateClinicSettings({
          clinicName: "Dental Clinic",
          appointmentDuration: 30,
          openTime: "09:00",
          closeTime: "17:00",
          workingDays: [1, 2, 3, 4, 5],
          services: [
            "General Checkup",
            "Teeth Cleaning",
            "Fillings",
            "Root Canal",
            "Teeth Whitening",
            "Orthodontics",
          ],
          welcomeMessage:
            "Welcome to our dental clinic! How can I help you today?",
        });
      }
      res.json(settings);
    } catch (error) {
      console.error("Error fetching settings:", error);
      res.status(500).json({ error: "Failed to fetch settings" });
    }
  });

  app.patch("/api/admin/settings", requireAdmin, async (req, res) => {
    try {
      const settings = await storage.updateClinicSettings(req.body);
      res.json(settings);
    } catch (error) {
      console.error("Error updating settings:", error);
      res.status(500).json({ error: "Failed to update settings" });
    }
  });

  // ========================================
  // DOCTOR ROUTES
  // ========================================

  app.get("/api/doctor/profile", requireDoctor, async (req, res) => {
    try {
      const session = (req as any).session;
      const user = session?.user;

      // For admin users, show first doctor (admin can view any doctor)
      if (user?.role === "admin") {
        const doctors = await storage.getDoctors();
        if (doctors.length > 0) {
          return res.json(doctors[0]);
        }
        return res.status(404).json({ error: "No doctors found" });
      }

      // For doctor users, find their specific profile
      let doctor = await storage.getDoctorByUserId(user?.id);
      if (!doctor && user?.doctorId) {
        doctor = await storage.getDoctorById(user.doctorId);
      }

      if (!doctor) {
        return res.status(404).json({ error: "Doctor profile not found" });
      }

      res.json(doctor);
    } catch (error) {
      console.error("Error fetching doctor profile:", error);
      res.status(500).json({ error: "Failed to fetch profile" });
    }
  });

  app.get("/api/doctor/stats", requireDoctor, async (req, res) => {
    try {
      const session = (req as any).session;
      const user = session?.user;

      let doctor;
      if (user?.role === "admin") {
        const doctors = await storage.getDoctors();
        doctor = doctors.length > 0 ? doctors[0] : null;
      } else {
        doctor = await storage.getDoctorByUserId(user?.id);
        if (!doctor && user?.doctorId) {
          doctor = await storage.getDoctorById(user.doctorId);
        }
      }

      if (!doctor) {
        return res.json({
          todayAppointments: 0,
          weekAppointments: 0,
          totalPatients: 0,
          upcomingAppointments: [],
        });
      }

      const stats = await storage.getDoctorStats(doctor.id);
      res.json(stats);
    } catch (error) {
      console.error("Error fetching doctor stats:", error);
      res.status(500).json({ error: "Failed to fetch stats" });
    }
  });

  app.get("/api/doctor/appointments", requireDoctor, async (req, res) => {
    try {
      const session = (req as any).session;
      const user = session?.user;

      let doctor;
      if (user?.role === "admin") {
        const doctors = await storage.getDoctors();
        doctor = doctors.length > 0 ? doctors[0] : null;
      } else {
        doctor = await storage.getDoctorByUserId(user?.id);
        if (!doctor && user?.doctorId) {
          doctor = await storage.getDoctorById(user.doctorId);
        }
      }

      if (!doctor) {
        return res.json([]);
      }

      const appointments = await storage.getAppointmentsByDoctorId(doctor.id);
      res.json(appointments);
    } catch (error) {
      console.error("Error fetching doctor appointments:", error);
      res.status(500).json({ error: "Failed to fetch appointments" });
    }
  });

  app.patch("/api/doctor/appointments/:id", requireDoctor, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const appointment = await storage.updateAppointment(id, req.body);
      if (!appointment) {
        return res.status(404).json({ error: "Appointment not found" });
      }
      res.json(appointment);
    } catch (error) {
      console.error("Error updating appointment:", error);
      res.status(500).json({ error: "Failed to update appointment" });
    }
  });

  // Doctor Availability
  app.get("/api/doctor/availability", requireDoctor, async (req, res) => {
    try {
      const session = (req as any).session;
      const user = session?.user;

      let doctor;
      if (user?.role === "admin") {
        const doctors = await storage.getDoctors();
        doctor = doctors.length > 0 ? doctors[0] : null;
      } else {
        doctor = await storage.getDoctorByUserId(user?.id);
        if (!doctor && user?.doctorId) {
          doctor = await storage.getDoctorById(user.doctorId);
        }
      }

      if (!doctor) {
        return res.json([]);
      }

      const availability = await storage.getDoctorAvailability(doctor.id);
      res.json(availability);
    } catch (error) {
      console.error("Error fetching availability:", error);
      res.status(500).json({ error: "Failed to fetch availability" });
    }
  });

  app.post("/api/doctor/availability", requireDoctor, async (req, res) => {
    try {
      const session = (req as any).session;
      const user = session?.user;

      let doctor;
      if (user?.role === "admin") {
        const doctors = await storage.getDoctors();
        doctor = doctors.length > 0 ? doctors[0] : null;
      } else {
        doctor = await storage.getDoctorByUserId(user?.id);
        if (!doctor && user?.doctorId) {
          doctor = await storage.getDoctorById(user.doctorId);
        }
      }

      if (!doctor) {
        return res.status(404).json({ error: "Doctor not found" });
      }

      const availability = await storage.createDoctorAvailability({
        ...req.body,
        doctorId: doctor.id,
      });
      res.json(availability);
    } catch (error) {
      console.error("Error creating availability:", error);
      res.status(500).json({ error: "Failed to create availability" });
    }
  });

  app.patch("/api/doctor/availability/:id", requireDoctor, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const availability = await storage.updateDoctorAvailability(id, req.body);
      if (!availability) {
        return res.status(404).json({ error: "Availability not found" });
      }
      res.json(availability);
    } catch (error) {
      console.error("Error updating availability:", error);
      res.status(500).json({ error: "Failed to update availability" });
    }
  });

  app.delete(
    "/api/doctor/availability/:id",
    requireDoctor,
    async (req, res) => {
      try {
        const id = parseInt(req.params.id);
        await storage.deleteDoctorAvailability(id);
        res.json({ success: true });
      } catch (error) {
        console.error("Error deleting availability:", error);
        res.status(500).json({ error: "Failed to delete availability" });
      }
    },
  );

  // Helper to get current doctor from session
  async function getDoctorFromSession(req: Request) {
    const session = (req as any).session;
    const user = session?.user;

    if (user?.role === "admin") {
      const doctors = await storage.getDoctors();
      return doctors.length > 0 ? doctors[0] : null;
    } else {
      let doctor = await storage.getDoctorByUserId(user?.id);
      if (!doctor && user?.doctorId) {
        doctor = await storage.getDoctorById(user.doctorId);
      }
      return doctor;
    }
  }

  // Google Calendar Integration - Per-Doctor OAuth
  app.get("/api/doctor/calendar/status", requireDoctor, async (req, res) => {
    try {
      const doctor = await getDoctorFromSession(req);

      if (!doctor) {
        return res.json({
          connected: false,
          configured: isOAuthConfigured(),
          message: "Doctor not found",
        });
      }

      // Check if this specific doctor has connected their calendar
      const hasRefreshToken = !!doctor.googleRefreshToken;

      res.json({
        connected: hasRefreshToken,
        configured: isOAuthConfigured(),
        calendarId: doctor.googleCalendarId,
        message: hasRefreshToken ? "Connected" : "Not connected",
      });
    } catch (error) {
      res.json({
        connected: false,
        configured: isOAuthConfigured(),
        message: "Error checking status",
      });
    }
  });

  // Start OAuth flow - redirects doctor to Google consent screen
  app.get("/api/doctor/calendar/connect", requireDoctor, async (req, res) => {
    try {
      const doctor = await getDoctorFromSession(req);

      if (!doctor) {
        return res.status(404).json({ error: "Doctor not found" });
      }

      if (!isOAuthConfigured()) {
        return res.status(400).json({
          error:
            "Google OAuth not configured. Please set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET.",
        });
      }

      const authUrl = getAuthUrl(doctor.id);
      res.json({ authUrl });
    } catch (error) {
      console.error("Error generating auth URL:", error);
      res.status(500).json({ error: "Failed to start OAuth flow" });
    }
  });

  // OAuth callback - exchanges code for tokens and stores them
  // This route requires authentication and validates that the state matches the session user's doctor
  app.get("/api/doctor/calendar/callback", async (req, res) => {
    try {
      const session = (req as any).session;
      const user = session?.user;

      // Require authentication
      if (!user) {
        return res.redirect("/login?error=session_expired");
      }

      const { code, state } = req.query;

      if (!code || !state) {
        return res.redirect("/doctor/calendar?error=missing_params");
      }

      const stateDoctorid = parseInt(state as string);
      if (isNaN(stateDoctorid)) {
        return res.redirect("/doctor/calendar?error=invalid_state");
      }

      // Get the doctor associated with the current session
      const doctor = await getDoctorFromSession(req);

      if (!doctor) {
        return res.redirect("/doctor/calendar?error=doctor_not_found");
      }

      // Security: Verify that the state (doctorId) matches the logged-in user's doctor
      // This prevents CSRF attacks where someone tries to bind their token to another doctor
      if (doctor.id !== stateDoctorid) {
        console.error(
          `OAuth state mismatch: state doctorId ${stateDoctorid} != session doctorId ${doctor.id}`,
        );
        return res.redirect("/doctor/calendar?error=security_violation");
      }

      const tokens = await exchangeCodeForTokens(code as string);

      if (!tokens.refresh_token) {
        return res.redirect("/doctor/calendar?error=no_refresh_token");
      }

      // Store the refresh token for this doctor
      await storage.updateDoctor(doctor.id, {
        googleRefreshToken: tokens.refresh_token,
      });

      res.redirect("/doctor/calendar?connected=true");
    } catch (error) {
      console.error("OAuth callback error:", error);
      res.redirect("/doctor/calendar?error=oauth_failed");
    }
  });

  // Disconnect calendar - revokes access and clears token
  app.post(
    "/api/doctor/calendar/disconnect",
    requireDoctor,
    async (req, res) => {
      try {
        const doctor = await getDoctorFromSession(req);

        if (!doctor) {
          return res.status(404).json({ error: "Doctor not found" });
        }

        if (doctor.googleRefreshToken) {
          try {
            await revokeAccess(doctor.googleRefreshToken);
          } catch (e) {
            // Ignore revoke errors, continue to clear token
            console.log("Token revoke failed (may already be revoked):", e);
          }
        }

        // Clear tokens from database
        await storage.updateDoctor(doctor.id, {
          googleRefreshToken: null,
          googleCalendarId: null,
        });

        res.json({ success: true, message: "Calendar disconnected" });
      } catch (error) {
        console.error("Error disconnecting calendar:", error);
        res.status(500).json({ error: "Failed to disconnect calendar" });
      }
    },
  );

  app.get("/api/doctor/calendar/calendars", requireDoctor, async (req, res) => {
    try {
      const doctor = await getDoctorFromSession(req);

      if (!doctor?.googleRefreshToken) {
        return res.status(400).json({ error: "Calendar not connected" });
      }

      const calendars = await listCalendars(doctor.googleRefreshToken);
      res.json(calendars);
    } catch (error) {
      console.error("Error listing calendars:", error);
      res.status(500).json({ error: "Failed to list calendars" });
    }
  });

  app.get("/api/doctor/calendar/events", requireDoctor, async (req, res) => {
    try {
      const doctor = await getDoctorFromSession(req);

      if (!doctor?.googleRefreshToken) {
        return res.status(400).json({ error: "Calendar not connected" });
      }

      const { calendarId, startDate, endDate } = req.query;
      const calId =
        (calendarId as string) || doctor.googleCalendarId || "primary";

      const timeMin = startDate ? new Date(startDate as string) : new Date();
      const timeMax = endDate
        ? new Date(endDate as string)
        : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

      const events = await getCalendarEvents(
        doctor.googleRefreshToken,
        calId,
        timeMin,
        timeMax,
      );
      res.json(events);
    } catch (error) {
      console.error("Error fetching calendar events:", error);
      res.status(500).json({ error: "Failed to fetch calendar events" });
    }
  });

  app.post("/api/doctor/calendar/sync", requireDoctor, async (req, res) => {
    try {
      const doctor = await getDoctorFromSession(req);

      if (!doctor) {
        return res.status(404).json({ error: "Doctor not found" });
      }

      if (!doctor.googleRefreshToken) {
        return res
          .status(400)
          .json({
            error:
              "Calendar not connected. Please connect your Google Calendar first.",
          });
      }

      // Get doctor's appointments and clinic settings for timezone
      const [appointments, settings] = await Promise.all([
        storage.getAppointmentsByDoctorId(doctor.id),
        storage.getClinicSettings(),
      ]);

      // Use doctor's calendar or provided calendar ID
      const calendarId =
        req.body.calendarId || doctor.googleCalendarId || "primary";
      const timezone = settings?.timezone || "Europe/Amsterdam";

      // Optionally save the calendar selection to the doctor profile
      if (
        req.body.calendarId &&
        req.body.calendarId !== doctor.googleCalendarId
      ) {
        await storage.updateDoctor(doctor.id, {
          googleCalendarId: req.body.calendarId,
        });
      }

      let syncedCount = 0;
      for (const appointment of appointments) {
        if (appointment.status === "scheduled" && !appointment.googleEventId) {
          try {
            // Get patient info
            const patient = await storage.getPatientById(appointment.patientId);

            // Format date from timestamp to YYYY-MM-DD
            const appointmentDate = new Date(appointment.date);
            const dateStr = appointmentDate.toISOString().split("T")[0];
            const timeStr = `${String(appointmentDate.getHours()).padStart(2, "0")}:${String(appointmentDate.getMinutes()).padStart(2, "0")}`;

            const event = await createCalendarEvent(
              doctor.googleRefreshToken,
              calendarId,
              {
                patientName: patient?.name || "Unknown Patient",
                doctorName: doctor.name,
                date: dateStr,
                time: timeStr,
                service: appointment.service || "Dental Appointment",
                notes: appointment.notes || undefined,
                duration: appointment.duration,
              },
              timezone,
            );

            // Update appointment with Google Event ID
            await storage.updateAppointment(appointment.id, {
              googleEventId: event.id,
            });

            syncedCount++;
          } catch (e) {
            console.error(`Failed to sync appointment ${appointment.id}:`, e);
          }
        }
      }

      res.json({
        success: true,
        message: `Synced ${syncedCount} appointments to Google Calendar`,
      });
    } catch (error) {
      console.error("Error syncing calendar:", error);
      res.status(500).json({ error: "Failed to sync calendar" });
    }
  });

  app.delete(
    "/api/doctor/calendar/event/:eventId",
    requireDoctor,
    async (req, res) => {
      try {
        const doctor = await getDoctorFromSession(req);

        if (!doctor?.googleRefreshToken) {
          return res.status(400).json({ error: "Calendar not connected" });
        }

        const { eventId } = req.params;
        const calendarId =
          (req.query.calendarId as string) ||
          doctor.googleCalendarId ||
          "primary";

        await deleteCalendarEvent(
          doctor.googleRefreshToken,
          calendarId,
          eventId,
        );
        res.json({ success: true });
      } catch (error) {
        console.error("Error deleting calendar event:", error);
        res.status(500).json({ error: "Failed to delete calendar event" });
      }
    },
  );

  // ========================================
  // CHAT ROUTES (AI Booking)
  // ========================================

  app.post("/api/chat/session", async (req, res) => {
    try {
      const { language = "en" } = req.body;
      const sessionId = randomUUID();

      // Get clinic settings for welcome message
      let settings = await storage.getClinicSettings();
      if (!settings) {
        settings = await storage.updateClinicSettings({
          clinicName: "Dental Clinic",
          welcomeMessage:
            language === "nl"
              ? "Welkom bij onze tandartskliniek! Hoe kan ik u vandaag helpen?"
              : "Welcome to our dental clinic! How can I help you today?",
        });
      }

      // Create session
      await storage.createChatSession({
        sessionId,
        language,
        status: "active",
      });

      const welcomeMessage =
        language === "nl"
          ? `Welkom bij ${settings.clinicName}! Ik ben uw AI-assistent. Ik kan u helpen met het boeken van een afspraak. Hoe kan ik u vandaag helpen?`
          : `Welcome to ${settings.clinicName}! I'm your AI assistant. I can help you book an appointment. How may I help you today?`;

      // Store welcome message
      await storage.createChatMessage({
        sessionId,
        role: "assistant",
        content: welcomeMessage,
      });

      res.json({ sessionId, welcomeMessage });
    } catch (error) {
      console.error("Error creating chat session:", error);
      res.status(500).json({ error: "Failed to create session" });
    }
  });

  // Helper function to find available slots
  async function findAvailableSlots(
    doctorId: number,
    requestedDate: string,
    openMinutes: number,
    closeMinutes: number,
    duration: number,
    existingAppointments: any[],
    workingDays: number[],
  ): Promise<{ date: string; time: string }[]> {
    const availableSlots: { date: string; time: string }[] = [];
    const slotInterval = 30; // Check every 30 minutes

    // Try requested day first, then next day
    for (
      let dayOffset = 0;
      dayOffset <= 1 && availableSlots.length < 3;
      dayOffset++
    ) {
      const checkDate = new Date(requestedDate);
      checkDate.setDate(checkDate.getDate() + dayOffset);
      const dateStr = checkDate.toISOString().split("T")[0];
      const dayOfWeek = checkDate.getDay();

      // Skip non-working days
      if (!workingDays.includes(dayOfWeek)) continue;

      // Get appointments for this specific day
      const dayAppointments = existingAppointments.filter((apt) => {
        if (apt.status === "cancelled") return false;
        const aptDate = new Date(apt.date).toISOString().split("T")[0];
        return aptDate === dateStr;
      });

      // Check each time slot
      for (
        let minutes = openMinutes;
        minutes + duration <= closeMinutes && availableSlots.length < 3;
        minutes += slotInterval
      ) {
        const slotStart = minutes;
        const slotEnd = minutes + duration;

        // Check if this slot conflicts with any existing appointment
        const hasConflict = dayAppointments.some((apt) => {
          const aptDate = new Date(apt.date);
          const aptStartMinutes =
            aptDate.getHours() * 60 + aptDate.getMinutes();
          const aptEndMinutes = aptStartMinutes + apt.duration;
          return slotStart < aptEndMinutes && slotEnd > aptStartMinutes;
        });

        if (!hasConflict) {
          const hours = Math.floor(minutes / 60);
          const mins = minutes % 60;
          const timeStr = `${String(hours).padStart(2, "0")}:${String(mins).padStart(2, "0")}`;
          availableSlots.push({ date: dateStr, time: timeStr });
        }
      }
    }

    return availableSlots;
  }

  app.post("/api/chat/message", async (req, res) => {
    try {
      const { sessionId, message, language = "en" } = req.body;

      if (!sessionId || !message) {
        return res
          .status(400)
          .json({ error: "Session ID and message required" });
      }

      // Store user message
      await storage.createChatMessage({
        sessionId,
        role: "user",
        content: message,
      });

      // Get context
      const [settings, doctors, previousMessages] = await Promise.all([
        storage.getClinicSettings(),
        storage.getDoctors(),
        storage.getChatMessages(sessionId),
      ]);

      const activeDoctors = doctors.filter((d) => d.isActive);
      const services = settings?.services || [
        "General Checkup",
        "Teeth Cleaning",
      ];
      const now = new Date();
      const today = now.toISOString().split("T")[0];
      const dayNames = [
        "Sunday",
        "Monday",
        "Tuesday",
        "Wednesday",
        "Thursday",
        "Friday",
        "Saturday",
      ];
      const dayNamesNL = [
        "Zondag",
        "Maandag",
        "Dinsdag",
        "Woensdag",
        "Donderdag",
        "Vrijdag",
        "Zaterdag",
      ];
      const currentDayOfWeek = now.getDay();

      // Build system prompt with function calling instructions
      const systemPrompt =
        language === "nl"
          ? `Je bent een warme, behulpzame receptionist voor ${settings?.clinicName || "de tandartskliniek"}. 
Praat natuurlijk alsof je een echte persoon bent die echt wil helpen. Wees beknopt maar vriendelijk.

DATUMCONTEXT:
- Vandaag: ${dayNamesNL[currentDayOfWeek]}, ${today}
- "morgen" = ${new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString().split("T")[0]}
- "overmorgen" = ${new Date(now.getTime() + 48 * 60 * 60 * 1000).toISOString().split("T")[0]}
- Bereken dagnamen naar exacte datums. Boek NOOIT in het verleden.

KLINIEKINFO:
Diensten: ${services.join(", ")}
Tandartsen: ${activeDoctors.map((d) => `Dr. ${d.name} (ID: ${d.id}, ${d.specialty})`).join("; ") || "Neem contact op"}
Open: ${settings?.openTime || "09:00"} - ${settings?.closeTime || "17:00"}, ma-za

BOEKINGSSTROOM (volg deze volgorde):
1. Begroet vriendelijk en vraag hoe je kunt helpen
2. Bij afspraakverzoek: noem de diensten en vraag welke ze nodig hebben
3. Beveel een geschikte tandarts aan op basis van hun keuze
4. Vraag wanneer ze willen komen
5. Controleer beschikbaarheid - bevestig of bied alternatieven
6. Verzamel naam, telefoon en e-mail
7. Vat samen en vraag bevestiging
8. Boek pas na bevestiging

STIJLREGELS:
- Praat natuurlijk, niet als een robot. Varieer je bewoordingen.
- Eén vraag per keer
- Vraag pas laat in het gesprek om contactgegevens
- Geen emoji's, geen opmaak (geen **vet** of *cursief*)
- Houd het kort - max 2-3 zinnen per antwoord
- Wees behulpzaam en professioneel maar warm`
          : `You are a warm, helpful receptionist for ${settings?.clinicName || "the dental clinic"}. 
Talk naturally like a real person who genuinely wants to help. Be concise but friendly.

DATE CONTEXT:
- Today: ${dayNames[currentDayOfWeek]}, ${today}
- "tomorrow" = ${new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString().split("T")[0]}
- "day after tomorrow" = ${new Date(now.getTime() + 48 * 60 * 60 * 1000).toISOString().split("T")[0]}
- Convert day names to exact dates. NEVER book in the past.

CLINIC INFO:
Services: ${services.join(", ")}
Dentists: ${activeDoctors.map((d) => `Dr. ${d.name} (ID: ${d.id}, ${d.specialty})`).join("; ") || "Contact us"}
Hours: ${settings?.openTime || "09:00"} - ${settings?.closeTime || "17:00"}, Mon-Sat

BOOKING FLOW (follow this order):
1. Greet warmly and ask how you can help
2. When they want to book: mention services and ask which they need
3. Recommend a suitable dentist based on their choice
4. Ask when they would like to come in
5. Check availability - confirm the slot or offer alternatives
6. Collect name, phone, and email
7. Summarize and ask for confirmation
8. Only book after they confirm

STYLE RULES:
- Talk naturally, not robotic. Vary your wording each time.
- One question at a time
- Only ask for contact details late in the conversation
- No emojis, no formatting (no **bold** or *italic*)
- Keep it short - max 2-3 sentences per response
- Be helpful and professional but warm`;

      // Build conversation history
      const conversationHistory = previousMessages.slice(-10).map((m) => ({
        role: m.role as "user" | "assistant",
        content: m.content,
      }));

      // Define the booking function for OpenAI
      const bookingFunction = {
        type: "function" as const,
        function: {
          name: "book_appointment",
          description:
            "Book a dental appointment for a patient. Call this when you have collected all required information: patient name, phone number, service, date, time, and doctor.",
          parameters: {
            type: "object",
            properties: {
              patientName: {
                type: "string",
                description: "Full name of the patient",
              },
              patientPhone: {
                type: "string",
                description: "Phone number of the patient",
              },
              patientEmail: {
                type: "string",
                description: "Email address of the patient (optional)",
              },
              service: {
                type: "string",
                description: "The dental service requested",
              },
              doctorId: {
                type: "number",
                description: "ID of the selected doctor",
              },
              doctorName: {
                type: "string",
                description: "Name of the selected doctor",
              },
              date: {
                type: "string",
                description: "Appointment date in YYYY-MM-DD format",
              },
              time: {
                type: "string",
                description: "Appointment time in HH:MM format (24-hour)",
              },
              notes: {
                type: "string",
                description: "Any additional notes from the patient",
              },
            },
            required: [
              "patientName",
              "patientPhone",
              "service",
              "doctorId",
              "date",
              "time",
            ],
          },
        },
      };

      // First call: Check if AI wants to book
      const initialResponse = await openai.chat.completions.create({
        model: "gpt-4o",
        messages: [
          { role: "system", content: systemPrompt },
          ...conversationHistory,
          { role: "user", content: message },
        ],
        tools: [bookingFunction],
        tool_choice: "auto",
      });

      const responseMessage = initialResponse.choices[0]?.message;
      let fullResponse = "";
      let bookingResult = null;

      // Check if AI called the booking function
      if (
        responseMessage?.tool_calls &&
        responseMessage.tool_calls.length > 0
      ) {
        const toolCall = responseMessage.tool_calls[0] as {
          id: string;
          type: string;
          function: { name: string; arguments: string };
        };
        if (toolCall.function?.name === "book_appointment") {
          try {
            const bookingData = JSON.parse(toolCall.function.arguments);
            console.log("Booking appointment:", bookingData);

            // Parse date and time
            const appointmentDateTime = new Date(
              `${bookingData.date}T${bookingData.time}:00`,
            );
            const appointmentDuration = settings?.appointmentDuration || 30;

            // Check if date is in the past
            const now = new Date();
            const todayStart = new Date(
              now.getFullYear(),
              now.getMonth(),
              now.getDate(),
            );
            const appointmentDate = new Date(
              appointmentDateTime.getFullYear(),
              appointmentDateTime.getMonth(),
              appointmentDateTime.getDate(),
            );

            if (appointmentDate < todayStart) {
              throw new Error(
                `SLOT_UNAVAILABLE: Cannot book appointments in the past. Please choose a future date.`,
              );
            }

            // If booking for today, check if the time hasn't passed
            if (appointmentDate.getTime() === todayStart.getTime()) {
              if (appointmentDateTime.getTime() < now.getTime()) {
                throw new Error(
                  `SLOT_UNAVAILABLE: This time has already passed. Please choose a later time today or another day.`,
                );
              }
            }

            // Check if time is within working hours
            const openTime = settings?.openTime || "09:00:00";
            const closeTime = settings?.closeTime || "17:00:00";
            const requestedTime = bookingData.time;

            // Parse times for comparison
            const [openHour, openMin] = openTime.split(":").map(Number);
            const [closeHour, closeMin] = closeTime.split(":").map(Number);
            const [reqHour, reqMin] = requestedTime.split(":").map(Number);

            const openMinutes = openHour * 60 + openMin;
            const closeMinutes = closeHour * 60 + closeMin;
            const requestedMinutes = reqHour * 60 + reqMin;
            const appointmentEndMinutes =
              requestedMinutes + appointmentDuration;

            if (
              requestedMinutes < openMinutes ||
              appointmentEndMinutes > closeMinutes
            ) {
              throw new Error(
                `SLOT_UNAVAILABLE: The requested time is outside working hours (${openTime.slice(0, 5)} - ${closeTime.slice(0, 5)})`,
              );
            }

            // Check if it's a working day
            const dayOfWeek = appointmentDateTime.getDay(); // 0 = Sunday, 1 = Monday, etc.
            const workingDays = settings?.workingDays || [1, 2, 3, 4, 5, 6]; // Mon-Sat by default
            if (!workingDays.includes(dayOfWeek)) {
              const dayNames = [
                "Sunday",
                "Monday",
                "Tuesday",
                "Wednesday",
                "Thursday",
                "Friday",
                "Saturday",
              ];
              throw new Error(
                `SLOT_UNAVAILABLE: ${dayNames[dayOfWeek]} is not a working day. Please choose another day.`,
              );
            }

            // Check for conflicting appointments
            const existingAppointments =
              await storage.getAppointmentsByDoctorId(bookingData.doctorId);
            const conflictingAppointment = existingAppointments.find((apt) => {
              if (apt.status === "cancelled") return false;

              const aptStart = new Date(apt.date).getTime();
              const aptEnd = aptStart + apt.duration * 60 * 1000;
              const newStart = appointmentDateTime.getTime();
              const newEnd = newStart + appointmentDuration * 60 * 1000;

              // Check for overlap
              return newStart < aptEnd && newEnd > aptStart;
            });

            if (conflictingAppointment) {
              // Find alternative slots
              const alternativeSlots = await findAvailableSlots(
                bookingData.doctorId,
                bookingData.date,
                openMinutes,
                closeMinutes,
                appointmentDuration,
                existingAppointments,
                workingDays,
              );

              if (alternativeSlots.length > 0) {
                const slotsText = alternativeSlots
                  .map((s) => `${s.date} at ${s.time}`)
                  .join(", ");
                throw new Error(
                  `SLOT_UNAVAILABLE_WITH_ALTERNATIVES: This time slot is already booked. Available slots: ${slotsText}`,
                );
              } else {
                throw new Error(
                  `SLOT_UNAVAILABLE: This time slot is already booked and no alternatives found for this day. Please try a different day.`,
                );
              }
            }

            // Create or find patient
            let patient = await storage.getPatientByPhone(
              bookingData.patientPhone,
            );
            if (!patient) {
              patient = await storage.createPatient({
                name: bookingData.patientName,
                phone: bookingData.patientPhone,
                email: bookingData.patientEmail || null,
                notes: `Booked via chat on ${new Date().toLocaleDateString()}`,
              });
              console.log("Created new patient:", patient.id);
            }

            // Create appointment
            const appointment = await storage.createAppointment({
              patientId: patient.id,
              doctorId: bookingData.doctorId,
              date: appointmentDateTime,
              duration: appointmentDuration,
              status: "scheduled",
              service: bookingData.service,
              notes: bookingData.notes || null,
              source: "chat",
            });

            console.log("Created appointment:", appointment.id);

            bookingResult = {
              success: true,
              appointmentId: appointment.id,
              patientName: bookingData.patientName,
              doctorName: bookingData.doctorName,
              date: bookingData.date,
              time: bookingData.time,
              service: bookingData.service,
            };

            // Get confirmation message from AI
            const confirmationResponse = await openai.chat.completions.create({
              model: "gpt-4o",
              messages: [
                { role: "system", content: systemPrompt },
                ...conversationHistory,
                { role: "user", content: message },
                responseMessage,
                {
                  role: "tool",
                  tool_call_id: toolCall.id,
                  content: JSON.stringify({
                    success: true,
                    message: `Appointment booked successfully! Appointment ID: ${appointment.id}`,
                    details: bookingResult,
                  }),
                },
              ],
            });

            fullResponse =
              confirmationResponse.choices[0]?.message?.content ||
              (language === "nl"
                ? `Uw afspraak is geboekt! Afspraak voor ${bookingData.service} met Dr. ${bookingData.doctorName} op ${bookingData.date} om ${bookingData.time}.`
                : `Your appointment is booked! Appointment for ${bookingData.service} with Dr. ${bookingData.doctorName} on ${bookingData.date} at ${bookingData.time}.`);
          } catch (bookingError: any) {
            console.error("Booking error:", bookingError);

            // Check if it's a slot unavailability error with alternatives
            if (
              bookingError.message?.startsWith(
                "SLOT_UNAVAILABLE_WITH_ALTERNATIVES:",
              )
            ) {
              const reason = bookingError.message.replace(
                "SLOT_UNAVAILABLE_WITH_ALTERNATIVES: ",
                "",
              );
              fullResponse =
                language === "nl"
                  ? `Sorry, dit tijdslot is al geboekt. ${reason}. Wilt u een van deze tijden boeken?`
                  : `Sorry, this time slot is already booked. ${reason}. Would you like to book one of these times?`;
            } else if (bookingError.message?.startsWith("SLOT_UNAVAILABLE:")) {
              const reason = bookingError.message.replace(
                "SLOT_UNAVAILABLE: ",
                "",
              );
              fullResponse =
                language === "nl"
                  ? `Sorry, dit tijdslot is niet beschikbaar. ${reason} Kies alstublieft een ander tijdstip.`
                  : `Sorry, this time slot is not available. ${reason} Please choose a different time.`;
            } else {
              fullResponse =
                language === "nl"
                  ? "Er is een fout opgetreden bij het boeken. Probeer het opnieuw."
                  : "There was an error booking your appointment. Please try again.";
            }
          }
        }
      } else {
        // No function call, use the regular response
        fullResponse = responseMessage?.content || "";
      }

      // Set headers for response
      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");

      // Send response
      if (fullResponse) {
        res.write(`data: ${JSON.stringify({ content: fullResponse })}\n\n`);

        // Store assistant response
        await storage.createChatMessage({
          sessionId,
          role: "assistant",
          content: fullResponse,
        });
      }

      // Send booking result if available
      if (bookingResult) {
        res.write(`data: ${JSON.stringify({ booking: bookingResult })}\n\n`);
      }

      res.write("data: [DONE]\n\n");
      res.end();
    } catch (error) {
      console.error("Error processing chat message:", error);
      res.status(500).json({ error: "Failed to process message" });
    }
  });

  // Public endpoint to get available slots
  app.get("/api/public/doctors", async (req, res) => {
    try {
      const doctors = await storage.getDoctors();
      const activeDoctors = doctors
        .filter((d) => d.isActive)
        .map((d) => ({
          id: d.id,
          name: d.name,
          specialty: d.specialty,
        }));
      res.json(activeDoctors);
    } catch (error) {
      console.error("Error fetching public doctors:", error);
      res.status(500).json({ error: "Failed to fetch doctors" });
    }
  });

  app.get("/api/public/settings", async (req, res) => {
    try {
      const settings = await storage.getClinicSettings();
      if (!settings) {
        return res.json({
          clinicName: "Dental Clinic",
          services: ["General Checkup", "Teeth Cleaning"],
        });
      }
      res.json({
        clinicName: settings.clinicName,
        services: settings.services,
        openTime: settings.openTime,
        closeTime: settings.closeTime,
      });
    } catch (error) {
      console.error("Error fetching public settings:", error);
      res.status(500).json({ error: "Failed to fetch settings" });
    }
  });

  return httpServer;
}
