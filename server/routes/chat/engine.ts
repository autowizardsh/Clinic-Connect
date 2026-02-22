import { storage } from "../../storage";
import { buildSystemPrompt } from "./prompts";
import { runToolLoop, type ToolLoopResult, type QuickReply } from "./toolLoop";
import { getNowInTimezone, getTomorrowInTimezone, getDayAfterTomorrowInTimezone } from "../../utils/timezone";

export interface ChatEngineResult {
  response: string;
  quickReplies: QuickReply[];
  booking: ToolLoopResult["booking"];
}

export async function processChatMessage(
  sessionId: string,
  message: string,
  language: string = "en",
  source: string = "chat",
): Promise<ChatEngineResult> {
  await storage.createChatMessage({
    sessionId,
    role: "user",
    content: message,
  });

  const [settings, doctors, previousMessages] = await Promise.all([
    storage.getClinicSettings(),
    storage.getDoctors(),
    storage.getChatMessages(sessionId),
  ]);

  const activeDoctors = doctors.filter((d) => d.isActive);
  const services = settings?.services || ["General Checkup", "Teeth Cleaning"];
  const clinicTimezone = settings?.timezone || "Europe/Amsterdam";
  const clinicNow = getNowInTimezone(clinicTimezone);
  const today = clinicNow.dateStr;
  const tomorrow = getTomorrowInTimezone(clinicTimezone);
  const dayAfterTomorrow = getDayAfterTomorrowInTimezone(clinicTimezone);
  const currentDayOfWeek = clinicNow.dayOfWeek;

  const systemPrompt = buildSystemPrompt({
    language,
    clinicName:
      settings?.clinicName ||
      (language === "nl" ? "de tandartskliniek" : "the dental clinic"),
    services,
    activeDoctors: activeDoctors.map((d) => ({
      id: d.id,
      name: d.name,
      specialty: d.specialty,
    })),
    openTime: settings?.openTime || "09:00",
    closeTime: settings?.closeTime || "17:00",
    workingDays: settings?.workingDays || [1, 2, 3, 4, 5, 6],
    today,
    tomorrow,
    dayAfterTomorrow,
    currentDayOfWeek,
  });

  const conversationHistory = previousMessages.slice(-25).map((m) => ({
    role: m.role as "user" | "assistant",
    content: m.content,
  }));

  const currentMessages: any[] = [
    { role: "system", content: systemPrompt },
    ...conversationHistory,
  ];

  const result = await runToolLoop(currentMessages, {
    settings,
    activeDoctors: activeDoctors.map((d) => ({
      id: d.id,
      name: d.name,
      specialty: d.specialty,
      isActive: d.isActive,
    })),
    services,
    clinicTimezone,
    today,
    language,
    source,
  });

  if (result.response) {
    await storage.createChatMessage({
      sessionId,
      role: "assistant",
      content: result.response,
    });
  }

  return {
    response: result.response,
    quickReplies: result.quickReplies,
    booking: result.booking,
  };
}

export async function createChatSession(
  language: string = "en",
): Promise<{ sessionId: string; welcomeMessage: string; quickReplies: QuickReply[] }> {
  const { randomUUID } = await import("crypto");
  const sessionId = randomUUID();

  let settings = await storage.getClinicSettings();
  if (!settings) {
    settings = await storage.updateClinicSettings({
      clinicName: "Dental Clinic",
      welcomeMessage:
        language === "nl"
          ? "Welkom bij onze tandartskliniek! Hoe kan ik u vandaag helpen?"
          : "Welcome to our dental clinic! How can I help you today?",
    });
  }

  await storage.createChatSession({
    sessionId,
    language,
    status: "active",
  });

  const welcomeMessage =
    language === "nl"
      ? `Welkom bij ${settings.clinicName}! Ik ben uw AI-assistent. Ik kan u helpen met het boeken van een afspraak. Hoe kan ik u vandaag helpen?`
      : `Welcome to ${settings.clinicName}! I'm your AI assistant. I can help you book an appointment. How may I help you today?`;

  await storage.createChatMessage({
    sessionId,
    role: "assistant",
    content: welcomeMessage,
  });

  const quickReplies: QuickReply[] = language === "nl"
    ? [
        { label: "Afspraak maken", value: "Ik wil een afspraak maken" },
        { label: "Spoedafspraak", value: "Ik heb een spoedgeval en heb zo snel mogelijk een afspraak nodig" },
        { label: "Afspraak verzetten", value: "Ik wil mijn afspraak verzetten" },
        { label: "Afspraak annuleren", value: "Ik wil mijn afspraak annuleren" },
        { label: "Andere vraag", value: "Ik heb een andere vraag" },
      ]
    : [
        { label: "Book an appointment", value: "I would like to book an appointment" },
        { label: "Emergency booking", value: "I need an emergency appointment as soon as possible" },
        { label: "Reschedule appointment", value: "I want to reschedule my appointment" },
        { label: "Cancel appointment", value: "I want to cancel my appointment" },
        { label: "Other question", value: "I have another question" },
      ];

  return { sessionId, welcomeMessage, quickReplies };
}
