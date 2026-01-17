// Google Calendar Integration via Replit Connectors
import { google } from 'googleapis';

let connectionSettings: any;

async function getAccessToken() {
  if (connectionSettings && connectionSettings.settings.expires_at && new Date(connectionSettings.settings.expires_at).getTime() > Date.now()) {
    return connectionSettings.settings.access_token;
  }
  
  const hostname = process.env.REPLIT_CONNECTORS_HOSTNAME;
  const xReplitToken = process.env.REPL_IDENTITY 
    ? 'repl ' + process.env.REPL_IDENTITY 
    : process.env.WEB_REPL_RENEWAL 
    ? 'depl ' + process.env.WEB_REPL_RENEWAL 
    : null;

  if (!xReplitToken) {
    throw new Error('X_REPLIT_TOKEN not found for repl/depl');
  }

  connectionSettings = await fetch(
    'https://' + hostname + '/api/v2/connection?include_secrets=true&connector_names=google-calendar',
    {
      headers: {
        'Accept': 'application/json',
        'X_REPLIT_TOKEN': xReplitToken
      }
    }
  ).then(res => res.json()).then(data => data.items?.[0]);

  const accessToken = connectionSettings?.settings?.access_token || connectionSettings.settings?.oauth?.credentials?.access_token;

  if (!connectionSettings || !accessToken) {
    throw new Error('Google Calendar not connected');
  }
  return accessToken;
}

// WARNING: Never cache this client.
// Access tokens expire, so a new client must be created each time.
// Always call this function again to get a fresh client.
export async function getGoogleCalendarClient() {
  const accessToken = await getAccessToken();

  const oauth2Client = new google.auth.OAuth2();
  oauth2Client.setCredentials({
    access_token: accessToken
  });

  return google.calendar({ version: 'v3', auth: oauth2Client });
}

// Create a calendar event for an appointment
export async function createCalendarEvent(
  calendarId: string,
  appointment: {
    patientName: string;
    doctorName: string;
    date: string;
    time: string;
    service: string;
    notes?: string;
    duration?: number;
  },
  timezone: string = 'Europe/Amsterdam'
) {
  const calendar = await getGoogleCalendarClient();
  
  // Parse date and time - date is expected as YYYY-MM-DD, time as HH:MM
  const dateStr = appointment.date.split('T')[0]; // Handle both date string and ISO datetime
  const timeStr = appointment.time;
  
  // Create datetime string in the clinic's timezone
  const startDateTime = `${dateStr}T${timeStr}:00`;
  
  // Calculate end time based on duration (default 30 minutes)
  const durationMinutes = appointment.duration || 30;
  const [hours, minutes] = timeStr.split(':').map(Number);
  const endMinutes = hours * 60 + minutes + durationMinutes;
  const endHours = Math.floor(endMinutes / 60);
  const endMins = endMinutes % 60;
  const endTime = `${String(endHours).padStart(2, '0')}:${String(endMins).padStart(2, '0')}`;
  const endDateTime = `${dateStr}T${endTime}:00`;

  const event = {
    summary: `Dental Appointment: ${appointment.patientName}`,
    description: `Service: ${appointment.service}\nDoctor: ${appointment.doctorName}\n${appointment.notes ? 'Notes: ' + appointment.notes : ''}`,
    start: {
      dateTime: startDateTime,
      timeZone: timezone,
    },
    end: {
      dateTime: endDateTime,
      timeZone: timezone,
    },
  };

  const response = await calendar.events.insert({
    calendarId: calendarId || 'primary',
    requestBody: event,
  });

  return response.data;
}

// Get calendar events for a specific date range
export async function getCalendarEvents(
  calendarId: string,
  timeMin: Date,
  timeMax: Date
) {
  const calendar = await getGoogleCalendarClient();

  const response = await calendar.events.list({
    calendarId: calendarId || 'primary',
    timeMin: timeMin.toISOString(),
    timeMax: timeMax.toISOString(),
    singleEvents: true,
    orderBy: 'startTime',
  });

  return response.data.items || [];
}

// Delete a calendar event
export async function deleteCalendarEvent(calendarId: string, eventId: string) {
  const calendar = await getGoogleCalendarClient();

  await calendar.events.delete({
    calendarId: calendarId || 'primary',
    eventId: eventId,
  });
}

// Update a calendar event
export async function updateCalendarEvent(
  calendarId: string,
  eventId: string,
  updates: {
    date?: string;
    time?: string;
    patientName?: string;
    service?: string;
    notes?: string;
  }
) {
  const calendar = await getGoogleCalendarClient();

  // Get existing event first
  const existing = await calendar.events.get({
    calendarId: calendarId || 'primary',
    eventId: eventId,
  });

  const event = existing.data;

  // Update fields if provided
  if (updates.date || updates.time) {
    const currentStart = new Date(event.start?.dateTime || new Date());
    
    if (updates.date) {
      const [year, month, day] = updates.date.split('-').map(Number);
      currentStart.setFullYear(year, month - 1, day);
    }
    
    if (updates.time) {
      const [hours, minutes] = updates.time.split(':').map(Number);
      currentStart.setHours(hours, minutes, 0, 0);
    }
    
    const endDate = new Date(currentStart);
    endDate.setMinutes(endDate.getMinutes() + 30);
    
    event.start = {
      dateTime: currentStart.toISOString(),
      timeZone: 'UTC',
    };
    event.end = {
      dateTime: endDate.toISOString(),
      timeZone: 'UTC',
    };
  }

  if (updates.patientName) {
    event.summary = `Dental Appointment: ${updates.patientName}`;
  }

  const response = await calendar.events.update({
    calendarId: calendarId || 'primary',
    eventId: eventId,
    requestBody: event,
  });

  return response.data;
}

// List available calendars
export async function listCalendars() {
  const calendar = await getGoogleCalendarClient();

  const response = await calendar.calendarList.list();
  return response.data.items || [];
}
