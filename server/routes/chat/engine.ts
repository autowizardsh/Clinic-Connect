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
} from "./tools";
import { buildSystemPrompt } from "./prompts";
import { findAvailableSlots, getAvailableSlotsForDate } from "./availability";
import { determineQuickReplies } from "./quickReplies";

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
  const now = new Date();
  const formatLocalDate = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const today = formatLocalDate(now);
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const dayAfterTomorrow = new Date(now);
  dayAfterTomorrow.setDate(dayAfterTomorrow.getDate() + 2);
  const currentDayOfWeek = now.getDay();

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
    today,
    tomorrow: formatLocalDate(tomorrow),
    dayAfterTomorrow: formatLocalDate(dayAfterTomorrow),
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
    lookupPatientByEmailFunction,
  ];

  let initialResponse = await openai.chat.completions.create({
    model: "gpt-4o",
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
        model: "gpt-4o",
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
      "lookup_patient_by_email"
  ) {
    const emailToolCall = responseMessage.tool_calls[0] as {
      id: string;
      function: { name: string; arguments: string };
    };

    try {
      const emailData = JSON.parse(emailToolCall.function.arguments);
      const email = (emailData.email || "").trim().toLowerCase();

      const patient = await storage.getPatientByEmail(email);

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
          message: "No patient found with this email address. Please treat them as a new patient and collect their full details.",
        });
      }

      currentMessages.push(responseMessage);
      currentMessages.push({
        role: "tool",
        tool_call_id: emailToolCall.id,
        content: lookupResult,
      });

      const emailFollowUp = await openai.chat.completions.create({
        model: "gpt-4o",
        messages: currentMessages,
        tools: allTools,
        tool_choice: "auto",
      });

      responseMessage = emailFollowUp.choices[0]?.message;
    } catch (e) {
      console.error("Error looking up patient by email:", e);
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
          doctorName: appointment.doctor.name,
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
        model: "gpt-4o",
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

        if (appointment.googleEventId) {
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
          const doctor = await storage.getDoctorById(appointment.doctorId);
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
        model: "gpt-4o",
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
      } else {
        const newDateTime = new Date(
          `${rescheduleData.newDate}T${rescheduleData.newTime}:00`,
        );
        const nowCheck = new Date();

        if (newDateTime <= nowCheck) {
          rescheduleResult = JSON.stringify({
            success: false,
            error: "Cannot reschedule to a past date/time.",
          });
        } else {
          const existingAppointments =
            await storage.getAppointmentsByDoctorId(appointment.doctorId);
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

            if (appointment.googleEventId) {
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
                    "Europe/Amsterdam",
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
              const doctor = await storage.getDoctorById(appointment.doctorId);
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
        model: "gpt-4o",
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

      const patientEmailAddr = (bookingData.patientEmail || "").trim();
      if (!patientEmailAddr || !patientEmailAddr.includes("@")) {
        throw new Error(
          "MISSING_INFO: I need your email address to book the appointment. What is your email?",
        );
      }

      const appointmentDateTime = new Date(
        `${bookingData.date}T${bookingData.time}:00`,
      );
      const appointmentDuration = settings?.appointmentDuration || 30;

      const todayStart = new Date(
        now.getFullYear(),
        now.getMonth(),
        now.getDate(),
      );
      const appointmentDate = new Date(
        appointmentDateTime.getFullYear(),
        appointmentDateTime.getMonth(),
        appointmentDateTime.getDate(),
      );

      if (appointmentDate < todayStart) {
        throw new Error(
          "SLOT_UNAVAILABLE: Cannot book appointments in the past. Please choose a future date.",
        );
      }

      if (appointmentDate.getTime() === todayStart.getTime()) {
        if (appointmentDateTime.getTime() < now.getTime()) {
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

      let patient = await storage.getPatientByEmail(patientEmailAddr);
      if (!patient) {
        patient = await storage.getPatientByPhone(bookingData.patientPhone);
      }
      if (patient) {
        await storage.updatePatient(patient.id, {
          name: bookingData.patientName,
          phone: bookingData.patientPhone,
          email: patientEmailAddr,
        });
      } else {
        patient = await storage.createPatient({
          name: bookingData.patientName,
          phone: bookingData.patientPhone,
          email: patientEmailAddr,
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
            "Europe/Amsterdam",
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

      if (patientEmailAddr) {
        sendAppointmentConfirmationEmail({
          patientEmail: patientEmailAddr,
          patientName: bookingData.patientName,
          doctorName: bookingData.doctorName,
          date: appointmentDateTime,
          service: bookingData.service,
          duration: appointmentDuration,
          referenceNumber: appointment.referenceNumber!,
        }).catch((e) => console.error("Failed to send confirmation email:", e));
      }

      const confirmationResponse = await openai.chat.completions.create({
        model: "gpt-4o",
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
