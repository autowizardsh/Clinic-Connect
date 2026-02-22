import { storage } from "../../storage";
import { openai } from "../../services/openai";
import { createCalendarEvent, deleteCalendarEvent } from "../../google-calendar";
import { sendAppointmentConfirmationEmail, sendAppointmentCancelledEmail, sendAppointmentRescheduledEmail } from "../../services/email";
import { scheduleRemindersForAppointment, rescheduleRemindersForAppointment, cancelRemindersForAppointment } from "../../services/reminders";
import { allChatTools } from "./tools";
import { findAvailableSlots, getAvailableSlotsForDate, findEmergencySlot } from "./availability";
import { getNowInTimezone, clinicTimeToUTC, isClinicTimePast, getDateInTimezone } from "../../utils/timezone";

export interface QuickReply {
  label: string;
  value: string;
}

export interface BookingResult {
  success: boolean;
  appointmentId: number;
  referenceNumber: string;
  patientName: string;
  doctorName: string;
  date: string;
  time: string;
  service: string;
}

export interface ToolLoopResult {
  response: string;
  quickReplies: QuickReply[];
  booking: BookingResult | null;
}

interface ToolLoopContext {
  settings: any;
  activeDoctors: { id: number; name: string; specialty: string; isActive: boolean }[];
  services: string[];
  clinicTimezone: string;
  today: string;
  language: string;
  source: string;
}

const MAX_TOOL_ITERATIONS = 10;

export async function runToolLoop(
  messages: any[],
  ctx: ToolLoopContext,
): Promise<ToolLoopResult> {
  let currentMessages = [...messages];
  let bookingResult: BookingResult | null = null;
  let quickReplies: QuickReply[] = [];
  let finalResponse = "";
  let iterations = 0;

  while (iterations < MAX_TOOL_ITERATIONS) {
    iterations++;

    const response = await openai.chat.completions.create({
      model: process.env.CHAT_AI_MODEL || "gpt-4o-mini",
      messages: currentMessages,
      tools: allChatTools,
      tool_choice: "auto",
    });

    const assistantMessage = response.choices[0]?.message;
    if (!assistantMessage) break;

    if (assistantMessage.content) {
      finalResponse = assistantMessage.content;
    }

    if (!assistantMessage.tool_calls || assistantMessage.tool_calls.length === 0) {
      break;
    }

    currentMessages.push(assistantMessage);

    let hasQuickRepliesCall = false;
    let hasDataToolCall = false;

    for (const toolCall of assistantMessage.tool_calls) {
      const fnName = (toolCall as any).function?.name;
      const fnArgs = (toolCall as any).function?.arguments || "{}";

      let result: string;
      try {
        const args = JSON.parse(fnArgs);

        if (fnName === "suggest_quick_replies") {
          hasQuickRepliesCall = true;
          const handled = await handleToolCall(fnName, args, ctx);
          if (handled.type === "quick_replies") {
            quickReplies = handled.quickReplies;
          }
          result = JSON.stringify({ acknowledged: true });
        } else {
          hasDataToolCall = true;
          const handled = await handleToolCall(fnName, args, ctx);
          if (handled.type === "booking") {
            bookingResult = handled.booking;
            result = handled.result;
          } else if (handled.type === "result") {
            result = handled.result;
          } else {
            result = JSON.stringify({ acknowledged: true });
          }
        }
      } catch (err: any) {
        console.error(`Tool call error (${fnName}):`, err);
        result = JSON.stringify({ error: err.message || "Tool execution failed" });
      }

      currentMessages.push({
        role: "tool",
        tool_call_id: toolCall.id,
        content: result,
      });
    }

    if (hasQuickRepliesCall && !hasDataToolCall) {
      if (!finalResponse) {
        const followUp = await openai.chat.completions.create({
          model: process.env.CHAT_AI_MODEL || "gpt-4o-mini",
          messages: currentMessages,
          tools: allChatTools,
          tool_choice: "none",
        });
        const followUpContent = followUp.choices[0]?.message?.content;
        if (followUpContent) {
          finalResponse = followUpContent;
        }
      }
      break;
    }
  }

  if (iterations >= MAX_TOOL_ITERATIONS) {
    console.warn("Tool loop hit max iterations");
  }

  return { response: finalResponse, quickReplies, booking: bookingResult };
}

