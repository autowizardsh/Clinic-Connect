import { storage } from "../storage";
import { sendAppointmentReminderEmail } from "./email";

let reminderInterval: ReturnType<typeof setInterval> | null = null;

export async function scheduleRemindersForAppointment(appointmentId: number): Promise<void> {
  const settings = await storage.getClinicSettings();
  if (!settings?.reminderEnabled) return;

  const offsets = settings.reminderOffsets || [1440, 60];
  const channels = settings.reminderChannels || ["email"];

  const existing = await storage.getRemindersForAppointment(appointmentId);
  if (existing.length > 0) return;

  for (const offset of offsets) {
    for (const channel of channels) {
      await storage.createAppointmentReminder({
        appointmentId,
        offsetMinutes: offset,
        channel,
        status: "pending",
      });
    }
  }
}

export async function rescheduleRemindersForAppointment(appointmentId: number): Promise<void> {
  await storage.deleteRemindersForAppointment(appointmentId);

  const settings = await storage.getClinicSettings();
  if (!settings?.reminderEnabled) return;

  const offsets = settings.reminderOffsets || [1440, 60];
  const channels = settings.reminderChannels || ["email"];

  for (const offset of offsets) {
    for (const channel of channels) {
      await storage.createAppointmentReminder({
        appointmentId,
        offsetMinutes: offset,
        channel,
        status: "pending",
      });
    }
  }
}

export async function cancelRemindersForAppointment(appointmentId: number): Promise<void> {
  await storage.deleteRemindersForAppointment(appointmentId);
}

async function processReminders(): Promise<void> {
  try {
    const settings = await storage.getClinicSettings();
    if (!settings?.reminderEnabled) return;

    const pending = await storage.getPendingReminders();

    for (const reminder of pending) {
      try {
        if (reminder.channel === "email") {
          const patientEmail = reminder.patient.email;
          if (!patientEmail) {
            await storage.markReminderFailed(reminder.id, "Patient has no email");
            continue;
          }

          const sent = await sendAppointmentReminderEmail({
            patientEmail,
            patientName: reminder.patient.name,
            doctorName: reminder.doctor.name,
            date: new Date(reminder.appointment.date),
            service: reminder.appointment.service,
            referenceNumber: reminder.appointment.referenceNumber || "N/A",
            offsetMinutes: reminder.offsetMinutes,
          });

          if (sent) {
            await storage.markReminderSent(reminder.id);
            console.log(`[REMINDER] Sent email reminder #${reminder.id} for appointment #${reminder.appointmentId}`);
          } else {
            await storage.markReminderFailed(reminder.id, "Email service returned false");
          }
        } else if (reminder.channel === "whatsapp") {
          const phone = reminder.patient.phone;
          if (!phone) {
            await storage.markReminderFailed(reminder.id, "Patient has no phone number");
            continue;
          }

          try {
            const { sendTextMessage } = await import("../routes/whatsapp/service");
            const apptDate = new Date(reminder.appointment.date);
            const dateStr = apptDate.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" });
            const timeStr = apptDate.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });

            let timeLabel: string;
            if (reminder.offsetMinutes >= 1440) {
              const days = Math.round(reminder.offsetMinutes / 1440);
              timeLabel = days === 1 ? "tomorrow" : `in ${days} days`;
            } else if (reminder.offsetMinutes >= 60) {
              const hours = Math.round(reminder.offsetMinutes / 60);
              timeLabel = hours === 1 ? "in 1 hour" : `in ${hours} hours`;
            } else {
              timeLabel = `in ${reminder.offsetMinutes} minutes`;
            }

            const message = `Reminder: Your dental appointment is ${timeLabel}.\n\nDate: ${dateStr}\nTime: ${timeStr}\nDoctor: Dr. ${reminder.doctor.name}\nService: ${reminder.appointment.service}\nRef: ${reminder.appointment.referenceNumber || "N/A"}\n\nTo reschedule or cancel, reply with your reference number.`;

            await sendTextMessage(phone, message);
            await storage.markReminderSent(reminder.id);
            console.log(`[REMINDER] Sent WhatsApp reminder #${reminder.id} for appointment #${reminder.appointmentId}`);
          } catch (err: any) {
            await storage.markReminderFailed(reminder.id, err.message || "WhatsApp send failed");
          }
        } else {
          await storage.markReminderFailed(reminder.id, `Unknown channel: ${reminder.channel}`);
        }
      } catch (err: any) {
        console.error(`[REMINDER] Failed to process reminder #${reminder.id}:`, err);
        await storage.markReminderFailed(reminder.id, err.message || "Processing error");
      }
    }
  } catch (err) {
    console.error("[REMINDER] Error in reminder processing cycle:", err);
  }
}

export function startReminderScheduler(): void {
  if (reminderInterval) return;

  console.log("[REMINDER] Starting appointment reminder scheduler (runs every 5 minutes)");
  processReminders();
  reminderInterval = setInterval(processReminders, 5 * 60 * 1000);
}

export function stopReminderScheduler(): void {
  if (reminderInterval) {
    clearInterval(reminderInterval);
    reminderInterval = null;
    console.log("[REMINDER] Stopped appointment reminder scheduler");
  }
}
