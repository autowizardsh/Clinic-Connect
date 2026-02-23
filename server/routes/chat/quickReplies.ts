import { storage } from "../../storage";
import { getNowInTimezone } from "../../utils/timezone";

export async function getQuickReplies(
  context: {
    lastToolCall?: string;
    toolResultSuccess?: boolean;
    userMessage: string;
    aiResponse: string;
    language: string;
  },
): Promise<{ label: string; value: string }[]> {
  const { lastToolCall, toolResultSuccess, userMessage, aiResponse, language } = context;
  const nl = language === "nl";

  const settings = await storage.getClinicSettings();
  const doctors = await storage.getDoctors();
  const activeDoctors = doctors.filter(d => d.isActive);
  const services = settings?.services || ["General Checkup", "Teeth Cleaning"];

  if (lastToolCall === "book_appointment" && toolResultSuccess) {
    return nl
      ? [
          { label: "Nieuwe afspraak maken", value: "Ik wil een afspraak maken" },
          { label: "Andere vraag", value: "Ik heb een andere vraag" },
        ]
      : [
          { label: "Book another appointment", value: "I would like to book another appointment" },
          { label: "Other question", value: "I have another question" },
        ];
  }

  if (lastToolCall === "cancel_appointment" && toolResultSuccess) {
    return nl
      ? [
          { label: "Nieuwe afspraak maken", value: "Ik wil een afspraak maken" },
          { label: "Andere vraag", value: "Ik heb een andere vraag" },
        ]
      : [
          { label: "Book another appointment", value: "I would like to book another appointment" },
          { label: "Other question", value: "I have another question" },
        ];
  }

  if (lastToolCall === "reschedule_appointment" && toolResultSuccess) {
    return nl
      ? [
          { label: "Nieuwe afspraak maken", value: "Ik wil een afspraak maken" },
          { label: "Andere vraag", value: "Ik heb een andere vraag" },
        ]
      : [
          { label: "Book another appointment", value: "I would like to book another appointment" },
          { label: "Other question", value: "I have another question" },
        ];
  }

  if (lastToolCall === "check_availability") {
    const timeSlots = extractTimeSlots(aiResponse);
    if (timeSlots.length > 0) {
      return timeSlots.map(t => ({ label: t, value: t }));
    }
    return buildDateButtons(settings, language);
  }

  if (lastToolCall === "lookup_appointment" && toolResultSuccess) {
    const responseLower = aiResponse.toLowerCase();
    const msgLower = userMessage.toLowerCase();
    const isCancelFlow = responseLower.includes("cancel") || responseLower.includes("annul") ||
      msgLower.includes("cancel") || msgLower.includes("annul");
    const isRescheduleFlow = responseLower.includes("reschedule") || responseLower.includes("verzet") ||
      responseLower.includes("verplaats") || msgLower.includes("reschedule") || msgLower.includes("verzet");
    if (isCancelFlow) {
      return nl
        ? [
            { label: "Ja, annuleer", value: "Ja, annuleer mijn afspraak alstublieft" },
            { label: "Nee, toch niet", value: "Nee, ik wil mijn afspraak behouden" },
          ]
        : [
            { label: "Yes, cancel it", value: "Yes, please cancel my appointment" },
            { label: "No, keep it", value: "No, I want to keep my appointment" },
          ];
    }
    if (isRescheduleFlow) {
      return nl
        ? [
            { label: "Ja, verzet het", value: "Ja, verzet mijn afspraak alstublieft" },
            { label: "Nee, andere tijd", value: "Nee, ik wil een andere tijd kiezen" },
          ]
        : [
            { label: "Yes, reschedule it", value: "Yes, please reschedule my appointment" },
            { label: "No, different time", value: "No, I want to pick a different time" },
          ];
    }
  }

  const lower = aiResponse.toLowerCase();

  if (hasAny(lower, ["new patient", "returning patient", "nieuwe pati", "terugkerende pati", "first time", "eerste keer"])) {
    if (hasAny(lower, ["?", "are you a", "bent u een"])) {
      return nl
        ? [
            { label: "Nieuwe patient", value: "Ik ben een nieuwe patient" },
            { label: "Terugkerende patient", value: "Ik ben een terugkerende patient" },
          ]
        : [
            { label: "New patient", value: "I am a new patient" },
            { label: "Returning patient", value: "I am a returning patient" },
          ];
    }
  }

  if (hasAny(lower, ["shall i book", "shall i go ahead", "should i book", "confirm", "sound good", "look correct", "go ahead", "zal ik boeken", "wilt u bevestigen", "klopt dit"])) {
    return nl
      ? [
          { label: "Ja, bevestig", value: "Ja, bevestig mijn afspraak alstublieft" },
          { label: "Nee, wijzig", value: "Nee, ik wil iets wijzigen" },
        ]
      : [
          { label: "Yes, confirm", value: "Yes, please confirm my appointment" },
          { label: "No, change something", value: "No, I want to change something" },
        ];
  }

  const lastQ = getLastQuestion(lower);

  const doctorNameCount = activeDoctors.filter(d => lower.includes(d.name.toLowerCase())).length;
  const isChoosingDoctor = doctorNameCount >= 2 || hasAny(lower, ["which doctor", "which dentist", "welke tandarts"]);
  if (isChoosingDoctor && mentionsAny(lastQ, [
    "which", "prefer", "choose", "who", "recommend",
    "like to see", "want to see", "would you like",
    "welke", "voorkeur",
  ])) {
    return activeDoctors.map(d => ({
      label: `Dr. ${d.name} (${d.specialty})`,
      value: nl ? `Ik wil graag bij Dr. ${d.name}` : `I'd like Dr. ${d.name}`,
    }));
  }

  const mentionsServices = services.filter(s => lower.includes(s.toLowerCase())).length >= 2;
  const isAskingService = mentionsAny(lastQ, [
    "service", "treatment", "what type", "what kind",
    "looking for", "what brings you", "reason for",
    "dienst", "behandeling", "voorkeur", "preference",
  ]) || mentionsServices;
  if (isAskingService) {
    return services.map(s => ({
      label: s,
      value: nl ? `Ik wil graag ${s}` : `I would like ${s}`,
    }));
  }

  if (mentionsAny(lastQ, ["when would", "which day", "which date", "what date", "what day", "preferred date", "preferred day", "come in", "wanneer", "welke dag", "welke datum"])) {
    return buildDateButtons(settings, language);
  }

  if (mentionsAny(lower, ["how can i help", "how may i help", "how can i assist", "how may i assist", "what can i help", "what can i do for you", "waarmee kan ik", "hoe kan ik"])) {
    return nl
      ? [
          { label: "Afspraak maken", value: "Ik wil een afspraak maken" },
          { label: "Afspraak verzetten", value: "Ik wil mijn afspraak verzetten" },
          { label: "Afspraak annuleren", value: "Ik wil mijn afspraak annuleren" },
          { label: "Andere vraag", value: "Ik heb een andere vraag" },
        ]
      : [
          { label: "Book an appointment", value: "I would like to book an appointment" },
          { label: "Reschedule appointment", value: "I want to reschedule my appointment" },
          { label: "Cancel appointment", value: "I want to cancel my appointment" },
          { label: "Other question", value: "I have another question" },
        ];
  }

  return [];
}

