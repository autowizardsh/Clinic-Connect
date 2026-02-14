import type { Express } from "express";
import crypto from "crypto";
import { storage } from "../../storage";
import { processChatMessage, createChatSession } from "../chat/engine";
import {
  sendTextMessage,
  markMessageAsRead,
  formatQuickRepliesForWhatsApp,
} from "./service";

function verifyWebhookSignature(
  rawBody: Buffer | string,
  signature: string | undefined,
): boolean {
  const appSecret = process.env.WHATSAPP_APP_SECRET;
  if (!appSecret) {
    return true;
  }
  if (!signature) {
    return false;
  }
  const expectedSig =
    "sha256=" +
    crypto
      .createHmac("sha256", appSecret)
      .update(rawBody)
      .digest("hex");
  return crypto.timingSafeEqual(
    Buffer.from(signature),
    Buffer.from(expectedSig),
  );
}

const whatsappSessions: Map<
  string,
  { sessionId: string; language: string; lastActivity: number }
> = new Map();

const SESSION_TIMEOUT_MS = 24 * 60 * 60 * 1000;

const pendingQuickReplies: Map<
  string,
  { label: string; value: string }[]
> = new Map();

function cleanupSessions() {
  const now = Date.now();
  const phones = Array.from(whatsappSessions.keys());
  for (const phone of phones) {
    const session = whatsappSessions.get(phone);
    if (session && now - session.lastActivity > SESSION_TIMEOUT_MS) {
      whatsappSessions.delete(phone);
      pendingQuickReplies.delete(phone);
    }
  }
}

setInterval(cleanupSessions, 5 * 60 * 1000);

async function getOrCreateSession(
  phone: string,
  language: string = "en",
): Promise<{ sessionId: string; isNew: boolean }> {
  const existing = whatsappSessions.get(phone);
  if (existing && Date.now() - existing.lastActivity < SESSION_TIMEOUT_MS) {
    existing.lastActivity = Date.now();
    return { sessionId: existing.sessionId, isNew: false };
  }

  const session = await createChatSession(language);
  whatsappSessions.set(phone, {
    sessionId: session.sessionId,
    language,
    lastActivity: Date.now(),
  });
  return { sessionId: session.sessionId, isNew: true };
}

function extractMessageText(messageObj: any): string | null {
  if (messageObj.type === "text" && messageObj.text?.body) {
    return messageObj.text.body;
  }

  if (messageObj.type === "interactive") {
    if (messageObj.interactive?.type === "button_reply") {
      const buttonId = messageObj.interactive.button_reply?.id || "";
      const phone = messageObj.from;
      const replies = pendingQuickReplies.get(phone);
      if (replies) {
        const idx = parseInt(buttonId.split("_")[1], 10);
        if (!isNaN(idx) && replies[idx]) {
          return replies[idx].value;
        }
      }
      return messageObj.interactive.button_reply?.title || null;
    }

    if (messageObj.interactive?.type === "list_reply") {
      const listId = messageObj.interactive.list_reply?.id || "";
      const phone = messageObj.from;
      const replies = pendingQuickReplies.get(phone);
      if (replies) {
        const idx = parseInt(listId.split("_")[1], 10);
        if (!isNaN(idx) && replies[idx]) {
          return replies[idx].value;
        }
      }
      return messageObj.interactive.list_reply?.title || null;
    }
  }

  return null;
}

function detectLanguage(text: string): string {
  const dutchWords = [
    "hallo",
    "goedemorgen",
    "goedemiddag",
    "afspraak",
    "tandarts",
    "boeken",
    "annuleren",
    "verzetten",
    "alstublieft",
    "dank",
    "ja",
    "nee",
    "ik",
    "wil",
    "graag",
    "maken",
    "welke",
    "wanneer",
  ];
  const lower = text.toLowerCase();
  const matchCount = dutchWords.filter((w) => lower.includes(w)).length;
  return matchCount >= 2 ? "nl" : "en";
}

