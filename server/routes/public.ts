import type { Express } from "express";
import { storage } from "../storage";

export function registerPublicRoutes(app: Express) {
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
        timezone: settings.timezone || "Europe/Amsterdam",
      });
    } catch (error) {
      console.error("Error fetching public settings:", error);
      res.status(500).json({ error: "Failed to fetch settings" });
    }
  });

  app.get("/api/public/widget-config", async (req, res) => {
    try {
      const settings = await storage.getClinicSettings();
      res.json({
        botName: settings?.chatBotName || "Dental Assistant",
        color: settings?.chatWidgetColor || "#0891b2",
      });
    } catch (error) {
      console.error("Error fetching widget config:", error);
      res.json({ botName: "Dental Assistant", color: "#0891b2" });
    }
  });
}
