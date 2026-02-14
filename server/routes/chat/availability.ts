import { storage } from "../../storage";
import { getNowInTimezone, getDateInTimezone, getTimeInTimezone } from "../../utils/timezone";

export async function findEmergencySlot(
  settings: { openTime?: string; closeTime?: string; appointmentDuration?: number; workingDays?: number[] | null; timezone?: string | null } | null,
): Promise<{
  found: boolean;
  doctorId?: number;
  doctorName?: string;
  specialty?: string;
  date?: string;
  time?: string;
  message: string;
}> {
  const timezone = settings?.timezone || "Europe/Amsterdam";
  const clinicNow = getNowInTimezone(timezone);
  const todayStr = clinicNow.dateStr;
  const workingDays = settings?.workingDays || [1, 2, 3, 4, 5, 6];
  const dayOfWeek = clinicNow.dayOfWeek;

  if (!workingDays.includes(dayOfWeek)) {
    return { found: false, message: "Today is not a working day. Please call our emergency line or try again on the next working day." };
  }

  const openTime = settings?.openTime || "09:00";
  const closeTime = settings?.closeTime || "17:00";
  const [openH, openM] = openTime.split(":").map(Number);
  const [closeH, closeM] = closeTime.split(":").map(Number);
  const openMinutes = openH * 60 + openM;
  const closeMinutes = closeH * 60 + closeM;
  const duration = settings?.appointmentDuration || 30;

  const currentMinutes = clinicNow.hours * 60 + clinicNow.minutes;
  const startFrom = Math.max(currentMinutes + 15, openMinutes);

  if (startFrom + duration > closeMinutes) {
    return { found: false, message: "No more slots available today - the clinic is closing soon. Please call our emergency line or book for tomorrow." };
  }

  const roundedStart = Math.ceil(startFrom / 30) * 30;

  const doctors = await storage.getDoctors();
  const activeDoctors = doctors.filter((d) => d.isActive);

  if (activeDoctors.length === 0) {
    return { found: false, message: "No doctors are currently available. Please call our emergency line." };
  }

  let bestSlot: { doctorId: number; doctorName: string; specialty: string; time: string } | null = null;
  let earliestTime = Infinity;

  for (const doctor of activeDoctors) {
    const appointments = await storage.getAppointmentsByDoctorId(doctor.id);
    const todayAppointments = appointments.filter((apt) => {
      if (apt.status === "cancelled") return false;
      const aptDateStr = getDateInTimezone(new Date(apt.date), timezone);
      return aptDateStr === todayStr;
    });

    const unavailability = await storage.getDoctorAvailabilityForDate(doctor.id, todayStr);
    const blockedRanges = unavailability
      .filter((b) => !b.isAvailable)
      .map((b) => {
        const [sH, sM] = b.startTime.split(":").map(Number);
        const [eH, eM] = b.endTime.split(":").map(Number);
        return { start: sH * 60 + sM, end: eH * 60 + eM };
      });

    for (let time = roundedStart; time + duration <= closeMinutes; time += 30) {
      const slotEnd = time + duration;

      const isBlocked = blockedRanges.some((r) => time < r.end && slotEnd > r.start);
      if (isBlocked) continue;

      const isBooked = todayAppointments.some((apt) => {
        const aptTime = getTimeInTimezone(new Date(apt.date), timezone);
        const aptStart = aptTime.hours * 60 + aptTime.minutes;
        const aptEnd = aptStart + apt.duration;
        return time < aptEnd && slotEnd > aptStart;
      });
      if (isBooked) continue;

      if (time < earliestTime) {
        earliestTime = time;
        const hours = Math.floor(time / 60);
        const mins = time % 60;
        bestSlot = {
          doctorId: doctor.id,
          doctorName: doctor.name,
          specialty: doctor.specialty,
          time: `${String(hours).padStart(2, "0")}:${String(mins).padStart(2, "0")}`,
        };
      }
      break;
    }
  }

  if (!bestSlot) {
    return { found: false, message: "All doctors are fully booked today. Please call our emergency line or try again tomorrow." };
  }

  return {
    found: true,
    doctorId: bestSlot.doctorId,
    doctorName: bestSlot.doctorName,
    specialty: bestSlot.specialty,
    date: todayStr,
    time: bestSlot.time,
    message: `Emergency slot found: Dr. ${bestSlot.doctorName} (${bestSlot.specialty}) is available today at ${bestSlot.time}.`,
  };
}

