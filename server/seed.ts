import { db } from "./db";
import { adminUsers, doctors, doctorAvailability, clinicSettings } from "@shared/schema";
import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";

async function seed() {
  console.log("Starting database seed...\n");

  const existingAdmin = await db.select().from(adminUsers).where(eq(adminUsers.username, "admin")).limit(1);
  if (existingAdmin.length > 0) {
    console.log("Seed data already exists (admin user found). Skipping.\n");
    process.exit(0);
  }

  const adminPassword = await bcrypt.hash("D3nt@l!Adm1n#2026", 12);

  const [doctor1] = await db.insert(doctors).values({
    userId: "doctor-1",
    name: "Dr. Sarah van den Berg",
    email: "sarah.vandenberg@clinic.example",
    phone: "+31612345678",
    specialty: "General Dentistry",
    bio: "Experienced general dentist specializing in preventive care and cosmetic dentistry.",
    isActive: true,
  }).returning();

  const [doctor2] = await db.insert(doctors).values({
    userId: "doctor-2",
    name: "Dr. Jan de Vries",
    email: "jan.devries@clinic.example",
    phone: "+31687654321",
    specialty: "Orthodontics",
    bio: "Orthodontist with expertise in braces, aligners, and jaw alignment correction.",
    isActive: true,
  }).returning();

  console.log(`Created doctor: ${doctor1.name} (ID: ${doctor1.id})`);
  console.log(`Created doctor: ${doctor2.name} (ID: ${doctor2.id})`);

  const [admin] = await db.insert(adminUsers).values({
    userId: "admin-1",
    username: "admin",
    password: adminPassword,
    name: "Clinic Administrator",
    role: "admin",
  }).returning();

  console.log(`Created admin user: ${admin.username} (ID: ${admin.id})`);

  const doctorPassword1 = await bcrypt.hash("Dr$arah#2026!", 12);
  const doctorPassword2 = await bcrypt.hash("DrJ@n#2026!", 12);

  const [doctorUser1] = await db.insert(adminUsers).values({
    userId: "doctor-login-1",
    username: "dr.sarah",
    password: doctorPassword1,
    name: "Dr. Sarah van den Berg",
    role: "doctor",
    doctorId: doctor1.id,
  }).returning();

  const [doctorUser2] = await db.insert(adminUsers).values({
    userId: "doctor-login-2",
    username: "dr.jan",
    password: doctorPassword2,
    name: "Dr. Jan de Vries",
    role: "doctor",
    doctorId: doctor2.id,
  }).returning();

  console.log(`Created doctor login: ${doctorUser1.username} (linked to Doctor ID: ${doctor1.id})`);
  console.log(`Created doctor login: ${doctorUser2.username} (linked to Doctor ID: ${doctor2.id})`);

  const today = new Date();
  const availabilitySlots = [];
  for (let dayOffset = 0; dayOffset < 14; dayOffset++) {
    const date = new Date(today);
    date.setDate(today.getDate() + dayOffset);
    const dayOfWeek = date.getDay();

    if (dayOfWeek === 0 || dayOfWeek === 6) continue;

    const dateStr = date.toISOString().split("T")[0];

    availabilitySlots.push(
      { doctorId: doctor1.id, date: dateStr, startTime: "09:00", endTime: "12:30", isAvailable: true, reason: null },
      { doctorId: doctor1.id, date: dateStr, startTime: "13:30", endTime: "17:00", isAvailable: true, reason: null },
      { doctorId: doctor2.id, date: dateStr, startTime: "08:30", endTime: "12:00", isAvailable: true, reason: null },
      { doctorId: doctor2.id, date: dateStr, startTime: "13:00", endTime: "16:30", isAvailable: true, reason: null },
    );
  }

  await db.insert(doctorAvailability).values(availabilitySlots);
  console.log(`Created ${availabilitySlots.length} availability slots (2 weeks, Mon-Fri)`);

  await db.insert(clinicSettings).values({
    clinicName: "Amsterdam Dental Care",
    address: "Keizersgracht 123, 1015 Amsterdam",
    phone: "+31201234567",
    email: "info@amsterdamdentalcare.example",
    appointmentDuration: 30,
    workingDays: [1, 2, 3, 4, 5],
    openTime: "08:30",
    closeTime: "17:00",
    timezone: "Europe/Amsterdam",
    welcomeMessage: "Welcome to Amsterdam Dental Care! How can I help you today?",
    chatBotName: "Dental Assistant",
    chatWidgetColor: "#0891b2",
    services: ["General Checkup", "Teeth Cleaning", "Fillings", "Root Canal", "Teeth Whitening", "Orthodontics", "Dental Implants", "Wisdom Tooth Extraction"],
  });

  console.log("Created clinic settings\n");

  console.log("=".repeat(50));
  console.log("SEED COMPLETE - Login Credentials");
  console.log("=".repeat(50));
  console.log("");
  console.log("Admin Portal:");
  console.log("  Username: admin");
  console.log("  Password: D3nt@l!Adm1n#2026");
  console.log("");
  console.log("Doctor Portal (Dr. Sarah):");
  console.log("  Username: dr.sarah");
  console.log("  Password: Dr$arah#2026!");
  console.log("");
  console.log("Doctor Portal (Dr. Jan):");
  console.log("  Username: dr.jan");
  console.log("  Password: DrJ@n#2026!");
  console.log("");
  console.log("=".repeat(50));

  process.exit(0);
}

seed().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