type ToolResult =
  | { type: "result"; result: string }
  | { type: "quick_replies"; quickReplies: QuickReply[] }
  | { type: "booking"; booking: BookingResult; result: string };

async function handleToolCall(
  fnName: string,
  args: any,
  ctx: ToolLoopContext,
): Promise<ToolResult> {
  switch (fnName) {
    case "check_availability":
      return handleCheckAvailability(args, ctx);
    case "book_appointment":
      return handleBookAppointment(args, ctx);
    case "lookup_appointment":
      return handleLookupAppointment(args);
    case "cancel_appointment":
      return handleCancelAppointment(args, ctx);
    case "reschedule_appointment":
      return handleRescheduleAppointment(args, ctx);
    case "find_emergency_slot":
      return handleFindEmergencySlot(ctx);
    case "lookup_patient_by_email":
      return handleLookupPatientByEmail(args);
    case "suggest_quick_replies":
      return handleSuggestQuickReplies(args, ctx);
    default:
      return { type: "result", result: JSON.stringify({ error: `Unknown tool: ${fnName}` }) };
  }
}

async function handleCheckAvailability(
  args: { doctorId: number; date: string },
  ctx: ToolLoopContext,
): Promise<ToolResult> {
  const availability = await getAvailableSlotsForDate(args.doctorId, args.date, ctx.settings);
  const doctor = ctx.activeDoctors.find((d) => d.id === args.doctorId);
  const doctorName = doctor?.name || "the doctor";

  let info = "";
  if (availability.blockedPeriods.length > 0) {
    info = `Dr. ${doctorName} is NOT available during: ${availability.blockedPeriods.join(", ")} on ${args.date}. `;
  }
  if (availability.available) {
    info += `Available time slots: ${availability.slots.join(", ")}.`;
  } else {
    info += `No available slots on ${args.date}.`;
  }

  return { type: "result", result: info };
}

