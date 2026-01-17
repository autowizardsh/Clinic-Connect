// Google Calendar Integration - Per-Doctor OAuth
import { google } from 'googleapis';

// OAuth 2.0 Client configuration
// These should be set from Google Cloud Console OAuth credentials
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const REDIRECT_URI = process.env.REPLIT_DEV_DOMAIN 
  ? `https://${process.env.REPLIT_DEV_DOMAIN}/api/doctor/calendar/callback`
  : process.env.REPLIT_DEPLOYMENT_URL
    ? `${process.env.REPLIT_DEPLOYMENT_URL}/api/doctor/calendar/callback`
    : 'http://localhost:5000/api/doctor/calendar/callback';

// Check if OAuth is configured
export function isOAuthConfigured(): boolean {
  return !!(GOOGLE_CLIENT_ID && GOOGLE_CLIENT_SECRET);
}

// Create OAuth2 client
function createOAuth2Client() {
  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) {
    throw new Error('Google OAuth credentials not configured. Please set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET.');
  }
  return new google.auth.OAuth2(GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, REDIRECT_URI);
}

// Generate OAuth URL for a doctor to connect their calendar
export function getAuthUrl(doctorId: number): string {
  const oauth2Client = createOAuth2Client();
  
  const scopes = [
    'https://www.googleapis.com/auth/calendar',
    'https://www.googleapis.com/auth/calendar.events',
  ];

  return oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: scopes,
    prompt: 'consent', // Force consent screen to get refresh token
    state: String(doctorId), // Pass doctor ID in state
  });
}

// Exchange authorization code for tokens
export async function exchangeCodeForTokens(code: string): Promise<{
  access_token: string;
  refresh_token: string;
  expiry_date: number;
}> {
  const oauth2Client = createOAuth2Client();
  const { tokens } = await oauth2Client.getToken(code);
  
  if (!tokens.refresh_token) {
    throw new Error('No refresh token received. Please revoke access and try again.');
  }
  
  return {
    access_token: tokens.access_token || '',
    refresh_token: tokens.refresh_token,
    expiry_date: tokens.expiry_date || Date.now() + 3600000,
  };
}

// Get a calendar client for a specific doctor using their refresh token
export async function getCalendarClientForDoctor(refreshToken: string) {
  const oauth2Client = createOAuth2Client();
  oauth2Client.setCredentials({ refresh_token: refreshToken });
  
  // Refresh the access token
  const { credentials } = await oauth2Client.refreshAccessToken();
  oauth2Client.setCredentials(credentials);
  
  return google.calendar({ version: 'v3', auth: oauth2Client });
}

// Revoke access for a doctor
export async function revokeAccess(refreshToken: string): Promise<void> {
  const oauth2Client = createOAuth2Client();
  oauth2Client.setCredentials({ refresh_token: refreshToken });
  await oauth2Client.revokeCredentials();
}

// Create a calendar event for an appointment (using doctor's token)
export async function createCalendarEvent(
  refreshToken: string,
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
  const calendar = await getCalendarClientForDoctor(refreshToken);
  
  // Parse date and time - date is expected as YYYY-MM-DD, time as HH:MM
  const dateStr = appointment.date.split('T')[0];
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

// Get calendar events (using doctor's token)
export async function getCalendarEvents(
  refreshToken: string,
  calendarId: string,
  timeMin: Date,
  timeMax: Date
) {
  const calendar = await getCalendarClientForDoctor(refreshToken);

  const response = await calendar.events.list({
    calendarId: calendarId || 'primary',
    timeMin: timeMin.toISOString(),
    timeMax: timeMax.toISOString(),
    singleEvents: true,
    orderBy: 'startTime',
  });

  return response.data.items || [];
}

// List available calendars (using doctor's token)
export async function listCalendars(refreshToken: string) {
  const calendar = await getCalendarClientForDoctor(refreshToken);

  const response = await calendar.calendarList.list();
  return response.data.items || [];
}

// Delete a calendar event (using doctor's token)
export async function deleteCalendarEvent(
  refreshToken: string,
  calendarId: string,
  eventId: string
) {
  const calendar = await getCalendarClientForDoctor(refreshToken);

  await calendar.events.delete({
    calendarId: calendarId || 'primary',
    eventId: eventId,
  });
}
