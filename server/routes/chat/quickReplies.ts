import { storage } from "../../storage";
import { getNowInTimezone } from "../../utils/timezone";

const BTN_PATTERN = /\n?\[BTN:([a-z_]+)\]\s*$/;

export function parseButtonHint(fullResponse: string): { cleanResponse: string; buttonType: string } {
  const match = fullResponse.match(BTN_PATTERN);
  if (match) {
    return {
      cleanResponse: fullResponse.replace(BTN_PATTERN, "").trim(),
      buttonType: match[1],
    };
  }
  const fallbackType = classifyByPattern(fullResponse);
  return { cleanResponse: fullResponse, buttonType: fallbackType };
}

function classifyByPattern(response: string): string {
  const lower = response.toLowerCase();
  const lastQuestion = extractLastQuestion(response).toLowerCase();

  const has = (phrases: string[]) => phrases.some(p => lower.includes(p));
  const lastQHas = (phrases: string[]) => phrases.some(p => lastQuestion.includes(p));

  const isBookingComplete = has([
    "has been booked", "successfully booked", "appointment is confirmed",
    "is booked", "appointment confirmed", "booking confirmed",
    "successfully scheduled", "has been scheduled",
    "is geboekt", "is bevestigd", "succesvol geboekt", "afspraak bevestigd",
  ]) && has(["reference", "apt-", "referentie"]);
  if (isBookingComplete) return "post_complete";

  const isCancelComplete = has([
    "has been cancelled", "successfully cancelled", "appointment cancelled",
    "been canceled", "successfully canceled",
    "is geannuleerd", "succesvol geannuleerd",
  ]);
  if (isCancelComplete) return "post_complete";

  const isRescheduleComplete = has([
    "has been rescheduled", "successfully rescheduled",
    "is verzet", "succesvol verzet", "is verplaatst",
  ]);
  if (isRescheduleComplete) return "post_complete";

  const isAskingNewOrReturning =
    (has(["new patient", "nieuwe pati"]) && has(["returning", "existing", "terugkerende", "bestaande"])) ||
    (has(["first time", "eerste keer"]) && has(["been here before", "visited", "eerder geweest"]));
  if (isAskingNewOrReturning) return "new_returning";

  const isAskingContactInfo = lastQHas([
    "your name", "full name", "first and last name",
    "phone number", "your number", "contact number", "mobile",
    "reference number", "referentienummer", "booking reference",
    "email address", "your email", "e-mail",
    "uw naam", "telefoonnummer", "uw e-mail",
  ]);
  if (isAskingContactInfo) return "none";

  const isConfirmCancel = has([
    "cancel this appointment", "want to cancel", "confirm the cancellation",
    "sure you want to cancel", "shall i cancel", "should i cancel",
    "want me to cancel", "proceed with cancellation",
    "wilt u annuleren", "zal ik annuleren",
  ]);
  if (isConfirmCancel) return "confirm_cancel";

  const isConfirmReschedule = has([
    "reschedule to", "shall i reschedule", "confirm the reschedule",
    "should i reschedule", "want me to reschedule", "move your appointment",
    "move it to", "change it to",
    "verzetten naar", "zal ik verzetten",
  ]);
  if (isConfirmReschedule) return "confirm_reschedule";

  const isConfirmBooking = has([
    "shall i book", "shall i go ahead", "should i book",
    "would you like me to book", "would you like me to confirm",
    "want me to book", "ready to book", "shall i proceed",
    "confirm this", "confirm the booking", "confirm the appointment",
    "go ahead and book", "proceed with booking",
    "everything look correct", "look good", "sound good",
    "zal ik boeken", "wilt u bevestigen", "klopt dit",
  ]);
  if (isConfirmBooking) return "confirm_booking";

  const timeSlots = extractTimeSlots(response);
  if (timeSlots.length > 0) return "time_slots";

  const mentionsDoctors = has(["dr. ", "doctor", "dentist", "tandarts"]);
  const isAskingDoctor = mentionsDoctors && lastQHas([
    "which doctor", "which dentist", "which one",
    "prefer a doctor", "prefer a dentist",
    "choose a doctor", "choose a dentist",
    "have a preference", "do you have a preference",
    "doctor preference", "dentist preference",
    "like to see", "want to see",
    "particular doctor", "specific doctor",
    "recommend one", "choose one for you",
    "who would you", "select a doctor",
    "welke tandarts", "voorkeur",
  ]);
  if (isAskingDoctor) return "doctors";

  const isAskingService = lastQHas([
    "which service", "what service", "type of service", "what treatment",
    "which treatment", "type of treatment", "type of appointment",
    "what kind of", "what type of", "looking for", "what brings you",
    "reason for your visit", "what do you need",
    "welke dienst", "welke behandeling", "wat voor",
  ]);
  if (isAskingService) return "services";

  const isAskingDate = lastQHas([
    "when would you", "which day", "what day", "which date", "what date",
    "preferred date", "when do you", "come in", "like to visit",
    "when are you", "schedule for", "when works",
    "like to come", "want to come", "preferred day",
    "your preferred", "date you", "day would",
    "wanneer wilt", "welke dag", "welke datum",
  ]);
  if (isAskingDate) return "dates";

  const isGreeting = has([
    "how can i help", "how may i help", "what can i help",
    "how can i assist", "what would you like",
    "hoe kan ik", "waarmee kan ik",
    "welcome", "welkom",
  ]);
  if (isGreeting) return "main_menu";

  return "none";
}

