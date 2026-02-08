import { SESClient, SendEmailCommand } from "@aws-sdk/client-ses";
import { storage } from "../storage";

let sesClient: SESClient | null = null;

function getSESClient(): SESClient | null {
  if (sesClient) return sesClient;
  const accessKeyId = process.env.AWS_SES_ACCESS_KEY_ID;
  const secretAccessKey = process.env.AWS_SES_SECRET_ACCESS_KEY;
  const region = process.env.AWS_SES_REGION;
  if (!accessKeyId || !secretAccessKey || !region) {
    return null;
  }
  sesClient = new SESClient({
    region,
    credentials: { accessKeyId, secretAccessKey },
  });
  return sesClient;
}

function getFromEmail(): string | null {
  return process.env.AWS_SES_FROM_EMAIL || null;
}

function formatDate(date: Date): string {
  const days = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const months = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  return `${days[date.getDay()]}, ${months[date.getMonth()]} ${date.getDate()}, ${date.getFullYear()}`;
}

function formatTime(date: Date): string {
  const hours = date.getHours();
  const minutes = String(date.getMinutes()).padStart(2, "0");
  const ampm = hours >= 12 ? "PM" : "AM";
  const displayHour = hours % 12 || 12;
  return `${displayHour}:${minutes} ${ampm}`;
}

