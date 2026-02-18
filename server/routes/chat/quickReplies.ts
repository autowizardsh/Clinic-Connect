import { storage } from "../../storage";

export async function determineQuickReplies(
  message: string,
  aiResponse: string,
  conversationHistory: { role: string; content: string }[],
  language: string,
): Promise<{ label: string; value: string }[]> {
  const lowerResponse = aiResponse.toLowerCase();
  const lowerMessage = message.toLowerCase();

  const settings = await storage.getClinicSettings();
  const doctors = await storage.getDoctors();
  const activeDoctors = doctors.filter((d) => d.isActive);
  const services = settings?.services || ["General Checkup", "Teeth Cleaning"];

  const userMessages = conversationHistory
    .filter(m => m.role === "user")
    .map(m => m.content.toLowerCase());
  const recentUserText = userMessages.slice(-3).join(" ") + " " + lowerMessage;

  const containsAny = (text: string, phrases: string[]): boolean =>
    phrases.some(p => text.includes(p));

  const lastQuestion = extractLastQuestion(aiResponse);
  const lowerLastQ = lastQuestion.toLowerCase();

  const isAskingNewOrReturning = (
    (containsAny(lowerResponse, ["new patient", "nieuwe pati"]) &&
     containsAny(lowerResponse, ["returning patient", "existing patient", "terugkerende pati", "bestaande pati"])) ||
    (containsAny(lowerResponse, ["first time", "eerste keer"]) &&
     containsAny(lowerResponse, ["been here before", "visited us before", "been before", "eerder geweest", "al eerder"])) ||
    (containsAny(lowerResponse, ["new", "nieuw"]) &&
     containsAny(lowerResponse, ["returning", "terugkerend"]) &&
     containsAny(lowerResponse, ["patient", "patiënt"])) ||
    (containsAny(lowerResponse, ["first visit", "eerste bezoek"]) &&
     lowerResponse.includes("?")) ||
    (containsAny(lowerResponse, ["visited us", "been with us", "registered", "have an account", "on file", "in our system", "bij ons geregistreerd", "in ons systeem"]) &&
     lowerResponse.includes("?"))
  );

  if (isAskingNewOrReturning) {
    return language === "nl"
      ? [
          { label: "Nieuwe patient", value: "Ik ben een nieuwe patient" },
          { label: "Terugkerende patient", value: "Ik ben een terugkerende patient" },
        ]
      : [
          { label: "New patient", value: "I am a new patient" },
          { label: "Returning patient", value: "I am a returning patient" },
        ];
  }

  const isAskingWalkinOrRegular = (
    (containsAny(lowerResponse, ["walk-in", "walk in", "inloopafspraak", "inloop"]) &&
     containsAny(lowerResponse, ["regular", "specific", "scheduled", "reguliere", "specifieke", "ingeplande"])) ||
    (containsAny(lowerResponse, ["walk-in", "walk in"]) &&
     containsAny(lowerResponse, ["appointment", "visit", "booking"]) &&
     lowerResponse.includes("?"))
  );

  if (isAskingWalkinOrRegular) {
    return language === "nl"
      ? [
          { label: "Reguliere afspraak", value: "Ik wil een reguliere afspraak met een specifieke arts" },
          { label: "Inloopbezoek", value: "Ik wil graag een inloopbezoek (walk-in)" },
        ]
      : [
          { label: "Regular appointment", value: "I would like a regular appointment with a specific doctor" },
          { label: "Walk-in visit", value: "I would like a walk-in visit" },
        ];
  }

  const isAskingContactInfo = containsAny(lowerLastQ, [
    "your name", "full name", "your full name", "first and last name",
    "phone number", "your number", "contact number", "mobile number", "telephone",
    "reference number", "referentienummer", "booking reference", "apt-",
    "email address", "e-mail address", "your email", "e-mailadres",
    "uw naam", "uw volledige naam", "telefoonnummer", "uw e-mail",
  ]);
  if (isAskingContactInfo) {
    return [];
  }

  const isCancelComplete = containsAny(lowerResponse, [
    "has been cancelled", "successfully cancelled", "appointment cancelled",
    "is cancelled", "been canceled", "successfully canceled",
    "is geannuleerd", "succesvol geannuleerd", "afspraak geannuleerd",
  ]);
  const isRescheduleComplete = containsAny(lowerResponse, [
    "has been rescheduled", "successfully rescheduled", "appointment rescheduled",
    "is rescheduled", "been rescheduled",
    "is verzet", "succesvol verzet", "afspraak verzet", "is verplaatst",
  ]);

  if (isCancelComplete || isRescheduleComplete) {
    return language === "nl"
      ? [
          { label: "Nieuwe afspraak maken", value: "Ik wil een afspraak maken" },
          { label: "Andere vraag", value: "Ik heb een andere vraag" },
        ]
      : [
          { label: "Book a new appointment", value: "I would like to book an appointment" },
          { label: "Other question", value: "I have another question" },
        ];
  }

  const isBookingComplete = containsAny(lowerResponse, [
    "has been booked", "successfully booked", "appointment is confirmed",
    "is booked", "appointment confirmed", "booking confirmed", "booking is confirmed",
    "successfully scheduled", "has been scheduled", "appointment scheduled",
    "is geboekt", "is bevestigd", "succesvol geboekt", "afspraak bevestigd",
    "has been registered", "successfully registered", "is registered",
    "walk-in appointment registered", "walk-in afspraak is geregistreerd",
    "is geregistreerd",
  ]) && containsAny(lowerResponse, [
    "booked", "confirmed", "scheduled", "geboekt", "bevestigd", "reference", "apt-",
    "registered", "geregistreerd",
  ]);

  if (isBookingComplete) {
    return language === "nl"
      ? [
          { label: "Nieuwe afspraak maken", value: "Ik wil nog een afspraak maken" },
          { label: "Andere vraag", value: "Ik heb een andere vraag" },
        ]
      : [
          { label: "Book another appointment", value: "I would like to book another appointment" },
          { label: "Other question", value: "I have another question" },
        ];
  }

  const isAskingCancelConfirm = containsAny(lowerResponse, [
    "cancel this appointment", "want to cancel", "confirm the cancellation",
    "sure you want to cancel", "would you like to cancel", "like me to cancel",
    "shall i cancel", "should i cancel", "proceed with cancellation",
    "go ahead and cancel", "want me to cancel", "confirm cancel",
    "wilt u annuleren", "afspraak annuleren", "zal ik annuleren",
    "wilt u dat ik annuleer", "doorgaan met annuleren",
  ]);

  if (isAskingCancelConfirm) {
    return language === "nl"
      ? [
          { label: "Ja, annuleer", value: "Ja, annuleer mijn afspraak alstublieft" },
          { label: "Nee, toch niet", value: "Nee, ik wil mijn afspraak behouden" },
        ]
      : [
          { label: "Yes, cancel it", value: "Yes, please cancel my appointment" },
          { label: "No, keep it", value: "No, I want to keep my appointment" },
        ];
  }

  const isAskingRescheduleConfirm = containsAny(lowerResponse, [
    "reschedule to", "shall i reschedule", "confirm the reschedule",
    "would you like me to reschedule", "like to reschedule",
    "should i reschedule", "want me to reschedule", "go ahead and reschedule",
    "proceed with reschedul", "confirm reschedul", "move your appointment",
    "move it to", "change it to",
    "verzetten naar", "zal ik verzetten", "wilt u verzetten",
    "zal ik verplaatsen", "wilt u verplaatsen", "doorgaan met verzetten",
  ]);

  if (isAskingRescheduleConfirm) {
    return language === "nl"
      ? [
          { label: "Ja, verzet het", value: "Ja, verzet mijn afspraak alstublieft" },
          { label: "Nee, toch niet", value: "Nee, ik wil een andere tijd kiezen" },
        ]
      : [
          { label: "Yes, reschedule it", value: "Yes, please reschedule my appointment" },
          { label: "No, different time", value: "No, I want to pick a different time" },
        ];
  }

  const isAskingConfirmation = containsAny(lowerResponse, [
    "shall i book", "shall i go ahead", "should i book", "should i go ahead",
    "would you like me to book", "would you like me to confirm",
    "want me to book", "ready to book", "shall i proceed", "should i proceed",
    "would you like to confirm", "like me to go ahead", "like me to proceed",
    "confirm this", "confirm the booking", "confirm the appointment",
    "go ahead and book", "proceed with booking", "proceed with the booking",
    "everything look correct", "everything correct", "look good",
    "does that look right", "is that correct", "sound good", "sounds good",
    "zal ik boeken", "zal ik de afspraak", "wilt u dat ik boek",
    "wilt u bevestigen", "zal ik doorgaan", "klopt dit", "klopt alles",
  ]);

  if (isAskingConfirmation) {
    return language === "nl"
      ? [
          { label: "Ja, bevestig", value: "Ja, bevestig mijn afspraak alstublieft" },
          { label: "Nee, wijzig", value: "Nee, ik wil iets wijzigen" },
        ]
      : [
          { label: "Yes, confirm", value: "Yes, please confirm my appointment" },
          { label: "No, change something", value: "No, I want to change something" },
        ];
  }

  const isGreeting = containsAny(lowerResponse, [
    "how can i help", "how may i help", "what can i help", "what can i do for you",
    "how can i assist", "how may i assist", "what would you like",
    "hoe kan ik", "waarmee kan ik", "wat kan ik voor u",
    "welcome", "welkom",
  ]) && conversationHistory.length <= 2;

  if (isGreeting) {
    return language === "nl"
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
  }

  const inCancelFlow = containsAny(recentUserText, ["cancel", "annuleren"]);
  const inRescheduleFlow = containsAny(recentUserText, ["reschedule", "verzetten", "verplaats"]);
  if (inCancelFlow || inRescheduleFlow) {
    return [];
  }

  const isShowingWalkinPeriods = containsAny(lowerResponse, ["walk-in", "walk in", "inloop"]) &&
    containsAny(lowerResponse, ["morning", "afternoon", "evening", "ochtend", "middag", "avond"]) &&
    (lowerResponse.includes("?") || containsAny(lowerResponse, ["prefer", "choose", "select", "which", "kies", "welke", "voorkeur"]));

  if (isShowingWalkinPeriods) {
    const periods: { label: string; value: string }[] = [];
    if (containsAny(lowerResponse, ["morning", "ochtend"])) {
      periods.push(language === "nl"
        ? { label: "Ochtend", value: "Ik kies voor de ochtend" }
        : { label: "Morning", value: "I prefer the morning" });
    }
    if (containsAny(lowerResponse, ["afternoon", "middag"])) {
      periods.push(language === "nl"
        ? { label: "Middag", value: "Ik kies voor de middag" }
        : { label: "Afternoon", value: "I prefer the afternoon" });
    }
    if (containsAny(lowerResponse, ["evening", "avond"])) {
      periods.push(language === "nl"
        ? { label: "Avond", value: "Ik kies voor de avond" }
        : { label: "Evening", value: "I prefer the evening" });
    }
    if (periods.length > 0) return periods;
  }

  const timeSlots = extractTimeSlotsFromResponse(aiResponse);
  if (timeSlots.length > 0) {
    return timeSlots.map(t => ({ label: t, value: t }));
  }

  const intent = classifyLastQuestionIntent(lowerLastQ, lowerResponse, language);

  if (intent === "date") {
    return buildDateButtons(settings, language);
  }

  if (intent === "doctor") {
    const mentionedDoctors = extractMentionedDoctors(aiResponse, activeDoctors);
    const doctorsToShow = mentionedDoctors.length > 0 ? mentionedDoctors : activeDoctors.map(d => ({ name: d.name, specialty: d.specialty }));
    return doctorsToShow.map(d => ({
      label: `Dr. ${d.name} (${d.specialty})`,
      value: language === "nl" ? `Ik wil graag bij Dr. ${d.name}` : `I'd like Dr. ${d.name}`,
    }));
  }

  if (intent === "service") {
    return services.map(s => ({
      label: s,
      value: language === "nl" ? `Ik wil graag ${s}` : `I would like ${s}`,
    }));
  }

  return [];
}

