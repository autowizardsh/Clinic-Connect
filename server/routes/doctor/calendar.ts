import type { Express, Request } from "express";
import { storage } from "../../storage";
import { requireDoctor } from "../../middleware/auth";
import {
  isOAuthConfigured,
  getAuthUrl,
  exchangeCodeForTokens,
  revokeAccess,
  createCalendarEvent,
  getCalendarEvents,
  deleteCalendarEvent,
  listCalendars,
} from "../../google-calendar";

export async function getDoctorFromSession(req: Request) {
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

export function registerDoctorCalendarRoutes(app: Express) {
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

  app.get("/api/doctor/calendar/callback", async (req, res) => {
    try {
      const session = (req as any).session;
      const user = session?.user;

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

      const doctor = await getDoctorFromSession(req);

      if (!doctor) {
        return res.redirect("/doctor/calendar?error=doctor_not_found");
      }

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

      await storage.updateDoctor(doctor.id, {
        googleRefreshToken: tokens.refresh_token,
      });

      res.redirect("/doctor/calendar?connected=true");
    } catch (error) {
      console.error("OAuth callback error:", error);
      res.redirect("/doctor/calendar?error=oauth_failed");
    }
  });

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
            console.log("Token revoke failed (may already be revoked):", e);
          }
        }

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

      const [appointments, settings] = await Promise.all([
        storage.getAppointmentsByDoctorId(doctor.id),
        storage.getClinicSettings(),
      ]);

      const calendarId =
        req.body.calendarId || doctor.googleCalendarId || "primary";
      const timezone = settings?.timezone || "Europe/Amsterdam";

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
            const patient = await storage.getPatientById(appointment.patientId);

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
}
