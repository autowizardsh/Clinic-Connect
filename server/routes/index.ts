import type { Express } from "express";
import type { Server } from "http";
import { setupAuth, registerAuthRoutes } from "../replit_integrations/auth";
import { registerAdminRoutes } from "./admin";
import { registerDoctorRoutes } from "./doctor";
import { registerChatRoutes } from "./chat";
import { registerPublicRoutes } from "./public";

export async function registerRoutes(
  httpServer: Server,
  app: Express,
): Promise<Server> {
  await setupAuth(app);
  registerAuthRoutes(app);

  registerAdminRoutes(app);
  registerDoctorRoutes(app);
  registerChatRoutes(app);
  registerPublicRoutes(app);

  return httpServer;
}
