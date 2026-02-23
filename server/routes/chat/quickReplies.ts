import { openai } from "../../services/openai";
import { storage } from "../../storage";
import { getNowInTimezone } from "../../utils/timezone";

const CLASSIFY_PROMPT = `You are a button classifier for a dental clinic chatbot. Analyze the assistant's last response and return JSON with the button type to show.

TYPES:
- "main_menu" — greeting, welcome, or after completing an action and asking what else to help with
- "doctors" — asking which doctor/dentist the patient prefers
- "services" — asking what treatment/service type
- "time_slots" — listing specific available times (e.g. 9:00, 10:30, 14:00)
- "dates" — asking which day/date the patient wants to come in
- "confirm_booking" — asking patient to confirm booking details (yes/no)
- "confirm_cancel" — asking patient to confirm cancellation (yes/no)
- "confirm_reschedule" — asking patient to confirm rescheduling (yes/no)
- "new_returning" — asking if patient is new or returning/existing
- "post_complete" — booking/cancellation/rescheduling just completed successfully
- "none" — asking for free text input (name, phone, email, reference number, date of birth, address) or any open-ended question that needs typed input

Return ONLY: {"type":"<one_of_the_types_above>"}`;

export async function determineQuickReplies(
  message: string,
  aiResponse: string,
  conversationHistory: { role: string; content: string }[],
  language: string,
): Promise<{ label: string; value: string }[]> {
  try {
    const settings = await storage.getClinicSettings();
    const doctors = await storage.getDoctors();
    const activeDoctors = doctors.filter(d => d.isActive);
    const services = settings?.services || ["General Checkup", "Teeth Cleaning"];

    const buttonType = await classifyButtonType(aiResponse);

    switch (buttonType) {
      case "main_menu":
        return mainMenuButtons(language);

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
        return slots.length > 0 ? slots.map(t => ({ label: t, value: t })) : [];
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
    console.error("Quick reply determination failed:", error);
    return [];
  }
}

async function classifyButtonType(aiResponse: string): Promise<string> {
  try {
    const trimmedResponse = aiResponse.slice(-600);

    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: CLASSIFY_PROMPT },
        { role: "user", content: `Assistant response:\n"${trimmedResponse}"` },
      ],
      response_format: { type: "json_object" },
      max_tokens: 30,
      temperature: 0,
    });

    const content = response.choices[0]?.message?.content;
    if (!content) return "none";

    const parsed = JSON.parse(content);
    return parsed.type || "none";
  } catch (error) {
    console.error("Button type classification failed:", error);
    return "none";
  }
}

function mainMenuButtons(language: string): { label: string; value: string }[] {
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
