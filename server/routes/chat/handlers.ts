import type { Express } from "express";
import { randomUUID } from "crypto";
import { storage } from "../../storage";
import { openai } from "../../services/openai";
import { createCalendarEvent, deleteCalendarEvent } from "../../google-calendar";
import { sendAppointmentConfirmationEmail, sendAppointmentCancelledEmail, sendAppointmentRescheduledEmail } from "../../services/email";
import {
  checkAvailabilityFunction,
  bookingFunction,
  lookupAppointmentFunction,
  cancelAppointmentFunction,
  rescheduleAppointmentFunction,
  lookupPatientByEmailFunction,
  checkAvailabilityFunctionSimple,
  bookingFunctionSimple,
  checkWalkinAvailabilityFunction,
  bookWalkinFunction,
} from "./tools";
import { scheduleRemindersForAppointment } from "../../services/reminders";
import { buildSystemPrompt } from "./prompts";
import { findAvailableSlots, getAvailableSlotsForDate } from "./availability";
import { determineQuickReplies } from "./quickReplies";
import { getNowInTimezone, clinicTimeToUTC, isClinicTimePast, getTomorrowInTimezone, getDayAfterTomorrowInTimezone } from "../../utils/timezone";

export function registerChatRoutes(app: Express) {
  app.post("/api/chat/session", async (req, res) => {
    try {
      const { language = "en" } = req.body;
      const sessionId = randomUUID();

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

      await storage.createChatSession({
        sessionId,
        language,
        status: "active",
      });

      storage.incrementChatSessions().catch(e => console.error("Failed to increment chat sessions:", e));

      const welcomeMessage =
        language === "nl"
          ? `Welkom bij ${settings.clinicName}! Ik ben uw AI-assistent. Ik kan u helpen met het boeken van een afspraak. Hoe kan ik u vandaag helpen?`
          : `Welcome to ${settings.clinicName}! I'm your AI assistant. I can help you book an appointment. How may I help you today?`;

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
        return res
          .status(400)
          .json({ error: "Session ID and message required" });
      }

      const existingMessages = await storage.getChatMessages(sessionId);
      const isFirstUserMessage = !existingMessages.some(m => m.role === "user");

      await storage.createChatMessage({
        sessionId,
        role: "user",
        content: message,
      });

      if (isFirstUserMessage) {
        storage.incrementChatInteractions().catch(e => console.error("Failed to increment chat interactions:", e));
      }

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
      const clinicTimezone = settings?.timezone || "Europe/Amsterdam";
      const clinicNow = getNowInTimezone(clinicTimezone);
      const today = clinicNow.dateStr;
      const tomorrow = getTomorrowInTimezone(clinicTimezone);
      const dayAfterTomorrow = getDayAfterTomorrowInTimezone(clinicTimezone);
      const currentDayOfWeek = clinicNow.dayOfWeek;

      const systemPrompt = buildSystemPrompt({
        language,
        clinicName: settings?.clinicName || (language === "nl" ? "de tandartskliniek" : "the dental clinic"),
        services,
        activeDoctors: activeDoctors.map(d => ({ id: d.id, name: d.name, specialty: d.specialty })),
        openTime: settings?.openTime || "09:00",
        closeTime: settings?.closeTime || "17:00",
        workingDays: settings?.workingDays || [1, 2, 3, 4, 5, 6],
        today,
        tomorrow,
        dayAfterTomorrow,
        currentDayOfWeek,
      });

      const conversationHistory = previousMessages.slice(-10).map((m) => ({
        role: m.role as "user" | "assistant",
        content: m.content,
      }));

      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");

      const allTools = [checkAvailabilityFunction, bookingFunction, lookupAppointmentFunction, cancelAppointmentFunction, rescheduleAppointmentFunction, lookupPatientByEmailFunction, checkWalkinAvailabilityFunction, bookWalkinFunction];

      const processNonTerminalToolCall = async (tc: { id: string; function: { name: string; arguments: string } }): Promise<string> => {
        const fnName = tc.function.name;
        const args = JSON.parse(tc.function.arguments);

        if (fnName === "check_availability") {
          console.log("Checking availability:", args);
          const availability = await getAvailableSlotsForDate(args.doctorId, args.date, settings || null);
          const doctor = activeDoctors.find(d => d.id === args.doctorId);
          const doctorName = doctor?.name || "the doctor";
          let info = "";
          if (availability.blockedPeriods.length > 0) {
            info = `Dr. ${doctorName} is NOT available during: ${availability.blockedPeriods.join(", ")} on ${args.date}. `;
          }
          info += availability.available
            ? `Available time slots: ${availability.slots.join(", ")}.`
            : `No available slots on ${args.date}.`;
          return info;
        }

        if (fnName === "lookup_patient_by_email") {
          const email = (args.email || "").trim().toLowerCase();
          console.log("Patient lookup by email:", email);
          const patient = await storage.getPatientByEmail(email);
          if (patient) {
            return JSON.stringify({ found: true, patientId: patient.id, name: patient.name, phone: patient.phone, email: patient.email });
          }
          return JSON.stringify({ found: false, message: "No patient found with this email address. Please collect their details as a new patient (name, phone number, and email)." });
        }

        if (fnName === "lookup_appointment") {
          const refNum = (args.referenceNumber || "").toUpperCase().trim();
          const phone = (args.phoneNumber || "").trim();
          const appointment = await storage.getAppointmentByReferenceNumber(refNum);
          if (!appointment) return JSON.stringify({ found: false, error: "No appointment found with this reference number. Please check and try again." });
          if (!appointment.patient.phone || !phone || appointment.patient.phone.replace(/\D/g, "").slice(-6) !== phone.replace(/\D/g, "").slice(-6)) {
            return JSON.stringify({ found: false, error: "Phone number does not match our records. Please verify your phone number." });
          }
          if (appointment.status === "cancelled") return JSON.stringify({ found: false, error: "This appointment has already been cancelled." });
          const appointmentDate = new Date(appointment.date);
          return JSON.stringify({
            found: true, referenceNumber: appointment.referenceNumber, appointmentId: appointment.id,
            doctorId: appointment.doctorId, doctorName: appointment.doctor?.name || "Walk-in (any available doctor)",
            patientName: appointment.patient.name, service: appointment.service,
            date: appointmentDate.toISOString().split("T")[0],
            time: `${String(appointmentDate.getHours()).padStart(2, "0")}:${String(appointmentDate.getMinutes()).padStart(2, "0")}`,
            status: appointment.status,
          });
        }

        if (fnName === "cancel_appointment") {
          const refNum = (args.referenceNumber || "").toUpperCase().trim();
          const phone = (args.phoneNumber || "").trim();
          const appointment = await storage.getAppointmentByReferenceNumber(refNum);
          if (!appointment) return JSON.stringify({ success: false, error: "Appointment not found." });
          if (!phone || appointment.patient.phone.replace(/\D/g, "").slice(-6) !== phone.replace(/\D/g, "").slice(-6)) {
            return JSON.stringify({ success: false, error: "Phone verification failed. Cannot cancel." });
          }
          if (appointment.status === "cancelled") return JSON.stringify({ success: false, error: "This appointment is already cancelled." });

          await storage.updateAppointment(appointment.id, { status: "cancelled" });
          if (appointment.googleEventId && appointment.doctorId) {
            try {
              const doctor = await storage.getDoctorById(appointment.doctorId);
              if (doctor?.googleRefreshToken) {
                await deleteCalendarEvent(doctor.googleRefreshToken, doctor.googleCalendarId || "primary", appointment.googleEventId);
              }
            } catch (calErr) { console.error("Failed to delete Google Calendar event:", calErr); }
          }
          if (appointment.patient.email) {
            const doctor = appointment.doctorId ? await storage.getDoctorById(appointment.doctorId) : null;
            sendAppointmentCancelledEmail({
              patientEmail: appointment.patient.email, patientName: appointment.patient.name,
              doctorName: doctor?.name || "Doctor", date: new Date(appointment.date),
              service: appointment.service, referenceNumber: refNum,
            }).catch((e) => console.error("Failed to send cancellation email:", e));
          }
          return JSON.stringify({ success: true, message: `Appointment ${refNum} has been cancelled successfully.`, referenceNumber: refNum });
        }

        if (fnName === "reschedule_appointment") {
          const refNum = (args.referenceNumber || "").toUpperCase().trim();
          const phone = (args.phoneNumber || "").trim();
          const appointment = await storage.getAppointmentByReferenceNumber(refNum);
          if (!appointment) return JSON.stringify({ success: false, error: "Appointment not found." });
          if (!phone || appointment.patient.phone.replace(/\D/g, "").slice(-6) !== phone.replace(/\D/g, "").slice(-6)) {
            return JSON.stringify({ success: false, error: "Phone verification failed. Cannot reschedule." });
          }
          if (appointment.status === "cancelled") return JSON.stringify({ success: false, error: "Cannot reschedule a cancelled appointment." });
          if (isClinicTimePast(args.newDate, args.newTime, clinicTimezone)) {
            return JSON.stringify({ success: false, error: "Cannot reschedule to a past date/time." });
          }
          const newDateTime = clinicTimeToUTC(args.newDate, args.newTime, clinicTimezone);
          const existingAppointments = appointment.doctorId ? await storage.getAppointmentsByDoctorId(appointment.doctorId) : [];
          const duration = appointment.duration || 30;
          const conflicting = existingAppointments.find((apt) => {
            if (apt.id === appointment.id || apt.status === "cancelled") return false;
            const aptStart = new Date(apt.date).getTime();
            const aptEnd = aptStart + apt.duration * 60 * 1000;
            const newStart = newDateTime.getTime();
            const newEnd = newStart + duration * 60 * 1000;
            return newStart < aptEnd && newEnd > aptStart;
          });
          if (conflicting) return JSON.stringify({ success: false, error: "The new time slot conflicts with another appointment. Please choose a different time." });

          const oldDate = new Date(appointment.date);
          await storage.updateAppointment(appointment.id, { date: newDateTime });
          if (appointment.googleEventId && appointment.doctorId) {
            try {
              const doctor = await storage.getDoctorById(appointment.doctorId);
              if (doctor?.googleRefreshToken) {
                await deleteCalendarEvent(doctor.googleRefreshToken, doctor.googleCalendarId || "primary", appointment.googleEventId);
                const event = await createCalendarEvent(doctor.googleRefreshToken, doctor.googleCalendarId || "primary", {
                  patientName: appointment.patient.name, doctorName: doctor.name,
                  date: args.newDate, time: args.newTime, service: appointment.service, duration,
                }, clinicTimezone);
                await storage.updateAppointment(appointment.id, { googleEventId: event.id });
              }
            } catch (calErr) { console.error("Failed to update Google Calendar event:", calErr); }
          }
          if (appointment.patient.email) {
            const reschDoctor = appointment.doctorId ? await storage.getDoctorById(appointment.doctorId) : null;
            sendAppointmentRescheduledEmail({
              patientEmail: appointment.patient.email, patientName: appointment.patient.name,
              doctorName: reschDoctor?.name || "Doctor", oldDate, newDate: newDateTime,
              service: appointment.service, duration, referenceNumber: refNum,
            }).catch((e) => console.error("Failed to send reschedule email:", e));
          }
          return JSON.stringify({
            success: true, message: `Appointment ${refNum} has been rescheduled from ${oldDate.toISOString().split("T")[0]} to ${args.newDate} at ${args.newTime}.`,
            referenceNumber: refNum, newDate: args.newDate, newTime: args.newTime,
          });
        }

        if (fnName === "check_walkin_availability") {
          const requestedDate = args.date;
          if (requestedDate < today) return JSON.stringify({ available: false, error: "Cannot check availability for past dates." });
          const openT = settings?.openTime || "09:00";
          const closeT = settings?.closeTime || "17:00";
          const [openH] = openT.split(":").map(Number);
          const [closeH] = closeT.split(":").map(Number);
          const periods: { name: string; available: boolean; description: string }[] = [];
          if (openH < 12) periods.push({ name: "morning", available: true, description: `${openT.slice(0, 5)} - 12:00` });
          if (openH < 16 && closeH > 12) periods.push({ name: "afternoon", available: true, description: `12:00 - ${Math.min(closeH, 16)}:00` });
          if (closeH > 16) periods.push({ name: "evening", available: true, description: `16:00 - ${closeT.slice(0, 5)}` });
          if (requestedDate === today) {
            const currentHour = clinicNow.hours;
            for (const period of periods) {
              const periodEndHour = period.name === "morning" ? 12 : period.name === "afternoon" ? 16 : closeH;
              if (currentHour >= periodEndHour) period.available = false;
            }
          }
          const dayOfWeek = new Date(requestedDate + "T12:00:00").getDay();
          const wDays = settings?.workingDays || [1, 2, 3, 4, 5, 6];
          if (!wDays.includes(dayOfWeek)) for (const period of periods) period.available = false;
          return JSON.stringify({ date: requestedDate, periods: periods.filter(p => p.available), clinicOpen: openT.slice(0, 5), clinicClose: closeT.slice(0, 5), isWorkingDay: wDays.includes(dayOfWeek) });
        }

        if (fnName === "find_emergency_slot") {
          return JSON.stringify({ error: "Emergency slot finding is handled separately." });
        }

        return JSON.stringify({ error: `Unknown tool: ${fnName}` });
      }

      const streamText = (text: string) => {
        const chunkSize = 3;
        const chunks: string[] = [];
        for (let i = 0; i < text.length; i += chunkSize) {
          chunks.push(text.slice(i, i + chunkSize));
        }
        return chunks;
      }

      const writeStreamedResponse = async (text: string) => {
        for (const chunk of streamText(text)) {
          res.write(`data: ${JSON.stringify({ content: chunk })}\n\n`);
          await new Promise(resolve => setTimeout(resolve, 15));
        }
      }

      let currentMessages: any[] = [
        { role: "system", content: systemPrompt },
        ...conversationHistory,
        { role: "user", content: message },
      ];

      let fullResponse = "";
      let bookingResult: any = null;
      let maxIterations = 8;
      let terminalHandled = false;

      while (maxIterations > 0) {
        maxIterations--;

        const aiResponse = await openai.chat.completions.create({
          model: process.env.CHAT_AI_MODEL || "gpt-4o-mini",
          messages: currentMessages,
          tools: allTools,
          tool_choice: "auto",
        });

        const responseMessage = aiResponse.choices[0]?.message;

        if (!responseMessage?.tool_calls || responseMessage.tool_calls.length === 0) {
          const content = responseMessage?.content || "";
          if (content) {
            await writeStreamedResponse(content);
            fullResponse = content;
            await storage.createChatMessage({ sessionId, role: "assistant", content: fullResponse });
          }
          break;
        }

        const toolCalls = responseMessage.tool_calls as { id: string; type: string; function: { name: string; arguments: string } }[];
        const terminalTools = ["book_appointment", "book_walkin"];
        const hasTerminalTool = toolCalls.some(tc => terminalTools.includes(tc.function.name));

        if (hasTerminalTool) {
          const terminalTc = toolCalls.find(tc => terminalTools.includes(tc.function.name))!;

          if (terminalTc.function.name === "book_appointment") {
            try {
              const bookingData = JSON.parse(terminalTc.function.arguments);
              console.log("Booking appointment:", bookingData);

              const invalidNames = ["pending", "unknown", "test", "user", "patient", "name", "n/a", "na", "tbd", "to be determined"];
              const patientName = (bookingData.patientName || "").trim().toLowerCase();
              const patientPhone = (bookingData.patientPhone || "").trim();

              if (!bookingData.patientName || patientName.length < 2) throw new Error("MISSING_INFO: I need your full name to book the appointment. What is your name?");
              const nameParts = patientName.split(/\s+/);
              if (nameParts.some((part: string) => invalidNames.includes(part)) || (nameParts.length >= 2 && nameParts[0] === nameParts[1]))
                throw new Error("MISSING_INFO: I need your real full name to book the appointment. Could you please tell me your name?");
              if (!patientPhone || patientPhone.length < 6) throw new Error("MISSING_INFO: I need your phone number to book the appointment. What is your phone number?");
              const invalidPhones = ["0000000", "1234567", "pending", "unknown", "test", "n/a", "na", "tbd"];
              if (invalidPhones.some(p => patientPhone.toLowerCase().includes(p)))
                throw new Error("MISSING_INFO: I need a valid phone number to book the appointment. What is your phone number?");

              const appointmentDateTime = clinicTimeToUTC(bookingData.date, bookingData.time, clinicTimezone);
              const appointmentDuration = settings?.appointmentDuration || 30;

              if (bookingData.date < today) throw new Error("SLOT_UNAVAILABLE: Cannot book appointments in the past. Please choose a future date.");
              if (bookingData.date === today && isClinicTimePast(bookingData.date, bookingData.time, clinicTimezone))
                throw new Error("SLOT_UNAVAILABLE: This time has already passed. Please choose a later time today or another day.");

              const openTime = settings?.openTime || "09:00:00";
              const closeTime = settings?.closeTime || "17:00:00";
              const [openHour, openMin] = openTime.split(":").map(Number);
              const [closeHour, closeMin] = closeTime.split(":").map(Number);
              const [reqHour, reqMin] = bookingData.time.split(":").map(Number);
              const openMinutes = openHour * 60 + openMin;
              const closeMinutes = closeHour * 60 + closeMin;
              const requestedMinutes = reqHour * 60 + reqMin;
              const appointmentEndMinutes = requestedMinutes + appointmentDuration;

              if (requestedMinutes < openMinutes || appointmentEndMinutes > closeMinutes)
                throw new Error(`SLOT_UNAVAILABLE: The requested time is outside working hours (${openTime.slice(0, 5)} - ${closeTime.slice(0, 5)})`);

              const dayOfWeek = appointmentDateTime.getDay();
              const workingDays = settings?.workingDays || [1, 2, 3, 4, 5, 6];
              if (!workingDays.includes(dayOfWeek)) {
                const dayNames = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
                throw new Error(`SLOT_UNAVAILABLE: ${dayNames[dayOfWeek]} is not a working day. Please choose another day.`);
              }

              const doctorUnavailability = await storage.getDoctorAvailabilityForDate(bookingData.doctorId, bookingData.date);
              for (const block of doctorUnavailability) {
                if (!block.isAvailable) {
                  const [blockStartH, blockStartM] = block.startTime.split(":").map(Number);
                  const [blockEndH, blockEndM] = block.endTime.split(":").map(Number);
                  const blockStart = blockStartH * 60 + blockStartM;
                  const blockEnd = blockEndH * 60 + blockEndM;
                  if (requestedMinutes < blockEnd && appointmentEndMinutes > blockStart)
                    throw new Error(`SLOT_UNAVAILABLE: ${bookingData.doctorName} is not available on ${bookingData.date} from ${block.startTime.slice(0, 5)} to ${block.endTime.slice(0, 5)}${block.reason ? ` (${block.reason})` : ''}.`);
                }
              }

              const existingAppointments = await storage.getAppointmentsByDoctorId(bookingData.doctorId);
              const conflictingAppointment = existingAppointments.find((apt) => {
                if (apt.status === "cancelled") return false;
                const aptStart = new Date(apt.date).getTime();
                const aptEnd = aptStart + apt.duration * 60 * 1000;
                const newStart = appointmentDateTime.getTime();
                const newEnd = newStart + appointmentDuration * 60 * 1000;
                return newStart < aptEnd && newEnd > aptStart;
              });

              if (conflictingAppointment) {
                const alternativeSlots = await findAvailableSlots(bookingData.doctorId, bookingData.date, openMinutes, closeMinutes, appointmentDuration, existingAppointments, workingDays, clinicTimezone);
                if (alternativeSlots.length > 0) {
                  const slotsText = alternativeSlots.map((s) => `${s.date} at ${s.time}`).join(", ");
                  throw new Error(`SLOT_UNAVAILABLE_WITH_ALTERNATIVES: This time slot is already booked. Available slots: ${slotsText}`);
                }
                throw new Error(`SLOT_UNAVAILABLE: This time slot is already booked and no alternatives found for this day. Please try a different day.`);
              }

              let patient = await storage.findOrCreatePatient({
                name: bookingData.patientName, phone: bookingData.patientPhone,
                email: bookingData.patientEmail || null, notes: `Booked via chat on ${new Date().toLocaleDateString()}`,
              });
              console.log("Using patient:", patient.id, patient.name);

              const appointment = await storage.createAppointment({
                patientId: patient.id, doctorId: bookingData.doctorId, date: appointmentDateTime,
                duration: appointmentDuration, status: "scheduled", service: bookingData.service,
                notes: bookingData.notes || null, source: "chat",
              });
              console.log("Created appointment:", appointment.id);

              try {
                const doctor = await storage.getDoctorById(bookingData.doctorId);
                if (doctor?.googleRefreshToken) {
                  const event = await createCalendarEvent(doctor.googleRefreshToken, doctor.googleCalendarId || "primary", {
                    patientName: bookingData.patientName, doctorName: doctor.name, date: bookingData.date,
                    time: bookingData.time, service: bookingData.service || "Dental Appointment",
                    notes: bookingData.notes || undefined, duration: appointmentDuration,
                  }, clinicTimezone);
                  await storage.updateAppointment(appointment.id, { googleEventId: event.id });
                  console.log("Created Google Calendar event for chat appointment:", appointment.id);
                }
              } catch (calendarError) { console.error("Failed to sync chat appointment to Google Calendar:", calendarError); }

              bookingResult = {
                success: true, appointmentId: appointment.id, referenceNumber: appointment.referenceNumber,
                patientName: bookingData.patientName, doctorName: bookingData.doctorName,
                date: bookingData.date, time: bookingData.time, service: bookingData.service,
              };

              const bookedPatientEmail = bookingData.patientEmail || patient.email;
              if (bookedPatientEmail) {
                sendAppointmentConfirmationEmail({
                  patientEmail: bookedPatientEmail, patientName: bookingData.patientName,
                  doctorName: bookingData.doctorName, date: appointmentDateTime,
                  service: bookingData.service, duration: appointmentDuration,
                  referenceNumber: appointment.referenceNumber || "",
                }).catch((e) => console.error("Failed to send confirmation email:", e));
              }

              const confirmMsgs: any[] = [...currentMessages, responseMessage];
              for (const tc of toolCalls) {
                if (tc.id === terminalTc.id) {
                  confirmMsgs.push({ role: "tool", tool_call_id: tc.id, content: JSON.stringify({ success: true, message: `Appointment booked successfully! Reference number: ${appointment.referenceNumber}`, referenceNumber: appointment.referenceNumber, details: bookingResult }) });
                } else {
                  try { const r = await processNonTerminalToolCall(tc); confirmMsgs.push({ role: "tool", tool_call_id: tc.id, content: r }); }
                  catch { confirmMsgs.push({ role: "tool", tool_call_id: tc.id, content: JSON.stringify({ error: "Tool not processed" }) }); }
                }
              }

              const confirmationResponse = await openai.chat.completions.create({ model: process.env.CHAT_AI_MODEL || "gpt-4o-mini", messages: confirmMsgs });
              const confirmationContent = confirmationResponse.choices[0]?.message?.content ||
                (language === "nl" ? `Uw afspraak is geboekt! Afspraak voor ${bookingData.service} met Dr. ${bookingData.doctorName} op ${bookingData.date} om ${bookingData.time}.`
                  : `Your appointment is booked! Appointment for ${bookingData.service} with Dr. ${bookingData.doctorName} on ${bookingData.date} at ${bookingData.time}.`);

              await writeStreamedResponse(confirmationContent);
              fullResponse = confirmationContent;
              await storage.createChatMessage({ sessionId, role: "assistant", content: fullResponse });
            } catch (bookingError: any) {
              console.error("Booking error:", bookingError);
              let errorMessage = "";
              if (bookingError.message?.startsWith("SLOT_UNAVAILABLE_WITH_ALTERNATIVES:")) {
                const reason = bookingError.message.replace("SLOT_UNAVAILABLE_WITH_ALTERNATIVES: ", "");
                errorMessage = language === "nl" ? `Sorry, dit tijdslot is al geboekt. ${reason}. Wilt u een van deze tijden boeken?` : `Sorry, this time slot is already booked. ${reason}. Would you like to book one of these times?`;
              } else if (bookingError.message?.startsWith("SLOT_UNAVAILABLE:")) {
                const reason = bookingError.message.replace("SLOT_UNAVAILABLE: ", "");
                errorMessage = language === "nl" ? `Sorry, dit tijdslot is niet beschikbaar. ${reason} Kies alstublieft een ander tijdstip.` : `Sorry, this time slot is not available. ${reason} Please choose a different time.`;
              } else if (bookingError.message?.startsWith("MISSING_INFO:")) {
                errorMessage = bookingError.message.replace("MISSING_INFO: ", "");
              } else {
                errorMessage = language === "nl" ? "Er is een fout opgetreden bij het boeken. Probeer het opnieuw." : "There was an error booking your appointment. Please try again.";
              }
              await writeStreamedResponse(errorMessage);
              fullResponse = errorMessage;
              await storage.createChatMessage({ sessionId, role: "assistant", content: fullResponse });
            }
          } else if (terminalTc.function.name === "book_walkin") {
            try {
              const walkinData = JSON.parse(terminalTc.function.arguments);
              const invalidNames = ["pending", "unknown", "test", "user", "patient", "name", "n/a", "na", "tbd"];
              const wName = (walkinData.patientName || "").trim().toLowerCase();
              const wPhone = (walkinData.patientPhone || "").trim();

              if (!walkinData.patientName || wName.length < 2) throw new Error("MISSING_INFO: I need your full name to book the walk-in visit. What is your name?");
              if (invalidNames.some((n) => wName.split(/\s+/).includes(n))) throw new Error("MISSING_INFO: I need your real full name. Could you please tell me your name?");
              if (!wPhone || wPhone.length < 6) throw new Error("MISSING_INFO: I need your phone number to book the walk-in visit. What is your phone number?");
              if (!walkinData.patientEmail) throw new Error("MISSING_INFO: I need your email address to send the appointment confirmation. What is your email?");

              const wOpenTime = settings?.openTime || "09:00";
              const timePeriodMap: Record<string, string> = { morning: wOpenTime.slice(0, 5), afternoon: "12:00", evening: "16:00" };
              const representativeTime = timePeriodMap[walkinData.timePeriod] || wOpenTime.slice(0, 5);
              const appointmentDateTime = clinicTimeToUTC(walkinData.date, representativeTime, clinicTimezone);

              let wPatient = await storage.findOrCreatePatient({
                name: walkinData.patientName, phone: walkinData.patientPhone,
                email: walkinData.patientEmail || null, notes: `Walk-in booked via chat on ${new Date().toLocaleDateString()}`,
              });

              const wAppointment = await storage.createAppointment({
                patientId: wPatient.id, doctorId: null, date: appointmentDateTime,
                duration: settings?.appointmentDuration || 30, status: "scheduled",
                service: walkinData.service, notes: walkinData.notes || `Walk-in - ${walkinData.timePeriod}`,
                source: "chat", appointmentType: "walk-in", timePeriod: walkinData.timePeriod,
              });

              bookingResult = {
                success: true, appointmentId: wAppointment.id, referenceNumber: wAppointment.referenceNumber,
                patientName: walkinData.patientName, doctorName: "Any available doctor",
                date: walkinData.date, time: walkinData.timePeriod, service: walkinData.service,
              };

              const wPatientEmail = walkinData.patientEmail || wPatient.email;
              if (wPatientEmail) {
                sendAppointmentConfirmationEmail({
                  patientEmail: wPatientEmail, patientName: walkinData.patientName,
                  doctorName: "Any available doctor (walk-in)", date: appointmentDateTime,
                  service: walkinData.service, duration: settings?.appointmentDuration || 30,
                  referenceNumber: wAppointment.referenceNumber!,
                }).catch((e) => console.error("Failed to send walk-in confirmation email:", e));
              }

              scheduleRemindersForAppointment(wAppointment.id).catch((e) => console.error("Failed to schedule walk-in reminders:", e));

              const confirmMsgs: any[] = [...currentMessages, responseMessage];
              for (const tc of toolCalls) {
                if (tc.id === terminalTc.id) {
                  confirmMsgs.push({ role: "tool", tool_call_id: tc.id, content: JSON.stringify({
                    success: true, message: `Walk-in appointment registered! Reference number: ${wAppointment.referenceNumber}. Come in on ${walkinData.date} during the ${walkinData.timePeriod} (${timePeriodMap[walkinData.timePeriod]} onwards). The first available doctor will see you.`,
                    referenceNumber: wAppointment.referenceNumber, details: bookingResult,
                  }) });
                } else {
                  try { const r = await processNonTerminalToolCall(tc); confirmMsgs.push({ role: "tool", tool_call_id: tc.id, content: r }); }
                  catch { confirmMsgs.push({ role: "tool", tool_call_id: tc.id, content: JSON.stringify({ error: "Tool not processed" }) }); }
                }
              }

              const walkinConfirmation = await openai.chat.completions.create({ model: process.env.CHAT_AI_MODEL || "gpt-4o-mini", messages: confirmMsgs });
              const walkinContent = walkinConfirmation.choices[0]?.message?.content ||
                (language === "nl" ? `Uw walk-in afspraak is geregistreerd! Referentienummer: ${wAppointment.referenceNumber}.`
                  : `Your walk-in appointment is registered! Reference: ${wAppointment.referenceNumber}. Come in on ${walkinData.date} during the ${walkinData.timePeriod}.`);

              await writeStreamedResponse(walkinContent);
              fullResponse = walkinContent;
              await storage.createChatMessage({ sessionId, role: "assistant", content: fullResponse });
            } catch (bwError: any) {
              console.error("Walk-in booking error:", bwError);
              let bwErrMsg = "";
              if (bwError.message?.startsWith("MISSING_INFO:")) { bwErrMsg = bwError.message.replace("MISSING_INFO: ", ""); }
              else { bwErrMsg = language === "nl" ? "Er is een fout opgetreden bij het registreren van uw walk-in afspraak. Probeer het opnieuw." : "There was an error registering your walk-in appointment. Please try again."; }
              await writeStreamedResponse(bwErrMsg);
              fullResponse = bwErrMsg;
              await storage.createChatMessage({ sessionId, role: "assistant", content: fullResponse });
            }
          }
          terminalHandled = true;
          break;
        }

        currentMessages.push(responseMessage);
        for (const tc of toolCalls) {
          try {
            const result = await processNonTerminalToolCall(tc);
            currentMessages.push({ role: "tool", tool_call_id: tc.id, content: result });
          } catch (e: any) {
            console.error(`Error processing tool ${tc.function.name}:`, e);
            currentMessages.push({ role: "tool", tool_call_id: tc.id, content: JSON.stringify({ error: e.message || "Tool processing failed" }) });
          }
        }
      }

      if (!fullResponse && !terminalHandled) {
        const fallback = language === "nl" ? "Sorry, er ging iets mis. Probeer het opnieuw." : "Sorry, something went wrong. Please try again.";
        await writeStreamedResponse(fallback);
        fullResponse = fallback;
        await storage.createChatMessage({ sessionId, role: "assistant", content: fullResponse });
      }

      if (bookingResult) {
        res.write(`data: ${JSON.stringify({ booking: bookingResult })}\n\n`);
      }

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

  app.post("/api/chat/message-simple", async (req, res) => {
    try {
      const { sessionId, message, language = "en" } = req.body;

      if (!sessionId || !message) {
        return res.status(400).json({ error: "Session ID and message required" });
      }

      const existingMsgs = await storage.getChatMessages(sessionId);
      const isFirstUserMsg = !existingMsgs.some(m => m.role === "user");

      await storage.createChatMessage({
        sessionId,
        role: "user",
        content: message,
      });

      if (isFirstUserMsg) {
        storage.incrementChatInteractions().catch(e => console.error("Failed to increment chat interactions:", e));
      }

      const [settings, doctors, previousMessages] = await Promise.all([
        storage.getClinicSettings(),
        storage.getDoctors(),
        storage.getChatMessages(sessionId),
      ]);

      const activeDoctors = doctors.filter((d) => d.isActive);
      const services = settings?.services || ["General Checkup", "Teeth Cleaning"];
      const clinicTimezone = settings?.timezone || "Europe/Amsterdam";
      const clinicNow = getNowInTimezone(clinicTimezone);
      const today = clinicNow.dateStr;
      const tomorrow = getTomorrowInTimezone(clinicTimezone);
      const dayAfterTomorrow = getDayAfterTomorrowInTimezone(clinicTimezone);
      const currentDayOfWeek = clinicNow.dayOfWeek;

      const systemPrompt = buildSystemPrompt({
        language,
        clinicName: settings?.clinicName || (language === "nl" ? "de tandartskliniek" : "the dental clinic"),
        services,
        activeDoctors: activeDoctors.map(d => ({ id: d.id, name: d.name, specialty: d.specialty })),
        openTime: settings?.openTime || "09:00",
        closeTime: settings?.closeTime || "17:00",
        workingDays: settings?.workingDays || [1, 2, 3, 4, 5, 6],
        today,
        tomorrow,
        dayAfterTomorrow,
        currentDayOfWeek,
      });

      const conversationHistory = previousMessages
        .slice(-10)
        .map((m) => ({ role: m.role as "user" | "assistant", content: m.content }));

      const getAvailableSlotsSimple = async (doctorId: number, dateStr: string): Promise<{ available: boolean; slots: string[]; blockedPeriods: string[] }> => {
        return getAvailableSlotsForDate(doctorId, dateStr, settings || null);
      };

      let currentMessages: any[] = [
        { role: "system", content: systemPrompt },
        ...conversationHistory,
        { role: "user", content: message },
      ];

      let initialResponse = await openai.chat.completions.create({
        model: process.env.CHAT_AI_MODEL || "gpt-4o-mini",
        messages: currentMessages,
        tools: [checkAvailabilityFunctionSimple, bookingFunctionSimple],
        tool_choice: "auto",
      });

      let responseMessage = initialResponse.choices[0]?.message;
      let fullResponse = "";
      let bookingResult = null;

      if (responseMessage?.tool_calls && responseMessage.tool_calls.length > 0 &&
          (responseMessage.tool_calls[0] as any)?.function?.name === "check_availability") {
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
            model: process.env.CHAT_AI_MODEL || "gpt-4o-mini",
            messages: currentMessages,
            tools: [checkAvailabilityFunctionSimple, bookingFunctionSimple],
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

            const invalidNames = ["pending", "unknown", "test", "user", "patient", "name", "n/a", "na", "tbd", "to be determined"];
            const patientNameLower = (bookingData.patientName || "").trim().toLowerCase();
            const patientPhoneVal = (bookingData.patientPhone || "").trim();
            
            if (!bookingData.patientName || patientNameLower.length < 2) {
              throw new Error("MISSING_INFO: I need your full name to book the appointment. What is your name?");
            }
            
            const namePartsCheck = patientNameLower.split(/\s+/);
            if (namePartsCheck.some((part: string) => invalidNames.includes(part)) || 
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

            const appointmentDateTime = clinicTimeToUTC(bookingData.date, bookingData.time, clinicTimezone);
            const appointmentDuration = settings?.appointmentDuration || 30;

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
              let patient = await storage.findOrCreatePatient({
                name: bookingData.patientName, phone: bookingData.patientPhone,
                email: bookingData.patientEmail || null, notes: `Booked via WhatsApp on ${new Date().toLocaleDateString()}`,
              });

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
                    clinicTimezone,
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

      if (fullResponse) {
        await storage.createChatMessage({
          sessionId,
          role: "assistant",
          content: fullResponse,
        });
      }

      const simpleConversationHistory = previousMessages.slice(-10).map((m) => ({
        role: m.role as "user" | "assistant",
        content: m.content,
      }));
      const quickReplies = await determineQuickReplies(message, fullResponse, simpleConversationHistory, language);

      res.json({
        response: fullResponse,
        booking: bookingResult,
        quickReplies,
      });
    } catch (error) {
      console.error("Error processing simple chat message:", error);
      res.status(500).json({ error: "Failed to process message" });
    }
  });
}
