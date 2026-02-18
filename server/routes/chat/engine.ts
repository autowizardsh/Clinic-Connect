import { storage } from "../../storage";
import { openai } from "../../services/openai";
import { createCalendarEvent, deleteCalendarEvent } from "../../google-calendar";
import { sendAppointmentConfirmationEmail, sendAppointmentCancelledEmail, sendAppointmentRescheduledEmail } from "../../services/email";
import { scheduleRemindersForAppointment, rescheduleRemindersForAppointment, cancelRemindersForAppointment } from "../../services/reminders";
import {
  checkAvailabilityFunction,
  bookingFunction,
  lookupAppointmentFunction,
  cancelAppointmentFunction,
  rescheduleAppointmentFunction,
  findEmergencySlotFunction,
  lookupPatientByEmailFunction,
  checkWalkinAvailabilityFunction,
  bookWalkinFunction,
} from "./tools";
import { buildSystemPrompt } from "./prompts";
import { findAvailableSlots, getAvailableSlotsForDate, findEmergencySlot } from "./availability";
import { determineQuickReplies } from "./quickReplies";
import { getNowInTimezone, clinicTimeToUTC, isClinicTimePast, getTomorrowInTimezone, getDayAfterTomorrowInTimezone } from "../../utils/timezone";

export interface ChatEngineResult {
  response: string;
  quickReplies: { label: string; value: string }[];
  booking: {
    success: boolean;
    appointmentId: number;
    referenceNumber: string;
    patientName: string;
    doctorName: string;
    date: string;
    time: string;
    service: string;
    appointmentType?: string;
    timePeriod?: string;
  } | null;
}