async function handleIncomingMessage(from: string, messageObj: any) {
  const messageText = extractMessageText(messageObj);
  if (!messageText) {
    console.log("Unsupported WhatsApp message type:", messageObj.type);
    return;
  }

  console.log(`WhatsApp message from ${from}: ${messageText}`);

  const session = whatsappSessions.get(from);
  let language = session?.language || detectLanguage(messageText);

  if (
    messageText.toLowerCase() === "dutch" ||
    messageText.toLowerCase() === "nederlands"
  ) {
    language = "nl";
    if (session) session.language = language;
  } else if (
    messageText.toLowerCase() === "english" ||
    messageText.toLowerCase() === "engels"
  ) {
    language = "en";
    if (session) session.language = language;
  }

  const { sessionId, isNew } = await getOrCreateSession(from, language);

  if (isNew) {
    const settings = await storage.getClinicSettings();
    const clinicName = settings?.clinicName || "our dental clinic";
    const welcome =
      language === "nl"
        ? `Welkom bij ${clinicName}! Ik ben uw AI-assistent via WhatsApp. Hoe kan ik u helpen?`
        : `Welcome to ${clinicName}! I'm your AI assistant on WhatsApp. How can I help you?`;

    try {
      await sendTextMessage(from, welcome);
    } catch (e) {
      console.error("Failed to send welcome message:", e);
    }

    if (
      messageText.toLowerCase() === "hi" ||
      messageText.toLowerCase() === "hello" ||
      messageText.toLowerCase() === "hallo" ||
      messageText.toLowerCase() === "start"
    ) {
      return;
    }
  }

  try {
    const result = await processChatMessage(
      sessionId,
      messageText,
      language,
      "whatsapp",
    );

    if (result.quickReplies.length > 0) {
      pendingQuickReplies.set(from, result.quickReplies);
    } else {
      pendingQuickReplies.delete(from);
    }

    const settings = await storage.getClinicSettings();
    const clinicName = settings?.clinicName;

    const formatted = formatQuickRepliesForWhatsApp(
      from,
      result.response,
      result.quickReplies,
      clinicName || undefined,
    );

    await formatted.send();
  } catch (error) {
    console.error("Error processing WhatsApp message:", error);
    const errorMsg =
      language === "nl"
        ? "Sorry, er is een fout opgetreden. Probeer het opnieuw."
        : "Sorry, something went wrong. Please try again.";
    try {
      await sendTextMessage(from, errorMsg);
    } catch (e) {
      console.error("Failed to send error message:", e);
    }
  }
}

export function registerWhatsAppRoutes(app: Express) {
  app.get("/api/whatsapp/webhook", (req, res) => {
    const mode = req.query["hub.mode"];
    const token = req.query["hub.verify_token"];
    const challenge = req.query["hub.challenge"];

    const verifyToken = process.env.WHATSAPP_VERIFY_TOKEN;
    if (!verifyToken) {
      console.warn("WHATSAPP_VERIFY_TOKEN not configured");
      return res.sendStatus(403);
    }

    if (mode === "subscribe" && token === verifyToken) {
      console.log("WhatsApp webhook verified successfully");
      return res.status(200).send(challenge);
    }

    console.warn("WhatsApp webhook verification failed");
    return res.sendStatus(403);
  });

  app.post("/api/whatsapp/webhook", async (req, res) => {
    console.log("=== WhatsApp Webhook POST received ===");
    console.log("Headers:", JSON.stringify({
      "x-hub-signature-256": req.headers["x-hub-signature-256"] ? "present" : "missing",
      "content-type": req.headers["content-type"],
    }));
    console.log("Body object type:", req.body?.object);
    console.log("Body entries count:", req.body?.entry?.length || 0);
    try {
      const signature = req.headers["x-hub-signature-256"] as string | undefined;
      const rawBody = (req as any).rawBody;

      if (!verifyWebhookSignature(rawBody || JSON.stringify(req.body), signature)) {
        console.warn("WhatsApp webhook signature verification failed");
        return res.sendStatus(403);
      }

      console.log("Webhook signature verified OK");
      res.sendStatus(200);

      const body = req.body;

      if (body.object !== "whatsapp_business_account") {
        console.log("Ignoring non-whatsapp object:", body.object);
        return;
      }

      const entries = body.entry || [];
      for (const entry of entries) {
        const changes = entry.changes || [];
        for (const change of changes) {
          if (change.field !== "messages") continue;

          const value = change.value;
          if (!value?.messages) continue;

          for (const message of value.messages) {
            const from = message.from;
            const messageId = message.id;

            markMessageAsRead(messageId);

            await handleIncomingMessage(from, message);
          }
        }
      }
    } catch (error) {
      console.error("Error handling WhatsApp webhook:", error);
    }
  });

  app.get("/api/whatsapp/status", (req, res) => {
    const hasToken = !!process.env.WHATSAPP_ACCESS_TOKEN;
    const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID || "871803432691653";

    res.json({
      configured: hasToken,
      phoneNumberId,
      activeSessions: whatsappSessions.size,
      webhookUrl: `${req.protocol}://${req.get("host")}/api/whatsapp/webhook`,
    });
  });
}