function extractLastQuestion(response: string): string {
  const sentences = response
    .split(/(?<=[.!?])\s+/)
    .map(s => s.trim())
    .filter(s => s.length > 0);

  for (let i = sentences.length - 1; i >= 0; i--) {
    if (sentences[i].includes("?")) return sentences[i];
  }

  return sentences.length > 0 ? sentences[sentences.length - 1] : response;
}

export async function buildQuickReplies(
  buttonType: string,
  language: string,
  aiResponse: string,
): Promise<{ label: string; value: string }[]> {
  try {
    const settings = await storage.getClinicSettings();
    const doctors = await storage.getDoctors();
    const activeDoctors = doctors.filter(d => d.isActive);
    const services = settings?.services || ["General Checkup", "Teeth Cleaning"];

    switch (buttonType) {
      case "main_menu":
        return language === "nl"
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

      case "doctors":
        return activeDoctors.map(d => ({
          label: `Dr. ${d.name} (${d.specialty})`,
          value: language === "nl" ? `Ik wil graag bij Dr. ${d.name}` : `I'd like Dr. ${d.name}`,
        }));

      case "services":
        return services.map(s => ({
          label: s,
          value: language === "nl" ? `Ik wil graag ${s}` : `I would like ${s}`,
        }));

      case "time_slots": {
        const slots = extractTimeSlots(aiResponse);
        return slots.map(t => ({ label: t, value: t }));
      }

      case "dates":
        return buildDateButtons(settings, language);

      case "confirm_booking":
        return language === "nl"
          ? [
              { label: "Ja, bevestig", value: "Ja, bevestig mijn afspraak alstublieft" },
              { label: "Nee, wijzig", value: "Nee, ik wil iets wijzigen" },
            ]
          : [
              { label: "Yes, confirm", value: "Yes, please confirm my appointment" },
              { label: "No, change something", value: "No, I want to change something" },
            ];

      case "confirm_cancel":
        return language === "nl"
          ? [
              { label: "Ja, annuleer", value: "Ja, annuleer mijn afspraak alstublieft" },
              { label: "Nee, toch niet", value: "Nee, ik wil mijn afspraak behouden" },
            ]
          : [
              { label: "Yes, cancel it", value: "Yes, please cancel my appointment" },
              { label: "No, keep it", value: "No, I want to keep my appointment" },
            ];

      case "confirm_reschedule":
        return language === "nl"
          ? [
              { label: "Ja, verzet het", value: "Ja, verzet mijn afspraak alstublieft" },
              { label: "Nee, andere tijd", value: "Nee, ik wil een andere tijd kiezen" },
            ]
          : [
              { label: "Yes, reschedule it", value: "Yes, please reschedule my appointment" },
              { label: "No, different time", value: "No, I want to pick a different time" },
            ];

      case "new_returning":
        return language === "nl"
          ? [
              { label: "Nieuwe patient", value: "Ik ben een nieuwe patient" },
              { label: "Terugkerende patient", value: "Ik ben een terugkerende patient" },
            ]
          : [
              { label: "New patient", value: "I am a new patient" },
              { label: "Returning patient", value: "I am a returning patient" },
            ];

      case "post_complete":
        return language === "nl"
          ? [
              { label: "Nieuwe afspraak maken", value: "Ik wil een afspraak maken" },
              { label: "Andere vraag", value: "Ik heb een andere vraag" },
            ]
          : [
              { label: "Book another appointment", value: "I would like to book another appointment" },
              { label: "Other question", value: "I have another question" },
            ];

      case "none":
      default:
        return [];
    }
  } catch (error) {
    console.error("Error building quick replies:", error);
    return [];
  }
}

function buildDateButtons(
  settings: any,
  language: string,
): { label: string; value: string }[] {
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
  const timeSlots: string[] = [];
  const timePattern = /\b(\d{1,2}:\d{2})\b/g;

  const lowerFull = aiResponse.toLowerCase();
  const hasTimeContext =
    lowerFull.includes("available") ||
    lowerFull.includes("slot") ||
    lowerFull.includes("time") ||
    lowerFull.includes("schedule") ||
    lowerFull.includes("beschikbaar") ||
    lowerFull.includes("tijdslot") ||
    lowerFull.includes("choose") ||
    lowerFull.includes("select") ||
    lowerFull.includes("pick") ||
    lowerFull.includes("kies") ||
    lowerFull.includes("here are");

  if (!hasTimeContext) return [];

  let match;
  while ((match = timePattern.exec(aiResponse)) !== null) {
    const time = match[1];
    const hour = parseInt(time.split(":")[0], 10);
    if (hour >= 6 && hour <= 22 && !timeSlots.includes(time)) {
      timeSlots.push(time);
    }
  }

  return timeSlots.slice(0, 10);
}
