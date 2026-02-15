import type { Request, Response, NextFunction } from "express";
import helmet from "helmet";
import rateLimit from "express-rate-limit";

export const helmetMiddleware = helmet({
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false,
  crossOriginResourcePolicy: { policy: "cross-origin" },
  crossOriginOpenerPolicy: false,
  frameguard: { action: "sameorigin" },
});

export function widgetCorsHeaders(req: Request, res: Response, next: NextFunction) {
  res.removeHeader("X-Frame-Options");
  res.removeHeader("Cross-Origin-Opener-Policy");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
  if (req.method === "OPTIONS") {
    return res.sendStatus(200);
  }
  next();
}

export const generalApiLimiter = rateLimit({
  windowMs: 1 * 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: "Too many requests. Please try again later.",
    retryAfter: 60,
  },
});

export const authLimiter = rateLimit({
  windowMs: 1 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: "Too many login attempts. Please wait a minute before trying again.",
    retryAfter: 60,
  },
});

export const chatLimiter = rateLimit({
  windowMs: 1 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: "Too many messages. Please wait a moment before sending another.",
    retryAfter: 60,
  },
});

export const voiceApiLimiter = rateLimit({
  windowMs: 1 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: "Voice API rate limit exceeded. Please slow down requests.",
    retryAfter: 60,
  },
});

export const whatsappLimiter = rateLimit({
  windowMs: 1 * 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: "Too many webhook requests.",
    retryAfter: 60,
  },
});

function getClientIp(req: Request): string {
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string") {
    return forwarded.split(",")[0].trim();
  }
  return req.ip || req.socket.remoteAddress || "unknown";
}

export function auditLog(action: string) {
  return (req: Request, _res: Response, next: NextFunction) => {
    const session = (req as any).session;
    const user = session?.user;
    const ip = getClientIp(req);
    const timestamp = new Date().toISOString();

    const logEntry = {
      timestamp,
      action,
      userId: user?.id || "anonymous",
      userName: user?.name || user?.username || "anonymous",
      role: user?.role || "public",
      ip,
      method: req.method,
      path: req.path,
      userAgent: req.headers["user-agent"]?.substring(0, 100),
    };

    console.log(`[AUDIT] ${JSON.stringify(logEntry)}`);
    next();
  };
}
