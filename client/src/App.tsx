import { Switch, Route, useLocation, Redirect } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ThemeProvider } from "@/components/theme-provider";
import { useAuth } from "@/hooks/use-auth";

import NotFound from "@/pages/not-found";
import LandingPage from "@/pages/landing";
import LoginPage from "@/pages/login";
import ChatPage from "@/pages/chat";

import { AdminLayout } from "@/components/admin-layout";
import AdminDashboard from "@/pages/admin/dashboard";
import AdminDoctors from "@/pages/admin/doctors";
import AdminPatients from "@/pages/admin/patients";
import AdminAppointments from "@/pages/admin/appointments";
import AdminSettings from "@/pages/admin/settings";
import AdminChatPreview from "@/pages/admin/chat-preview";

import { DoctorLayout } from "@/components/doctor-layout";
import DoctorDashboard from "@/pages/doctor/dashboard";
import DoctorAppointments from "@/pages/doctor/appointments";
import DoctorAvailability from "@/pages/doctor/availability";
import DoctorCalendar from "@/pages/doctor/calendar";

function LoadingSpinner() {
  return (
    <div className="h-screen flex items-center justify-center">
      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
    </div>
  );
}

function ProtectedRoute({ 
  children, 
  requiredRole 
}: { 
  children: React.ReactNode; 
  requiredRole?: "admin" | "doctor";
}) {
  const { isLoading, isAuthenticated, role } = useAuth();

  if (isLoading) {
    return <LoadingSpinner />;
  }

  if (!isAuthenticated) {
    return <Redirect to="/login" />;
  }

  // Check role if specified
  if (requiredRole) {
    // Admin can access all routes
    if (role === "admin") {
      return <>{children}</>;
    }
    // Doctor can only access doctor routes
    if (requiredRole === "doctor" && role === "doctor") {
      return <>{children}</>;
    }
    // Doctor trying to access admin routes - redirect to doctor portal
    if (requiredRole === "admin" && role === "doctor") {
      return <Redirect to="/doctor" />;
    }
  }

  return <>{children}</>;
}

function AdminRoutes() {
  return (
    <ProtectedRoute requiredRole="admin">
      <AdminLayout>
        <Switch>
          <Route path="/admin" component={AdminDashboard} />
          <Route path="/admin/doctors" component={AdminDoctors} />
          <Route path="/admin/patients" component={AdminPatients} />
          <Route path="/admin/appointments" component={AdminAppointments} />
          <Route path="/admin/settings" component={AdminSettings} />
          <Route path="/admin/chat-preview" component={AdminChatPreview} />
          <Route component={NotFound} />
        </Switch>
      </AdminLayout>
    </ProtectedRoute>
  );
}

function DoctorRoutes() {
  return (
    <ProtectedRoute requiredRole="doctor">
      <DoctorLayout>
        <Switch>
          <Route path="/doctor" component={DoctorDashboard} />
          <Route path="/doctor/appointments" component={DoctorAppointments} />
          <Route path="/doctor/availability" component={DoctorAvailability} />
          <Route path="/doctor/calendar" component={DoctorCalendar} />
          <Route component={NotFound} />
        </Switch>
      </DoctorLayout>
    </ProtectedRoute>
  );
}

function HomeRedirect() {
  const { isAuthenticated, isLoading, role } = useAuth();

  if (isLoading) {
    return <LoadingSpinner />;
  }

  if (isAuthenticated) {
    // Route based on role
    if (role === "doctor") {
      return <Redirect to="/doctor" />;
    }
    // Default to admin for admins and any other role
    return <Redirect to="/admin" />;
  }

  return <LandingPage />;
}

function Router() {
  const [location] = useLocation();
  
  // Handle admin routes
  if (location.startsWith("/admin")) {
    return <AdminRoutes />;
  }
  
  // Handle doctor routes
  if (location.startsWith("/doctor")) {
    return <DoctorRoutes />;
  }
  
  return (
    <Switch>
      <Route path="/" component={HomeRedirect} />
      <Route path="/login" component={LoginPage} />
      <Route path="/chat" component={ChatPage} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider defaultTheme="light">
        <TooltipProvider>
          <Toaster />
          <Router />
        </TooltipProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}

export default App;
