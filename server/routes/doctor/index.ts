import type { Express } from "express";
import { storage } from "../../storage";
import { requireDoctor } from "../../middleware/auth";
import { getDoctorFromSession, registerDoctorCalendarRoutes } from "./calendar";

export function registerDoctorRoutes(app: Express) {
  app.get("/api/doctor/profile", requireDoctor, async (req, res) => {
    try {
      const session = (req as any).session;
      const user = session?.user;
      if (user?.role === "admin") {
        const doctors = await storage.getDoctors();
        if (doctors.length > 0) {
          return res.json(doctors[0]);
        }
        return res.status(404).json({ error: "No doctors found" });
      }
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

  app.get("/api/doctor/availability", requireDoctor, async (req, res) => {
    try {
      const doctor = await getDoctorFromSession(req);
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
      const doctor = await getDoctorFromSession(req);
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

  registerDoctorCalendarRoutes(app);
}
