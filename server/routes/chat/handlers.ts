import type { Express } from "express";
import { randomUUID } from "crypto";
import { storage } from "../../storage";
import { buildSystemPrompt } from "./prompts";
import { runToolLoop, type QuickReply } from "./toolLoop";
import { getNowInTimezone, getTomorrowInTimezone, getDayAfterTomorrowInTimezone } from "../../utils/timezone";
import { processChatMessage } from "./engine";

export function registerChatRoutes(app: Express) {
  app.post("/api/chat/session", async (req, res) => {
    try {
      const { language = "en" } = req.body;
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

      storage.incrementChatSessions().catch(e => console.error("Failed to increment chat sessions:", e));

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

      res.json({ sessionId, welcomeMessage, quickReplies });
    } catch (error) {
      console.error("Error creating chat session:", error);
      res.status(500).json({ error: "Failed to create session" });
    }
  });

  app.post("/api/chat/message", async (req, res) => {
    try {
      const { sessionId, message, language = "en" } = req.body;

      if (!sessionId || !message) {
        return res
          .status(400)
          .json({ error: "Session ID and message required" });
      }

      const existingMessages = await storage.getChatMessages(sessionId);
      const isFirstUserMessage = !existingMessages.some(m => m.role === "user");

      await storage.createChatMessage({
        sessionId,
        role: "user",
        content: message,
      });

      if (isFirstUserMessage) {
        storage.incrementChatInteractions().catch(e => console.error("Failed to increment chat interactions:", e));
      }

      const [settings, doctors, previousMessages] = await Promise.all([
        storage.getClinicSettings(),
        storage.getDoctors(),
        storage.getChatMessages(sessionId),
      ]);

      const activeDoctors = doctors.filter((d) => d.isActive);
      const services = settings?.services || [
        "General Checkup",
        "Teeth Cleaning",
      ];
      const clinicTimezone = settings?.timezone || "Europe/Amsterdam";
      const clinicNow = getNowInTimezone(clinicTimezone);
      const today = clinicNow.dateStr;
      const tomorrow = getTomorrowInTimezone(clinicTimezone);
      const dayAfterTomorrow = getDayAfterTomorrowInTimezone(clinicTimezone);
      const currentDayOfWeek = clinicNow.dayOfWeek;

      const systemPrompt = buildSystemPrompt({
        language,
        clinicName: settings?.clinicName || (language === "nl" ? "de tandartskliniek" : "the dental clinic"),
        services,
        activeDoctors: activeDoctors.map(d => ({ id: d.id, name: d.name, specialty: d.specialty })),
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

      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");

      const currentMessages: any[] = [
        { role: "system", content: systemPrompt },
        ...conversationHistory,
      ];

      const result = await runToolLoop(currentMessages, {
        settings,
        activeDoctors: activeDoctors.map(d => ({
          id: d.id,
          name: d.name,
          specialty: d.specialty,
          isActive: d.isActive,
        })),
        services,
        clinicTimezone,
        today,
        language,
        source: "chat",
      });

      if (result.response) {
        const chunkSize = 3;
        for (let i = 0; i < result.response.length; i += chunkSize) {
          const chunk = result.response.slice(i, i + chunkSize);
          res.write(`data: ${JSON.stringify({ content: chunk })}\n\n`);
          await new Promise(resolve => setTimeout(resolve, 15));
        }

        await storage.createChatMessage({
          sessionId,
          role: "assistant",
          content: result.response,
        });
      }

      if (result.booking) {
        res.write(`data: ${JSON.stringify({ booking: result.booking })}\n\n`);
      }

      if (result.quickReplies.length > 0) {
        res.write(`data: ${JSON.stringify({ quickReplies: result.quickReplies })}\n\n`);
      }

      res.write("data: [DONE]\n\n");
      res.end();
    } catch (error) {
      console.error("Error processing chat message:", error);
      if (!res.headersSent) {
        res.status(500).json({ error: "Failed to process message" });
      }
    }
  });

  app.post("/api/chat/message-simple", async (req, res) => {
    try {
      const { sessionId, message, language = "en" } = req.body;

      if (!sessionId || !message) {
        return res.status(400).json({ error: "Session ID and message required" });
      }

      const existingMsgs = await storage.getChatMessages(sessionId);
      const isFirstUserMsg = !existingMsgs.some(m => m.role === "user");

      if (isFirstUserMsg) {
        storage.incrementChatInteractions().catch(e => console.error("Failed to increment chat interactions:", e));
      }

      const result = await processChatMessage(sessionId, message, language, "whatsapp");

      res.json({
        response: result.response,
        quickReplies: result.quickReplies,
        booking: result.booking,
      });
    } catch (error) {
      console.error("Error processing simple chat message:", error);
      res.status(500).json({ error: "Failed to process message" });
    }
  });
}