function baseTemplate(clinicName: string, title: string, body: string): string {
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${title}</title>
</head>
<body style="margin:0;padding:0;background-color:#f4f4f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f4f4f5;padding:32px 16px;">
<tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background-color:#ffffff;border-radius:8px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.08);">

<tr><td style="background-color:#0f766e;padding:24px 32px;">
<h1 style="margin:0;color:#ffffff;font-size:20px;font-weight:600;">${clinicName}</h1>
</td></tr>

<tr><td style="padding:32px;">
${body}
</td></tr>

<tr><td style="padding:16px 32px;background-color:#f9fafb;border-top:1px solid #e5e7eb;">
<p style="margin:0;font-size:12px;color:#9ca3af;text-align:center;">
This is an automated message from ${clinicName}. Please do not reply to this email.
</p>
</td></tr>

</table>
</td></tr>
</table>
</body>
</html>`;
}

function scheduledEmailBody(data: {
  patientName: string;
  doctorName: string;
  date: Date;
  service: string;
  duration: number;
  referenceNumber: string;
}): string {
  return `
<h2 style="margin:0 0 8px;font-size:18px;color:#111827;">Appointment Confirmed</h2>
<p style="margin:0 0 24px;font-size:14px;color:#6b7280;">Hi ${data.patientName}, your appointment has been successfully booked.</p>

<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f0fdfa;border:1px solid #ccfbf1;border-radius:6px;padding:20px;margin-bottom:24px;">
<tr><td>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0">
<tr>
<td style="padding:6px 0;font-size:13px;color:#6b7280;width:120px;">Reference</td>
<td style="padding:6px 0;font-size:14px;color:#111827;font-weight:600;">${data.referenceNumber}</td>
</tr>
<tr>
<td style="padding:6px 0;font-size:13px;color:#6b7280;">Doctor</td>
<td style="padding:6px 0;font-size:14px;color:#111827;">Dr. ${data.doctorName}</td>
</tr>
<tr>
<td style="padding:6px 0;font-size:13px;color:#6b7280;">Date</td>
<td style="padding:6px 0;font-size:14px;color:#111827;">${formatDate(data.date)}</td>
</tr>
<tr>
<td style="padding:6px 0;font-size:13px;color:#6b7280;">Time</td>
<td style="padding:6px 0;font-size:14px;color:#111827;">${formatTime(data.date)}</td>
</tr>
<tr>
<td style="padding:6px 0;font-size:13px;color:#6b7280;">Service</td>
<td style="padding:6px 0;font-size:14px;color:#111827;">${data.service}</td>
</tr>
<tr>
<td style="padding:6px 0;font-size:13px;color:#6b7280;">Duration</td>
<td style="padding:6px 0;font-size:14px;color:#111827;">${data.duration} minutes</td>
</tr>
</table>
</td></tr>
</table>

<p style="margin:0;font-size:13px;color:#6b7280;">
Please save your reference number <strong>${data.referenceNumber}</strong> — you'll need it if you want to reschedule or cancel your appointment.
</p>`;
}

function rescheduledEmailBody(data: {
  patientName: string;
  doctorName: string;
  oldDate: Date;
  newDate: Date;
  service: string;
  duration: number;
  referenceNumber: string;
}): string {
  return `
<h2 style="margin:0 0 8px;font-size:18px;color:#111827;">Appointment Rescheduled</h2>
<p style="margin:0 0 24px;font-size:14px;color:#6b7280;">Hi ${data.patientName}, your appointment has been rescheduled.</p>

<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#fef3c7;border:1px solid #fde68a;border-radius:6px;padding:16px;margin-bottom:16px;">
<tr><td>
<p style="margin:0;font-size:13px;color:#92400e;">
<strong>Previous:</strong> ${formatDate(data.oldDate)} at ${formatTime(data.oldDate)}
</p>
</td></tr>
</table>

<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f0fdfa;border:1px solid #ccfbf1;border-radius:6px;padding:20px;margin-bottom:24px;">
<tr><td>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0">
<tr>
<td style="padding:6px 0;font-size:13px;color:#6b7280;width:120px;">Reference</td>
<td style="padding:6px 0;font-size:14px;color:#111827;font-weight:600;">${data.referenceNumber}</td>
</tr>
<tr>
<td style="padding:6px 0;font-size:13px;color:#6b7280;">Doctor</td>
<td style="padding:6px 0;font-size:14px;color:#111827;">Dr. ${data.doctorName}</td>
</tr>
<tr>
<td style="padding:6px 0;font-size:13px;color:#6b7280;">New Date</td>
<td style="padding:6px 0;font-size:14px;color:#111827;">${formatDate(data.newDate)}</td>
</tr>
<tr>
<td style="padding:6px 0;font-size:13px;color:#6b7280;">New Time</td>
<td style="padding:6px 0;font-size:14px;color:#111827;">${formatTime(data.newDate)}</td>
</tr>
<tr>
<td style="padding:6px 0;font-size:13px;color:#6b7280;">Service</td>
<td style="padding:6px 0;font-size:14px;color:#111827;">${data.service}</td>
</tr>
<tr>
<td style="padding:6px 0;font-size:13px;color:#6b7280;">Duration</td>
<td style="padding:6px 0;font-size:14px;color:#111827;">${data.duration} minutes</td>
</tr>
</table>
</td></tr>
</table>`;
}

function cancelledEmailBody(data: {
  patientName: string;
  doctorName: string;
  date: Date;
  service: string;
  referenceNumber: string;
}): string {
  return `
<h2 style="margin:0 0 8px;font-size:18px;color:#111827;">Appointment Cancelled</h2>
<p style="margin:0 0 24px;font-size:14px;color:#6b7280;">Hi ${data.patientName}, your appointment has been cancelled.</p>

<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#fef2f2;border:1px solid #fecaca;border-radius:6px;padding:20px;margin-bottom:24px;">
<tr><td>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0">
<tr>
<td style="padding:6px 0;font-size:13px;color:#6b7280;width:120px;">Reference</td>
<td style="padding:6px 0;font-size:14px;color:#111827;font-weight:600;">${data.referenceNumber}</td>
</tr>
<tr>
<td style="padding:6px 0;font-size:13px;color:#6b7280;">Doctor</td>
<td style="padding:6px 0;font-size:14px;color:#111827;">Dr. ${data.doctorName}</td>
</tr>
<tr>
<td style="padding:6px 0;font-size:13px;color:#6b7280;">Date</td>
<td style="padding:6px 0;font-size:14px;color:#111827;">${formatDate(data.date)}</td>
</tr>
<tr>
<td style="padding:6px 0;font-size:13px;color:#6b7280;">Time</td>
<td style="padding:6px 0;font-size:14px;color:#111827;">${formatTime(data.date)}</td>
</tr>
<tr>
<td style="padding:6px 0;font-size:13px;color:#6b7280;">Service</td>
<td style="padding:6px 0;font-size:14px;color:#111827;">${data.service}</td>
</tr>
</table>
</td></tr>
</table>

<p style="margin:0;font-size:13px;color:#6b7280;">
If you'd like to book a new appointment, please use our chat or contact the clinic directly.
</p>`;
}

async function sendEmail(to: string, subject: string, htmlBody: string): Promise<boolean> {
  const client = getSESClient();
  if (!client) {
    console.log("SES not configured (missing credentials) — skipping email to", to);
    return false;
  }

  const fromEmail = getFromEmail();
  if (!fromEmail) {
    console.log("SES not configured (missing AWS_SES_FROM_EMAIL) — skipping email to", to);
    return false;
  }

  try {
    const command = new SendEmailCommand({
      Source: fromEmail,
      Destination: { ToAddresses: [to] },
      Message: {
        Subject: { Data: subject, Charset: "UTF-8" },
        Body: {
          Html: { Data: htmlBody, Charset: "UTF-8" },
        },
      },
    });

    await client.send(command);
    console.log("Email sent successfully to", to);
    return true;
  } catch (error) {
    console.error("Failed to send email via SES:", error);
    return false;
  }
}

async function getClinicName(): Promise<string> {
  try {
    const settings = await storage.getClinicSettings();
    return settings?.clinicName || "Dental Clinic";
  } catch {
    return "Dental Clinic";
  }
}

export async function sendAppointmentConfirmationEmail(data: {
  patientEmail: string;
  patientName: string;
  doctorName: string;
  date: Date;
  service: string;
  duration: number;
  referenceNumber: string;
}): Promise<boolean> {
  const clinicName = await getClinicName();
  const body = scheduledEmailBody(data);
  const html = baseTemplate(clinicName, "Appointment Confirmed", body);
  return sendEmail(
    data.patientEmail,
    `Appointment Confirmed — ${formatDate(data.date)} at ${formatTime(data.date)}`,
    html,
  );
}

export async function sendAppointmentRescheduledEmail(data: {
  patientEmail: string;
  patientName: string;
  doctorName: string;
  oldDate: Date;
  newDate: Date;
  service: string;
  duration: number;
  referenceNumber: string;
}): Promise<boolean> {
  const clinicName = await getClinicName();
  const body = rescheduledEmailBody(data);
  const html = baseTemplate(clinicName, "Appointment Rescheduled", body);
  return sendEmail(
    data.patientEmail,
    `Appointment Rescheduled — New: ${formatDate(data.newDate)} at ${formatTime(data.newDate)}`,
    html,
  );
}

export async function sendAppointmentCancelledEmail(data: {
  patientEmail: string;
  patientName: string;
  doctorName: string;
  date: Date;
  service: string;
  referenceNumber: string;
}): Promise<boolean> {
  const clinicName = await getClinicName();
  const body = cancelledEmailBody(data);
  const html = baseTemplate(clinicName, "Appointment Cancelled", body);
  return sendEmail(
    data.patientEmail,
    `Appointment Cancelled — ${data.referenceNumber}`,
    html,
  );
}