export async function findAvailableSlots(
  doctorId: number,
  requestedDate: string,
  openMinutes: number,
  closeMinutes: number,
  duration: number,
  existingAppointments: any[],
  workingDays: number[],
  timezone: string = "Europe/Amsterdam",
): Promise<{ date: string; time: string }[]> {
  const availableSlots: { date: string; time: string }[] = [];
  const slotInterval = 30;

  for (
    let dayOffset = 0;
    dayOffset <= 7 && availableSlots.length < 3;
    dayOffset++
  ) {
    const checkDate = new Date(requestedDate + "T12:00:00");
    checkDate.setDate(checkDate.getDate() + dayOffset);
    const dateStr = `${checkDate.getFullYear()}-${String(checkDate.getMonth() + 1).padStart(2, '0')}-${String(checkDate.getDate()).padStart(2, '0')}`;
    const dayOfWeek = checkDate.getDay();

    if (!workingDays.includes(dayOfWeek)) continue;

    const dateUnavailability = await storage.getDoctorAvailabilityForDate(doctorId, dateStr);

    const dayAppointments = existingAppointments.filter((apt) => {
      if (apt.status === "cancelled") return false;
      const aptDateLocalStr = getDateInTimezone(new Date(apt.date), timezone);
      return aptDateLocalStr === dateStr;
    });

    for (
      let minutes = openMinutes;
      minutes + duration <= closeMinutes && availableSlots.length < 3;
      minutes += slotInterval
    ) {
      const slotStart = minutes;
      const slotEnd = minutes + duration;

      let isBlocked = false;
      for (const block of dateUnavailability) {
        if (!block.isAvailable) {
          const [blockStartH, blockStartM] = block.startTime.split(":").map(Number);
          const [blockEndH, blockEndM] = block.endTime.split(":").map(Number);
          const blockStart = blockStartH * 60 + blockStartM;
          const blockEnd = blockEndH * 60 + blockEndM;
          
          if (slotStart < blockEnd && slotEnd > blockStart) {
            isBlocked = true;
            break;
          }
        }
      }
      if (isBlocked) continue;

      const hasConflict = dayAppointments.some((apt) => {
        const aptTime = getTimeInTimezone(new Date(apt.date), timezone);
        const aptStartMinutes = aptTime.hours * 60 + aptTime.minutes;
        const aptEndMinutes = aptStartMinutes + apt.duration;
        return slotStart < aptEndMinutes && slotEnd > aptStartMinutes;
      });

      if (!hasConflict) {
        const hours = Math.floor(minutes / 60);
        const mins = minutes % 60;
        const timeStr = `${String(hours).padStart(2, "0")}:${String(mins).padStart(2, "0")}`;
        availableSlots.push({ date: dateStr, time: timeStr });
      }
    }
  }

  return availableSlots;
}

export async function getAvailableSlotsForDate(
  doctorId: number,
  dateStr: string,
  settings: { openTime?: string; closeTime?: string; appointmentDuration?: number; timezone?: string | null } | null,
): Promise<{ available: boolean; slots: string[]; blockedPeriods: string[] }> {
  const timezone = settings?.timezone || "Europe/Amsterdam";
  const openTime = settings?.openTime || "09:00";
  const closeTime = settings?.closeTime || "17:00";
  const [openHour, openMin] = openTime.split(":").map(Number);
  const [closeHour, closeMin] = closeTime.split(":").map(Number);
  const openMinutes = openHour * 60 + openMin;
  const closeMinutes = closeHour * 60 + closeMin;
  const duration = settings?.appointmentDuration || 30;

  const doctorUnavailability = await storage.getDoctorAvailabilityForDate(doctorId, dateStr);
  const blockedPeriods: string[] = [];
  const blockedRanges: { start: number; end: number }[] = [];
  
  for (const block of doctorUnavailability) {
    if (!block.isAvailable) {
      blockedPeriods.push(`${block.startTime} - ${block.endTime}`);
      const [startH, startM] = block.startTime.split(":").map(Number);
      const [endH, endM] = block.endTime.split(":").map(Number);
      blockedRanges.push({ start: startH * 60 + startM, end: endH * 60 + endM });
    }
  }

  const allAppointments = await storage.getAppointmentsByDoctorId(doctorId);
  const bookedRanges: { start: number; end: number }[] = [];

  for (const apt of allAppointments) {
    if (apt.status === "cancelled") continue;
    const aptDateInTz = getDateInTimezone(new Date(apt.date), timezone);
    if (aptDateInTz === dateStr) {
      const aptTime = getTimeInTimezone(new Date(apt.date), timezone);
      const aptMinutes = aptTime.hours * 60 + aptTime.minutes;
      bookedRanges.push({ start: aptMinutes, end: aptMinutes + apt.duration });
    }
  }

  const availableSlots: string[] = [];
  for (let time = openMinutes; time + duration <= closeMinutes; time += 30) {
    const slotEnd = time + duration;
    
    const isBlocked = blockedRanges.some(range => time < range.end && slotEnd > range.start);
    if (isBlocked) continue;

    const isBooked = bookedRanges.some(range => time < range.end && slotEnd > range.start);
    if (isBooked) continue;

    const hours = Math.floor(time / 60);
    const mins = time % 60;
    availableSlots.push(`${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}`);
  }

  return {
    available: availableSlots.length > 0,
    slots: availableSlots,
    blockedPeriods,
  };
}