async function handleBookAppointment(
  args: any,
  ctx: ToolLoopContext,
): Promise<ToolResult> {
  const invalidNames = ["pending", "unknown", "test", "user", "patient", "name", "n/a", "na", "tbd", "to be determined"];
  const patientName = (args.patientName || "").trim();
  const patientNameLower = patientName.toLowerCase();
  const patientPhone = (args.patientPhone || "").trim();
  const patientEmail = (args.patientEmail || "").trim();

  if (!patientName || patientNameLower.length < 2) {
    return { type: "result", result: JSON.stringify({ error: "MISSING_INFO: Patient name is missing. Please ask for their full name." }) };
  }
  const nameParts = patientNameLower.split(/\s+/);
  if (nameParts.some((p: string) => invalidNames.includes(p)) || (nameParts.length >= 2 && nameParts[0] === nameParts[1])) {
    return { type: "result", result: JSON.stringify({ error: "MISSING_INFO: Need a real patient name, not a placeholder." }) };
  }
  if (!patientPhone || patientPhone.length < 6) {
    return { type: "result", result: JSON.stringify({ error: "MISSING_INFO: Patient phone number is missing. Please ask for it." }) };
  }
  const invalidPhones = ["0000000", "1234567", "pending", "unknown", "test", "n/a", "na", "tbd"];
  if (invalidPhones.some((p) => patientPhone.toLowerCase().includes(p))) {
    return { type: "result", result: JSON.stringify({ error: "MISSING_INFO: Need a valid phone number, not a placeholder." }) };
  }
  if (!patientEmail || !patientEmail.includes("@")) {
    return { type: "result", result: JSON.stringify({ error: "MISSING_INFO: Patient email is missing. Please ask for it." }) };
  }

  if (args.date < ctx.today) {
    return { type: "result", result: JSON.stringify({ error: "Cannot book in the past. Choose a future date." }) };
  }
  if (args.date === ctx.today && isClinicTimePast(args.date, args.time, ctx.clinicTimezone)) {
    return { type: "result", result: JSON.stringify({ error: "This time has already passed. Choose a later time or another day." }) };
  }

  const openTime = ctx.settings?.openTime || "09:00:00";
  const closeTime = ctx.settings?.closeTime || "17:00:00";
  const [openH, openM] = openTime.split(":").map(Number);
  const [closeH, closeM] = closeTime.split(":").map(Number);
  const [reqH, reqM] = args.time.split(":").map(Number);
  const openMin = openH * 60 + openM;
  const closeMin = closeH * 60 + closeM;
  const reqMin = reqH * 60 + reqM;
  const appointmentDuration = ctx.settings?.appointmentDuration || 30;
  const endMin = reqMin + appointmentDuration;

  if (reqMin < openMin || endMin > closeMin) {
    return { type: "result", result: JSON.stringify({ error: `Time outside working hours (${openTime.slice(0, 5)} - ${closeTime.slice(0, 5)}).` }) };
  }

  const appointmentDateTime = clinicTimeToUTC(args.date, args.time, ctx.clinicTimezone);
  const dayOfWeek = new Date(args.date + "T12:00:00").getDay();
  const workingDays = ctx.settings?.workingDays || [1, 2, 3, 4, 5, 6];
  if (!workingDays.includes(dayOfWeek)) {
    const dayNames = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
    return { type: "result", result: JSON.stringify({ error: `${dayNames[dayOfWeek]} is not a working day.` }) };
  }

  const doctorUnavailability = await storage.getDoctorAvailabilityForDate(args.doctorId, args.date);
  for (const block of doctorUnavailability) {
    if (!block.isAvailable) {
      const [bsH, bsM] = block.startTime.split(":").map(Number);
      const [beH, beM] = block.endTime.split(":").map(Number);
      const bStart = bsH * 60 + bsM;
      const bEnd = beH * 60 + beM;
      if (reqMin < bEnd && endMin > bStart) {
        return { type: "result", result: JSON.stringify({ error: `Doctor unavailable ${block.startTime.slice(0, 5)}-${block.endTime.slice(0, 5)} on ${args.date}.` }) };
      }
    }
  }

  const existingAppointments = await storage.getAppointmentsByDoctorId(args.doctorId);
  const conflict = existingAppointments.find((apt) => {
    if (apt.status === "cancelled") return false;
    const aptStart = new Date(apt.date).getTime();
    const aptEnd = aptStart + apt.duration * 60 * 1000;
    const newStart = appointmentDateTime.getTime();
    const newEnd = newStart + appointmentDuration * 60 * 1000;
    return newStart < aptEnd && newEnd > aptStart;
  });

  if (conflict) {
    const alternatives = await findAvailableSlots(
      args.doctorId, args.date, openMin, closeMin, appointmentDuration,
      existingAppointments, workingDays, ctx.clinicTimezone,
    );
    if (alternatives.length > 0) {
      const altText = alternatives.map((s) => `${s.date} at ${s.time}`).join(", ");
      return { type: "result", result: JSON.stringify({ error: `Time slot already booked. Available alternatives: ${altText}` }) };
    }
    return { type: "result", result: JSON.stringify({ error: "Time slot already booked. No alternatives today. Try a different day." }) };
  }

  let patient = await storage.getPatientByPhone(patientPhone);
  if (!patient) {
    patient = await storage.createPatient({
      name: patientName,
      phone: patientPhone,
      email: patientEmail || null,
      notes: `Booked via ${ctx.source} on ${new Date().toLocaleDateString()}`,
    });
  } else if (patientEmail && patient.email !== patientEmail) {
    await storage.updatePatient(patient.id, { email: patientEmail });
  }

  const appointment = await storage.createAppointment({
    patientId: patient.id,
    doctorId: args.doctorId,
    date: appointmentDateTime,
    duration: appointmentDuration,
    status: "scheduled",
    service: args.service,
    notes: args.notes || null,
    source: ctx.source,
  });

  try {
    const doctor = await storage.getDoctorById(args.doctorId);
    if (doctor?.googleRefreshToken) {
      const event = await createCalendarEvent(
        doctor.googleRefreshToken,
        doctor.googleCalendarId || "primary",
        {
          patientName,
          doctorName: doctor.name,
          date: args.date,
          time: args.time,
          service: args.service || "Dental Appointment",
          notes: args.notes || undefined,
          duration: appointmentDuration,
        },
        ctx.clinicTimezone,
      );
      await storage.updateAppointment(appointment.id, { googleEventId: event.id });
    }
  } catch (e) {
    console.error("Calendar sync failed:", e);
  }

  if (patientEmail) {
    sendAppointmentConfirmationEmail({
      patientEmail,
      patientName,
      doctorName: args.doctorName || "Doctor",
      date: appointmentDateTime,
      service: args.service,
      duration: appointmentDuration,
      referenceNumber: appointment.referenceNumber || "",
    }).catch((e) => console.error("Failed to send confirmation email:", e));
  }

  scheduleRemindersForAppointment(appointment.id).catch((e) =>
    console.error("Failed to schedule reminders:", e),
  );

  const booking: BookingResult = {
    success: true,
    appointmentId: appointment.id,
    referenceNumber: appointment.referenceNumber || "",
    patientName,
    doctorName: args.doctorName || "",
    date: args.date,
    time: args.time,
    service: args.service,
  };

  return {
    type: "booking",
    booking,
    result: JSON.stringify({
      success: true,
      message: `Appointment booked successfully! Reference number: ${appointment.referenceNumber}`,
      referenceNumber: appointment.referenceNumber,
      details: booking,
    }),
  };
}

