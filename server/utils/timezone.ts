import { storage } from "../storage";
import { fromZonedTime, toZonedTime } from "date-fns-tz";

let cachedTimezone: string | null = null;
let cacheTime = 0;
const CACHE_TTL = 60_000;

export async function getClinicTimezone(): Promise<string> {
  const now = Date.now();
  if (cachedTimezone && now - cacheTime < CACHE_TTL) {
    return cachedTimezone;
  }
  const settings = await storage.getClinicSettings();
  cachedTimezone = settings?.timezone || "Europe/Amsterdam";
  cacheTime = now;
  return cachedTimezone;
}

export function getNowInTimezone(timezone: string): {
  utcNow: Date;
  dateStr: string;
  hours: number;
  minutes: number;
  dayOfWeek: number;
} {
  const utcNow = new Date();
  const zonedNow = toZonedTime(utcNow, timezone);

  const year = zonedNow.getFullYear();
  const month = String(zonedNow.getMonth() + 1).padStart(2, "0");
  const day = String(zonedNow.getDate()).padStart(2, "0");
  const dateStr = `${year}-${month}-${day}`;
  const hours = zonedNow.getHours();
  const minutes = zonedNow.getMinutes();
  const dayOfWeek = zonedNow.getDay();

  return { utcNow, dateStr, hours, minutes, dayOfWeek };
}

export function clinicTimeToUTC(
  dateStr: string,
  timeStr: string,
  timezone: string,
): Date {
  const localDate = new Date(`${dateStr}T${timeStr}:00`);
  return fromZonedTime(localDate, timezone);
}

export function formatDateInTimezone(
  date: Date,
  timezone: string,
): { dateStr: string; timeStr: string } {
  const zoned = toZonedTime(date, timezone);

  const year = zoned.getFullYear();
  const month = String(zoned.getMonth() + 1).padStart(2, "0");
  const day = String(zoned.getDate()).padStart(2, "0");
  const hours = String(zoned.getHours()).padStart(2, "0");
  const mins = String(zoned.getMinutes()).padStart(2, "0");

  return {
    dateStr: `${year}-${month}-${day}`,
    timeStr: `${hours}:${mins}`,
  };
}

export function getDateInTimezone(date: Date, timezone: string): string {
  const zoned = toZonedTime(date, timezone);

  const year = zoned.getFullYear();
  const month = String(zoned.getMonth() + 1).padStart(2, "0");
  const day = String(zoned.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
}

export function getTomorrowInTimezone(timezone: string): string {
  const clinicNow = getNowInTimezone(timezone);
  const tomorrowZoned = toZonedTime(clinicNow.utcNow, timezone);
  tomorrowZoned.setDate(tomorrowZoned.getDate() + 1);
  return `${tomorrowZoned.getFullYear()}-${String(tomorrowZoned.getMonth() + 1).padStart(2, "0")}-${String(tomorrowZoned.getDate()).padStart(2, "0")}`;
}

export function getDayAfterTomorrowInTimezone(timezone: string): string {
  const clinicNow = getNowInTimezone(timezone);
  const datZoned = toZonedTime(clinicNow.utcNow, timezone);
  datZoned.setDate(datZoned.getDate() + 2);
  return `${datZoned.getFullYear()}-${String(datZoned.getMonth() + 1).padStart(2, "0")}-${String(datZoned.getDate()).padStart(2, "0")}`;
}

export function getTimeInTimezone(date: Date, timezone: string): { hours: number; minutes: number } {
  const zoned = toZonedTime(date, timezone);
  return { hours: zoned.getHours(), minutes: zoned.getMinutes() };
}

export function isClinicTimePast(
  dateStr: string,
  timeStr: string,
  timezone: string,
): boolean {
  const appointmentUTC = clinicTimeToUTC(dateStr, timeStr, timezone);
  return appointmentUTC.getTime() < Date.now();
}
