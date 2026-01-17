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
  listCalendars 
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
    return res.status(403).json({ error: "Access denied. Admin privileges required." });
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
  app: Express
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

  app.get("/api/admin/patients/:id/appointments", requireAdmin, async (req, res) => {
    try {
      const patientId = parseInt(req.params.id);
      const appointments = await storage.getAppointmentsByPatientId(patientId);
      res.json(appointments);
    } catch (error) {
      console.error("Error fetching patient appointments:", error);
      res.status(500).json({ error: "Failed to fetch appointments" });
    }
  });

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
          services: ["General Checkup", "Teeth Cleaning", "Fillings", "Root Canal", "Teeth Whitening", "Orthodontics"],
          welcomeMessage: "Welcome to our dental clinic! How can I help you today?",
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

  app.delete("/api/doctor/availability/:id", requireDoctor, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      await storage.deleteDoctorAvailability(id);
      res.json({ success: true });
    } catch (error) {
      console.error("Error deleting availability:", error);
      res.status(500).json({ error: "Failed to delete availability" });
    }
  });

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
        return res.json({ connected: false, configured: isOAuthConfigured(), message: "Doctor not found" });
      }
      
      // Check if this specific doctor has connected their calendar
      const hasRefreshToken = !!doctor.googleRefreshToken;
      
      res.json({ 
        connected: hasRefreshToken,
        configured: isOAuthConfigured(),
        calendarId: doctor.googleCalendarId,
        message: hasRefreshToken ? "Connected" : "Not connected"
      });
    } catch (error) {
      res.json({ connected: false, configured: isOAuthConfigured(), message: "Error checking status" });
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
          error: "Google OAuth not configured. Please set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET." 
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
  app.get("/api/doctor/calendar/callback", async (req, res) => {
    try {
      const { code, state } = req.query;
      
      if (!code || !state) {
        return res.redirect('/doctor/calendar?error=missing_params');
      }
      
      const doctorId = parseInt(state as string);
      if (isNaN(doctorId)) {
        return res.redirect('/doctor/calendar?error=invalid_state');
      }
      
      const tokens = await exchangeCodeForTokens(code as string);
      
      // Store the refresh token for this doctor
      await storage.updateDoctor(doctorId, {
        googleRefreshToken: tokens.refresh_token,
      });
      
      res.redirect('/doctor/calendar?connected=true');
    } catch (error) {
      console.error("OAuth callback error:", error);
      res.redirect('/doctor/calendar?error=oauth_failed');
    }
  });

  // Disconnect calendar - revokes access and clears token
  app.post("/api/doctor/calendar/disconnect", requireDoctor, async (req, res) => {
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
  });

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
      const calId = (calendarId as string) || doctor.googleCalendarId || "primary";
      
      const timeMin = startDate ? new Date(startDate as string) : new Date();
      const timeMax = endDate ? new Date(endDate as string) : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
      
      const events = await getCalendarEvents(doctor.googleRefreshToken, calId, timeMin, timeMax);
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
        return res.status(400).json({ error: "Calendar not connected. Please connect your Google Calendar first." });
      }

      // Get doctor's appointments and clinic settings for timezone
      const [appointments, settings] = await Promise.all([
        storage.getAppointmentsByDoctorId(doctor.id),
        storage.getClinicSettings(),
      ]);
      
      // Use doctor's calendar or provided calendar ID
      const calendarId = req.body.calendarId || doctor.googleCalendarId || "primary";
      const timezone = settings?.timezone || "Europe/Amsterdam";
      
      // Optionally save the calendar selection to the doctor profile
      if (req.body.calendarId && req.body.calendarId !== doctor.googleCalendarId) {
        await storage.updateDoctor(doctor.id, { googleCalendarId: req.body.calendarId });
      }
      
      let syncedCount = 0;
      for (const appointment of appointments) {
        if (appointment.status === "scheduled" && !appointment.googleEventId) {
          try {
            // Get patient info
            const patient = await storage.getPatientById(appointment.patientId);
            
            // Format date from timestamp to YYYY-MM-DD
            const appointmentDate = new Date(appointment.date);
            const dateStr = appointmentDate.toISOString().split('T')[0];
            const timeStr = `${String(appointmentDate.getHours()).padStart(2, '0')}:${String(appointmentDate.getMinutes()).padStart(2, '0')}`;
            
            const event = await createCalendarEvent(doctor.googleRefreshToken, calendarId, {
              patientName: patient?.name || "Unknown Patient",
              doctorName: doctor.name,
              date: dateStr,
              time: timeStr,
              service: appointment.service || "Dental Appointment",
              notes: appointment.notes || undefined,
              duration: appointment.duration,
            }, timezone);
            
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
        message: `Synced ${syncedCount} appointments to Google Calendar` 
      });
    } catch (error) {
      console.error("Error syncing calendar:", error);
      res.status(500).json({ error: "Failed to sync calendar" });
    }
  });

  app.delete("/api/doctor/calendar/event/:eventId", requireDoctor, async (req, res) => {
    try {
      const doctor = await getDoctorFromSession(req);
      
      if (!doctor?.googleRefreshToken) {
        return res.status(400).json({ error: "Calendar not connected" });
      }
      
      const { eventId } = req.params;
      const calendarId = (req.query.calendarId as string) || doctor.googleCalendarId || "primary";
      
      await deleteCalendarEvent(doctor.googleRefreshToken, calendarId, eventId);
      res.json({ success: true });
    } catch (error) {
      console.error("Error deleting calendar event:", error);
      res.status(500).json({ error: "Failed to delete calendar event" });
    }
  });

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
          welcomeMessage: language === "nl" 
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

      const welcomeMessage = language === "nl"
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

  app.post("/api/chat/message", async (req, res) => {
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

      const activeDoctors = doctors.filter(d => d.isActive);
      const services = settings?.services || ["General Checkup", "Teeth Cleaning"];

      // Build system prompt
      const systemPrompt = language === "nl"
        ? `Je bent een vriendelijke AI-receptionist voor ${settings?.clinicName || "de tandartskliniek"}. 
Je helpt patiënten om afspraken te boeken.

Beschikbare diensten: ${services.join(", ")}
Beschikbare tandartsen: ${activeDoctors.map(d => `Dr. ${d.name} (${d.specialty})`).join(", ") || "Neem contact op voor beschikbaarheid"}
Openingstijden: ${settings?.openTime || "09:00"} - ${settings?.closeTime || "17:00"}
Werkdagen: Maandag t/m Vrijdag

Instructies:
1. Wees vriendelijk en professioneel
2. Verzamel: naam patiënt, telefoonnummer, gewenste dienst, voorkeursdag/tijd
3. Stel één vraag tegelijk
4. Bevestig de afspraakgegevens voordat je boekt
5. Als alle informatie compleet is, bevestig de boeking

Houd antwoorden kort en behulpzaam.`
        : `You are a friendly AI receptionist for ${settings?.clinicName || "the dental clinic"}. 
You help patients book appointments.

Available services: ${services.join(", ")}
Available dentists: ${activeDoctors.map(d => `Dr. ${d.name} (${d.specialty})`).join(", ") || "Please contact for availability"}
Opening hours: ${settings?.openTime || "09:00"} - ${settings?.closeTime || "17:00"}
Working days: Monday to Friday

Instructions:
1. Be friendly and professional
2. Collect: patient name, phone number, service needed, preferred day/time
3. Ask one question at a time
4. Confirm booking details before finalizing
5. When all info is complete, confirm the booking

Keep responses concise and helpful.`;

      // Build conversation history
      const conversationHistory = previousMessages.slice(-10).map(m => ({
        role: m.role as "user" | "assistant",
        content: m.content,
      }));

      // Set headers for streaming
      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");

      // Call OpenAI with streaming
      const stream = await openai.chat.completions.create({
        model: "gpt-5.1",
        messages: [
          { role: "system", content: systemPrompt },
          ...conversationHistory,
          { role: "user", content: message },
        ],
        stream: true,
        max_completion_tokens: 500,
      });

      let fullResponse = "";

      for await (const chunk of stream) {
        const content = chunk.choices[0]?.delta?.content || "";
        if (content) {
          fullResponse += content;
          res.write(`data: ${JSON.stringify({ content })}\n\n`);
        }
      }

      // Store assistant response
      if (fullResponse) {
        await storage.createChatMessage({
          sessionId,
          role: "assistant",
          content: fullResponse,
        });
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
      const activeDoctors = doctors.filter(d => d.isActive).map(d => ({
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
