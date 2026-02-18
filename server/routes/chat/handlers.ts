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
} from "./tools";
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

      let currentMessages: any[] = [
        { role: "system", content: systemPrompt },
        ...conversationHistory,
        { role: "user", content: message },
      ];
      
      let initialResponse = await openai.chat.completions.create({
        model: process.env.CHAT_AI_MODEL || "gpt-4o-mini",
        messages: currentMessages,
        tools: [checkAvailabilityFunction, bookingFunction, lookupAppointmentFunction, cancelAppointmentFunction, rescheduleAppointmentFunction, lookupPatientByEmailFunction],
        tool_choice: "auto",
      });

      let responseMessage = initialResponse.choices[0]?.message;
      let fullResponse = "";
      let bookingResult = null;

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
          
          const availability = await getAvailableSlotsForDate(checkData.doctorId, checkData.date, settings);
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
          currentMessages.push({
            role: "tool",
            tool_call_id: checkToolCall.id,
            content: availabilityInfo,
          });
          
          const followUpResponse = await openai.chat.completions.create({
            model: process.env.CHAT_AI_MODEL || "gpt-4o-mini",
            messages: currentMessages,
            tools: [checkAvailabilityFunction, bookingFunction, lookupAppointmentFunction, cancelAppointmentFunction, rescheduleAppointmentFunction, lookupPatientByEmailFunction],
            tool_choice: "auto",
          });
          
          responseMessage = followUpResponse.choices[0]?.message;
        } catch (e) {
          console.error("Error checking availability:", e);
        }
      }

      if (
        responseMessage?.tool_calls &&
        responseMessage.tool_calls.length > 0 &&
        responseMessage.tool_calls[0]?.function?.name === "lookup_patient_by_email"
      ) {
        const patientLookupToolCall = responseMessage.tool_calls[0] as {
          id: string;
          function: { name: string; arguments: string };
        };

        try {
          const lookupData = JSON.parse(patientLookupToolCall.function.arguments);
          const email = (lookupData.email || "").trim().toLowerCase();
          console.log("Patient lookup by email:", email);

          const patient = await storage.getPatientByEmail(email);
          console.log("Patient lookup result:", patient ? `Found: ${patient.name} (${patient.email})` : "Not found");

          let lookupResult = "";
          if (patient) {
            lookupResult = JSON.stringify({
              found: true,
              patientId: patient.id,
              name: patient.name,
              phone: patient.phone,
              email: patient.email,
            });
          } else {
            lookupResult = JSON.stringify({
              found: false,
              message: "No patient found with this email address. Please collect their details as a new patient (name, phone number, and email).",
            });
          }

          currentMessages.push(responseMessage);
          currentMessages.push({
            role: "tool",
            tool_call_id: patientLookupToolCall.id,
            content: lookupResult,
          });

          const patientLookupFollowUp = await openai.chat.completions.create({
            model: process.env.CHAT_AI_MODEL || "gpt-4o-mini",
            messages: currentMessages,
            tools: [checkAvailabilityFunction, bookingFunction, lookupAppointmentFunction, cancelAppointmentFunction, rescheduleAppointmentFunction, lookupPatientByEmailFunction],
            tool_choice: "auto",
          });

          responseMessage = patientLookupFollowUp.choices[0]?.message;
        } catch (e) {
          console.error("Error looking up patient by email:", e);
        }
      }

      if (
        responseMessage?.tool_calls &&
        responseMessage.tool_calls.length > 0 &&
        responseMessage.tool_calls[0]?.function?.name === "lookup_appointment"
      ) {
        const lookupToolCall = responseMessage.tool_calls[0] as {
          id: string;
          function: { name: string; arguments: string };
        };
        
        try {
          const lookupData = JSON.parse(lookupToolCall.function.arguments);
          const refNum = (lookupData.referenceNumber || "").toUpperCase().trim();
          const phone = (lookupData.phoneNumber || "").trim();
          
          const appointment = await storage.getAppointmentByReferenceNumber(refNum);
          
          let lookupResult = "";
          if (!appointment) {
            lookupResult = JSON.stringify({ found: false, error: "No appointment found with this reference number. Please check and try again." });
          } else if (!appointment.patient.phone || !phone || 
            appointment.patient.phone.replace(/\D/g, "").slice(-6) !== phone.replace(/\D/g, "").slice(-6)) {
            lookupResult = JSON.stringify({ found: false, error: "Phone number does not match our records. Please verify your phone number." });
          } else if (appointment.status === "cancelled") {
            lookupResult = JSON.stringify({ found: false, error: "This appointment has already been cancelled." });
          } else {
            const appointmentDate = new Date(appointment.date);
            lookupResult = JSON.stringify({
              found: true,
              referenceNumber: appointment.referenceNumber,
              appointmentId: appointment.id,
              doctorId: appointment.doctorId,
              doctorName: appointment.doctor?.name || "Walk-in (any available doctor)",
              patientName: appointment.patient.name,
              service: appointment.service,
              date: appointmentDate.toISOString().split("T")[0],
              time: `${String(appointmentDate.getHours()).padStart(2, "0")}:${String(appointmentDate.getMinutes()).padStart(2, "0")}`,
              status: appointment.status,
            });
          }
          
          currentMessages.push(responseMessage);
          currentMessages.push({
            role: "tool",
            tool_call_id: lookupToolCall.id,
            content: lookupResult,
          });
          
          const lookupFollowUp = await openai.chat.completions.create({
            model: process.env.CHAT_AI_MODEL || "gpt-4o-mini",
            messages: currentMessages,
            tools: [checkAvailabilityFunction, bookingFunction, lookupAppointmentFunction, cancelAppointmentFunction, rescheduleAppointmentFunction, lookupPatientByEmailFunction],
            tool_choice: "auto",
          });
          
          responseMessage = lookupFollowUp.choices[0]?.message;
        } catch (e) {
          console.error("Error looking up appointment:", e);
        }
      }

      if (
        responseMessage?.tool_calls &&
        responseMessage.tool_calls.length > 0 &&
        responseMessage.tool_calls[0]?.function?.name === "cancel_appointment"
      ) {
        const cancelToolCall = responseMessage.tool_calls[0] as {
          id: string;
          function: { name: string; arguments: string };
        };
        
        try {
          const cancelData = JSON.parse(cancelToolCall.function.arguments);
          const refNum = (cancelData.referenceNumber || "").toUpperCase().trim();
          const phone = (cancelData.phoneNumber || "").trim();
          
          const appointment = await storage.getAppointmentByReferenceNumber(refNum);
          
          let cancelResult = "";
          if (!appointment) {
            cancelResult = JSON.stringify({ success: false, error: "Appointment not found." });
          } else if (!phone || appointment.patient.phone.replace(/\D/g, "").slice(-6) !== phone.replace(/\D/g, "").slice(-6)) {
            cancelResult = JSON.stringify({ success: false, error: "Phone verification failed. Cannot cancel." });
          } else if (appointment.status === "cancelled") {
            cancelResult = JSON.stringify({ success: false, error: "This appointment is already cancelled." });
          } else {
            await storage.updateAppointment(appointment.id, { status: "cancelled" });
            
            if (appointment.googleEventId && appointment.doctorId) {
              try {
                const doctor = await storage.getDoctorById(appointment.doctorId);
                if (doctor?.googleRefreshToken) {
                  await deleteCalendarEvent(
                    doctor.googleRefreshToken,
                    doctor.googleCalendarId || "primary",
                    appointment.googleEventId
                  );
                }
              } catch (calErr) {
                console.error("Failed to delete Google Calendar event:", calErr);
              }
            }
            
            if (appointment.patient.email) {
              const doctor = appointment.doctorId ? await storage.getDoctorById(appointment.doctorId) : null;
              sendAppointmentCancelledEmail({
                patientEmail: appointment.patient.email,
                patientName: appointment.patient.name,
                doctorName: doctor?.name || "Doctor",
                date: new Date(appointment.date),
                service: appointment.service,
                referenceNumber: refNum,
              }).catch((e) => console.error("Failed to send cancellation email:", e));
            }

            cancelResult = JSON.stringify({
              success: true,
              message: `Appointment ${refNum} has been cancelled successfully.`,
              referenceNumber: refNum,
            });
          }
          
          currentMessages.push(responseMessage);
          currentMessages.push({
            role: "tool",
            tool_call_id: cancelToolCall.id,
            content: cancelResult,
          });
          
          const cancelFollowUp = await openai.chat.completions.create({
            model: process.env.CHAT_AI_MODEL || "gpt-4o-mini",
            messages: currentMessages,
          });
          
          responseMessage = cancelFollowUp.choices[0]?.message;
        } catch (e) {
          console.error("Error cancelling appointment:", e);
        }
      }

      if (
        responseMessage?.tool_calls &&
        responseMessage.tool_calls.length > 0 &&
        responseMessage.tool_calls[0]?.function?.name === "reschedule_appointment"
      ) {
        const rescheduleToolCall = responseMessage.tool_calls[0] as {
          id: string;
          function: { name: string; arguments: string };
        };
        
        try {
          const rescheduleData = JSON.parse(rescheduleToolCall.function.arguments);
          const refNum = (rescheduleData.referenceNumber || "").toUpperCase().trim();
          const phone = (rescheduleData.phoneNumber || "").trim();
          
          const appointment = await storage.getAppointmentByReferenceNumber(refNum);
          
          let rescheduleResult = "";
          if (!appointment) {
            rescheduleResult = JSON.stringify({ success: false, error: "Appointment not found." });
          } else if (!phone || appointment.patient.phone.replace(/\D/g, "").slice(-6) !== phone.replace(/\D/g, "").slice(-6)) {
            rescheduleResult = JSON.stringify({ success: false, error: "Phone verification failed. Cannot reschedule." });
          } else if (appointment.status === "cancelled") {
            rescheduleResult = JSON.stringify({ success: false, error: "Cannot reschedule a cancelled appointment." });
          } else {
            if (isClinicTimePast(rescheduleData.newDate, rescheduleData.newTime, clinicTimezone)) {
              rescheduleResult = JSON.stringify({ success: false, error: "Cannot reschedule to a past date/time." });
            } else {
              const newDateTime = clinicTimeToUTC(rescheduleData.newDate, rescheduleData.newTime, clinicTimezone);
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
              
              if (conflicting) {
                rescheduleResult = JSON.stringify({ success: false, error: "The new time slot conflicts with another appointment. Please choose a different time." });
              } else {
                const oldDate = new Date(appointment.date);
                await storage.updateAppointment(appointment.id, { date: newDateTime });
                
                if (appointment.googleEventId && appointment.doctorId) {
                  try {
                    const doctor = await storage.getDoctorById(appointment.doctorId);
                    if (doctor?.googleRefreshToken) {
                      await deleteCalendarEvent(
                        doctor.googleRefreshToken,
                        doctor.googleCalendarId || "primary",
                        appointment.googleEventId
                      );
                      const event = await createCalendarEvent(
                        doctor.googleRefreshToken,
                        doctor.googleCalendarId || "primary",
                        {
                          patientName: appointment.patient.name,
                          doctorName: doctor.name,
                          date: rescheduleData.newDate,
                          time: rescheduleData.newTime,
                          service: appointment.service,
                          duration: duration,
                        },
                        clinicTimezone,
                      );
                      await storage.updateAppointment(appointment.id, { googleEventId: event.id });
                    }
                  } catch (calErr) {
                    console.error("Failed to update Google Calendar event:", calErr);
                  }
                }
                
                if (appointment.patient.email) {
                  const reschDoctor = appointment.doctorId ? await storage.getDoctorById(appointment.doctorId) : null;
                  sendAppointmentRescheduledEmail({
                    patientEmail: appointment.patient.email,
                    patientName: appointment.patient.name,
                    doctorName: reschDoctor?.name || "Doctor",
                    oldDate: oldDate,
                    newDate: newDateTime,
                    service: appointment.service,
                    duration: duration,
                    referenceNumber: refNum,
                  }).catch((e) => console.error("Failed to send reschedule email:", e));
                }

                rescheduleResult = JSON.stringify({
                  success: true,
                  message: `Appointment ${refNum} has been rescheduled from ${oldDate.toISOString().split("T")[0]} to ${rescheduleData.newDate} at ${rescheduleData.newTime}.`,
                  referenceNumber: refNum,
                  newDate: rescheduleData.newDate,
                  newTime: rescheduleData.newTime,
                });
              }
            }
          }
          
          currentMessages.push(responseMessage);
          currentMessages.push({
            role: "tool",
            tool_call_id: rescheduleToolCall.id,
            content: rescheduleResult,
          });
          
          const rescheduleFollowUp = await openai.chat.completions.create({
            model: process.env.CHAT_AI_MODEL || "gpt-4o-mini",
            messages: currentMessages,
          });
          
          responseMessage = rescheduleFollowUp.choices[0]?.message;
        } catch (e) {
          console.error("Error rescheduling appointment:", e);
        }
      }

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

            const invalidNames = ["pending", "unknown", "test", "user", "patient", "name", "n/a", "na", "tbd", "to be determined"];
            const patientName = (bookingData.patientName || "").trim().toLowerCase();
            const patientPhone = (bookingData.patientPhone || "").trim();
            
            if (!bookingData.patientName || patientName.length < 2) {
              throw new Error("MISSING_INFO: I need your full name to book the appointment. What is your name?");
            }
            
            const nameParts = patientName.split(/\s+/);
            if (nameParts.some(part => invalidNames.includes(part)) || 
                (nameParts.length >= 2 && nameParts[0] === nameParts[1])) {
              throw new Error("MISSING_INFO: I need your real full name to book the appointment. Could you please tell me your name?");
            }
            
            if (!patientPhone || patientPhone.length < 6) {
              throw new Error("MISSING_INFO: I need your phone number to book the appointment. What is your phone number?");
            }
            
            const invalidPhones = ["0000000", "1234567", "pending", "unknown", "test", "n/a", "na", "tbd"];
            if (invalidPhones.some(p => patientPhone.toLowerCase().includes(p))) {
              throw new Error("MISSING_INFO: I need a valid phone number to book the appointment. What is your phone number?");
            }

            const appointmentDateTime = clinicTimeToUTC(bookingData.date, bookingData.time, clinicTimezone);
            const appointmentDuration = settings?.appointmentDuration || 30;

            if (bookingData.date < today) {
              throw new Error("SLOT_UNAVAILABLE: Cannot book appointments in the past. Please choose a future date.");
            }
            if (bookingData.date === today) {
              if (isClinicTimePast(bookingData.date, bookingData.time, clinicTimezone)) {
                throw new Error("SLOT_UNAVAILABLE: This time has already passed. Please choose a later time today or another day.");
              }
            }

            const openTime = settings?.openTime || "09:00:00";
            const closeTime = settings?.closeTime || "17:00:00";
            const requestedTime = bookingData.time;

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

            const dayOfWeek = appointmentDateTime.getDay();
            const workingDays = settings?.workingDays || [1, 2, 3, 4, 5, 6];
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

            const doctorUnavailability = await storage.getDoctorAvailabilityForDate(bookingData.doctorId, bookingData.date);
            
            for (const block of doctorUnavailability) {
              if (!block.isAvailable) {
                const [blockStartH, blockStartM] = block.startTime.split(":").map(Number);
                const [blockEndH, blockEndM] = block.endTime.split(":").map(Number);
                const blockStart = blockStartH * 60 + blockStartM;
                const blockEnd = blockEndH * 60 + blockEndM;
                
                if (requestedMinutes < blockEnd && appointmentEndMinutes > blockStart) {
                  throw new Error(
                    `SLOT_UNAVAILABLE: ${bookingData.doctorName} is not available on ${bookingData.date} from ${block.startTime.slice(0, 5)} to ${block.endTime.slice(0, 5)}${block.reason ? ` (${block.reason})` : ''}.`,
                  );
                }
              }
            }

            const existingAppointments =
              await storage.getAppointmentsByDoctorId(bookingData.doctorId);
            const conflictingAppointment = existingAppointments.find((apt) => {
              if (apt.status === "cancelled") return false;

              const aptStart = new Date(apt.date).getTime();
              const aptEnd = aptStart + apt.duration * 60 * 1000;
              const newStart = appointmentDateTime.getTime();
              const newEnd = newStart + appointmentDuration * 60 * 1000;

              return newStart < aptEnd && newEnd > aptStart;
            });

            if (conflictingAppointment) {
              const alternativeSlots = await findAvailableSlots(
                bookingData.doctorId,
                bookingData.date,
                openMinutes,
                closeMinutes,
                appointmentDuration,
                existingAppointments,
                workingDays,
                clinicTimezone,
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
                  clinicTimezone,
                );
                
                await storage.updateAppointment(appointment.id, {
                  googleEventId: event.id,
                });
                console.log("Created Google Calendar event for chat appointment:", appointment.id);
              }
            } catch (calendarError) {
              console.error("Failed to sync chat appointment to Google Calendar:", calendarError);
            }

            bookingResult = {
              success: true,
              appointmentId: appointment.id,
              referenceNumber: appointment.referenceNumber,
              patientName: bookingData.patientName,
              doctorName: bookingData.doctorName,
              date: bookingData.date,
              time: bookingData.time,
              service: bookingData.service,
            };

            const bookedPatientEmail = bookingData.patientEmail || patient.email;
            if (bookedPatientEmail) {
              sendAppointmentConfirmationEmail({
                patientEmail: bookedPatientEmail,
                patientName: bookingData.patientName,
                doctorName: bookingData.doctorName,
                date: appointmentDateTime,
                service: bookingData.service,
                duration: appointmentDuration,
                referenceNumber: appointment.referenceNumber || "",
              }).catch((e) => console.error("Failed to send confirmation email:", e));
            }

            const confirmationResponse = await openai.chat.completions.create({
              model: process.env.CHAT_AI_MODEL || "gpt-4o-mini",
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
                    message: `Appointment booked successfully! Reference number: ${appointment.referenceNumber}`,
                    referenceNumber: appointment.referenceNumber,
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
            
            const chunkSize = 3;
            for (let i = 0; i < confirmationContent.length; i += chunkSize) {
              const chunk = confirmationContent.slice(i, i + chunkSize);
              res.write(`data: ${JSON.stringify({ content: chunk })}\n\n`);
              await new Promise(resolve => setTimeout(resolve, 15));
            }
            fullResponse = confirmationContent;
            
            await storage.createChatMessage({
              sessionId,
              role: "assistant",
              content: fullResponse,
            });
          } catch (bookingError: any) {
            console.error("Booking error:", bookingError);

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
            
            const chunkSize = 3;
            for (let i = 0; i < errorMessage.length; i += chunkSize) {
              const chunk = errorMessage.slice(i, i + chunkSize);
              res.write(`data: ${JSON.stringify({ content: chunk })}\n\n`);
              await new Promise(resolve => setTimeout(resolve, 15));
            }
            fullResponse = errorMessage;
            
            await storage.createChatMessage({
              sessionId,
              role: "assistant",
              content: fullResponse,
            });
          }
        }
      } else {
        const content = responseMessage?.content || "";
        if (content) {
          const chunkSize = 3;
          for (let i = 0; i < content.length; i += chunkSize) {
            const chunk = content.slice(i, i + chunkSize);
            res.write(`data: ${JSON.stringify({ content: chunk })}\n\n`);
            await new Promise(resolve => setTimeout(resolve, 15));
          }
          fullResponse = content;
          
          await storage.createChatMessage({
            sessionId,
            role: "assistant",
            content: fullResponse,
          });
        }
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

      async function getAvailableSlotsSimple(doctorId: number, dateStr: string): Promise<{ available: boolean; slots: string[]; blockedPeriods: string[] }> {
        return getAvailableSlotsForDate(doctorId, dateStr, settings);
      }

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
