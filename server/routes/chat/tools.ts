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
      "Book a dental appointment ONLY after collecting ALL required information from the patient. DO NOT call this function until you have explicitly asked for and received: 1) patient's REAL full name (first and last), 2) patient's REAL phone number, 3) preferred service, 4) preferred date and time. NEVER use placeholder values like 'pending' or 'unknown'. If any information is missing, ask for it first instead of calling this function.",
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
          description: "Email address of the patient (REQUIRED)",
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

export const lookupPatientByEmailFunction = {
  type: "function" as const,
  function: {
    name: "lookup_patient_by_email",
    description: "Look up an existing patient by their email address. Call this when a returning patient provides their email to retrieve their stored details (name, phone) so they don't have to re-enter everything. Only call this when the patient says they have visited before.",
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

export const checkAvailabilityFunctionSimple = {
  type: "function" as const,
  function: {
    name: "check_availability",
    description: "Check if a doctor is available on a specific date. ALWAYS call this before telling a patient about availability.",
    parameters: {
      type: "object",
      properties: {
        doctorId: { type: "number", description: "ID of the doctor to check" },
        date: { type: "string", description: "Date in YYYY-MM-DD format" },
      },
      required: ["doctorId", "date"],
    },
  },
};

export const bookingFunctionSimple = {
  type: "function" as const,
  function: {
    name: "book_appointment",
    description: "Book a dental appointment for a patient.",
    parameters: {
      type: "object",
      properties: {
        patientName: { type: "string" },
        patientPhone: { type: "string" },
        patientEmail: { type: "string", description: "Patient's email address (REQUIRED)" },
        service: { type: "string" },
        doctorId: { type: "number" },
        doctorName: { type: "string" },
        date: { type: "string", description: "YYYY-MM-DD format" },
        time: { type: "string", description: "HH:MM format" },
        notes: { type: "string" },
      },
      required: ["patientName", "patientPhone", "patientEmail", "service", "doctorId", "date", "time"],
    },
  },
};