async function handleLookupAppointment(
  args: { referenceNumber: string; phoneNumber: string },
): Promise<ToolResult> {
  const refNum = (args.referenceNumber || "").toUpperCase().trim();
  const phone = (args.phoneNumber || "").trim();

  const appointment = await storage.getAppointmentByReferenceNumber(refNum);

  if (!appointment) {
    return { type: "result", result: JSON.stringify({ found: false, error: "No appointment found with this reference number." }) };
  }
  if (!appointment.patient.phone || !phone ||
      appointment.patient.phone.replace(/\D/g, "").slice(-6) !== phone.replace(/\D/g, "").slice(-6)) {
    return { type: "result", result: JSON.stringify({ found: false, error: "Phone number does not match our records." }) };
  }
  if (appointment.status === "cancelled") {
    return { type: "result", result: JSON.stringify({ found: false, error: "This appointment has already been cancelled." }) };
  }

  const appointmentDate = new Date(appointment.date);
  return {
    type: "result",
    result: JSON.stringify({
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
    }),
  };
}

async function handleCancelAppointment(
  args: { referenceNumber: string; phoneNumber: string },
  ctx: ToolLoopContext,
): Promise<ToolResult> {
  const refNum = (args.referenceNumber || "").toUpperCase().trim();
  const phone = (args.phoneNumber || "").trim();

  const appointment = await storage.getAppointmentByReferenceNumber(refNum);

  if (!appointment) {
    return { type: "result", result: JSON.stringify({ success: false, error: "Appointment not found." }) };
  }
  if (!phone || appointment.patient.phone.replace(/\D/g, "").slice(-6) !== phone.replace(/\D/g, "").slice(-6)) {
    return { type: "result", result: JSON.stringify({ success: false, error: "Phone verification failed." }) };
  }
  if (appointment.status === "cancelled") {
    return { type: "result", result: JSON.stringify({ success: false, error: "Already cancelled." }) };
  }

  await storage.updateAppointment(appointment.id, { status: "cancelled" });

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
    } catch (e) {
      console.error("Failed to delete calendar event:", e);
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

  cancelRemindersForAppointment(appointment.id).catch((e) =>
    console.error("Failed to cancel reminders:", e),
  );

  return {
    type: "result",
    result: JSON.stringify({
      success: true,
      message: `Appointment ${refNum} has been cancelled successfully.`,
      referenceNumber: refNum,
    }),
  };
}