function extractLastQuestion(aiResponse: string): string {
  const sentences = aiResponse
    .split(/(?<=[.!?])\s+/)
    .map(s => s.trim())
    .filter(s => s.length > 0);

  for (let i = sentences.length - 1; i >= 0; i--) {
    if (sentences[i].includes("?")) {
      return sentences[i];
    }
  }

  if (sentences.length > 0) {
    return sentences[sentences.length - 1];
  }
  return aiResponse;
}

function classifyLastQuestionIntent(
  lowerLastQ: string,
  lowerFullResponse: string,
  language: string,
): "date" | "doctor" | "service" | "none" {
  const dateKeywords = [
    "when would you", "which day", "what day", "which date", "what date",
    "preferred date", "when do you", "come in", "like to visit",
    "when are you", "schedule for", "when works", "when suits",
    "like to come", "want to come", "when can you",
    "schedule your", "like to schedule", "appointment for",
    "wanneer wilt", "welke dag", "welke datum", "wanneer komt",
    "wanneer past", "wanneer schikt",
  ];

  const doctorKeywords = [
    "which dentist", "which doctor", "prefer a doctor", "preference for a doctor",
    "doctor preference", "dentist preference", "choose a doctor", "choose a dentist",
    "select a doctor", "select a dentist", "particular doctor", "specific doctor",
    "would you like to see", "any preference", "who would you",
    "welke tandarts", "voorkeur voor een", "een arts kiezen",
  ];

  const serviceKeywords = [
    "which service", "what service", "type of service", "what treatment",
    "which treatment", "type of treatment", "type of appointment",
    "what kind of", "what type of", "looking for", "what brings you",
    "reason for your visit", "what do you need",
    "welke dienst", "welke behandeling", "welke soort", "wat voor",
  ];

  const isDate = dateKeywords.some(k => lowerLastQ.includes(k));
  const isDoctor = doctorKeywords.some(k => lowerLastQ.includes(k));
  const isService = serviceKeywords.some(k => lowerLastQ.includes(k));

  if (isDate && !isDoctor && !isService) return "date";
  if (isDoctor && !isDate) return "doctor";
  if (isService && !isDate && !isDoctor) return "service";

  if (isDate) return "date";

  const dateInFull = dateKeywords.some(k => lowerFullResponse.includes(k));
  const doctorInFull = doctorKeywords.some(k => lowerFullResponse.includes(k));
  const serviceInFull = serviceKeywords.some(k => lowerFullResponse.includes(k));

  if (dateInFull && !doctorInFull && !serviceInFull) return "date";
  if (doctorInFull && !dateInFull) return "doctor";
  if (serviceInFull && !dateInFull && !doctorInFull) return "service";

  return "none";
}

