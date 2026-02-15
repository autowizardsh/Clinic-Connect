import { SESClient, SendRawEmailCommand } from "@aws-sdk/client-ses";
import { storage } from "../storage";
import { toZonedTime } from "date-fns-tz";

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

function toClinicTime(date: Date, timezone: string): Date {
  return toZonedTime(date, timezone);
}

function formatDate(date: Date, timezone?: string): string {
  const d = timezone ? toClinicTime(date, timezone) : date;
  const days = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const months = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  return `${days[d.getDay()]}, ${months[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
}

function formatTime(date: Date, timezone?: string): string {
  const d = timezone ? toClinicTime(date, timezone) : date;
  const hours = d.getHours();
  const minutes = String(d.getMinutes()).padStart(2, "0");
  const ampm = hours >= 12 ? "PM" : "AM";
  const displayHour = hours % 12 || 12;
  return `${displayHour}:${minutes} ${ampm}`;
}

function formatICSDate(date: Date, timezone?: string): string {
  const d = timezone ? toClinicTime(date, timezone) : date;
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  const h = String(d.getHours()).padStart(2, "0");
  const min = String(d.getMinutes()).padStart(2, "0");
  const s = String(d.getSeconds()).padStart(2, "0");
  return `${y}${m}${day}T${h}${min}${s}`;
}

function generateICSContent(data: {
  referenceNumber: string;
  patientName: string;
  doctorName: string;
  date: Date;
  duration: number;
  service: string;
  clinicName: string;
  clinicAddress?: string;
  timezone: string;
  method: "REQUEST" | "CANCEL";
}): string {
  const startDate = formatICSDate(data.date, data.timezone);
  const endDate = new Date(data.date.getTime() + data.duration * 60 * 1000);
  const endDateStr = formatICSDate(endDate, data.timezone);
  const now = formatICSDate(new Date());
  const uid = `${data.referenceNumber}@dentalclinic`;
  const status = data.method === "CANCEL" ? "CANCELLED" : "CONFIRMED";
  const doctorDisplay = data.doctorName.startsWith("Dr.") ? data.doctorName : `Dr. ${data.doctorName}`;
  const sequence = Math.floor(Date.now() / 1000);

  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//DentalClinic//Appointment//EN",
    `METHOD:${data.method}`,
    "CALSCALE:GREGORIAN",
    "BEGIN:VEVENT",
    `UID:${uid}`,
    `DTSTAMP:${now}`,
    `DTSTART;TZID=${data.timezone}:${startDate}`,
    `DTEND;TZID=${data.timezone}:${endDateStr}`,
    `SUMMARY:${data.service} - ${data.clinicName}`,
    `DESCRIPTION:Appointment with ${doctorDisplay}\\nService: ${data.service}\\nReference: ${data.referenceNumber}\\nPatient: ${data.patientName}`,
    `LOCATION:${data.clinicAddress || data.clinicName}`,
    `ORGANIZER;CN=${data.clinicName}:MAILTO:${getFromEmail() || "noreply@clinic.com"}`,
    `STATUS:${status}`,
    `SEQUENCE:${sequence}`,
    "BEGIN:VALARM",
    "TRIGGER:-PT30M",
    "ACTION:DISPLAY",
    `DESCRIPTION:Reminder: ${data.service} at ${data.clinicName} in 30 minutes`,
    "END:VALARM",
    "END:VEVENT",
    "END:VCALENDAR",
  ];

  return lines.join("\r\n");
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

function appointmentDetailsTable(data: {
  referenceNumber: string;
  patientName: string;
  doctorName: string;
  date: Date;
  service: string;
  duration?: number;
  timezone?: string;
}, bgColor: string, borderColor: string): string {
  const tz = data.timezone;
  const rows = [
    { label: "Reference", value: data.referenceNumber, bold: true },
    { label: "Patient", value: data.patientName },
    { label: "Doctor", value: `Dr. ${data.doctorName}` },
    { label: "Date", value: formatDate(data.date, tz) },
    { label: "Time", value: formatTime(data.date, tz) },
    { label: "Service", value: data.service },
  ];
  if (data.duration) {
    rows.push({ label: "Duration", value: `${data.duration} minutes`, bold: false } as any);
  }
  const rowsHtml = rows.map(r =>
    `<tr>
<td style="padding:6px 0;font-size:13px;color:#6b7280;width:120px;">${r.label}</td>
<td style="padding:6px 0;font-size:14px;color:#111827;${(r as any).bold ? 'font-weight:600;' : ''}">${r.value}</td>
</tr>`
  ).join("");

  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:${bgColor};border:1px solid ${borderColor};border-radius:6px;padding:20px;margin-bottom:24px;">
<tr><td>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0">
${rowsHtml}
</table>
</td></tr>
</table>`;
}

