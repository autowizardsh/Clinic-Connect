import type { Express } from "express";
import { authStorage } from "./storage";
import { isAuthenticated } from "./replitAuth";
import { storage } from "../../storage";

// Register auth-specific routes
export function registerAuthRoutes(app: Express): void {
  // Get current authenticated user with role
  app.get("/api/auth/user", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const user = await authStorage.getUser(userId);
      
      if (!user) {
        return res.status(404).json({ message: "User not found" });
      }

      // Check for role in adminUsers table
      let role: "admin" | "doctor" | null = null;
      let doctorId: number | null = null;
      
      try {
        const adminUser = await storage.getAdminUser(userId);
        if (adminUser) {
          role = adminUser.role as "admin" | "doctor";
          doctorId = adminUser.doctorId;
        } else {
          // Check if any admin users exist - only first user gets auto-admin
          const allAdminUsers = await storage.getAdminUsers();
          if (allAdminUsers.length === 0) {
            // First user ever - make them admin for MVP bootstrap
            await storage.createAdminUser({
              userId: userId,
              role: "admin",
              doctorId: null,
            });
            role = "admin";
          }
          // If admins exist but this user has no role, role stays null
          // They need to be invited/assigned a role by an admin
        }
      } catch (e) {
        console.error("Error checking/creating admin user:", e);
        // Don't auto-provision on error - fail safely
      }

      // Return user with role
      res.json({
        ...user,
        role,
        doctorId,
      });
    } catch (error) {
      console.error("Error fetching user:", error);
      res.status(500).json({ message: "Failed to fetch user" });
    }
  });
}