function buildDateButtons(
  settings: any,
  language: string,
): { label: string; value: string }[] {
  const now = new Date();
  const options: { label: string; value: string }[] = [];
  const dayNamesEN = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const dayNamesNL = ["Zondag", "Maandag", "Dinsdag", "Woensdag", "Donderdag", "Vrijdag", "Zaterdag"];
  const workingDays = settings?.workingDays || [1, 2, 3, 4, 5, 6];

  for (let i = 0; i < 14 && options.length < 5; i++) {
    const d = new Date(now);
    d.setDate(d.getDate() + i);
    if (!workingDays.includes(d.getDay())) continue;
    const dateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const dayName = language === "nl" ? dayNamesNL[d.getDay()] : dayNamesEN[d.getDay()];
    const label = i === 0
      ? (language === "nl" ? `Vandaag (${dayName})` : `Today (${dayName})`)
      : i === 1
      ? (language === "nl" ? `Morgen (${dayName})` : `Tomorrow (${dayName})`)
      : `${dayName} ${dateStr}`;
    options.push({ label, value: dateStr });
  }
  return options;
}

function extractTimeSlotsFromResponse(aiResponse: string): string[] {
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
    const hour = parseInt(time.split(':')[0], 10);
    if (hour >= 6 && hour <= 22 && !timeSlots.includes(time)) {
      timeSlots.push(time);
    }
  }

  return timeSlots.slice(0, 10);
}

function extractMentionedDoctors(
  aiResponse: string,
  activeDoctors: { id: number; name: string; specialty: string; isActive: boolean }[],
): { name: string; specialty: string }[] {
  const lowerResponse = aiResponse.toLowerCase();
  const mentioned: { name: string; specialty: string }[] = [];

  for (const doctor of activeDoctors) {
    const nameLower = doctor.name.toLowerCase();
    const nameParts = nameLower.split(/\s+/);
    const lastName = nameParts[nameParts.length - 1];

    if (
      lowerResponse.includes(nameLower) ||
      lowerResponse.includes(`dr. ${nameLower}`) ||
      lowerResponse.includes(`dr.${nameLower}`) ||
      lowerResponse.includes(`dr ${nameLower}`) ||
      (lastName.length > 3 && lowerResponse.includes(lastName))
    ) {
      mentioned.push({ name: doctor.name, specialty: doctor.specialty });
    }
  }

  return mentioned;
}
