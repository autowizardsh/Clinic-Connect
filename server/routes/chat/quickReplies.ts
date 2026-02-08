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
  const allUserText = userMessages.join(" ") + " " + lowerMessage;
  const recentUserText = userMessages.slice(-3).join(" ") + " " + lowerMessage;

  const isAskingNewOrReturning = (
    (lowerResponse.includes("first time") || lowerResponse.includes("visited before") ||
    lowerResponse.includes("been here before") || lowerResponse.includes("new patient") ||
    lowerResponse.includes("returning patient") || lowerResponse.includes("visited us before") ||
    lowerResponse.includes("eerste keer") || lowerResponse.includes("eerder geweest") ||
    lowerResponse.includes("nieuwe patient") || lowerResponse.includes("terugkerende patient") ||
    lowerResponse.includes("eerder bij ons"))
  );
  if (isAskingNewOrReturning) {
    return language === "nl"
      ? [
          { label: "Nieuwe patient", value: "Ik ben een nieuwe patient" },
          { label: "Ik ben eerder geweest", value: "Ik ben hier eerder geweest" },
        ]
      : [
          { label: "New patient", value: "I am a new patient" },
          { label: "I've visited before", value: "I have visited before" },
        ];
  }

  const isAskingContactInfo = (
    lowerResponse.includes("your name") || lowerResponse.includes("full name") ||
    lowerResponse.includes("phone number") || lowerResponse.includes("uw naam") ||
    lowerResponse.includes("telefoonnummer") || lowerResponse.includes("your number") ||
    lowerResponse.includes("reference number") || lowerResponse.includes("referentienummer") ||
    lowerResponse.includes("booking reference") || lowerResponse.includes("apt-") ||
    lowerResponse.includes("email address") || lowerResponse.includes("e-mailadres") ||
    lowerResponse.includes("email") || lowerResponse.includes("e-mail")
  );
  if (isAskingContactInfo) {
    return [];
  }

  const isCancelComplete = lowerResponse.includes("has been cancelled") || lowerResponse.includes("is geannuleerd") || lowerResponse.includes("successfully cancelled");
  const isRescheduleComplete = lowerResponse.includes("has been rescheduled") || lowerResponse.includes("is verzet") || lowerResponse.includes("successfully rescheduled");

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

  const isBookingComplete = lowerResponse.includes("has been booked") || lowerResponse.includes("successfully booked") || lowerResponse.includes("appointment is confirmed") || lowerResponse.includes("is geboekt") || lowerResponse.includes("is bevestigd") || lowerResponse.includes("successfully scheduled");

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

  const isAskingCancelConfirm = (
    lowerResponse.includes("cancel this appointment") || lowerResponse.includes("want to cancel") ||
    lowerResponse.includes("confirm the cancellation") || lowerResponse.includes("sure you want to cancel") ||
    lowerResponse.includes("would you like to cancel") || lowerResponse.includes("like me to cancel") ||
    lowerResponse.includes("wilt u annuleren") || lowerResponse.includes("afspraak annuleren")
  );

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

  const isAskingRescheduleConfirm = (
    lowerResponse.includes("reschedule to") || lowerResponse.includes("shall i reschedule") ||
    lowerResponse.includes("confirm the reschedule") || lowerResponse.includes("would you like me to reschedule") ||
    lowerResponse.includes("like to reschedule") ||
    lowerResponse.includes("verzetten naar") || lowerResponse.includes("zal ik verzetten")
  );

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

  const isAskingConfirmation = (
    lowerResponse.includes("shall i book") || lowerResponse.includes("shall i go ahead") ||
    lowerResponse.includes("should i book") || lowerResponse.includes("should i go ahead") ||
    lowerResponse.includes("would you like me to book") || lowerResponse.includes("would you like me to confirm") ||
    lowerResponse.includes("want me to book") || lowerResponse.includes("ready to book") ||
    lowerResponse.includes("zal ik boeken") || lowerResponse.includes("zal ik de afspraak") ||
    lowerResponse.includes("wilt u dat ik boek") || lowerResponse.includes("confirm this")
  );

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

  const isGreeting = (lowerResponse.includes("how can i help") || lowerResponse.includes("hoe kan ik") || lowerResponse.includes("what can i") || lowerResponse.includes("welcome")) && conversationHistory.length <= 2;

  if (isGreeting) {
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

  const inCancelFlow = recentUserText.includes("cancel") || recentUserText.includes("annuleren");
  const inRescheduleFlow = recentUserText.includes("reschedule") || recentUserText.includes("verzetten") || recentUserText.includes("verplaats");
  if (inCancelFlow || inRescheduleFlow) {
    return [];
  }

  const hasBookingIntent = allUserText.includes("book") || allUserText.includes("appointment") || allUserText.includes("afspraak") || allUserText.includes("boek") || allUserText.includes("schedule");

  if (!hasBookingIntent) {
    return [];
  }

  const hasSelectedService = services.some(s => allUserText.includes(s.toLowerCase()));
  const hasSelectedDoctor = activeDoctors.some(d => allUserText.includes(d.name.toLowerCase()));
  const userJustPickedTime = /^\d{1,2}:\d{2}$/.test(lowerMessage.trim());
  const hasSelectedTime = userMessages.some(m => /^\d{1,2}:\d{2}$/.test(m.trim()));

  if (!userJustPickedTime && !hasSelectedTime) {
    const timeSlotMatch = aiResponse.match(/\b(\d{1,2}:\d{2})\b/g);
    if (timeSlotMatch && timeSlotMatch.length >= 2) {
      const uniqueSlots = [...new Set(timeSlotMatch)];
      if (uniqueSlots.length >= 2) {
        return uniqueSlots.slice(0, 6).map(t => ({
          label: t,
          value: t,
        }));
      }
    }
  }

  const isAskingService = (
    lowerResponse.includes("service") || lowerResponse.includes("treatment") ||
    lowerResponse.includes("dienst") || lowerResponse.includes("behandeling") ||
    lowerResponse.includes("which type") || lowerResponse.includes("what type") ||
    lowerResponse.includes("welke soort") || lowerResponse.includes("what kind") ||
    lowerResponse.includes("looking for") || lowerResponse.includes("need help with")
  ) && !hasSelectedService;

  if (isAskingService) {
    return services.map(s => ({
      label: s,
      value: language === "nl" ? `Ik wil graag ${s}` : `I would like ${s}`,
    }));
  }

  const isAskingDoctor = (
    lowerResponse.includes("which dentist") || lowerResponse.includes("which doctor") ||
    lowerResponse.includes("prefer") || lowerResponse.includes("preference") ||
    lowerResponse.includes("welke tandarts") || lowerResponse.includes("voorkeur") ||
    lowerResponse.includes("recommend") || lowerResponse.includes("would you like to see") ||
    lowerResponse.includes("wilt u bij") || lowerResponse.includes("specialist") ||
    (lowerResponse.includes("dr.") && lowerResponse.includes("?"))
  ) && !hasSelectedDoctor;

  if (isAskingDoctor) {
    return activeDoctors.map(d => ({
      label: `Dr. ${d.name} (${d.specialty})`,
      value: language === "nl" ? `Ik wil graag bij Dr. ${d.name}` : `I'd like Dr. ${d.name}`,
    }));
  }

  const isAskingDate = (
    lowerResponse.includes("when would you") || lowerResponse.includes("which day") ||
    lowerResponse.includes("what day") || lowerResponse.includes("which date") ||
    lowerResponse.includes("what date") || lowerResponse.includes("preferred date") ||
    lowerResponse.includes("wanneer wilt") || lowerResponse.includes("welke dag") ||
    lowerResponse.includes("welke datum") || lowerResponse.includes("when do you") ||
    lowerResponse.includes("come in") || lowerResponse.includes("like to visit") ||
    lowerResponse.includes("when are you") || lowerResponse.includes("schedule for")
  );

  if (isAskingDate) {
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

  return [];
}
