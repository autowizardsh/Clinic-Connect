export const checkAvailabilityFunction = {
  type: "function" as const,
  function: {
    name: "check_availability",
    description:
      "Check if a doctor is available on a specific date. ALWAYS call this function before telling a patient about availability or before booking. This returns the actual available time slots.",
    parameters: {
      type: "object",
      properties: {
        doctorId: {
          type: "number",
          description: "ID of the doctor to check",
        },
        date: {
          type: "string",
          description: "Date to check in YYYY-MM-DD format",
        },
      },
      required: ["doctorId", "date"],
    },
  },
};

export const bookingFunction = {
  type: "function" as const,
  function: {
    name: "book_appointment",
    description:
      "Book a dental appointment ONLY after collecting ALL required information from the patient. DO NOT call this function until you have explicitly asked for and received: 1) patient's REAL full name (first and last), 2) patient's REAL phone number, 3) patient's REAL email address, 4) preferred service, 5) preferred date and time. NEVER use placeholder values like 'pending' or 'unknown'. If any information is missing, ask for it first instead of calling this function.",
    parameters: {
      type: "object",
      properties: {
        patientName: {
          type: "string",
          description: "Patient's REAL full name (first and last name) - NEVER use placeholder like 'pending'",
        },
        patientPhone: {
          type: "string",
          description: "Patient's REAL phone number - NEVER use placeholder like 'unknown'",
        },
        patientEmail: {
          type: "string",
          description: "Patient's REAL email address - REQUIRED for confirmation email and calendar invite - NEVER use placeholder",
        },
        service: {
          type: "string",
          description: "The dental service requested",
        },
        doctorId: {
          type: "number",
          description: "ID of the selected doctor",
        },
        doctorName: {
          type: "string",
          description: "Name of the selected doctor",
        },
        date: {
          type: "string",
          description: "Appointment date in YYYY-MM-DD format",
        },
        time: {
          type: "string",
          description: "Appointment time in HH:MM format (24-hour)",
        },
        notes: {
          type: "string",
          description: "Any additional notes from the patient",
        },
      },
      required: [
        "patientName",
        "patientPhone",
        "patientEmail",
        "service",
        "doctorId",
        "date",
        "time",
      ],
    },
  },
};

export const lookupAppointmentFunction = {
  type: "function" as const,
  function: {
    name: "lookup_appointment",
    description: "Look up an existing appointment by its reference number and verify the patient's phone number. Call this FIRST when a patient wants to reschedule or cancel. Returns appointment details if found and phone matches.",
    parameters: {
      type: "object",
      properties: {
        referenceNumber: {
          type: "string",
          description: "The appointment reference number (e.g. APT-AB12)",
        },
        phoneNumber: {
          type: "string",
          description: "The patient's phone number for verification",
        },
      },
      required: ["referenceNumber", "phoneNumber"],
    },
  },
};

export const cancelAppointmentFunction = {
  type: "function" as const,
  function: {
    name: "cancel_appointment",
    description: "Cancel an appointment after it has been verified via lookup_appointment. Only call this AFTER successful lookup and patient confirmation.",
    parameters: {
      type: "object",
      properties: {
        referenceNumber: {
          type: "string",
          description: "The verified appointment reference number",
        },
        phoneNumber: {
          type: "string",
          description: "The patient's phone number for re-verification",
        },
      },
      required: ["referenceNumber", "phoneNumber"],
    },
  },
};

export const rescheduleAppointmentFunction = {
  type: "function" as const,
  function: {
    name: "reschedule_appointment",
    description: "Reschedule an appointment to a new date and time after it has been verified via lookup_appointment. Only call this AFTER successful lookup, availability check, and patient confirmation.",
    parameters: {
      type: "object",
      properties: {
        referenceNumber: {
          type: "string",
          description: "The verified appointment reference number",
        },
        phoneNumber: {
          type: "string",
          description: "The patient's phone number for re-verification",
        },
        newDate: {
          type: "string",
          description: "New appointment date in YYYY-MM-DD format",
        },
        newTime: {
          type: "string",
          description: "New appointment time in HH:MM format (24-hour)",
        },
      },
      required: ["referenceNumber", "phoneNumber", "newDate", "newTime"],
    },
  },
};

export const findEmergencySlotFunction = {
  type: "function" as const,
  function: {
    name: "find_emergency_slot",
    description:
      "Find the nearest available emergency appointment slot for TODAY. Searches across ALL doctors to find the soonest available time. Use this when a patient needs an urgent or emergency appointment.",
    parameters: {
      type: "object",
      properties: {},
      required: [],
    },
  },
};

export const lookupPatientByEmailFunction = {
  type: "function" as const,
  function: {
    name: "lookup_patient_by_email",
    description: "Look up a returning patient by their email address. Use this when the patient says they are a returning patient and provides their email. Returns the patient's name, phone, and email if found.",
    parameters: {
      type: "object",
      properties: {
        email: {
          type: "string",
          description: "The patient's email address to look up",
        },
      },
      required: ["email"],
    },
  },
};

export const suggestQuickRepliesFunction = {
  type: "function" as const,
  function: {
    name: "suggest_quick_replies",
    description: "Call this AFTER composing your text response to suggest clickable quick-reply buttons for the patient. Choose the appropriate type based on what you just asked the patient. Only call this when buttons would be helpful - not for free-text answers like names, phone numbers, or emails.",
    parameters: {
      type: "object",
      properties: {
        type: {
          type: "string",
          enum: ["main_menu", "services", "doctors", "dates", "time_slots", "yes_no", "confirm_cancel", "new_returning", "post_booking", "post_cancel", "custom"],
          description: "Type of quick replies: main_menu (initial options), services (available services), doctors (available dentists), dates (upcoming dates), time_slots (available times from check_availability result), yes_no (simple confirmation), confirm_cancel (cancel confirmation), new_returning (new vs returning patient), post_booking (after booking complete), post_cancel (after cancel/reschedule), custom (provide custom buttons)",
        },
        timeSlots: {
          type: "array",
          items: { type: "string" },
          description: "Only for type=time_slots: list of available time slots like ['09:00', '10:30', '14:00']",
        },
        custom: {
          type: "array",
          items: {
            type: "object",
            properties: {
              label: { type: "string", description: "Button label shown to user" },
              value: { type: "string", description: "Value sent when clicked" },
            },
            required: ["label", "value"],
          },
          description: "Only for type=custom: array of custom button objects",
        },
      },
      required: ["type"],
    },
  },
};

export const allChatTools = [
  checkAvailabilityFunction,
  bookingFunction,
  lookupAppointmentFunction,
  cancelAppointmentFunction,
  rescheduleAppointmentFunction,
  findEmergencySlotFunction,
  lookupPatientByEmailFunction,
  suggestQuickRepliesFunction,
];
