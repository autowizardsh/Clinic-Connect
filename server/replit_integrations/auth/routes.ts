import type { Express } from "express";
import { storage } from "../../storage";
import bcrypt from "bcryptjs";
import { randomUUID } from "crypto";

// Register auth-specific routes (username/password based)
export function registerAuthRoutes(app: Express): void {
  // Get current authenticated user
  app.get("/api/auth/user", (req: any, res) => {
    if (req.session?.user) {
      res.json(req.session.user);
    } else {
      res.status(401).json({ message: "Not authenticated" });
    }
  });

  // Login route
  app.post("/api/auth/login", async (req, res) => {
    try {
      const { username, password } = req.body;

      if (!username || !password) {
        return res.status(400).json({ message: "Username and password are required" });
      }

      const user = await storage.getAdminUserByUsername(username);

      if (!user) {
        return res.status(401).json({ message: "Invalid username or password" });
      }

      const isValidPassword = await bcrypt.compare(password, user.password);

      if (!isValidPassword) {
        return res.status(401).json({ message: "Invalid username or password" });
      }

      // Set session
      (req as any).session.user = {
        id: user.userId,
        username: user.username,
        name: user.name,
        role: user.role,
        doctorId: user.doctorId,
      };

      res.json({
        id: user.userId,
        username: user.username,
        name: user.name,
        role: user.role,
        doctorId: user.doctorId,
      });
    } catch (error) {
      console.error("Login error:", error);
      res.status(500).json({ message: "Login failed" });
    }
  });

  // Logout route
  app.post("/api/auth/logout", (req: any, res) => {
    req.session.destroy((err: any) => {
      if (err) {
        console.error("Logout error:", err);
        return res.status(500).json({ message: "Logout failed" });
      }
      res.clearCookie("connect.sid");
      res.json({ message: "Logged out successfully" });
    });
  });

  // Seed admin user on startup (only if no users exist)
  seedAdminUser();
}

// Seed default admin account
async function seedAdminUser() {
  try {
    const users = await storage.getAdminUsers();
    if (users.length === 0) {
      const hashedPassword = await bcrypt.hash("admin", 10);
      await storage.createAdminUser({
        userId: randomUUID(),
        username: "admin",
        password: hashedPassword,
        name: "Administrator",
        role: "admin",
        doctorId: null,
      });
      console.log("Default admin user created (username: admin, password: admin)");
    }
  } catch (error) {
    console.error("Error seeding admin user:", error);
  }
}
