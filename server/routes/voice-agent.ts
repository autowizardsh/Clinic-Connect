import type { Express, Request, Response, NextFunction } from "express";
import { storage } from "../storage";
import { getAvailableSlotsForDate, findAvailableSlots } from "./chat/availability";
import { createCalendarEvent, deleteCalendarEvent } from "../google-calendar";
import { sendAppointmentConfirmationEmail, sendAppointmentCancelledEmail, sendAppointmentRescheduledEmail } from "../services/email";
import { scheduleRemindersForAppointment, rescheduleRemindersForAppointment, cancelRemindersForAppointment } from "../services/reminders";
import { clinicTimeToUTC, isClinicTimePast, getNowInTimezone } from "../utils/timezone";

function authMiddleware(req: Request, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;
  const token = process.env.VOICE_AGENT_API_TOKEN;

  if (!token) {
    return res.status(500).json({ error: "API token not configured on server" });
  }

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Missing or invalid Authorization header. Use: Bearer <token>" });
  }

  const provided = authHeader.slice(7);
  if (provided !== token) {
    return res.status(403).json({ error: "Invalid API token" });
  }

  next();
}

export function registerVoiceAgentRoutes(app: Express) {
  app.get("/api/voice/doctors", authMiddleware, async (_req, res) => {
    try {
      const doctors = await storage.getDoctors();
      const activeDoctors = doctors
        .filter((d) => d.isActive)
        .map((d) => ({
          id: d.id,
          name: d.name,
          specialty: d.specialty,
        }));
      res.json({ doctors: activeDoctors });
    } catch (error) {
      console.error("Voice API - Error fetching doctors:", error);
      res.status(500).json({ error: "Failed to fetch doctors" });
    }
  });

  app.get("/api/voice/services", authMiddleware, async (_req, res) => {
    try {
      const settings = await storage.getClinicSettings();
      const services = settings?.services || ["General Checkup", "Teeth Cleaning"];
      res.json({
        services,
        clinicName: settings?.clinicName || "Dental Clinic",
        openTime: settings?.openTime || "09:00",
        closeTime: settings?.closeTime || "17:00",
        workingDays: settings?.workingDays || [1, 2, 3, 4, 5, 6],
      });
    } catch (error) {
      console.error("Voice API - Error fetching services:", error);
      res.status(500).json({ error: "Failed to fetch services" });
    }
  });

  app.post("/api/voice/availability", authMiddleware, async (req, res) => {
    try {
      const { doctorId, date } = req.body;

      if (!doctorId || !date) {
        return res.status(400).json({ error: "doctorId and date (YYYY-MM-DD) are required" });
      }

      const settings = await storage.getClinicSettings();
      const result = await getAvailableSlotsForDate(doctorId, date, settings || null);

      const doctor = await storage.getDoctorById(doctorId);

      res.json({
        doctorId,
        doctorName: doctor?.name || "Unknown",
        date,
        available: result.available,
        slots: result.slots,
        blockedPeriods: result.blockedPeriods,
      });
    } catch (error) {
      console.error("Voice API - Error checking availability:", error);
      res.status(500).json({ error: "Failed to check availability" });
    }
  });

  app.post("/api/voice/book", authMiddleware, async (req, res) => {
    try {
      const { patientName, patientPhone, patientEmail, service, doctorId, date, time, notes } = req.body;

      if (!patientName || !patientPhone || !patientEmail || !service || !doctorId || !date || !time) {
        return res.status(400).json({
          error: "Missing required fields",
          required: ["patientName", "patientPhone", "patientEmail", "service", "doctorId", "date", "time"],
          optional: ["notes"],
        });
      }

      const trimmedName = (patientName || "").trim().toLowerCase();
      const trimmedPhone = (patientPhone || "").trim();

      if (trimmedName.length < 2) {
        return res.status(400).json({ error: "Patient name is too short. Please provide a full name." });
      }

      const invalidNames = ["pending", "unknown", "test", "user", "patient", "name", "n/a", "na", "tbd", "to be determined"];
      const nameParts = trimmedName.split(/\s+/);
      if (nameParts.some((part: string) => invalidNames.includes(part)) || (nameParts.length >= 2 && nameParts[0] === nameParts[1])) {
        return res.status(400).json({ error: "Please provide the patient's real full name" });
      }

      if (trimmedPhone.length < 6) {
        return res.status(400).json({ error: "Phone number is too short. Please provide a valid phone number." });
      }

      const invalidPhones = ["0000000", "1234567", "pending", "unknown", "test", "n/a", "na", "tbd"];
      if (invalidPhones.some((p) => trimmedPhone.toLowerCase().includes(p))) {
        return res.status(400).json({ error: "Please provide a valid phone number" });
      }

      const settings = await storage.getClinicSettings();
      const doctor = await storage.getDoctorById(doctorId);

      if (!doctor || !doctor.isActive) {
        return res.status(400).json({ error: "Doctor not found or inactive" });
      }

      const clinicTimezone = settings?.timezone || "Europe/Amsterdam";
      const appointmentDateTime = clinicTimeToUTC(date, time, clinicTimezone);
      const appointmentDuration = settings?.appointmentDuration || 30;
      const clinicNow = getNowInTimezone(clinicTimezone);

      if (date < clinicNow.dateStr) {
        return res.status(400).json({ error: "Cannot book appointments in the past" });
      }

      if (date === clinicNow.dateStr && isClinicTimePast(date, time, clinicTimezone)) {
        return res.status(400).json({ error: "This time has already passed today" });
      }

      const openTime = settings?.openTime || "09:00";
      const closeTime = settings?.closeTime || "17:00";
      const [openH, openM] = openTime.split(":").map(Number);
      const [closeH, closeM] = closeTime.split(":").map(Number);
      const [reqH, reqM] = time.split(":").map(Number);
      const openMin = openH * 60 + openM;
      const closeMin = closeH * 60 + closeM;
      const reqMin = reqH * 60 + reqM;

      if (reqMin < openMin || reqMin + appointmentDuration > closeMin) {
        return res.status(400).json({ error: `Time is outside working hours (${openTime} - ${closeTime})` });
      }

      const dayOfWeek = new Date(date + "T12:00:00").getDay();
      const workingDays = settings?.workingDays || [1, 2, 3, 4, 5, 6];
      if (!workingDays.includes(dayOfWeek)) {
        return res.status(400).json({ error: "Selected day is not a working day" });
      }

      const doctorUnavailability = await storage.getDoctorAvailabilityForDate(doctorId, date);
      for (const block of doctorUnavailability) {
        if (!block.isAvailable) {
          const [bsH, bsM] = block.startTime.split(":").map(Number);
          const [beH, beM] = block.endTime.split(":").map(Number);
          const blockStart = bsH * 60 + bsM;
          const blockEnd = beH * 60 + beM;
          if (reqMin < blockEnd && reqMin + appointmentDuration > blockStart) {
            return res.status(400).json({
              error: `Doctor is not available from ${block.startTime} to ${block.endTime}${block.reason ? ` (${block.reason})` : ""}`,
            });
          }
        }
      }

      const existingAppointments = await storage.getAppointmentsByDoctorId(doctorId);
      const conflicting = existingAppointments.find((apt) => {
        if (apt.status === "cancelled") return false;
        const aptStart = new Date(apt.date).getTime();
        const aptEnd = aptStart + apt.duration * 60 * 1000;
        const newStart = appointmentDateTime.getTime();
        const newEnd = newStart + appointmentDuration * 60 * 1000;
        return newStart < aptEnd && newEnd > aptStart;
      });

      if (conflicting) {
        const alternativeSlots = await findAvailableSlots(
          doctorId, date, openMin, closeMin, appointmentDuration, existingAppointments, workingDays, clinicTimezone,
        );
        return res.status(409).json({
          error: "Time slot is already booked",
          alternativeSlots: alternativeSlots.map((s) => `${s.date} at ${s.time}`),
        });
      }

      let patient = await storage.findOrCreatePatient({
        name: patientName, phone: patientPhone,
        email: patientEmail || null, notes: `Booked via voice agent on ${new Date().toLocaleDateString()}`,
      });

      const appointment = await storage.createAppointment({
        patientId: patient.id,
        doctorId,
        date: appointmentDateTime,
        duration: appointmentDuration,
        status: "scheduled",
        service,
        notes: notes || null,
        source: "voice",
      });

      try {
        if (doctor.googleRefreshToken) {
          const event = await createCalendarEvent(
            doctor.googleRefreshToken,
            doctor.googleCalendarId || "primary",
            { patientName, doctorName: doctor.name, date, time, service, notes, duration: appointmentDuration },
            clinicTimezone,
          );
          await storage.updateAppointment(appointment.id, { googleEventId: event.id });
        }
      } catch (calErr) {
        console.error("Voice API - Failed to sync to Google Calendar:", calErr);
      }

      const email = patientEmail || patient.email;
      if (email) {
        sendAppointmentConfirmationEmail({
          patientEmail: email,
          patientName,
          doctorName: doctor.name,
          date: appointmentDateTime,
          service,
          duration: appointmentDuration,
          referenceNumber: appointment.referenceNumber!,
        }).catch((e) => console.error("Voice API - Failed to send confirmation email:", e));
      }

      scheduleRemindersForAppointment(appointment.id).catch((e) =>
        console.error("Voice API - Failed to schedule reminders:", e)
      );

      res.json({
        success: true,
        referenceNumber: appointment.referenceNumber,
        appointmentId: appointment.id,
        patientName,
        doctorName: doctor.name,
        date,
        time,
        service,
        duration: appointmentDuration,
      });
    } catch (error) {
      console.error("Voice API - Error booking appointment:", error);
      res.status(500).json({ error: "Failed to book appointment" });
    }
  });

  app.post("/api/voice/lookup", authMiddleware, async (req, res) => {
    try {
      const { referenceNumber, phoneNumber } = req.body;

      if (!referenceNumber || !phoneNumber) {
        return res.status(400).json({ error: "referenceNumber and phoneNumber are required" });
      }

      const refNum = referenceNumber.toUpperCase().trim();
      const appointment = await storage.getAppointmentByReferenceNumber(refNum);

      if (!appointment) {
        return res.status(404).json({ error: "Appointment not found" });
      }

      const phone = phoneNumber.replace(/\D/g, "").slice(-6);
      const aptPhone = appointment.patient.phone.replace(/\D/g, "").slice(-6);

      if (phone !== aptPhone) {
        return res.status(403).json({ error: "Phone number does not match the appointment record" });
      }

      const doctor = appointment.doctorId ? await storage.getDoctorById(appointment.doctorId) : null;

      res.json({
        found: true,
        referenceNumber: refNum,
        patientName: appointment.patient.name,
        doctorName: doctor?.name || (appointment.appointmentType === "walk-in" ? "Walk-in (any available)" : "Unknown"),
        date: new Date(appointment.date).toISOString().split("T")[0],
        time: new Date(appointment.date).toTimeString().slice(0, 5),
        service: appointment.service,
        status: appointment.status,
        duration: appointment.duration,
        appointmentType: appointment.appointmentType,
        timePeriod: appointment.timePeriod,
      });
    } catch (error) {
      console.error("Voice API - Error looking up appointment:", error);
      res.status(500).json({ error: "Failed to lookup appointment" });
    }
  });

  app.post("/api/voice/cancel", authMiddleware, async (req, res) => {
    try {
      const { referenceNumber, phoneNumber } = req.body;

      if (!referenceNumber || !phoneNumber) {
        return res.status(400).json({ error: "referenceNumber and phoneNumber are required" });
      }

      const refNum = referenceNumber.toUpperCase().trim();
      const appointment = await storage.getAppointmentByReferenceNumber(refNum);

      if (!appointment) {
        return res.status(404).json({ error: "Appointment not found" });
      }

      const phone = phoneNumber.replace(/\D/g, "").slice(-6);
      const aptPhone = appointment.patient.phone.replace(/\D/g, "").slice(-6);

      if (phone !== aptPhone) {
        return res.status(403).json({ error: "Phone number does not match the appointment record" });
      }

      if (appointment.status === "cancelled") {
        return res.status(400).json({ error: "This appointment is already cancelled" });
      }

      await storage.updateAppointment(appointment.id, { status: "cancelled" });

      if (appointment.googleEventId && appointment.doctorId) {
        try {
          const doctor = await storage.getDoctorById(appointment.doctorId);
          if (doctor?.googleRefreshToken) {
            await deleteCalendarEvent(
              doctor.googleRefreshToken,
              doctor.googleCalendarId || "primary",
              appointment.googleEventId,
            );
          }
        } catch (calErr) {
          console.error("Voice API - Failed to delete Google Calendar event:", calErr);
        }
      }

      if (appointment.patient.email) {
        const doctor = appointment.doctorId ? await storage.getDoctorById(appointment.doctorId) : null;
        sendAppointmentCancelledEmail({
          patientEmail: appointment.patient.email,
          patientName: appointment.patient.name,
          doctorName: doctor?.name || (appointment.appointmentType === "walk-in" ? "Walk-in" : "Doctor"),
          date: new Date(appointment.date),
          service: appointment.service,
          referenceNumber: refNum,
        }).catch((e) => console.error("Voice API - Failed to send cancellation email:", e));
      }

      cancelRemindersForAppointment(appointment.id).catch((e) =>
        console.error("Voice API - Failed to cancel reminders:", e)
      );

      res.json({
        success: true,
        message: `Appointment ${refNum} has been cancelled successfully`,
        referenceNumber: refNum,
      });
    } catch (error) {
      console.error("Voice API - Error cancelling appointment:", error);
      res.status(500).json({ error: "Failed to cancel appointment" });
    }
  });

  app.post("/api/voice/reschedule", authMiddleware, async (req, res) => {
    try {
      const { referenceNumber, phoneNumber, newDate, newTime } = req.body;

      if (!referenceNumber || !phoneNumber || !newDate || !newTime) {
        return res.status(400).json({
          error: "Missing required fields",
          required: ["referenceNumber", "phoneNumber", "newDate", "newTime"],
        });
      }

      const refNum = referenceNumber.toUpperCase().trim();
      const appointment = await storage.getAppointmentByReferenceNumber(refNum);

      if (!appointment) {
        return res.status(404).json({ error: "Appointment not found" });
      }

      const phone = phoneNumber.replace(/\D/g, "").slice(-6);
      const aptPhone = appointment.patient.phone.replace(/\D/g, "").slice(-6);

      if (phone !== aptPhone) {
        return res.status(403).json({ error: "Phone number does not match the appointment record" });
      }

      if (appointment.status === "cancelled") {
        return res.status(400).json({ error: "Cannot reschedule a cancelled appointment" });
      }

      const settings = await storage.getClinicSettings();
      const clinicTimezone = settings?.timezone || "Europe/Amsterdam";
      const newDateTime = clinicTimeToUTC(newDate, newTime, clinicTimezone);
      if (isClinicTimePast(newDate, newTime, clinicTimezone)) {
        return res.status(400).json({ error: "Cannot reschedule to a past date/time" });
      }

      const duration = appointment.duration || 30;

      const openTime = settings?.openTime || "09:00";
      const closeTime = settings?.closeTime || "17:00";
      const [openH, openM] = openTime.split(":").map(Number);
      const [closeH, closeM] = closeTime.split(":").map(Number);
      const [reqH, reqM] = newTime.split(":").map(Number);
      const openMin = openH * 60 + openM;
      const closeMin = closeH * 60 + closeM;
      const reqMin = reqH * 60 + reqM;

      if (reqMin < openMin || reqMin + duration > closeMin) {
        return res.status(400).json({ error: `Time is outside working hours (${openTime} - ${closeTime})` });
      }

      const dayOfWeek = new Date(newDate + "T12:00:00").getDay();
      const workingDays = settings?.workingDays || [1, 2, 3, 4, 5, 6];
      if (!workingDays.includes(dayOfWeek)) {
        return res.status(400).json({ error: "Selected day is not a working day" });
      }

      if (appointment.appointmentType === "walk-in") {
        return res.status(400).json({ error: "Walk-in appointments cannot be rescheduled. Please cancel and create a new booking." });
      }

      if (appointment.doctorId) {
        const doctorUnavailability = await storage.getDoctorAvailabilityForDate(appointment.doctorId, newDate);
        for (const block of doctorUnavailability) {
          if (!block.isAvailable) {
            const [bsH, bsM] = block.startTime.split(":").map(Number);
            const [beH, beM] = block.endTime.split(":").map(Number);
            const blockStart = bsH * 60 + bsM;
            const blockEnd = beH * 60 + beM;
            if (reqMin < blockEnd && reqMin + duration > blockStart) {
              return res.status(400).json({
                error: `Doctor is not available from ${block.startTime} to ${block.endTime}${block.reason ? ` (${block.reason})` : ""}`,
              });
            }
          }
        }

        const existingAppointments = await storage.getAppointmentsByDoctorId(appointment.doctorId);
        const conflicting = existingAppointments.find((apt) => {
          if (apt.id === appointment.id || apt.status === "cancelled") return false;
          const aptStart = new Date(apt.date).getTime();
          const aptEnd = aptStart + apt.duration * 60 * 1000;
          const newStart = newDateTime.getTime();
          const newEnd = newStart + duration * 60 * 1000;
          return newStart < aptEnd && newEnd > aptStart;
        });

        if (conflicting) {
          return res.status(409).json({ error: "The new time slot conflicts with another appointment" });
        }
      }

      const oldDate = new Date(appointment.date);
      await storage.updateAppointment(appointment.id, { date: newDateTime });

      const doctor = appointment.doctorId ? await storage.getDoctorById(appointment.doctorId) : null;

      if (appointment.googleEventId && doctor?.googleRefreshToken) {
        try {
          await deleteCalendarEvent(
            doctor.googleRefreshToken,
            doctor.googleCalendarId || "primary",
            appointment.googleEventId,
          );
          const event = await createCalendarEvent(
            doctor.googleRefreshToken,
            doctor.googleCalendarId || "primary",
            {
              patientName: appointment.patient.name,
              doctorName: doctor.name,
              date: newDate,
              time: newTime,
              service: appointment.service,
              duration,
            },
            clinicTimezone,
          );
          await storage.updateAppointment(appointment.id, { googleEventId: event.id });
        } catch (calErr) {
          console.error("Voice API - Failed to update Google Calendar:", calErr);
        }
      }

      if (appointment.patient.email) {
        sendAppointmentRescheduledEmail({
          patientEmail: appointment.patient.email,
          patientName: appointment.patient.name,
          doctorName: doctor?.name || "Doctor",
          oldDate,
          newDate: newDateTime,
          service: appointment.service,
          duration,
          referenceNumber: refNum,
        }).catch((e) => console.error("Voice API - Failed to send reschedule email:", e));
      }

      rescheduleRemindersForAppointment(appointment.id).catch((e) =>
        console.error("Voice API - Failed to reschedule reminders:", e)
      );

      res.json({
        success: true,
        message: `Appointment ${refNum} rescheduled to ${newDate} at ${newTime}`,
        referenceNumber: refNum,
        oldDate: oldDate.toISOString().split("T")[0],
        oldTime: oldDate.toTimeString().slice(0, 5),
        newDate,
        newTime,
      });
    } catch (error) {
      console.error("Voice API - Error rescheduling appointment:", error);
      res.status(500).json({ error: "Failed to reschedule appointment" });
    }
  });

  app.post("/api/voice/walkin-availability", authMiddleware, async (req, res) => {
    try {
      const { date } = req.body;

      if (!date) {
        return res.status(400).json({ error: "date (YYYY-MM-DD) is required" });
      }

      const settings = await storage.getClinicSettings();
      const clinicTimezone = settings?.timezone || "Europe/Amsterdam";
      const clinicNow = getNowInTimezone(clinicTimezone);

      if (date < clinicNow.dateStr) {
        return res.status(400).json({ error: "Cannot check availability for past dates" });
      }

      const openTime = settings?.openTime || "09:00";
      const closeTime = settings?.closeTime || "17:00";
      const [openH] = openTime.split(":").map(Number);
      const [closeH] = closeTime.split(":").map(Number);

      const periods: { name: string; available: boolean; description: string }[] = [];
      if (openH < 12) periods.push({ name: "morning", available: true, description: `${openTime.slice(0, 5)} - 12:00` });
      if (openH < 16 && closeH > 12) periods.push({ name: "afternoon", available: true, description: `12:00 - ${Math.min(closeH, 16)}:00` });
      if (closeH > 16) periods.push({ name: "evening", available: true, description: `16:00 - ${closeTime.slice(0, 5)}` });

      if (date === clinicNow.dateStr) {
        const currentHour = clinicNow.hours;
        for (const period of periods) {
          const periodEndHour = period.name === "morning" ? 12 : period.name === "afternoon" ? 16 : closeH;
          if (currentHour >= periodEndHour) period.available = false;
        }
      }

      const dayOfWeek = new Date(date + "T12:00:00").getDay();
      const workingDays = settings?.workingDays || [1, 2, 3, 4, 5, 6];
      if (!workingDays.includes(dayOfWeek)) {
        for (const period of periods) period.available = false;
      }

      res.json({
        date,
        periods: periods.filter(p => p.available),
        clinicOpen: openTime.slice(0, 5),
        clinicClose: closeTime.slice(0, 5),
        isWorkingDay: workingDays.includes(dayOfWeek),
      });
    } catch (error) {
      console.error("Voice API - Error checking walk-in availability:", error);
      res.status(500).json({ error: "Failed to check walk-in availability" });
    }
  });

  app.post("/api/voice/walkin-book", authMiddleware, async (req, res) => {
    try {
      const { patientName, patientPhone, patientEmail, service, date, timePeriod, notes } = req.body;

      if (!patientName || !patientPhone || !patientEmail || !service || !date || !timePeriod) {
        return res.status(400).json({
          error: "Missing required fields",
          required: ["patientName", "patientPhone", "patientEmail", "service", "date", "timePeriod"],
          optional: ["notes"],
          timePeriodOptions: ["morning", "afternoon", "evening"],
        });
      }

      if (!["morning", "afternoon", "evening"].includes(timePeriod)) {
        return res.status(400).json({ error: "timePeriod must be 'morning', 'afternoon', or 'evening'" });
      }

      const trimmedName = (patientName || "").trim().toLowerCase();
      if (trimmedName.length < 2) {
        return res.status(400).json({ error: "Patient name is too short" });
      }

      const settings = await storage.getClinicSettings();
      const clinicTimezone = settings?.timezone || "Europe/Amsterdam";
      const clinicNow = getNowInTimezone(clinicTimezone);

      if (date < clinicNow.dateStr) {
        return res.status(400).json({ error: "Cannot book walk-in for past dates" });
      }

      const openTime = settings?.openTime || "09:00";
      const timePeriodMap: Record<string, string> = {
        morning: openTime.slice(0, 5),
        afternoon: "12:00",
        evening: "16:00",
      };
      const representativeTime = timePeriodMap[timePeriod] || openTime.slice(0, 5);
      const appointmentDateTime = clinicTimeToUTC(date, representativeTime, clinicTimezone);

      let patient = await storage.findOrCreatePatient({
        name: patientName, phone: patientPhone,
        email: patientEmail || null, notes: `Walk-in booked via voice on ${new Date().toLocaleDateString()}`,
      });

      const appointment = await storage.createAppointment({
        patientId: patient.id,
        doctorId: null,
        date: appointmentDateTime,
        duration: settings?.appointmentDuration || 30,
        status: "scheduled",
        service,
        notes: notes || `Walk-in - ${timePeriod}`,
        source: "voice",
        appointmentType: "walk-in",
        timePeriod,
      });

      const patientEmailAddr = patientEmail || patient.email;
      if (patientEmailAddr) {
        sendAppointmentConfirmationEmail({
          patientEmail: patientEmailAddr,
          patientName,
          doctorName: "Any available doctor (walk-in)",
          date: appointmentDateTime,
          service,
          duration: settings?.appointmentDuration || 30,
          referenceNumber: appointment.referenceNumber!,
        }).catch((e) => console.error("Voice API - Failed to send walk-in confirmation email:", e));
      }

      scheduleRemindersForAppointment(appointment.id).catch((e) =>
        console.error("Voice API - Failed to schedule walk-in reminders:", e)
      );

      res.json({
        success: true,
        message: `Walk-in appointment registered for ${date} (${timePeriod})`,
        referenceNumber: appointment.referenceNumber,
        appointmentId: appointment.id,
        date,
        timePeriod,
        service,
        appointmentType: "walk-in",
      });
    } catch (error) {
      console.error("Voice API - Error booking walk-in:", error);
      res.status(500).json({ error: "Failed to book walk-in appointment" });
    }
  });
}
