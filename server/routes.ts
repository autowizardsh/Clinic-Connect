import type { Express, Request, Response, NextFunction } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { z } from "zod";
import OpenAI from "openai";
import { randomUUID } from "crypto";

// Use Replit AI Integrations for OpenAI
const openai = new OpenAI({
  apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
  baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
});

// Auth middleware - ensures user is authenticated
function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (!req.isAuthenticated() || !req.user) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  next();
}

// Admin-only middleware - checks if user is admin (not doctor-only)
async function requireAdmin(req: Request, res: Response, next: NextFunction) {
  if (!req.isAuthenticated() || !req.user) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  
  const user = req.user as any;
  
  try {
    const adminUser = await storage.getAdminUser(user.id);
    
    // Must have explicit admin role
    if (!adminUser) {
      return res.status(403).json({ error: "Access denied. No role assigned." });
    }
    
    if (adminUser.role !== "admin") {
      return res.status(403).json({ error: "Access denied. Admin privileges required." });
    }
    
    next();
  } catch (error) {
    console.error("Error checking admin role:", error);
    return res.status(500).json({ error: "Failed to verify permissions" });
  }
}

// Doctor-only middleware - for doctor-specific routes
async function requireDoctor(req: Request, res: Response, next: NextFunction) {
  if (!req.isAuthenticated() || !req.user) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  
  const user = req.user as any;
  
  try {
    const adminUser = await storage.getAdminUser(user.id);
    
    // Must have a role assigned
    if (!adminUser) {
      return res.status(403).json({ error: "Access denied. No role assigned." });
    }
    
    // Allow if user is admin OR doctor
    if (adminUser.role === "admin" || adminUser.role === "doctor") {
      next();
    } else {
      return res.status(403).json({ error: "Access denied" });
    }
  } catch (error) {
    console.error("Error checking doctor role:", error);
    return res.status(500).json({ error: "Failed to verify permissions" });
  }
}

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
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
      const data = req.body;
      // Generate a unique userId if not provided
      if (!data.userId) {
        data.userId = `doctor-${randomUUID()}`;
      }
      const doctor = await storage.createDoctor(data);
      res.json(doctor);
    } catch (error) {
      console.error("Error creating doctor:", error);
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
      const user = req.user as any;
      let doctor = await storage.getDoctorByUserId(user.id);
      
      // If no doctor profile exists, try to find or create one
      if (!doctor) {
        const doctors = await storage.getDoctors();
        // For demo purposes, return first doctor if exists
        if (doctors.length > 0) {
          doctor = doctors[0];
        } else {
          return res.status(404).json({ error: "Doctor profile not found" });
        }
      }
      res.json(doctor);
    } catch (error) {
      console.error("Error fetching doctor profile:", error);
      res.status(500).json({ error: "Failed to fetch profile" });
    }
  });

  app.get("/api/doctor/stats", requireDoctor, async (req, res) => {
    try {
      const user = req.user as any;
      let doctor = await storage.getDoctorByUserId(user.id);
      
      if (!doctor) {
        const doctors = await storage.getDoctors();
        if (doctors.length > 0) {
          doctor = doctors[0];
        } else {
          return res.json({
            todayAppointments: 0,
            weekAppointments: 0,
            totalPatients: 0,
            upcomingAppointments: [],
          });
        }
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
      const user = req.user as any;
      let doctor = await storage.getDoctorByUserId(user.id);
      
      if (!doctor) {
        const doctors = await storage.getDoctors();
        if (doctors.length > 0) {
          doctor = doctors[0];
        } else {
          return res.json([]);
        }
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
      const user = req.user as any;
      let doctor = await storage.getDoctorByUserId(user.id);
      
      if (!doctor) {
        const doctors = await storage.getDoctors();
        if (doctors.length > 0) {
          doctor = doctors[0];
        } else {
          return res.json([]);
        }
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
      const user = req.user as any;
      let doctor = await storage.getDoctorByUserId(user.id);
      
      if (!doctor) {
        const doctors = await storage.getDoctors();
        if (doctors.length > 0) {
          doctor = doctors[0];
        } else {
          return res.status(404).json({ error: "Doctor not found" });
        }
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

  // Google Calendar (MVP placeholder - feature coming soon)
  app.post("/api/doctor/calendar/connect", requireDoctor, async (req, res) => {
    // Google Calendar integration is planned for post-MVP release
    res.status(501).json({ 
      error: "Coming soon",
      message: "Google Calendar integration is planned for the next release." 
    });
  });

  app.post("/api/doctor/calendar/disconnect", requireDoctor, async (req, res) => {
    res.status(501).json({ 
      error: "Coming soon",
      message: "Google Calendar integration is planned for the next release." 
    });
  });

  app.post("/api/doctor/calendar/sync", requireDoctor, async (req, res) => {
    res.status(501).json({ 
      error: "Coming soon",
      message: "Google Calendar integration is planned for the next release." 
    });
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
