import { storage } from "../../storage";

export async function findAvailableSlots(
  doctorId: number,
  requestedDate: string,
  openMinutes: number,
  closeMinutes: number,
  duration: number,
  existingAppointments: any[],
  workingDays: number[],
): Promise<{ date: string; time: string }[]> {
  const availableSlots: { date: string; time: string }[] = [];
  const slotInterval = 30;

  for (
    let dayOffset = 0;
    dayOffset <= 7 && availableSlots.length < 3;
    dayOffset++
  ) {
    const checkDate = new Date(requestedDate);
    checkDate.setDate(checkDate.getDate() + dayOffset);
    const dateStr = `${checkDate.getFullYear()}-${String(checkDate.getMonth() + 1).padStart(2, '0')}-${String(checkDate.getDate()).padStart(2, '0')}`;
    const dayOfWeek = checkDate.getDay();

    if (!workingDays.includes(dayOfWeek)) continue;

    const dateUnavailability = await storage.getDoctorAvailabilityForDate(doctorId, dateStr);

    const dayAppointments = existingAppointments.filter((apt) => {
      if (apt.status === "cancelled") return false;
      const aptDate = new Date(apt.date);
      const aptDateLocalStr = `${aptDate.getFullYear()}-${String(aptDate.getMonth() + 1).padStart(2, '0')}-${String(aptDate.getDate()).padStart(2, '0')}`;
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
        const aptDate = new Date(apt.date);
        const aptStartMinutes =
          aptDate.getHours() * 60 + aptDate.getMinutes();
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
  settings: { openTime?: string; closeTime?: string; appointmentDuration?: number } | null,
): Promise<{ available: boolean; slots: string[]; blockedPeriods: string[] }> {
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
  const checkDateStart = new Date(`${dateStr}T00:00:00`);
  const checkDateEnd = new Date(`${dateStr}T23:59:59`);
  const bookedRanges: { start: number; end: number }[] = [];

  for (const apt of allAppointments) {
    if (apt.status === "cancelled") continue;
    const aptDate = new Date(apt.date);
    if (aptDate >= checkDateStart && aptDate <= checkDateEnd) {
      const aptMinutes = aptDate.getHours() * 60 + aptDate.getMinutes();
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