function scheduledEmailBody(data: {
  patientName: string;
  doctorName: string;
  date: Date;
  service: string;
  duration: number;
  referenceNumber: string;
  timezone?: string;
}): string {
  return `
<h2 style="margin:0 0 8px;font-size:18px;color:#111827;">Appointment Confirmed</h2>
<p style="margin:0 0 24px;font-size:14px;color:#6b7280;">Hi ${data.patientName}, your appointment has been successfully booked.</p>

${appointmentDetailsTable({ ...data, patientName: data.patientName }, "#f0fdfa", "#ccfbf1")}

<p style="margin:0;font-size:13px;color:#6b7280;">
Please save your reference number <strong>${data.referenceNumber}</strong> — you'll need it if you want to reschedule or cancel your appointment.
</p>`;
}

function scheduledStaffEmailBody(data: {
  patientName: string;
  doctorName: string;
  date: Date;
  service: string;
  duration: number;
  referenceNumber: string;
  recipientRole: string;
  timezone?: string;
}): string {
  return `
<h2 style="margin:0 0 8px;font-size:18px;color:#111827;">New Appointment Booked</h2>
<p style="margin:0 0 24px;font-size:14px;color:#6b7280;">A new appointment has been booked. Here are the details:</p>

${appointmentDetailsTable(data, "#f0fdfa", "#ccfbf1")}`;
}

function rescheduledEmailBody(data: {
  patientName: string;
  doctorName: string;
  oldDate: Date;
  newDate: Date;
  service: string;
  duration: number;
  referenceNumber: string;
  timezone?: string;
}): string {
  return `
<h2 style="margin:0 0 8px;font-size:18px;color:#111827;">Appointment Rescheduled</h2>
<p style="margin:0 0 24px;font-size:14px;color:#6b7280;">Hi ${data.patientName}, your appointment has been rescheduled.</p>

<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#fef3c7;border:1px solid #fde68a;border-radius:6px;padding:16px;margin-bottom:16px;">
<tr><td>
<p style="margin:0;font-size:13px;color:#92400e;">
<strong>Previous:</strong> ${formatDate(data.oldDate, data.timezone)} at ${formatTime(data.oldDate, data.timezone)}
</p>
</td></tr>
</table>

${appointmentDetailsTable({ ...data, date: data.newDate }, "#f0fdfa", "#ccfbf1")}`;
}

function rescheduledStaffEmailBody(data: {
  patientName: string;
  doctorName: string;
  oldDate: Date;
  newDate: Date;
  service: string;
  duration: number;
  referenceNumber: string;
  timezone?: string;
}): string {
  return `
<h2 style="margin:0 0 8px;font-size:18px;color:#111827;">Appointment Rescheduled</h2>
<p style="margin:0 0 24px;font-size:14px;color:#6b7280;">An appointment has been rescheduled. Here are the updated details:</p>

<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#fef3c7;border:1px solid #fde68a;border-radius:6px;padding:16px;margin-bottom:16px;">
<tr><td>
<p style="margin:0;font-size:13px;color:#92400e;">
<strong>Previous:</strong> ${formatDate(data.oldDate, data.timezone)} at ${formatTime(data.oldDate, data.timezone)}
</p>
</td></tr>
</table>

${appointmentDetailsTable({ ...data, date: data.newDate }, "#f0fdfa", "#ccfbf1")}`;
}

