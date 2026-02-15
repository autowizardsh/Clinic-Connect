import type { Express } from "express";
import type { Server } from "http";
import { setupAuth, registerAuthRoutes } from "../replit_integrations/auth";
import { registerAdminRoutes } from "./admin";
import { registerDoctorRoutes } from "./doctor";
import { registerChatRoutes } from "./chat";
import { registerPublicRoutes } from "./public";
import { registerWhatsAppRoutes } from "./whatsapp";
import { registerVoiceAgentRoutes } from "./voice-agent";
import {
  authLimiter,
  chatLimiter,
  voiceApiLimiter,
  whatsappLimiter,
  auditLog,
  widgetCorsHeaders,
} from "../middleware/security";

export async function registerRoutes(
  httpServer: Server,
  app: Express,
): Promise<Server> {
  await setupAuth(app);

  app.use("/api/auth/login", authLimiter);
  app.use("/api/chat", widgetCorsHeaders, chatLimiter);
  app.use("/api/public", widgetCorsHeaders);
  app.use("/api/voice", voiceApiLimiter);
  app.use("/api/whatsapp", whatsappLimiter);

  app.use("/api/admin", auditLog("admin_access"));
  app.use("/api/doctor", auditLog("doctor_access"));

  registerAuthRoutes(app);
  registerAdminRoutes(app);
  registerDoctorRoutes(app);
  registerChatRoutes(app);
  registerWhatsAppRoutes(app);
  registerPublicRoutes(app);
  registerVoiceAgentRoutes(app);

  return httpServer;
}