export async function processChatMessage(
  sessionId: string,
  message: string,
  language: string = "en",
  source: string = "chat",
): Promise<ChatEngineResult> {
  await storage.createChatMessage({
    sessionId,
    role: "user",
    content: message,
  });

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
    clinicName:
      settings?.clinicName ||
      (language === "nl" ? "de tandartskliniek" : "the dental clinic"),
    services,
    activeDoctors: activeDoctors.map((d) => ({
      id: d.id,
      name: d.name,
      specialty: d.specialty,
    })),
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

  let currentMessages: any[] = [
    { role: "system", content: systemPrompt },
    ...conversationHistory,
    { role: "user", content: message },
  ];

  const allTools = [
    checkAvailabilityFunction,
    bookingFunction,
    lookupAppointmentFunction,
    cancelAppointmentFunction,
    rescheduleAppointmentFunction,
    findEmergencySlotFunction,
    lookupPatientByEmailFunction,
    checkWalkinAvailabilityFunction,
    bookWalkinFunction,
  ];

  let initialResponse = await openai.chat.completions.create({
    model: process.env.CHAT_AI_MODEL || "gpt-4o-mini",
    messages: currentMessages,
    tools: allTools,
    tool_choice: "auto",
  });

  let responseMessage = initialResponse.choices[0]?.message;
  let fullResponse = "";
  let bookingResult: ChatEngineResult["booking"] = null;

  if (
    responseMessage?.tool_calls &&
    responseMessage.tool_calls.length > 0 &&
    (responseMessage.tool_calls[0] as any)?.function?.name ===
      "find_emergency_slot"
  ) {
    const emergencyToolCall = responseMessage.tool_calls[0] as {
      id: string;
      function: { name: string; arguments: string };
    };

    try {
      const emergencyResult = await findEmergencySlot(settings || null);

      currentMessages.push(responseMessage);
      currentMessages.push({
        role: "tool",
        tool_call_id: emergencyToolCall.id,
        content: JSON.stringify(emergencyResult),
      });

      const emergencyFollowUp = await openai.chat.completions.create({
        model: process.env.CHAT_AI_MODEL || "gpt-4o-mini",
        messages: currentMessages,
        tools: allTools,
        tool_choice: "auto",
      });

      responseMessage = emergencyFollowUp.choices[0]?.message;
    } catch (e) {
      console.error("Error finding emergency slot:", e);
    }
  }

  if (
    responseMessage?.tool_calls &&
    responseMessage.tool_calls.length > 0 &&
    (responseMessage.tool_calls[0] as any)?.function?.name ===
      "check_availability"
  ) {
    const checkToolCall = responseMessage.tool_calls[0] as {
      id: string;
      function: { name: string; arguments: string };
    };

    try {
      const checkData = JSON.parse(checkToolCall.function.arguments);
      const availability = await getAvailableSlotsForDate(
        checkData.doctorId,
        checkData.date,
        settings || null,
      );
      const doctor = activeDoctors.find((d) => d.id === checkData.doctorId);
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
        tools: allTools,
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
    (responseMessage.tool_calls[0] as any)?.function?.name ===
      "lookup_appointment"
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
        lookupResult = JSON.stringify({
          found: false,
          error:
            "No appointment found with this reference number. Please check and try again.",
        });
      } else if (
        !appointment.patient.phone ||
        !phone ||
        appointment.patient.phone.replace(/\D/g, "").slice(-6) !==
          phone.replace(/\D/g, "").slice(-6)
      ) {
        lookupResult = JSON.stringify({
          found: false,
          error:
            "Phone number does not match our records. Please verify your phone number.",
        });
      } else if (appointment.status === "cancelled") {
        lookupResult = JSON.stringify({
          found: false,
          error: "This appointment has already been cancelled.",
        });
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
          appointmentType: appointment.appointmentType,
          timePeriod: appointment.timePeriod,
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
        tools: allTools,
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
    (responseMessage.tool_calls[0] as any)?.function?.name ===
      "cancel_appointment"
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
        cancelResult = JSON.stringify({
          success: false,
          error: "Appointment not found.",
        });
      } else if (
        !phone ||
        appointment.patient.phone.replace(/\D/g, "").slice(-6) !==
          phone.replace(/\D/g, "").slice(-6)
      ) {
        cancelResult = JSON.stringify({
          success: false,
          error: "Phone verification failed. Cannot cancel.",
        });
      } else if (appointment.status === "cancelled") {
        cancelResult = JSON.stringify({
          success: false,
          error: "This appointment is already cancelled.",
        });
      } else {
        await storage.updateAppointment(appointment.id, {
          status: "cancelled",
        });

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
            console.error("Failed to delete Google Calendar event:", calErr);
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
          }).catch((e) => console.error("Failed to send cancellation email:", e));
        }

        cancelRemindersForAppointment(appointment.id).catch((e) =>
          console.error("Failed to cancel reminders:", e)
        );

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
    (responseMessage.tool_calls[0] as any)?.function?.name ===
      "reschedule_appointment"
  ) {
    const rescheduleToolCall = responseMessage.tool_calls[0] as {
      id: string;
      function: { name: string; arguments: string };
    };

    try {
      const rescheduleData = JSON.parse(rescheduleToolCall.function.arguments);
      const refNum = (rescheduleData.referenceNumber || "")
        .toUpperCase()
        .trim();
      const phone = (rescheduleData.phoneNumber || "").trim();

      const appointment = await storage.getAppointmentByReferenceNumber(refNum);

      let rescheduleResult = "";
      if (!appointment) {
        rescheduleResult = JSON.stringify({
          success: false,
          error: "Appointment not found.",
        });
      } else if (
        !phone ||
        appointment.patient.phone.replace(/\D/g, "").slice(-6) !==
          phone.replace(/\D/g, "").slice(-6)
      ) {
        rescheduleResult = JSON.stringify({
          success: false,
          error: "Phone verification failed. Cannot reschedule.",
        });
      } else if (appointment.status === "cancelled") {
        rescheduleResult = JSON.stringify({
          success: false,
          error: "Cannot reschedule a cancelled appointment.",
        });
      } else if (appointment.appointmentType === "walk-in") {
        rescheduleResult = JSON.stringify({
          success: false,
          error: "Walk-in appointments cannot be rescheduled to a specific time. Please cancel this walk-in and book a new appointment instead.",
        });
      } else {
        const newDateTime = clinicTimeToUTC(rescheduleData.newDate, rescheduleData.newTime, clinicTimezone);

        if (isClinicTimePast(rescheduleData.newDate, rescheduleData.newTime, clinicTimezone)) {
          rescheduleResult = JSON.stringify({
            success: false,
            error: "Cannot reschedule to a past date/time.",
          });
        } else {
          const existingAppointments = appointment.doctorId
            ? await storage.getAppointmentsByDoctorId(appointment.doctorId)
            : [];
          const duration = appointment.duration || 30;
          const conflicting = existingAppointments.find((apt) => {
            if (apt.id === appointment.id || apt.status === "cancelled")
              return false;
            const aptStart = new Date(apt.date).getTime();
            const aptEnd = aptStart + apt.duration * 60 * 1000;
            const newStart = newDateTime.getTime();
            const newEnd = newStart + duration * 60 * 1000;
            return newStart < aptEnd && newEnd > aptStart;
          });

          if (conflicting) {
            rescheduleResult = JSON.stringify({
              success: false,
              error:
                "The new time slot conflicts with another appointment. Please choose a different time.",
            });
          } else {
            const oldDate = new Date(appointment.date);
            await storage.updateAppointment(appointment.id, {
              date: newDateTime,
            });

            if (appointment.googleEventId && appointment.doctorId) {
              try {
                const doctor = await storage.getDoctorById(
                  appointment.doctorId,
                );
                if (doctor?.googleRefreshToken) {
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
                      date: rescheduleData.newDate,
                      time: rescheduleData.newTime,
                      service: appointment.service,
                      duration: duration,
                    },
                    clinicTimezone,
                  );
                  await storage.updateAppointment(appointment.id, {
                    googleEventId: event.id,
                  });
                }
              } catch (calErr) {
                console.error(
                  "Failed to update Google Calendar event:",
                  calErr,
                );
              }
            }

            if (appointment.patient.email) {
              const doctor = appointment.doctorId ? await storage.getDoctorById(appointment.doctorId) : null;
              sendAppointmentRescheduledEmail({
                patientEmail: appointment.patient.email,
                patientName: appointment.patient.name,
                doctorName: doctor?.name || "Doctor",
                oldDate: oldDate,
                newDate: newDateTime,
                service: appointment.service,
                duration: duration,
                referenceNumber: refNum,
              }).catch((e) => console.error("Failed to send reschedule email:", e));
            }

            rescheduleRemindersForAppointment(appointment.id).catch((e) =>
              console.error("Failed to reschedule reminders:", e)
            );

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
    responseMessage.tool_calls.length > 0 &&
    (responseMessage.tool_calls[0] as any)?.function?.name ===
      "lookup_patient_by_email"
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
        tools: allTools,
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
    (responseMessage.tool_calls[0] as any)?.function?.name ===
      "check_walkin_availability"
  ) {
    const walkinCheckToolCall = responseMessage.tool_calls[0] as {
      id: string;
      function: { name: string; arguments: string };
    };

    try {
      const checkData = JSON.parse(walkinCheckToolCall.function.arguments);
      const requestedDate = checkData.date;

      if (requestedDate < today) {
        const result = JSON.stringify({ available: false, error: "Cannot check availability for past dates." });
        currentMessages.push(responseMessage);
        currentMessages.push({ role: "tool", tool_call_id: walkinCheckToolCall.id, content: result });
      } else {
        const openTime = settings?.openTime || "09:00";
        const closeTime = settings?.closeTime || "17:00";
        const [openH] = openTime.split(":").map(Number);
        const [closeH] = closeTime.split(":").map(Number);

        const periods: { name: string; available: boolean; description: string }[] = [];

        if (openH < 12) {
          periods.push({ name: "morning", available: true, description: `${openTime.slice(0, 5)} - 12:00` });
        }
        if (openH < 16 && closeH > 12) {
          periods.push({ name: "afternoon", available: true, description: `12:00 - ${Math.min(closeH, 16)}:00` });
        }
        if (closeH > 16) {
          periods.push({ name: "evening", available: true, description: `16:00 - ${closeTime.slice(0, 5)}` });
        }

        if (requestedDate === today) {
          const currentHour = parseInt(clinicNow.timeStr.split(":")[0]);
          for (const period of periods) {
            const periodEndHour = period.name === "morning" ? 12 : period.name === "afternoon" ? 16 : closeH;
            if (currentHour >= periodEndHour) {
              period.available = false;
            }
          }
        }

        const dayOfWeek = new Date(requestedDate + "T12:00:00").getDay();
        const workingDays = settings?.workingDays || [1, 2, 3, 4, 5, 6];
        if (!workingDays.includes(dayOfWeek)) {
          for (const period of periods) {
            period.available = false;
          }
        }

        const result = JSON.stringify({
          date: requestedDate,
          periods: periods.filter(p => p.available),
          clinicOpen: openTime.slice(0, 5),
          clinicClose: closeTime.slice(0, 5),
          isWorkingDay: workingDays.includes(dayOfWeek),
        });

        currentMessages.push(responseMessage);
        currentMessages.push({ role: "tool", tool_call_id: walkinCheckToolCall.id, content: result });
      }

      const walkinCheckFollowUp = await openai.chat.completions.create({
        model: process.env.CHAT_AI_MODEL || "gpt-4o-mini",
        messages: currentMessages,
        tools: allTools,
        tool_choice: "auto",
      });

      responseMessage = walkinCheckFollowUp.choices[0]?.message;
    } catch (e) {
      console.error("Error checking walk-in availability:", e);
    }
  }

  if (
    responseMessage?.tool_calls &&
    responseMessage.tool_calls.length > 0 &&
    (responseMessage.tool_calls[0] as any)?.function?.name ===
      "book_walkin"
  ) {
    const walkinToolCall = responseMessage.tool_calls[0] as {
      id: string;
      type: string;
      function: { name: string; arguments: string };
    };

    try {
      const walkinData = JSON.parse(walkinToolCall.function.arguments);

      const invalidNames = ["pending", "unknown", "test", "user", "patient", "name", "n/a", "na", "tbd"];
      const patientName = (walkinData.patientName || "").trim().toLowerCase();
      const patientPhone = (walkinData.patientPhone || "").trim();

      if (!walkinData.patientName || patientName.length < 2) {
        throw new Error("MISSING_INFO: I need your full name to book the walk-in visit. What is your name?");
      }
      if (invalidNames.some((n) => patientName.split(/\s+/).includes(n))) {
        throw new Error("MISSING_INFO: I need your real full name. Could you please tell me your name?");
      }
      if (!patientPhone || patientPhone.length < 6) {
        throw new Error("MISSING_INFO: I need your phone number to book the walk-in visit. What is your phone number?");
      }
      if (!walkinData.patientEmail) {
        throw new Error("MISSING_INFO: I need your email address to send the appointment confirmation. What is your email?");
      }

      const openTime = settings?.openTime || "09:00";
      const closeTime = settings?.closeTime || "17:00";
      const timePeriodMap: Record<string, string> = {
        morning: openTime.slice(0, 5),
        afternoon: "12:00",
        evening: "16:00",
      };
      const representativeTime = timePeriodMap[walkinData.timePeriod] || openTime.slice(0, 5);
      const appointmentDateTime = clinicTimeToUTC(walkinData.date, representativeTime, clinicTimezone);

      let patient = await storage.getPatientByPhone(walkinData.patientPhone);
      if (!patient) {
        patient = await storage.createPatient({
          name: walkinData.patientName,
          phone: walkinData.patientPhone,
          email: walkinData.patientEmail || null,
          notes: `Walk-in booked via ${source} on ${new Date().toLocaleDateString()}`,
        });
      }

      const appointment = await storage.createAppointment({
        patientId: patient.id,
        doctorId: null,
        date: appointmentDateTime,
        duration: settings?.appointmentDuration || 30,
        status: "scheduled",
        service: walkinData.service,
        notes: walkinData.notes || `Walk-in - ${walkinData.timePeriod}`,
        source,
        appointmentType: "walk-in",
        timePeriod: walkinData.timePeriod,
      });

      bookingResult = {
        success: true,
        appointmentId: appointment.id,
        referenceNumber: appointment.referenceNumber!,
        patientName: walkinData.patientName,
        doctorName: "Any available doctor",
        date: walkinData.date,
        time: walkinData.timePeriod,
        service: walkinData.service,
        appointmentType: "walk-in",
        timePeriod: walkinData.timePeriod,
      };

      const patientEmail = walkinData.patientEmail || patient.email;
      if (patientEmail) {
        sendAppointmentConfirmationEmail({
          patientEmail,
          patientName: walkinData.patientName,
          doctorName: "Any available doctor (walk-in)",
          date: appointmentDateTime,
          service: walkinData.service,
          duration: settings?.appointmentDuration || 30,
          referenceNumber: appointment.referenceNumber!,
        }).catch((e) => console.error("Failed to send walk-in confirmation email:", e));
      }

      scheduleRemindersForAppointment(appointment.id).catch((e) =>
        console.error("Failed to schedule walk-in reminders:", e)
      );

      const confirmationResponse = await openai.chat.completions.create({
        model: process.env.CHAT_AI_MODEL || "gpt-4o-mini",
        messages: [
          { role: "system", content: systemPrompt },
          ...conversationHistory,
          { role: "user", content: message },
          responseMessage,
          {
            role: "tool",
            tool_call_id: walkinToolCall.id,
            content: JSON.stringify({
              success: true,
              message: `Walk-in appointment registered! Reference number: ${appointment.referenceNumber}. Come in on ${walkinData.date} during the ${walkinData.timePeriod} (${timePeriodMap[walkinData.timePeriod]} onwards). The first available doctor will see you.`,
              referenceNumber: appointment.referenceNumber,
              details: bookingResult,
            }),
          },
        ],
      });

      fullResponse =
        confirmationResponse.choices[0]?.message?.content ||
        (language === "nl"
          ? `Uw walk-in afspraak is geregistreerd! Referentienummer: ${appointment.referenceNumber}. Kom op ${walkinData.date} in de ${walkinData.timePeriod === "morning" ? "ochtend" : walkinData.timePeriod === "afternoon" ? "middag" : "avond"}.`
          : `Your walk-in appointment is registered! Reference: ${appointment.referenceNumber}. Come in on ${walkinData.date} during the ${walkinData.timePeriod}. The first available doctor will see you.`);
    } catch (walkinError: any) {
      console.error("Walk-in booking error:", walkinError);
      if (walkinError.message?.startsWith("MISSING_INFO:")) {
        fullResponse = walkinError.message.replace("MISSING_INFO: ", "");
      } else {
        fullResponse = language === "nl"
          ? "Er is een fout opgetreden bij het registreren van uw walk-in afspraak. Probeer het opnieuw."
          : "There was an error registering your walk-in appointment. Please try again.";
      }
    }
  }

  if (
    responseMessage?.tool_calls &&
    responseMessage.tool_calls.length > 0 &&
    (responseMessage.tool_calls[0] as any)?.function?.name ===
      "book_appointment"
  ) {
    const toolCall = responseMessage.tool_calls[0] as {
      id: string;
      type: string;
      function: { name: string; arguments: string };
    };

    try {
      const bookingData = JSON.parse(toolCall.function.arguments);

      const invalidNames = [
        "pending",
        "unknown",
        "test",
        "user",
        "patient",
        "name",
        "n/a",
        "na",
        "tbd",
        "to be determined",
      ];
      const patientName = (bookingData.patientName || "").trim().toLowerCase();
      const patientPhone = (bookingData.patientPhone || "").trim();

      if (!bookingData.patientName || patientName.length < 2) {
        throw new Error(
          "MISSING_INFO: I need your full name to book the appointment. What is your name?",
        );
      }

      const nameParts = patientName.split(/\s+/);
      if (
        nameParts.some((part: string) => invalidNames.includes(part)) ||
        (nameParts.length >= 2 && nameParts[0] === nameParts[1])
      ) {
        throw new Error(
          "MISSING_INFO: I need your real full name to book the appointment. Could you please tell me your name?",
        );
      }

      if (!patientPhone || patientPhone.length < 6) {
        throw new Error(
          "MISSING_INFO: I need your phone number to book the appointment. What is your phone number?",
        );
      }

      const invalidPhones = [
        "0000000",
        "1234567",
        "pending",
        "unknown",
        "test",
        "n/a",
        "na",
        "tbd",
      ];
      if (
        invalidPhones.some((p) => patientPhone.toLowerCase().includes(p))
      ) {
        throw new Error(
          "MISSING_INFO: I need a valid phone number to book the appointment. What is your phone number?",
        );
      }

      const appointmentDateTime = clinicTimeToUTC(bookingData.date, bookingData.time, clinicTimezone);
      const appointmentDuration = settings?.appointmentDuration || 30;

      if (bookingData.date < today) {
        throw new Error(
          "SLOT_UNAVAILABLE: Cannot book appointments in the past. Please choose a future date.",
        );
      }

      if (bookingData.date === today) {
        if (isClinicTimePast(bookingData.date, bookingData.time, clinicTimezone)) {
          throw new Error(
            "SLOT_UNAVAILABLE: This time has already passed. Please choose a later time today or another day.",
          );
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
      const appointmentEndMinutes = requestedMinutes + appointmentDuration;

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

      const doctorUnavailability =
        await storage.getDoctorAvailabilityForDate(
          bookingData.doctorId,
          bookingData.date,
        );

      for (const block of doctorUnavailability) {
        if (!block.isAvailable) {
          const [blockStartH, blockStartM] = block.startTime
            .split(":")
            .map(Number);
          const [blockEndH, blockEndM] = block.endTime
            .split(":")
            .map(Number);
          const blockStart = blockStartH * 60 + blockStartM;
          const blockEnd = blockEndH * 60 + blockEndM;

          if (
            requestedMinutes < blockEnd &&
            appointmentEndMinutes > blockStart
          ) {
            throw new Error(
              `SLOT_UNAVAILABLE: ${bookingData.doctorName} is not available on ${bookingData.date} from ${block.startTime.slice(0, 5)} to ${block.endTime.slice(0, 5)}${block.reason ? ` (${block.reason})` : ""}.`,
            );
          }
        }
      }

      const existingAppointments = await storage.getAppointmentsByDoctorId(
        bookingData.doctorId,
      );
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
            "SLOT_UNAVAILABLE: This time slot is already booked and no alternatives found for this day. Please try a different day.",
          );
        }
      }

      let patient = await storage.getPatientByPhone(bookingData.patientPhone);
      if (!patient) {
        patient = await storage.createPatient({
          name: bookingData.patientName,
          phone: bookingData.patientPhone,
          email: bookingData.patientEmail || null,
          notes: `Booked via ${source} on ${new Date().toLocaleDateString()}`,
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
        source,
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
              service: bookingData.service || "Dental Appointment",
              notes: bookingData.notes || undefined,
              duration: appointmentDuration,
            },
            clinicTimezone,
          );
          await storage.updateAppointment(appointment.id, {
            googleEventId: event.id,
          });
        }
      } catch (calendarError) {
        console.error("Failed to sync appointment to Google Calendar:", calendarError);
      }

      bookingResult = {
        success: true,
        appointmentId: appointment.id,
        referenceNumber: appointment.referenceNumber!,
        patientName: bookingData.patientName,
        doctorName: bookingData.doctorName,
        date: bookingData.date,
        time: bookingData.time,
        service: bookingData.service,
      };

      const patientEmail = bookingData.patientEmail || patient.email;
      if (patientEmail) {
        sendAppointmentConfirmationEmail({
          patientEmail,
          patientName: bookingData.patientName,
          doctorName: bookingData.doctorName,
          date: appointmentDateTime,
          service: bookingData.service,
          duration: appointmentDuration,
          referenceNumber: appointment.referenceNumber!,
        }).catch((e) => console.error("Failed to send confirmation email:", e));
      }

      scheduleRemindersForAppointment(appointment.id).catch((e) =>
        console.error("Failed to schedule reminders:", e)
      );

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

      fullResponse =
        confirmationResponse.choices[0]?.message?.content ||
        (language === "nl"
          ? `Uw afspraak is geboekt! Afspraak voor ${bookingData.service} met Dr. ${bookingData.doctorName} op ${bookingData.date} om ${bookingData.time}.`
          : `Your appointment is booked! Appointment for ${bookingData.service} with Dr. ${bookingData.doctorName} on ${bookingData.date} at ${bookingData.time}.`);
    } catch (bookingError: any) {
      console.error("Booking error:", bookingError);

      if (
        bookingError.message?.startsWith("SLOT_UNAVAILABLE_WITH_ALTERNATIVES:")
      ) {
        const reason = bookingError.message.replace(
          "SLOT_UNAVAILABLE_WITH_ALTERNATIVES: ",
          "",
        );
        fullResponse =
          language === "nl"
            ? `Sorry, dit tijdslot is al geboekt. ${reason}. Wilt u een van deze tijden boeken?`
            : `Sorry, this time slot is already booked. ${reason}. Would you like to book one of these times?`;
      } else if (bookingError.message?.startsWith("SLOT_UNAVAILABLE:")) {
        const reason = bookingError.message.replace("SLOT_UNAVAILABLE: ", "");
        fullResponse =
          language === "nl"
            ? `Sorry, dit tijdslot is niet beschikbaar. ${reason} Kies alstublieft een ander tijdstip.`
            : `Sorry, this time slot is not available. ${reason} Please choose a different time.`;
      } else if (bookingError.message?.startsWith("MISSING_INFO:")) {
        const reason = bookingError.message.replace("MISSING_INFO: ", "");
        fullResponse = reason;
      } else {
        fullResponse =
          language === "nl"
            ? "Er is een fout opgetreden bij het boeken. Probeer het opnieuw."
            : "There was an error booking your appointment. Please try again.";
      }
    }
  }

  if (!fullResponse) {
    fullResponse = responseMessage?.content || "";
  }

  if (fullResponse) {
    await storage.createChatMessage({
      sessionId,
      role: "assistant",
      content: fullResponse,
    });
  }

  let quickReplies: { label: string; value: string }[] = [];
  try {
    quickReplies = await determineQuickReplies(
      message,
      fullResponse,
      conversationHistory,
      language,
    );
  } catch (qrError) {
    console.error("Error determining quick replies:", qrError);
  }

  return {
    response: fullResponse,
    quickReplies,
    booking: bookingResult,
  };
}

export async function createChatSession(
  language: string = "en",
): Promise<{ sessionId: string; welcomeMessage: string }> {
  const { randomUUID } = await import("crypto");
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

  const welcomeMessage =
    language === "nl"
      ? `Welkom bij ${settings.clinicName}! Ik ben uw AI-assistent. Ik kan u helpen met het boeken van een afspraak. Hoe kan ik u vandaag helpen?`
      : `Welcome to ${settings.clinicName}! I'm your AI assistant. I can help you book an appointment. How may I help you today?`;

  await storage.createChatMessage({
    sessionId,
    role: "assistant",
    content: welcomeMessage,
  });

  return { sessionId, welcomeMessage };
}