async function handleRescheduleAppointment(
  args: { referenceNumber: string; phoneNumber: string; newDate: string; newTime: string },
  ctx: ToolLoopContext,
): Promise<ToolResult> {
  const refNum = (args.referenceNumber || "").toUpperCase().trim();
  const phone = (args.phoneNumber || "").trim();

  const appointment = await storage.getAppointmentByReferenceNumber(refNum);

  if (!appointment) {
    return { type: "result", result: JSON.stringify({ success: false, error: "Appointment not found." }) };
  }
  if (!phone || appointment.patient.phone.replace(/\D/g, "").slice(-6) !== phone.replace(/\D/g, "").slice(-6)) {
    return { type: "result", result: JSON.stringify({ success: false, error: "Phone verification failed." }) };
  }
  if (appointment.status === "cancelled") {
    return { type: "result", result: JSON.stringify({ success: false, error: "Cannot reschedule a cancelled appointment." }) };
  }

  if (isClinicTimePast(args.newDate, args.newTime, ctx.clinicTimezone)) {
    return { type: "result", result: JSON.stringify({ success: false, error: "Cannot reschedule to a past date/time." }) };
  }

  const newDateTime = clinicTimeToUTC(args.newDate, args.newTime, ctx.clinicTimezone);
  const duration = appointment.duration || 30;

  const existingAppointments = await storage.getAppointmentsByDoctorId(appointment.doctorId);
  const conflict = existingAppointments.find((apt) => {
    if (apt.id === appointment.id || apt.status === "cancelled") return false;
    const aptStart = new Date(apt.date).getTime();
    const aptEnd = aptStart + apt.duration * 60 * 1000;
    const newStart = newDateTime.getTime();
    const newEnd = newStart + duration * 60 * 1000;
    return newStart < aptEnd && newEnd > aptStart;
  });

  if (conflict) {
    return { type: "result", result: JSON.stringify({ success: false, error: "New time slot conflicts with another appointment." }) };
  }

  const oldDate = new Date(appointment.date);
  await storage.updateAppointment(appointment.id, { date: newDateTime });

  if (appointment.googleEventId) {
    try {
      const doctor = await storage.getDoctorById(appointment.doctorId);
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
            date: args.newDate,
            time: args.newTime,
            service: appointment.service,
            duration,
          },
          ctx.clinicTimezone,
        );
        await storage.updateAppointment(appointment.id, { googleEventId: event.id });
      }
    } catch (e) {
      console.error("Failed to update calendar event:", e);
    }
  }

  if (appointment.patient.email) {
    const doctor = await storage.getDoctorById(appointment.doctorId);
    sendAppointmentRescheduledEmail({
      patientEmail: appointment.patient.email,
      patientName: appointment.patient.name,
      doctorName: doctor?.name || "Doctor",
      oldDate,
      newDate: newDateTime,
      service: appointment.service,
      duration,
      referenceNumber: refNum,
    }).catch((e) => console.error("Failed to send reschedule email:", e));
  }

  rescheduleRemindersForAppointment(appointment.id).catch((e) =>
    console.error("Failed to reschedule reminders:", e),
  );

  return {
    type: "result",
    result: JSON.stringify({
      success: true,
      message: `Appointment ${refNum} rescheduled to ${args.newDate} at ${args.newTime}.`,
      referenceNumber: refNum,
      newDate: args.newDate,
      newTime: args.newTime,
    }),
  };
}

async function handleFindEmergencySlot(ctx: ToolLoopContext): Promise<ToolResult> {
  const result = await findEmergencySlot(ctx.settings);
  return { type: "result", result: JSON.stringify(result) };
}

async function handleLookupPatientByEmail(args: { email: string }): Promise<ToolResult> {
  const email = (args.email || "").trim().toLowerCase();
  const patient = await storage.getPatientByEmail(email);

  if (patient) {
    return {
      type: "result",
      result: JSON.stringify({
        found: true,
        patientId: patient.id,
        name: patient.name,
        phone: patient.phone,
        email: patient.email,
      }),
    };
  }
  return {
    type: "result",
    result: JSON.stringify({
      found: false,
      message: "No patient found with this email. Collect their details as a new patient.",
    }),
  };
}