function cancelledEmailBody(data: {
  patientName: string;
  doctorName: string;
  date: Date;
  service: string;
  referenceNumber: string;
  timezone?: string;
}): string {
  return `
<h2 style="margin:0 0 8px;font-size:18px;color:#111827;">Appointment Cancelled</h2>
<p style="margin:0 0 24px;font-size:14px;color:#6b7280;">Hi ${data.patientName}, your appointment has been cancelled.</p>

${appointmentDetailsTable(data, "#fef2f2", "#fecaca")}

<p style="margin:0;font-size:13px;color:#6b7280;">
If you'd like to book a new appointment, please use our chat or contact the clinic directly.
</p>`;
}

function cancelledStaffEmailBody(data: {
  patientName: string;
  doctorName: string;
  date: Date;
  service: string;
  referenceNumber: string;
  timezone?: string;
}): string {
  return `
<h2 style="margin:0 0 8px;font-size:18px;color:#111827;">Appointment Cancelled</h2>
<p style="margin:0 0 24px;font-size:14px;color:#6b7280;">An appointment has been cancelled. Here are the details:</p>

${appointmentDetailsTable(data, "#fef2f2", "#fecaca")}`;
}

function buildRawEmail(options: {
  from: string;
  to: string;
  subject: string;
  htmlBody: string;
  icsContent?: string;
  icsFilename?: string;
  icsMethod?: string;
}): string {
  const boundary = `----=_Part_${Date.now()}_${Math.random().toString(36).substring(2)}`;
  const calBoundary = `----=_Cal_${Date.now()}_${Math.random().toString(36).substring(2)}`;

  const headers = [
    `From: ${options.from}`,
    `To: ${options.to}`,
    `Subject: ${options.subject}`,
    `MIME-Version: 1.0`,
  ];

  if (options.icsContent && options.icsMethod) {
    headers.push(`Content-Type: multipart/mixed; boundary="${boundary}"`);

    const icsBase64 = Buffer.from(options.icsContent).toString("base64");

    const body = [
      `--${boundary}`,
      `Content-Type: multipart/alternative; boundary="${calBoundary}"`,
      ``,
      `--${calBoundary}`,
      `Content-Type: text/html; charset=UTF-8`,
      `Content-Transfer-Encoding: 7bit`,
      ``,
      options.htmlBody,
      ``,
      `--${calBoundary}`,
      `Content-Type: text/calendar; charset=UTF-8; method=${options.icsMethod}`,
      `Content-Transfer-Encoding: base64`,
      ``,
      icsBase64,
      ``,
      `--${calBoundary}--`,
      ``,
      `--${boundary}`,
      `Content-Type: text/calendar; charset=UTF-8; method=${options.icsMethod}; name="${options.icsFilename || "invite.ics"}"`,
      `Content-Disposition: attachment; filename="${options.icsFilename || "invite.ics"}"`,
      `Content-Transfer-Encoding: base64`,
      ``,
      icsBase64,
      ``,
      `--${boundary}--`,
    ];

    return [...headers, ``, ...body].join("\r\n");
  } else {
    headers.push(`Content-Type: text/html; charset=UTF-8`);
    return [...headers, ``, options.htmlBody].join("\r\n");
  }
}

