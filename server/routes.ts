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
      const { doctorId, patientId, date, time, service, notes, source } = req.body;
      
      // Validate required fields
      if (!doctorId || !patientId || !date || !service) {
        return res.status(400).json({ error: "Missing required fields" });
      }
      
      // Parse the date and time - handle both formats:
      // 1. Separate date (YYYY-MM-DD) and time (HH:MM)
      // 2. Combined ISO string
      let appointmentDate: Date;
      if (time) {
        // Separate date and time fields - create date in local context
        appointmentDate = new Date(`${date}T${time}:00`);
      } else {
        // Already a combined date string
        appointmentDate = new Date(date);
      }
      
      if (isNaN(appointmentDate.getTime())) {
        return res.status(400).json({ error: "Invalid date format" });
      }
      
      // Get clinic settings and doctor's date-specific unavailability
      // Use local date string to avoid timezone issues
      const appointmentDateStr = `${appointmentDate.getFullYear()}-${String(appointmentDate.getMonth() + 1).padStart(2, '0')}-${String(appointmentDate.getDate()).padStart(2, '0')}`;
      const [settings, doctorUnavailability, existingAppointments] = await Promise.all([
        storage.getClinicSettings(),
        storage.getDoctorAvailabilityForDate(doctorId, appointmentDateStr),
        storage.getAppointmentsByDoctorId(doctorId),
      ]);
      
      const appointmentDuration = settings?.appointmentDuration || 30;
      const appointmentHours = appointmentDate.getHours();
      const appointmentMinutes = appointmentDate.getMinutes();
      const appointmentTimeMinutes = appointmentHours * 60 + appointmentMinutes;
      const appointmentEndMinutes = appointmentTimeMinutes + appointmentDuration;
      
      // Check working hours from clinic settings
      const openTime = settings?.openTime || "09:00";
      const closeTime = settings?.closeTime || "17:00";
      const [openHour, openMin] = openTime.split(":").map(Number);
      const [closeHour, closeMin] = closeTime.split(":").map(Number);
      const openMinutes = openHour * 60 + openMin;
      const closeMinutes = closeHour * 60 + closeMin;
      
      if (appointmentTimeMinutes < openMinutes || appointmentEndMinutes > closeMinutes) {
        const formatTime = (mins: number) => {
          const h = Math.floor(mins / 60);
          const m = mins % 60;
          return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
        };
        return res.status(400).json({ 
          error: `Time slot outside working hours. Clinic is open from ${formatTime(openMinutes)} to ${formatTime(closeMinutes)}` 
        });
      }
      
      // Check if doctor is unavailable on this specific date/time
      for (const block of doctorUnavailability) {
        if (!block.isAvailable) {
          const [blockStartH, blockStartM] = block.startTime.split(":").map(Number);
          const [blockEndH, blockEndM] = block.endTime.split(":").map(Number);
          const blockStart = blockStartH * 60 + blockStartM;
          const blockEnd = blockEndH * 60 + blockEndM;
          
          // Check if appointment overlaps with blocked time
          if (appointmentTimeMinutes < blockEnd && appointmentEndMinutes > blockStart) {
            return res.status(400).json({ 
              error: `Doctor is not available on ${appointmentDateStr} from ${block.startTime.slice(0, 5)} to ${block.endTime.slice(0, 5)}${block.reason ? ` (${block.reason})` : ''}` 
            });
          }
        }
      }
      
      // Check for conflicts with existing appointments
      const conflictingAppointments = existingAppointments.filter(apt => {
        if (apt.status === 'cancelled') return false;
        const aptDate = new Date(apt.date);
        // Use local date string to avoid timezone issues
        const aptDateStr = `${aptDate.getFullYear()}-${String(aptDate.getMonth() + 1).padStart(2, '0')}-${String(aptDate.getDate()).padStart(2, '0')}`;
        if (aptDateStr !== appointmentDateStr) return false;
        
        const aptStartMins = aptDate.getHours() * 60 + aptDate.getMinutes();
        const aptEndMins = aptStartMins + (apt.duration || appointmentDuration);
        const newEndMins = appointmentTimeMinutes + appointmentDuration;
        
        return (appointmentTimeMinutes < aptEndMins && newEndMins > aptStartMins);
      });
      
      if (conflictingAppointments.length > 0) {
        return res.status(400).json({ 
          error: "This time slot is already booked. Please choose a different time." 
        });
      }
      
      // Create the appointment
      const appointment = await storage.createAppointment({
        doctorId,
        patientId,
        date: appointmentDate,
        duration: appointmentDuration,
        service,
        notes: notes || null,
        source: source || "admin",
        status: "scheduled",
      });
      
      // Sync to Google Calendar if doctor has it connected
      try {
        const doctor = await storage.getDoctorById(doctorId);
        if (doctor?.googleRefreshToken) {
          const patient = await storage.getPatientById(patientId);
          const formatLocalDate = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
          const dateStr = formatLocalDate(appointmentDate);
          const timeStr = `${String(appointmentDate.getHours()).padStart(2, "0")}:${String(appointmentDate.getMinutes()).padStart(2, "0")}`;
          
          const event = await createCalendarEvent(
            doctor.googleRefreshToken,
            doctor.googleCalendarId || "primary",
            {
              patientName: patient?.name || "Unknown Patient",
              doctorName: doctor.name,
              date: dateStr,
              time: timeStr,
              service: service || "Dental Appointment",
              notes: notes || undefined,
              duration: appointmentDuration,
            },
            "Europe/Amsterdam"
          );
          
          // Update appointment with Google Event ID
          await storage.updateAppointment(appointment.id, {
            googleEventId: event.id,
          });
          console.log("Created Google Calendar event for appointment:", appointment.id);
        }
      } catch (calendarError) {
        console.error("Failed to sync to Google Calendar:", calendarError);
        // Don't fail the appointment creation, just log the error
      }
      
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

  async function determineQuickReplies(
    message: string,
    aiResponse: string,
    conversationHistory: { role: string; content: string }[],
    language: string,
  ): Promise<{ label: string; value: string }[]> {
    const lowerResponse = aiResponse.toLowerCase();
    const lowerMessage = message.toLowerCase();
    const allMessages = [...conversationHistory.map(m => m.content.toLowerCase()), lowerMessage, lowerResponse];
    const fullConversation = allMessages.join(" ");

    const settings = await storage.getClinicSettings();
    const doctors = await storage.getDoctors();
    const activeDoctors = doctors.filter((d) => d.isActive);
    const services = settings?.services || ["General Checkup", "Teeth Cleaning"];

    const hasBookingIntent = fullConversation.includes("book") || fullConversation.includes("appointment") || fullConversation.includes("afspraak") || fullConversation.includes("boek");
    const hasSelectedService = services.some(s => fullConversation.includes(s.toLowerCase()));
    const hasSelectedDoctor = activeDoctors.some(d => fullConversation.includes(d.name.toLowerCase()));

    const isAskingService = lowerResponse.includes("service") || lowerResponse.includes("treatment") || lowerResponse.includes("dienst") || lowerResponse.includes("behandeling") || lowerResponse.includes("which type") || lowerResponse.includes("what type") || lowerResponse.includes("welke soort");
    const isAskingDoctor = lowerResponse.includes("dentist") || lowerResponse.includes("doctor") || (lowerResponse.includes("tandarts") && !lowerResponse.includes("tandartskliniek")) || lowerResponse.includes("prefer") || lowerResponse.includes("voorkeur");
    const isAskingDate = lowerResponse.includes("when") || lowerResponse.includes("which day") || lowerResponse.includes("what day") || lowerResponse.includes("wanneer") || lowerResponse.includes("welke dag") || lowerResponse.includes("which date") || lowerResponse.includes("what date");
    const isAskingTime = lowerResponse.includes("time slot") || lowerResponse.includes("which time") || lowerResponse.includes("what time") || lowerResponse.includes("tijdslot") || lowerResponse.includes("welk tijdstip") || lowerResponse.includes("available slot");
    const isAskingConfirmation = lowerResponse.includes("confirm") || lowerResponse.includes("shall i") || lowerResponse.includes("should i") || lowerResponse.includes("would you like me to book") || lowerResponse.includes("bevestig") || lowerResponse.includes("zal ik");
    const isBookingComplete = lowerResponse.includes("booked") || lowerResponse.includes("confirmed") || lowerResponse.includes("geboekt") || lowerResponse.includes("bevestigd");
    const isGreeting = (lowerResponse.includes("how can i help") || lowerResponse.includes("hoe kan ik") || lowerResponse.includes("what can i") || lowerResponse.includes("welcome")) && conversationHistory.length <= 2;

    if (isBookingComplete) {
      return language === "nl"
        ? [
            { label: "Nieuwe afspraak maken", value: "Ik wil nog een afspraak maken" },
            { label: "Andere vraag", value: "Ik heb een andere vraag" },
          ]
        : [
            { label: "Book another appointment", value: "I would like to book another appointment" },
            { label: "Other question", value: "I have another question" },
          ];
    }

    if (isGreeting) {
      return language === "nl"
        ? [
            { label: "Afspraak maken", value: "Ik wil een afspraak maken" },
            { label: "Afspraak verzetten", value: "Ik wil mijn afspraak verzetten" },
            { label: "Afspraak annuleren", value: "Ik wil mijn afspraak annuleren" },
            { label: "Andere vraag", value: "Ik heb een andere vraag" },
          ]
        : [
            { label: "Book an appointment", value: "I would like to book an appointment" },
            { label: "Reschedule appointment", value: "I want to reschedule my appointment" },
            { label: "Cancel appointment", value: "I want to cancel my appointment" },
            { label: "Other question", value: "I have another question" },
          ];
    }

    if (isAskingConfirmation) {
      return language === "nl"
        ? [
            { label: "Ja, bevestig", value: "Ja, bevestig mijn afspraak alstublieft" },
            { label: "Nee, wijzig", value: "Nee, ik wil iets wijzigen" },
          ]
        : [
            { label: "Yes, confirm", value: "Yes, please confirm my appointment" },
            { label: "No, change something", value: "No, I want to change something" },
          ];
    }

    if (isAskingService && hasBookingIntent) {
      return services.map(s => ({
        label: s,
        value: language === "nl" ? `Ik wil graag ${s}` : `I would like ${s}`,
      }));
    }

    if (isAskingDoctor && hasBookingIntent) {
      return activeDoctors.map(d => ({
        label: `Dr. ${d.name}`,
        value: language === "nl" ? `Ik wil graag bij Dr. ${d.name}` : `I'd like Dr. ${d.name}`,
      }));
    }

    if (isAskingDate && hasBookingIntent) {
      const now = new Date();
      const options: { label: string; value: string }[] = [];
      const dayNamesEN = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
      const dayNamesNL = ["Zondag", "Maandag", "Dinsdag", "Woensdag", "Donderdag", "Vrijdag", "Zaterdag"];
      const workingDays = settings?.workingDays || [1, 2, 3, 4, 5, 6];

      for (let i = 0; i < 14 && options.length < 4; i++) {
        const d = new Date(now);
        d.setDate(d.getDate() + i);
        if (!workingDays.includes(d.getDay())) continue;
        const dateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
        const dayName = language === "nl" ? dayNamesNL[d.getDay()] : dayNamesEN[d.getDay()];
        const label = i === 0
          ? (language === "nl" ? `Vandaag (${dayName})` : `Today (${dayName})`)
          : i === 1
          ? (language === "nl" ? `Morgen (${dayName})` : `Tomorrow (${dayName})`)
          : `${dayName} ${dateStr}`;
        options.push({ label, value: dateStr });
      }
      return options;
    }

    if (hasBookingIntent) {
      const timeSlotMatch = aiResponse.match(/\b(\d{1,2}:\d{2})\b/g);
      if (timeSlotMatch && timeSlotMatch.length >= 1) {
        const uniqueSlots = [...new Set(timeSlotMatch)];
        return uniqueSlots.slice(0, 6).map(t => ({
          label: t,
          value: t,
        }));
      }
    }

    return [];
  }

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

    // Try requested day first, then next 7 days
    for (
      let dayOffset = 0;
      dayOffset <= 7 && availableSlots.length < 3;
      dayOffset++
    ) {
      const checkDate = new Date(requestedDate);
      checkDate.setDate(checkDate.getDate() + dayOffset);
      // Use local date string to avoid timezone issues
      const dateStr = `${checkDate.getFullYear()}-${String(checkDate.getMonth() + 1).padStart(2, '0')}-${String(checkDate.getDate()).padStart(2, '0')}`;
      const dayOfWeek = checkDate.getDay();

      // Skip non-working days
      if (!workingDays.includes(dayOfWeek)) continue;

      // Get doctor's date-specific unavailability
      const dateUnavailability = await storage.getDoctorAvailabilityForDate(doctorId, dateStr);

      // Get appointments for this specific day
      const dayAppointments = existingAppointments.filter((apt) => {
        if (apt.status === "cancelled") return false;
        const aptDate = new Date(apt.date);
        // Use local date string to avoid timezone issues
        const aptDateLocalStr = `${aptDate.getFullYear()}-${String(aptDate.getMonth() + 1).padStart(2, '0')}-${String(aptDate.getDate()).padStart(2, '0')}`;
        return aptDateLocalStr === dateStr;
      });

      // Check each time slot
      for (
        let minutes = openMinutes;
        minutes + duration <= closeMinutes && availableSlots.length < 3;
        minutes += slotInterval
      ) {
        const slotStart = minutes;
        const slotEnd = minutes + duration;

        // Check if slot overlaps with any blocked time for this date
        let isBlocked = false;
        for (const block of dateUnavailability) {
          if (!block.isAvailable) {
            const [blockStartH, blockStartM] = block.startTime.split(":").map(Number);
            const [blockEndH, blockEndM] = block.endTime.split(":").map(Number);
            const blockStart = blockStartH * 60 + blockStartM;
            const blockEnd = blockEndH * 60 + blockEndM;
            
            if (slotStart < blockEnd && slotEnd > blockStart) {
              isBlocked = true;
              break;
            }
          }
        }
        if (isBlocked) continue;

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
      // Helper to format date as local YYYY-MM-DD
      const formatLocalDate = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      const today = formatLocalDate(now);
      const tomorrow = new Date(now);
      tomorrow.setDate(tomorrow.getDate() + 1);
      const dayAfterTomorrow = new Date(now);
      dayAfterTomorrow.setDate(dayAfterTomorrow.getDate() + 2);
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
- "morgen" = ${formatLocalDate(tomorrow)}
- "overmorgen" = ${formatLocalDate(dayAfterTomorrow)}
- Bereken dagnamen naar exacte datums. Boek NOOIT in het verleden.

KLINIEKINFO:
Diensten: ${services.join(", ")}
Tandartsen: ${activeDoctors.map((d) => `Dr. ${d.name} (ID: ${d.id}, ${d.specialty})`).join("; ") || "Neem contact op"}
Open: ${settings?.openTime || "09:00"} - ${settings?.closeTime || "17:00"}, ma-za

BELANGRIJK - BESCHIKBAARHEID CONTROLEREN:
- Roep ALTIJD check_availability aan voordat je een patient vertelt wanneer een tandarts beschikbaar is
- Gis NOOIT beschikbaarheid op basis van openingstijden - tandartsen kunnen tijdsloten geblokkeerd hebben
- Als iemand vraagt "is Dr X beschikbaar op [datum]?" - roep eerst check_availability aan

BOEKINGSSTROOM (volg deze volgorde STRIKT):
1. Begroet vriendelijk en vraag hoe je kunt helpen
2. Bij afspraakverzoek: noem de diensten en vraag welke ze nodig hebben
3. Beveel een geschikte tandarts aan op basis van hun keuze
4. Vraag wanneer ze willen komen
5. Roep check_availability aan om beschikbare tijdsloten te krijgen - bevestig of bied alternatieven
6. Vraag naar hun volledige naam (VERPLICHT voor boeking)
7. Vraag naar hun telefoonnummer (VERPLICHT voor boeking)
8. Vraag optioneel naar e-mail
9. Vat alle details samen en vraag bevestiging
10. Roep ALLEEN book_appointment aan nadat je naam EN telefoon hebt - NOOIT placeholders gebruiken

KRITIEK: Boek nooit zonder echte naam en telefoonnummer. Als ze deze niet hebben gegeven, VRAAG ernaar.

STIJLREGELS:
- Praat natuurlijk, niet als een robot. Varieer je bewoordingen.
- Eén vraag per keer
- Vraag pas laat in het gesprek om contactgegevens
- Geen emoji's, geen opmaak (geen **vet** of *cursief*)
- Houd het kort - max 2-3 zinnen per antwoord
- Wees behulpzaam en professioneel maar warm
- De chatinterface toont automatisch klikbare keuzetoetsen. Je hoeft de opties NIET in je tekst op te sommen. Stel gewoon de vraag natuurlijk (bijv. "Welke behandeling wilt u?" of "Bij welke tandarts wilt u?") en het systeem toont de juiste knoppen. GEEN genummerde of opsommingslijsten in je tekst.`
          : `You are a warm, helpful receptionist for ${settings?.clinicName || "the dental clinic"}. 
Talk naturally like a real person who genuinely wants to help. Be concise but friendly.

DATE CONTEXT:
- Today: ${dayNames[currentDayOfWeek]}, ${today}
- "tomorrow" = ${formatLocalDate(tomorrow)}
- "day after tomorrow" = ${formatLocalDate(dayAfterTomorrow)}
- Convert day names to exact dates. NEVER book in the past.

CLINIC INFO:
Services: ${services.join(", ")}
Dentists: ${activeDoctors.map((d) => `Dr. ${d.name} (ID: ${d.id}, ${d.specialty})`).join("; ") || "Contact us"}
Hours: ${settings?.openTime || "09:00"} - ${settings?.closeTime || "17:00"}, Mon-Sat

IMPORTANT - AVAILABILITY CHECKING:
- ALWAYS call check_availability before telling a patient when a doctor is available
- NEVER guess availability based on clinic hours - doctors may have blocked time slots
- When someone asks "is Dr X available on [date]?" - call check_availability first

BOOKING FLOW (follow this order STRICTLY):
1. Greet warmly and ask how you can help
2. When they want to book: mention services and ask which they need
3. Recommend a suitable dentist based on their choice
4. Ask when they would like to come in
5. Call check_availability to get actual available slots - then confirm or offer alternatives
6. Ask for their full name (REQUIRED before booking)
7. Ask for their phone number (REQUIRED before booking)
8. Optionally ask for email
9. Summarize all details and ask for confirmation
10. ONLY call book_appointment after you have collected name AND phone - NEVER use placeholders

CRITICAL: Never book without real patient name and phone number. If they haven't provided these, ASK for them.

STYLE RULES:
- Talk naturally, not robotic. Vary your wording each time.
- One question at a time
- Only ask for contact details late in the conversation
- No emojis, no formatting (no **bold** or *italic*)
- Keep it short - max 2-3 sentences per response
- Be helpful and professional but warm
- The chat interface shows clickable option buttons automatically. You do NOT need to list options in your text. Just ask the question naturally (e.g. "Which service would you like?" or "Which dentist do you prefer?") and the system will show the right buttons. Do NOT number or bullet-list options in your text.`;

      // Build conversation history
      const conversationHistory = previousMessages.slice(-10).map((m) => ({
        role: m.role as "user" | "assistant",
        content: m.content,
      }));

      // Define the check_availability function for OpenAI
      const checkAvailabilityFunction = {
        type: "function" as const,
        function: {
          name: "check_availability",
          description:
            "Check if a doctor is available on a specific date. ALWAYS call this function before telling a patient about availability or before booking. This returns the actual available time slots.",
          parameters: {
            type: "object",
            properties: {
              doctorId: {
                type: "number",
                description: "ID of the doctor to check",
              },
              date: {
                type: "string",
                description: "Date to check in YYYY-MM-DD format",
              },
            },
            required: ["doctorId", "date"],
          },
        },
      };

      // Define the booking function for OpenAI
      const bookingFunction = {
        type: "function" as const,
        function: {
          name: "book_appointment",
          description:
            "Book a dental appointment ONLY after collecting ALL required information from the patient. DO NOT call this function until you have explicitly asked for and received: 1) patient's REAL full name (first and last), 2) patient's REAL phone number, 3) preferred service, 4) preferred date and time. NEVER use placeholder values like 'pending' or 'unknown'. If any information is missing, ask for it first instead of calling this function.",
          parameters: {
            type: "object",
            properties: {
              patientName: {
                type: "string",
                description: "Patient's REAL full name (first and last name) - NEVER use placeholder like 'pending'",
              },
              patientPhone: {
                type: "string",
                description: "Patient's REAL phone number - NEVER use placeholder like 'unknown'",
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

      // Helper function to get available slots for a doctor on a date
      async function getAvailableSlotsForDate(doctorId: number, dateStr: string): Promise<{ available: boolean; slots: string[]; blockedPeriods: string[] }> {
        const openTime = settings?.openTime || "09:00";
        const closeTime = settings?.closeTime || "17:00";
        const [openHour, openMin] = openTime.split(":").map(Number);
        const [closeHour, closeMin] = closeTime.split(":").map(Number);
        const openMinutes = openHour * 60 + openMin;
        const closeMinutes = closeHour * 60 + closeMin;
        const duration = settings?.appointmentDuration || 30;

        // Get blocked periods for this date
        const doctorUnavailability = await storage.getDoctorAvailabilityForDate(doctorId, dateStr);
        const blockedPeriods: string[] = [];
        const blockedRanges: { start: number; end: number }[] = [];
        
        for (const block of doctorUnavailability) {
          if (!block.isAvailable) {
            blockedPeriods.push(`${block.startTime} - ${block.endTime}`);
            const [startH, startM] = block.startTime.split(":").map(Number);
            const [endH, endM] = block.endTime.split(":").map(Number);
            blockedRanges.push({ start: startH * 60 + startM, end: endH * 60 + endM });
          }
        }

        // Get existing appointments for this doctor on this date
        const allAppointments = await storage.getAppointmentsByDoctorId(doctorId);
        const checkDateStart = new Date(`${dateStr}T00:00:00`);
        const checkDateEnd = new Date(`${dateStr}T23:59:59`);
        const bookedRanges: { start: number; end: number }[] = [];

        for (const apt of allAppointments) {
          if (apt.status === "cancelled") continue;
          const aptDate = new Date(apt.date);
          if (aptDate >= checkDateStart && aptDate <= checkDateEnd) {
            const aptMinutes = aptDate.getHours() * 60 + aptDate.getMinutes();
            bookedRanges.push({ start: aptMinutes, end: aptMinutes + apt.duration });
          }
        }

        // Find available slots
        const availableSlots: string[] = [];
        for (let time = openMinutes; time + duration <= closeMinutes; time += 30) {
          const slotEnd = time + duration;
          
          // Check if slot overlaps with any blocked period
          const isBlocked = blockedRanges.some(range => time < range.end && slotEnd > range.start);
          if (isBlocked) continue;

          // Check if slot overlaps with any existing appointment
          const isBooked = bookedRanges.some(range => time < range.end && slotEnd > range.start);
          if (isBooked) continue;

          const hours = Math.floor(time / 60);
          const mins = time % 60;
          availableSlots.push(`${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}`);
        }

        return {
          available: availableSlots.length > 0,
          slots: availableSlots,
          blockedPeriods,
        };
      }

      // Set streaming headers early
      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");

      // First call: Check if AI wants to check availability or book
      let currentMessages: any[] = [
        { role: "system", content: systemPrompt },
        ...conversationHistory,
        { role: "user", content: message },
      ];
      
      let initialResponse = await openai.chat.completions.create({
        model: "gpt-4o",
        messages: currentMessages,
        tools: [checkAvailabilityFunction, bookingFunction],
        tool_choice: "auto",
      });

      let responseMessage = initialResponse.choices[0]?.message;
      let fullResponse = "";
      let bookingResult = null;

      // Handle check_availability function call first (if any)
      if (
        responseMessage?.tool_calls &&
        responseMessage.tool_calls.length > 0 &&
        responseMessage.tool_calls[0]?.function?.name === "check_availability"
      ) {
        const checkToolCall = responseMessage.tool_calls[0] as {
          id: string;
          function: { name: string; arguments: string };
        };
        
        try {
          const checkData = JSON.parse(checkToolCall.function.arguments);
          console.log("Checking availability:", checkData);
          
          const availability = await getAvailableSlotsForDate(checkData.doctorId, checkData.date);
          const doctor = activeDoctors.find(d => d.id === checkData.doctorId);
          const doctorName = doctor?.name || "the doctor";
          
          let availabilityInfo = "";
          if (availability.blockedPeriods.length > 0) {
            availabilityInfo = `Dr. ${doctorName} is NOT available during: ${availability.blockedPeriods.join(", ")} on ${checkData.date}. `;
          }
          if (availability.available) {
            availabilityInfo += `Available time slots: ${availability.slots.join(", ")}.`;
          } else {
            availabilityInfo += `No available slots on ${checkData.date}.`;
          }
          
          // Add tool result and get final response
          currentMessages.push(responseMessage);
          currentMessages.push({
            role: "tool",
            tool_call_id: checkToolCall.id,
            content: availabilityInfo,
          });
          
          // Get the AI's response based on availability data
          const followUpResponse = await openai.chat.completions.create({
            model: "gpt-4o",
            messages: currentMessages,
            tools: [checkAvailabilityFunction, bookingFunction],
            tool_choice: "auto",
          });
          
          responseMessage = followUpResponse.choices[0]?.message;
        } catch (e) {
          console.error("Error checking availability:", e);
        }
      }

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

            // CRITICAL: Validate patient information is real, not placeholder
            const invalidNames = ["pending", "unknown", "test", "user", "patient", "name", "n/a", "na", "tbd", "to be determined"];
            const patientName = (bookingData.patientName || "").trim().toLowerCase();
            const patientPhone = (bookingData.patientPhone || "").trim();
            
            // Check for invalid/placeholder names
            if (!bookingData.patientName || patientName.length < 2) {
              throw new Error("MISSING_INFO: I need your full name to book the appointment. What is your name?");
            }
            
            const nameParts = patientName.split(/\s+/);
            if (nameParts.some(part => invalidNames.includes(part)) || 
                (nameParts.length >= 2 && nameParts[0] === nameParts[1])) {
              throw new Error("MISSING_INFO: I need your real full name to book the appointment. Could you please tell me your name?");
            }
            
            // Check for invalid/placeholder phone numbers
            if (!patientPhone || patientPhone.length < 6) {
              throw new Error("MISSING_INFO: I need your phone number to book the appointment. What is your phone number?");
            }
            
            const invalidPhones = ["0000000", "1234567", "pending", "unknown", "test", "n/a", "na", "tbd"];
            if (invalidPhones.some(p => patientPhone.toLowerCase().includes(p))) {
              throw new Error("MISSING_INFO: I need a valid phone number to book the appointment. What is your phone number?");
            }

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

            // Check doctor's date-specific unavailability
            const doctorUnavailability = await storage.getDoctorAvailabilityForDate(bookingData.doctorId, bookingData.date);
            
            for (const block of doctorUnavailability) {
              if (!block.isAvailable) {
                const [blockStartH, blockStartM] = block.startTime.split(":").map(Number);
                const [blockEndH, blockEndM] = block.endTime.split(":").map(Number);
                const blockStart = blockStartH * 60 + blockStartM;
                const blockEnd = blockEndH * 60 + blockEndM;
                
                // Check if requested time overlaps with blocked time
                if (requestedMinutes < blockEnd && appointmentEndMinutes > blockStart) {
                  throw new Error(
                    `SLOT_UNAVAILABLE: ${bookingData.doctorName} is not available on ${bookingData.date} from ${block.startTime.slice(0, 5)} to ${block.endTime.slice(0, 5)}${block.reason ? ` (${block.reason})` : ''}.`,
                  );
                }
              }
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

            // Sync to Google Calendar if doctor has it connected
            try {
              const doctor = await storage.getDoctorById(bookingData.doctorId);
              if (doctor?.googleRefreshToken) {
                const event = await createCalendarEvent(
                  doctor.googleRefreshToken,
                  doctor.googleCalendarId || "primary",
                  {
                    patientName: bookingData.patientName,
                    doctorName: doctor.name,
                    date: bookingData.date,
                    time: bookingData.time,
                    service: bookingData.service || "Dental Appointment",
                    notes: bookingData.notes || undefined,
                    duration: appointmentDuration,
                  },
                  "Europe/Amsterdam"
                );
                
                // Update appointment with Google Event ID
                await storage.updateAppointment(appointment.id, {
                  googleEventId: event.id,
                });
                console.log("Created Google Calendar event for chat appointment:", appointment.id);
              }
            } catch (calendarError) {
              console.error("Failed to sync chat appointment to Google Calendar:", calendarError);
              // Don't fail the booking, just log the error
            }

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

            const confirmationContent =
              confirmationResponse.choices[0]?.message?.content ||
              (language === "nl"
                ? `Uw afspraak is geboekt! Afspraak voor ${bookingData.service} met Dr. ${bookingData.doctorName} op ${bookingData.date} om ${bookingData.time}.`
                : `Your appointment is booked! Appointment for ${bookingData.service} with Dr. ${bookingData.doctorName} on ${bookingData.date} at ${bookingData.time}.`);
            
            // Stream the confirmation message with typing effect
            const chunkSize = 3;
            for (let i = 0; i < confirmationContent.length; i += chunkSize) {
              const chunk = confirmationContent.slice(i, i + chunkSize);
              res.write(`data: ${JSON.stringify({ content: chunk })}\n\n`);
              await new Promise(resolve => setTimeout(resolve, 15));
            }
            fullResponse = confirmationContent;
            
            // Store assistant response
            await storage.createChatMessage({
              sessionId,
              role: "assistant",
              content: fullResponse,
            });
          } catch (bookingError: any) {
            console.error("Booking error:", bookingError);

            // Check if it's a slot unavailability error with alternatives
            let errorMessage = "";
            if (
              bookingError.message?.startsWith(
                "SLOT_UNAVAILABLE_WITH_ALTERNATIVES:",
              )
            ) {
              const reason = bookingError.message.replace(
                "SLOT_UNAVAILABLE_WITH_ALTERNATIVES: ",
                "",
              );
              errorMessage =
                language === "nl"
                  ? `Sorry, dit tijdslot is al geboekt. ${reason}. Wilt u een van deze tijden boeken?`
                  : `Sorry, this time slot is already booked. ${reason}. Would you like to book one of these times?`;
            } else if (bookingError.message?.startsWith("SLOT_UNAVAILABLE:")) {
              const reason = bookingError.message.replace(
                "SLOT_UNAVAILABLE: ",
                "",
              );
              errorMessage =
                language === "nl"
                  ? `Sorry, dit tijdslot is niet beschikbaar. ${reason} Kies alstublieft een ander tijdstip.`
                  : `Sorry, this time slot is not available. ${reason} Please choose a different time.`;
            } else {
              errorMessage =
                language === "nl"
                  ? "Er is een fout opgetreden bij het boeken. Probeer het opnieuw."
                  : "There was an error booking your appointment. Please try again.";
            }
            
            // Stream the error message with typing effect
            const chunkSize = 3;
            for (let i = 0; i < errorMessage.length; i += chunkSize) {
              const chunk = errorMessage.slice(i, i + chunkSize);
              res.write(`data: ${JSON.stringify({ content: chunk })}\n\n`);
              await new Promise(resolve => setTimeout(resolve, 15));
            }
            fullResponse = errorMessage;
            
            // Store error response
            await storage.createChatMessage({
              sessionId,
              role: "assistant",
              content: fullResponse,
            });
          }
        }
      } else {
        // No function call - stream the response character by character for a typing effect
        const content = responseMessage?.content || "";
        if (content) {
          // Stream in small chunks for typing effect
          const chunkSize = 3; // characters per chunk
          for (let i = 0; i < content.length; i += chunkSize) {
            const chunk = content.slice(i, i + chunkSize);
            res.write(`data: ${JSON.stringify({ content: chunk })}\n\n`);
            // Small delay between chunks for natural typing feel (non-blocking)
            await new Promise(resolve => setTimeout(resolve, 15));
          }
          fullResponse = content;
          
          // Store assistant response
          await storage.createChatMessage({
            sessionId,
            role: "assistant",
            content: fullResponse,
          });
        }
      }

      // Send booking result if available
      if (bookingResult) {
        res.write(`data: ${JSON.stringify({ booking: bookingResult })}\n\n`);
      }

      // Determine and send quick reply options
      try {
        const quickReplies = await determineQuickReplies(
          message,
          fullResponse,
          conversationHistory,
          language,
        );
        if (quickReplies.length > 0) {
          res.write(`data: ${JSON.stringify({ quickReplies })}\n\n`);
        }
      } catch (qrError) {
        console.error("Error determining quick replies:", qrError);
      }

      res.write("data: [DONE]\n\n");
      res.end();
    } catch (error) {
      console.error("Error processing chat message:", error);
      res.status(500).json({ error: "Failed to process message" });
    }
  });

  // Non-streaming chat endpoint for WhatsApp/external integrations
  app.post("/api/chat/message-simple", async (req, res) => {
    try {
      const { sessionId, message, language = "en" } = req.body;

      if (!sessionId || !message) {
        return res.status(400).json({ error: "Session ID and message required" });
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
      const services = settings?.services || ["General Checkup", "Teeth Cleaning"];
      const now = new Date();
      const formatLocalDate = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      const today = formatLocalDate(now);
      const tomorrow = new Date(now);
      tomorrow.setDate(tomorrow.getDate() + 1);
      const dayAfterTomorrow = new Date(now);
      dayAfterTomorrow.setDate(dayAfterTomorrow.getDate() + 2);
      const dayNames = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
      const currentDayOfWeek = now.getDay();

      const systemPrompt = language === "nl"
        ? `Je bent een warme, behulpzame receptionist voor ${settings?.clinicName || "de tandartskliniek"}. 
Praat natuurlijk. Wees beknopt maar vriendelijk.

DATUMCONTEXT:
- Vandaag: ${today}
- "morgen" = ${formatLocalDate(tomorrow)}

KLINIEKINFO:
Diensten: ${services.join(", ")}
Tandartsen: ${activeDoctors.map((d) => `Dr. ${d.name} (ID: ${d.id})`).join("; ") || "Neem contact op"}
Open: ${settings?.openTime || "09:00"} - ${settings?.closeTime || "17:00"}

BELANGRIJK - BESCHIKBAARHEID:
- Roep ALTIJD check_availability aan voordat je beschikbaarheid noemt
- Gis NOOIT beschikbaarheid op basis van openingstijden

STIJLREGELS:
- Geen emoji's, geen opmaak
- Kort en bondig`
        : `You are a warm, helpful receptionist for ${settings?.clinicName || "the dental clinic"}. 
Talk naturally. Be concise but friendly.

DATE CONTEXT:
- Today: ${dayNames[currentDayOfWeek]}, ${today}
- "tomorrow" = ${formatLocalDate(tomorrow)}

CLINIC INFO:
Services: ${services.join(", ")}
Dentists: ${activeDoctors.map((d) => `Dr. ${d.name} (ID: ${d.id})`).join("; ") || "Contact us"}
Hours: ${settings?.openTime || "09:00"} - ${settings?.closeTime || "17:00"}

IMPORTANT - AVAILABILITY:
- ALWAYS call check_availability before mentioning when a doctor is available
- NEVER guess availability based on clinic hours

STYLE RULES:
- No emojis, no markdown formatting
- Keep responses short`;

      const conversationHistory = previousMessages
        .slice(-10)
        .map((m) => ({ role: m.role as "user" | "assistant", content: m.content }));

      // Check availability function definition
      const checkAvailabilityFn = {
        type: "function" as const,
        function: {
          name: "check_availability",
          description: "Check if a doctor is available on a specific date. ALWAYS call this before telling a patient about availability.",
          parameters: {
            type: "object",
            properties: {
              doctorId: { type: "number", description: "ID of the doctor to check" },
              date: { type: "string", description: "Date in YYYY-MM-DD format" },
            },
            required: ["doctorId", "date"],
          },
        },
      };

      // Booking function definition
      const bookingFunction = {
        type: "function" as const,
        function: {
          name: "book_appointment",
          description: "Book a dental appointment for a patient.",
          parameters: {
            type: "object",
            properties: {
              patientName: { type: "string" },
              patientPhone: { type: "string" },
              patientEmail: { type: "string" },
              service: { type: "string" },
              doctorId: { type: "number" },
              doctorName: { type: "string" },
              date: { type: "string", description: "YYYY-MM-DD format" },
              time: { type: "string", description: "HH:MM format" },
              notes: { type: "string" },
            },
            required: ["patientName", "patientPhone", "service", "doctorId", "date", "time"],
          },
        },
      };

      // Helper function to get available slots
      async function getAvailableSlotsSimple(doctorId: number, dateStr: string): Promise<{ available: boolean; slots: string[]; blockedPeriods: string[] }> {
        const openTime = settings?.openTime || "09:00";
        const closeTime = settings?.closeTime || "17:00";
        const [openHour, openMin] = openTime.split(":").map(Number);
        const [closeHour, closeMin] = closeTime.split(":").map(Number);
        const openMinutes = openHour * 60 + openMin;
        const closeMinutes = closeHour * 60 + closeMin;
        const duration = settings?.appointmentDuration || 30;

        const doctorUnavailability = await storage.getDoctorAvailabilityForDate(doctorId, dateStr);
        const blockedPeriods: string[] = [];
        const blockedRanges: { start: number; end: number }[] = [];
        
        for (const block of doctorUnavailability) {
          if (!block.isAvailable) {
            blockedPeriods.push(`${block.startTime} - ${block.endTime}`);
            const [startH, startM] = block.startTime.split(":").map(Number);
            const [endH, endM] = block.endTime.split(":").map(Number);
            blockedRanges.push({ start: startH * 60 + startM, end: endH * 60 + endM });
          }
        }

        const allAppointments = await storage.getAppointmentsByDoctorId(doctorId);
        const checkDateStart = new Date(`${dateStr}T00:00:00`);
        const checkDateEnd = new Date(`${dateStr}T23:59:59`);
        const bookedRanges: { start: number; end: number }[] = [];

        for (const apt of allAppointments) {
          if (apt.status === "cancelled") continue;
          const aptDate = new Date(apt.date);
          if (aptDate >= checkDateStart && aptDate <= checkDateEnd) {
            const aptMinutes = aptDate.getHours() * 60 + aptDate.getMinutes();
            bookedRanges.push({ start: aptMinutes, end: aptMinutes + apt.duration });
          }
        }

        const availableSlots: string[] = [];
        for (let time = openMinutes; time + duration <= closeMinutes; time += 30) {
          const slotEnd = time + duration;
          const isBlocked = blockedRanges.some(range => time < range.end && slotEnd > range.start);
          if (isBlocked) continue;
          const isBooked = bookedRanges.some(range => time < range.end && slotEnd > range.start);
          if (isBooked) continue;
          const hours = Math.floor(time / 60);
          const mins = time % 60;
          availableSlots.push(`${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}`);
        }

        return { available: availableSlots.length > 0, slots: availableSlots, blockedPeriods };
      }

      let currentMessages: any[] = [
        { role: "system", content: systemPrompt },
        ...conversationHistory,
        { role: "user", content: message },
      ];

      let initialResponse = await openai.chat.completions.create({
        model: "gpt-4o",
        messages: currentMessages,
        tools: [checkAvailabilityFn, bookingFunction],
        tool_choice: "auto",
      });

      let responseMessage = initialResponse.choices[0]?.message;
      let fullResponse = "";
      let bookingResult = null;

      // Handle check_availability function call first
      if (responseMessage?.tool_calls && responseMessage.tool_calls.length > 0 &&
          responseMessage.tool_calls[0]?.function?.name === "check_availability") {
        const checkToolCall = responseMessage.tool_calls[0] as { id: string; function: { name: string; arguments: string } };
        
        try {
          const checkData = JSON.parse(checkToolCall.function.arguments);
          const availability = await getAvailableSlotsSimple(checkData.doctorId, checkData.date);
          const doctor = activeDoctors.find(d => d.id === checkData.doctorId);
          const doctorName = doctor?.name || "the doctor";
          
          let availabilityInfo = "";
          if (availability.blockedPeriods.length > 0) {
            availabilityInfo = `Dr. ${doctorName} is NOT available during: ${availability.blockedPeriods.join(", ")} on ${checkData.date}. `;
          }
          if (availability.available) {
            availabilityInfo += `Available time slots: ${availability.slots.join(", ")}.`;
          } else {
            availabilityInfo += `No available slots on ${checkData.date}.`;
          }
          
          currentMessages.push(responseMessage);
          currentMessages.push({ role: "tool", tool_call_id: checkToolCall.id, content: availabilityInfo });
          
          const followUpResponse = await openai.chat.completions.create({
            model: "gpt-4o",
            messages: currentMessages,
            tools: [checkAvailabilityFn, bookingFunction],
            tool_choice: "auto",
          });
          
          responseMessage = followUpResponse.choices[0]?.message;
        } catch (e) {
          console.error("Error checking availability:", e);
        }
      }

      if (responseMessage?.tool_calls && responseMessage.tool_calls.length > 0) {
        const toolCall = responseMessage.tool_calls[0] as { id: string; function: { name: string; arguments: string } };
        
        if (toolCall.function?.name === "book_appointment") {
          try {
            const bookingData = JSON.parse(toolCall.function.arguments);

            // CRITICAL: Validate patient information is real, not placeholder
            const invalidNames = ["pending", "unknown", "test", "user", "patient", "name", "n/a", "na", "tbd", "to be determined"];
            const patientNameLower = (bookingData.patientName || "").trim().toLowerCase();
            const patientPhoneVal = (bookingData.patientPhone || "").trim();
            
            if (!bookingData.patientName || patientNameLower.length < 2) {
              throw new Error("MISSING_INFO: I need your full name to book the appointment. What is your name?");
            }
            
            const namePartsCheck = patientNameLower.split(/\s+/);
            if (namePartsCheck.some(part => invalidNames.includes(part)) || 
                (namePartsCheck.length >= 2 && namePartsCheck[0] === namePartsCheck[1])) {
              throw new Error("MISSING_INFO: I need your real full name to book the appointment. Could you please tell me your name?");
            }
            
            if (!patientPhoneVal || patientPhoneVal.length < 6) {
              throw new Error("MISSING_INFO: I need your phone number to book the appointment. What is your phone number?");
            }
            
            const invalidPhonesCheck = ["0000000", "1234567", "pending", "unknown", "test", "n/a", "na", "tbd"];
            if (invalidPhonesCheck.some(p => patientPhoneVal.toLowerCase().includes(p))) {
              throw new Error("MISSING_INFO: I need a valid phone number to book the appointment. What is your phone number?");
            }

            const appointmentDateTime = new Date(`${bookingData.date}T${bookingData.time}:00`);
            const appointmentDuration = settings?.appointmentDuration || 30;

            // Check availability and conflicts (simplified)
            const existingAppointments = await storage.getAppointmentsByDoctorId(bookingData.doctorId);
            const hasConflict = existingAppointments.some((apt) => {
              if (apt.status === "cancelled") return false;
              const aptStart = new Date(apt.date).getTime();
              const aptEnd = aptStart + apt.duration * 60 * 1000;
              const newStart = appointmentDateTime.getTime();
              const newEnd = newStart + appointmentDuration * 60 * 1000;
              return newStart < aptEnd && newEnd > aptStart;
            });

            if (hasConflict) {
              fullResponse = language === "nl"
                ? "Sorry, dit tijdslot is al geboekt. Kies alstublieft een ander tijdstip."
                : "Sorry, this time slot is already booked. Please choose a different time.";
            } else {
              // Create patient and appointment
              let patient = await storage.getPatientByPhone(bookingData.patientPhone);
              if (!patient) {
                patient = await storage.createPatient({
                  name: bookingData.patientName,
                  phone: bookingData.patientPhone,
                  email: bookingData.patientEmail || null,
                  notes: `Booked via WhatsApp on ${new Date().toLocaleDateString()}`,
                });
              }

              const appointment = await storage.createAppointment({
                patientId: patient.id,
                doctorId: bookingData.doctorId,
                date: appointmentDateTime,
                duration: appointmentDuration,
                status: "scheduled",
                service: bookingData.service,
                notes: bookingData.notes || null,
                source: "whatsapp",
              });

              // Sync to Google Calendar if connected
              try {
                const doctor = await storage.getDoctorById(bookingData.doctorId);
                if (doctor?.googleRefreshToken) {
                  const event = await createCalendarEvent(
                    doctor.googleRefreshToken,
                    doctor.googleCalendarId || "primary",
                    {
                      patientName: bookingData.patientName,
                      doctorName: doctor.name,
                      date: bookingData.date,
                      time: bookingData.time,
                      service: bookingData.service,
                      duration: appointmentDuration,
                    },
                    "Europe/Amsterdam"
                  );
                  await storage.updateAppointment(appointment.id, { googleEventId: event.id });
                }
              } catch (e) {
                console.error("Calendar sync failed:", e);
              }

              bookingResult = {
                success: true,
                appointmentId: appointment.id,
                patientName: bookingData.patientName,
                doctorName: bookingData.doctorName,
                date: bookingData.date,
                time: bookingData.time,
                service: bookingData.service,
              };

              fullResponse = language === "nl"
                ? `Uw afspraak is geboekt! ${bookingData.service} met Dr. ${bookingData.doctorName} op ${bookingData.date} om ${bookingData.time}.`
                : `Your appointment is booked! ${bookingData.service} with Dr. ${bookingData.doctorName} on ${bookingData.date} at ${bookingData.time}.`;
            }
          } catch (error: any) {
            console.error("Booking error:", error);
            fullResponse = language === "nl"
              ? "Er is een fout opgetreden bij het boeken. Probeer het opnieuw."
              : "There was an error booking your appointment. Please try again.";
          }
        }
      } else {
        fullResponse = responseMessage?.content || "";
      }

      // Store assistant response
      if (fullResponse) {
        await storage.createChatMessage({
          sessionId,
          role: "assistant",
          content: fullResponse,
        });
      }

      res.json({
        response: fullResponse,
        booking: bookingResult,
      });
    } catch (error) {
      console.error("Error processing simple chat message:", error);
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
