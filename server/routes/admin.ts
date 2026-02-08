import type { Express } from "express";
import { requireAdmin } from "../middleware/auth";
import { storage } from "../storage";
import bcrypt from "bcryptjs";
import { randomUUID } from "crypto";
import { createCalendarEvent } from "../google-calendar";
import { sendAppointmentConfirmationEmail, sendAppointmentCancelledEmail } from "../services/email";

export function registerAdminRoutes(app: Express) {
  app.get("/api/admin/stats", requireAdmin, async (req, res) => {
    try {
      const stats = await storage.getAdminStats();
      res.json(stats);
    } catch (error) {
      console.error("Error fetching admin stats:", error);
      res.status(500).json({ error: "Failed to fetch stats" });
    }
  });

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
      const userId = `doctor-${randomUUID()}`;
      doctorData.userId = userId;
      const doctor = await storage.createDoctor(doctorData);
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
      
      if (!doctorId || !patientId || !date || !service) {
        return res.status(400).json({ error: "Missing required fields" });
      }
      
      let appointmentDate: Date;
      if (time) {
        appointmentDate = new Date(`${date}T${time}:00`);
      } else {
        appointmentDate = new Date(date);
      }
      
      if (isNaN(appointmentDate.getTime())) {
        return res.status(400).json({ error: "Invalid date format" });
      }
      
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
      
      for (const block of doctorUnavailability) {
        if (!block.isAvailable) {
          const [blockStartH, blockStartM] = block.startTime.split(":").map(Number);
          const [blockEndH, blockEndM] = block.endTime.split(":").map(Number);
          const blockStart = blockStartH * 60 + blockStartM;
          const blockEnd = blockEndH * 60 + blockEndM;
          
          if (appointmentTimeMinutes < blockEnd && appointmentEndMinutes > blockStart) {
            return res.status(400).json({ 
              error: `Doctor is not available on ${appointmentDateStr} from ${block.startTime.slice(0, 5)} to ${block.endTime.slice(0, 5)}${block.reason ? ` (${block.reason})` : ''}` 
            });
          }
        }
      }
      
      const conflictingAppointments = existingAppointments.filter(apt => {
        if (apt.status === 'cancelled') return false;
        const aptDate = new Date(apt.date);
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
          
          await storage.updateAppointment(appointment.id, {
            googleEventId: event.id,
          });
          console.log("Created Google Calendar event for appointment:", appointment.id);
        }
      } catch (calendarError) {
        console.error("Failed to sync to Google Calendar:", calendarError);
      }

      try {
        const patient = await storage.getPatientById(patientId);
        const doctor = await storage.getDoctorById(doctorId);
        if (patient?.email && doctor) {
          sendAppointmentConfirmationEmail({
            patientEmail: patient.email,
            patientName: patient.name,
            doctorName: doctor.name,
            date: appointmentDate,
            service,
            duration: appointmentDuration,
            referenceNumber: appointment.referenceNumber || "",
          }).catch((e) => console.error("Failed to send confirmation email:", e));
        }
      } catch (emailError) {
        console.error("Failed to send confirmation email:", emailError);
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

      try {
        const appt = await storage.getAppointmentById(id);
        if (appt) {
          const patient = await storage.getPatientById(appt.patientId);
          const doctor = await storage.getDoctorById(appt.doctorId);
          if (patient?.email && doctor) {
            sendAppointmentCancelledEmail({
              patientEmail: patient.email,
              patientName: patient.name,
              doctorName: doctor.name,
              date: new Date(appt.date),
              service: appt.service,
              referenceNumber: appt.referenceNumber || "",
            }).catch((e) => console.error("Failed to send cancellation email:", e));
          }
        }
      } catch (emailError) {
        console.error("Failed to send cancellation email:", emailError);
      }

      await storage.deleteAppointment(id);
      res.json({ success: true });
    } catch (error) {
      console.error("Error deleting appointment:", error);
      res.status(500).json({ error: "Failed to delete appointment" });
    }
  });

  app.get("/api/admin/settings", requireAdmin, async (req, res) => {
    try {
      let settings = await storage.getClinicSettings();
      if (!settings) {
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
}
