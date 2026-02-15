import { useQuery } from "@tanstack/react-query";

interface ClinicSettings {
  clinicName: string;
  services: string[];
  openTime: string;
  closeTime: string;
  timezone: string;
}

export function useClinicTimezone() {
  const { data } = useQuery<ClinicSettings>({
    queryKey: ["/api/public/settings"],
    staleTime: 60000,
  });

  const timezone = data?.timezone || "Europe/Amsterdam";

  function formatDateInTimezone(date: Date | string): string {
    const d = typeof date === "string" ? new Date(date) : date;
    return d.toLocaleDateString(undefined, { timeZone: timezone });
  }

  function formatTimeInTimezone(date: Date | string): string {
    const d = typeof date === "string" ? new Date(date) : date;
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", timeZone: timezone });
  }

  function getDateStringInTimezone(date: Date | string): string {
    const d = typeof date === "string" ? new Date(date) : date;
    const year = d.toLocaleString("en-CA", { year: "numeric", timeZone: timezone });
    const month = d.toLocaleString("en-CA", { month: "2-digit", timeZone: timezone });
    const day = d.toLocaleString("en-CA", { day: "2-digit", timeZone: timezone });
    return `${year}-${month}-${day}`;
  }

  function getTodayStringInTimezone(): string {
    return getDateStringInTimezone(new Date());
  }

  function isToday(date: Date | string): boolean {
    return getDateStringInTimezone(date) === getTodayStringInTimezone();
  }

  function isFuture(date: Date | string): boolean {
    const d = typeof date === "string" ? new Date(date) : date;
    return d.getTime() > Date.now();
  }

  return {
    timezone,
    formatDate: formatDateInTimezone,
    formatTime: formatTimeInTimezone,
    getDateString: getDateStringInTimezone,
    getTodayString: getTodayStringInTimezone,
    isToday,
    isFuture,
  };
}