async function sendEmail(to: string, subject: string, htmlBody: string, icsOptions?: {
  icsContent: string;
  icsFilename: string;
  icsMethod: string;
}): Promise<boolean> {
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
    const rawMessage = buildRawEmail({
      from: fromEmail,
      to,
      subject,
      htmlBody,
      icsContent: icsOptions?.icsContent,
      icsFilename: icsOptions?.icsFilename,
      icsMethod: icsOptions?.icsMethod,
    });

    const command = new SendRawEmailCommand({
      RawMessage: {
        Data: Buffer.from(rawMessage),
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

async function getClinicInfo(): Promise<{ clinicName: string; address: string; timezone: string }> {
  try {
    const settings = await storage.getClinicSettings();
    return {
      clinicName: settings?.clinicName || "Dental Clinic",
      address: settings?.address || "Dental Clinic",
      timezone: settings?.timezone || "Europe/Amsterdam",
    };
  } catch {
    return { clinicName: "Dental Clinic", address: "Dental Clinic", timezone: "Europe/Amsterdam" };
  }
}

async function getAdminEmail(): Promise<string | null> {
  try {
    const settings = await storage.getClinicSettings();
    return settings?.email || null;
  } catch {
    return null;
  }
}

async function getDoctorEmail(doctorName: string): Promise<string | null> {
  try {
    const allDoctors = await storage.getDoctors();
    const normalizedName = doctorName.replace(/^Dr\.?\s*/i, "").trim().toLowerCase();
    const doctor = allDoctors.find(d => {
      const dbName = d.name.replace(/^Dr\.?\s*/i, "").trim().toLowerCase();
      return dbName === normalizedName;
    });
    return doctor?.email || null;
  } catch {
    return null;
  }
}

async function sendStaffNotifications(
  doctorName: string,
  subject: string,
  staffHtml: string,
  icsOptions?: { icsContent: string; icsFilename: string; icsMethod: string },
): Promise<void> {
  const [doctorEmail, adminEmail] = await Promise.all([
    getDoctorEmail(doctorName),
    getAdminEmail(),
  ]);

  const sends: Promise<boolean>[] = [];

  if (doctorEmail) {
    sends.push(sendEmail(doctorEmail, subject, staffHtml, icsOptions));
  }
  if (adminEmail && adminEmail !== doctorEmail) {
    sends.push(sendEmail(adminEmail, subject, staffHtml, icsOptions));
  }

  if (sends.length > 0) {
    await Promise.allSettled(sends);
  }
}

function reminderEmailBody(data: {
  patientName: string;
  doctorName: string;
  date: Date;
  service: string;
  referenceNumber: string;
  offsetMinutes: number;
  timezone?: string;
}): string {
  let timeLabel: string;
  if (data.offsetMinutes >= 1440) {
    const days = Math.round(data.offsetMinutes / 1440);
    timeLabel = days === 1 ? "tomorrow" : `in ${days} days`;
  } else if (data.offsetMinutes >= 60) {
    const hours = Math.round(data.offsetMinutes / 60);
    timeLabel = hours === 1 ? "in 1 hour" : `in ${hours} hours`;
  } else {
    timeLabel = `in ${data.offsetMinutes} minutes`;
  }

  return `
<h2 style="margin:0 0 8px;font-size:18px;color:#111827;">Appointment Reminder</h2>
<p style="margin:0 0 24px;font-size:14px;color:#6b7280;">Hi ${data.patientName}, this is a friendly reminder that your appointment is ${timeLabel}.</p>

${appointmentDetailsTable(data, "#eff6ff", "#bfdbfe")}

<p style="margin:0;font-size:13px;color:#6b7280;">
If you need to reschedule or cancel, please use your reference number <strong>${data.referenceNumber}</strong> in our chat or contact the clinic.
</p>`;
}

export async function sendAppointmentReminderEmail(data: {
  patientEmail: string;
  patientName: string;
  doctorName: string;
  date: Date;
  service: string;
  referenceNumber: string;
  offsetMinutes: number;
}): Promise<boolean> {
  const clinic = await getClinicInfo();
  const tz = clinic.timezone;
  const subject = `Reminder: Appointment ${formatDate(data.date, tz)} at ${formatTime(data.date, tz)}`;
  const body = reminderEmailBody({ ...data, timezone: tz });
  const html = baseTemplate(clinic.clinicName, "Appointment Reminder", body);
  return sendEmail(data.patientEmail, subject, html);
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
  const clinic = await getClinicInfo();
  const tz = clinic.timezone;
  const subject = `Appointment Confirmed — ${formatDate(data.date, tz)} at ${formatTime(data.date, tz)}`;

  const icsContent = generateICSContent({
    ...data,
    clinicName: clinic.clinicName,
    clinicAddress: clinic.address,
    timezone: tz,
    method: "REQUEST",
  });
  const icsOptions = {
    icsContent,
    icsFilename: "appointment.ics",
    icsMethod: "REQUEST",
  };

  const patientBody = scheduledEmailBody({ ...data, timezone: tz });
  const patientHtml = baseTemplate(clinic.clinicName, "Appointment Confirmed", patientBody);
  const patientResult = sendEmail(data.patientEmail, subject, patientHtml, icsOptions);

  const staffBody = scheduledStaffEmailBody({ ...data, recipientRole: "staff", timezone: tz });
  const staffHtml = baseTemplate(clinic.clinicName, "New Appointment Booked", staffBody);
  sendStaffNotifications(data.doctorName, `New Booking: ${data.patientName} — ${formatDate(data.date, tz)} at ${formatTime(data.date, tz)}`, staffHtml, icsOptions);

  return patientResult;
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
  const clinic = await getClinicInfo();
  const tz = clinic.timezone;
  const subject = `Appointment Rescheduled — New: ${formatDate(data.newDate, tz)} at ${formatTime(data.newDate, tz)}`;

  const icsContent = generateICSContent({
    ...data,
    date: data.newDate,
    clinicName: clinic.clinicName,
    clinicAddress: clinic.address,
    timezone: tz,
    method: "REQUEST",
  });
  const icsOptions = {
    icsContent,
    icsFilename: "appointment-updated.ics",
    icsMethod: "REQUEST",
  };

  const patientBody = rescheduledEmailBody({ ...data, timezone: tz });
  const patientHtml = baseTemplate(clinic.clinicName, "Appointment Rescheduled", patientBody);
  const patientResult = sendEmail(data.patientEmail, subject, patientHtml, icsOptions);

  const staffBody = rescheduledStaffEmailBody({ ...data, timezone: tz });
  const staffHtml = baseTemplate(clinic.clinicName, "Appointment Rescheduled", staffBody);
  sendStaffNotifications(data.doctorName, `Rescheduled: ${data.patientName} — New: ${formatDate(data.newDate, tz)} at ${formatTime(data.newDate, tz)}`, staffHtml, icsOptions);

  return patientResult;
}

export async function sendAppointmentCancelledEmail(data: {
  patientEmail: string;
  patientName: string;
  doctorName: string;
  date: Date;
  service: string;
  referenceNumber: string;
}): Promise<boolean> {
  const clinic = await getClinicInfo();
  const subject = `Appointment Cancelled — ${data.referenceNumber}`;

  const tz = clinic.timezone;
  const icsContent = generateICSContent({
    ...data,
    duration: 15,
    clinicName: clinic.clinicName,
    clinicAddress: clinic.address,
    timezone: tz,
    method: "CANCEL",
  });
  const icsOptions = {
    icsContent,
    icsFilename: "appointment-cancelled.ics",
    icsMethod: "CANCEL",
  };

  const patientBody = cancelledEmailBody({ ...data, timezone: tz });
  const patientHtml = baseTemplate(clinic.clinicName, "Appointment Cancelled", patientBody);
  const patientResult = sendEmail(data.patientEmail, subject, patientHtml, icsOptions);

  const staffBody = cancelledStaffEmailBody({ ...data, timezone: tz });
  const staffHtml = baseTemplate(clinic.clinicName, "Appointment Cancelled", staffBody);
  sendStaffNotifications(data.doctorName, `Cancelled: ${data.patientName} — ${data.referenceNumber}`, staffHtml, icsOptions);

  return patientResult;
}
