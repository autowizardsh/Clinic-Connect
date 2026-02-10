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

function appointmentDetailsTable(data: {
  referenceNumber: string;
  patientName: string;
  doctorName: string;
  date: Date;
  service: string;
  duration?: number;
}, bgColor: string, borderColor: string): string {
  const rows = [
    { label: "Reference", value: data.referenceNumber, bold: true },
    { label: "Patient", value: data.patientName },
    { label: "Doctor", value: `Dr. ${data.doctorName}` },
    { label: "Date", value: formatDate(data.date) },
    { label: "Time", value: formatTime(data.date) },
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
}): string {
  return `
<h2 style="margin:0 0 8px;font-size:18px;color:#111827;">Appointment Rescheduled</h2>
<p style="margin:0 0 24px;font-size:14px;color:#6b7280;">An appointment has been rescheduled. Here are the updated details:</p>

<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#fef3c7;border:1px solid #fde68a;border-radius:6px;padding:16px;margin-bottom:16px;">
<tr><td>
<p style="margin:0;font-size:13px;color:#92400e;">
<strong>Previous:</strong> ${formatDate(data.oldDate)} at ${formatTime(data.oldDate)}
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
}): string {
  return `
<h2 style="margin:0 0 8px;font-size:18px;color:#111827;">Appointment Cancelled</h2>
<p style="margin:0 0 24px;font-size:14px;color:#6b7280;">An appointment has been cancelled. Here are the details:</p>

${appointmentDetailsTable(data, "#fef2f2", "#fecaca")}`;
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
    const doctor = allDoctors.find(d => d.name === doctorName);
    return doctor?.email || null;
  } catch {
    return null;
  }
}

async function sendStaffNotifications(
  doctorName: string,
  subject: string,
  staffHtml: string,
): Promise<void> {
  const [doctorEmail, adminEmail] = await Promise.all([
    getDoctorEmail(doctorName),
    getAdminEmail(),
  ]);

  const sends: Promise<boolean>[] = [];

  if (doctorEmail) {
    sends.push(sendEmail(doctorEmail, subject, staffHtml));
  }
  if (adminEmail && adminEmail !== doctorEmail) {
    sends.push(sendEmail(adminEmail, subject, staffHtml));
  }

  if (sends.length > 0) {
    await Promise.allSettled(sends);
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
  const subject = `Appointment Confirmed — ${formatDate(data.date)} at ${formatTime(data.date)}`;

  const patientBody = scheduledEmailBody(data);
  const patientHtml = baseTemplate(clinicName, "Appointment Confirmed", patientBody);
  const patientResult = sendEmail(data.patientEmail, subject, patientHtml);

  const staffBody = scheduledStaffEmailBody({ ...data, recipientRole: "staff" });
  const staffHtml = baseTemplate(clinicName, "New Appointment Booked", staffBody);
  sendStaffNotifications(data.doctorName, `New Booking: ${data.patientName} — ${formatDate(data.date)} at ${formatTime(data.date)}`, staffHtml);

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
  const clinicName = await getClinicName();
  const subject = `Appointment Rescheduled — New: ${formatDate(data.newDate)} at ${formatTime(data.newDate)}`;

  const patientBody = rescheduledEmailBody(data);
  const patientHtml = baseTemplate(clinicName, "Appointment Rescheduled", patientBody);
  const patientResult = sendEmail(data.patientEmail, subject, patientHtml);

  const staffBody = rescheduledStaffEmailBody(data);
  const staffHtml = baseTemplate(clinicName, "Appointment Rescheduled", staffBody);
  sendStaffNotifications(data.doctorName, `Rescheduled: ${data.patientName} — New: ${formatDate(data.newDate)} at ${formatTime(data.newDate)}`, staffHtml);

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
  const clinicName = await getClinicName();
  const subject = `Appointment Cancelled — ${data.referenceNumber}`;

  const patientBody = cancelledEmailBody(data);
  const patientHtml = baseTemplate(clinicName, "Appointment Cancelled", patientBody);
  const patientResult = sendEmail(data.patientEmail, subject, patientHtml);

  const staffBody = cancelledStaffEmailBody(data);
  const staffHtml = baseTemplate(clinicName, "Appointment Cancelled", staffBody);
  sendStaffNotifications(data.doctorName, `Cancelled: ${data.patientName} — ${data.referenceNumber}`, staffHtml);

  return patientResult;
}
