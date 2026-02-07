import type { Request, Response, NextFunction } from "express";

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const session = (req as any).session;
  if (!session?.user) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  next();
}

export function requireAdmin(req: Request, res: Response, next: NextFunction) {
  const session = (req as any).session;
  if (!session?.user) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  if (session.user.role !== "admin") {
    return res
      .status(403)
      .json({ error: "Access denied. Admin privileges required." });
  }

  next();
}

export function requireDoctor(req: Request, res: Response, next: NextFunction) {
  const session = (req as any).session;
  if (!session?.user) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  if (session.user.role === "admin" || session.user.role === "doctor") {
    next();
  } else {
    return res.status(403).json({ error: "Access denied" });
  }
}