async function handleSuggestQuickReplies(
  args: { type: string; timeSlots?: string[]; custom?: { label: string; value: string }[] },
  ctx: ToolLoopContext,
): Promise<{ type: "quick_replies"; quickReplies: QuickReply[] }> {
  const lang = ctx.language;
  const nl = lang === "nl";

  let buttons: QuickReply[] = [];

  switch (args.type) {
    case "main_menu":
      buttons = nl
        ? [
            { label: "Afspraak maken", value: "Ik wil een afspraak maken" },
            { label: "Spoedafspraak", value: "Ik heb een spoedgeval en heb zo snel mogelijk een afspraak nodig" },
            { label: "Afspraak verzetten", value: "Ik wil mijn afspraak verzetten" },
            { label: "Afspraak annuleren", value: "Ik wil mijn afspraak annuleren" },
            { label: "Andere vraag", value: "Ik heb een andere vraag" },
          ]
        : [
            { label: "Book an appointment", value: "I would like to book an appointment" },
            { label: "Emergency booking", value: "I need an emergency appointment as soon as possible" },
            { label: "Reschedule appointment", value: "I want to reschedule my appointment" },
            { label: "Cancel appointment", value: "I want to cancel my appointment" },
            { label: "Other question", value: "I have another question" },
          ];
      break;

    case "services":
      buttons = ctx.services.map((s) => ({
        label: s,
        value: nl ? `Ik wil graag ${s}` : `I would like ${s}`,
      }));
      break;

    case "doctors":
      buttons = ctx.activeDoctors.map((d) => ({
        label: `Dr. ${d.name} (${d.specialty})`,
        value: nl ? `Ik wil graag bij Dr. ${d.name}` : `I'd like Dr. ${d.name}`,
      }));
      break;

    case "dates": {
      const now = new Date();
      const dayNamesEN = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
      const dayNamesNL = ["Zondag", "Maandag", "Dinsdag", "Woensdag", "Donderdag", "Vrijdag", "Zaterdag"];
      const workingDays = ctx.settings?.workingDays || [1, 2, 3, 4, 5, 6];
      for (let i = 0; i < 14 && buttons.length < 5; i++) {
        const d = new Date(now);
        d.setDate(d.getDate() + i);
        if (!workingDays.includes(d.getDay())) continue;
        const dateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
        const dayName = nl ? dayNamesNL[d.getDay()] : dayNamesEN[d.getDay()];
        const label = i === 0
          ? (nl ? `Vandaag (${dayName})` : `Today (${dayName})`)
          : i === 1
          ? (nl ? `Morgen (${dayName})` : `Tomorrow (${dayName})`)
          : `${dayName} ${dateStr}`;
        buttons.push({ label, value: dateStr });
      }
      break;
    }

    case "time_slots":
      if (args.timeSlots && args.timeSlots.length > 0) {
        buttons = args.timeSlots.slice(0, 10).map((t) => ({ label: t, value: t }));
      }
      break;

    case "yes_no":
      buttons = nl
        ? [
            { label: "Ja, bevestig", value: "Ja, bevestig mijn afspraak alstublieft" },
            { label: "Nee, wijzig", value: "Nee, ik wil iets wijzigen" },
          ]
        : [
            { label: "Yes, confirm", value: "Yes, please confirm my appointment" },
            { label: "No, change something", value: "No, I want to change something" },
          ];
      break;

    case "confirm_cancel":
      buttons = nl
        ? [
            { label: "Ja, annuleer", value: "Ja, annuleer mijn afspraak alstublieft" },
            { label: "Nee, toch niet", value: "Nee, ik wil mijn afspraak behouden" },
          ]
        : [
            { label: "Yes, cancel it", value: "Yes, please cancel my appointment" },
            { label: "No, keep it", value: "No, I want to keep my appointment" },
          ];
      break;

    case "new_returning":
      buttons = nl
        ? [
            { label: "Nieuwe patient", value: "Ik ben een nieuwe patient" },
            { label: "Terugkerende patient", value: "Ik ben een terugkerende patient" },
          ]
        : [
            { label: "New patient", value: "I am a new patient" },
            { label: "Returning patient", value: "I am a returning patient" },
          ];
      break;

    case "post_booking":
      buttons = nl
        ? [
            { label: "Nieuwe afspraak maken", value: "Ik wil nog een afspraak maken" },
            { label: "Andere vraag", value: "Ik heb een andere vraag" },
          ]
        : [
            { label: "Book another appointment", value: "I would like to book another appointment" },
            { label: "Other question", value: "I have another question" },
          ];
      break;

    case "post_cancel":
      buttons = nl
        ? [
            { label: "Nieuwe afspraak maken", value: "Ik wil een afspraak maken" },
            { label: "Andere vraag", value: "Ik heb een andere vraag" },
          ]
        : [
            { label: "Book a new appointment", value: "I would like to book an appointment" },
            { label: "Other question", value: "I have another question" },
          ];
      break;

    case "custom":
      if (args.custom && args.custom.length > 0) {
        buttons = args.custom.slice(0, 10);
      }
      break;
  }

  return { type: "quick_replies", quickReplies: buttons };
}