function hasAny(text: string, phrases: string[]): boolean {
  return phrases.some(p => text.includes(p));
}

function mentionsAny(text: string, phrases: string[]): boolean {
  return phrases.some(p => text.includes(p));
}

function getLastQuestion(text: string): string {
  const cleaned = text.replace(/\b(dr|mr|mrs|ms|prof)\.\s/gi, "$1_ ");
  const sentences = cleaned.split(/(?<=[.!?])\s+/).filter(s => s.length > 0);
  for (let i = sentences.length - 1; i >= 0; i--) {
    if (sentences[i].includes("?")) return sentences[i];
  }
  return sentences[sentences.length - 1] || text;
}

function buildDateButtons(settings: any, language: string): { label: string; value: string }[] {
  const timezone = settings?.timezone || "Europe/Amsterdam";
  const { dateStr: todayStr } = getNowInTimezone(timezone);
  const options: { label: string; value: string }[] = [];
  const dayNamesEN = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const dayNamesNL = ["Zondag", "Maandag", "Dinsdag", "Woensdag", "Donderdag", "Vrijdag", "Zaterdag"];
  const workingDays = settings?.workingDays || [1, 2, 3, 4, 5, 6];

  const baseDate = new Date(todayStr + "T12:00:00");
  for (let i = 0; i < 14 && options.length < 5; i++) {
    const d = new Date(baseDate);
    d.setDate(d.getDate() + i);
    const dayOfWeek = d.getDay();
    if (!workingDays.includes(dayOfWeek)) continue;
    const dateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    const dayName = language === "nl" ? dayNamesNL[dayOfWeek] : dayNamesEN[dayOfWeek];
    const label =
      i === 0
        ? language === "nl" ? `Vandaag (${dayName})` : `Today (${dayName})`
        : i === 1
        ? language === "nl" ? `Morgen (${dayName})` : `Tomorrow (${dayName})`
        : `${dayName} ${dateStr}`;
    options.push({ label, value: dateStr });
  }
  return options;
}

function extractTimeSlots(aiResponse: string): string[] {
  const timePattern = /\b(\d{1,2}:\d{2})\b/g;
  const slots: string[] = [];
  let match;
  while ((match = timePattern.exec(aiResponse)) !== null) {
    const time = match[1];
    const hour = parseInt(time.split(":")[0], 10);
    if (hour >= 6 && hour <= 22 && !slots.includes(time)) {
      slots.push(time);
    }
  }
  return slots.slice(0, 10);
}
