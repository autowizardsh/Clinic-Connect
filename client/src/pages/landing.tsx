import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ThemeToggle } from "@/components/theme-toggle";
import { Calendar, MessageSquare, Users, Clock, Shield, Sparkles } from "lucide-react";

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-background">
      {/* Navigation */}
      <nav className="fixed top-0 left-0 right-0 z-50 bg-background/80 backdrop-blur-md border-b">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16 gap-4">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-md bg-primary flex items-center justify-center">
                <Sparkles className="h-5 w-5 text-primary-foreground" />
              </div>
              <span className="font-semibold text-lg">DentalAI</span>
            </div>
            <div className="hidden md:flex items-center gap-8">
              <a href="#features" className="text-sm text-muted-foreground hover:text-foreground transition-colors">Features</a>
              <a href="#how-it-works" className="text-sm text-muted-foreground hover:text-foreground transition-colors">How it Works</a>
            </div>
            <div className="flex items-center gap-3">
              <ThemeToggle />
              <Button asChild data-testid="button-login">
                <a href="/api/login">Sign In</a>
              </Button>
            </div>
          </div>
        </div>
      </nav>

      {/* Hero Section */}
      <section className="pt-32 pb-20 px-4 sm:px-6 lg:px-8">
        <div className="max-w-7xl mx-auto">
          <div className="grid lg:grid-cols-2 gap-12 items-center">
            <div className="space-y-8">
              <div className="space-y-4">
                <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-primary/10 text-primary text-sm font-medium">
                  <Sparkles className="h-4 w-4" />
                  AI-Powered Booking
                </div>
                <h1 className="text-4xl sm:text-5xl lg:text-6xl font-bold tracking-tight">
                  Your AI Receptionist for{" "}
                  <span className="text-primary">Dental Clinics</span>
                </h1>
                <p className="text-lg text-muted-foreground max-w-lg">
                  Automate appointment booking with intelligent AI chat. Available 24/7, 
                  speaks English & Dutch, and syncs with Google Calendar.
                </p>
              </div>
              <div className="flex flex-col sm:flex-row gap-4">
                <Button size="lg" asChild data-testid="button-get-started">
                  <a href="/api/login">Get Started Free</a>
                </Button>
                <Button size="lg" variant="outline" asChild data-testid="button-demo">
                  <a href="#features">Learn More</a>
                </Button>
              </div>
              <div className="flex items-center gap-6 text-sm text-muted-foreground">
                <div className="flex items-center gap-2">
                  <Shield className="h-4 w-4 text-primary" />
                  <span>GDPR Compliant</span>
                </div>
                <div className="flex items-center gap-2">
                  <Clock className="h-4 w-4 text-primary" />
                  <span>24/7 Available</span>
                </div>
              </div>
            </div>
            <div className="relative">
              <div className="relative bg-gradient-to-br from-primary/20 to-primary/5 rounded-2xl p-8 border">
                <div className="bg-card rounded-xl shadow-xl overflow-hidden">
                  <div className="bg-primary p-4">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-full bg-white/20 flex items-center justify-center">
                        <MessageSquare className="h-5 w-5 text-white" />
                      </div>
                      <div>
                        <div className="text-white font-medium">AI Dental Assistant</div>
                        <div className="text-white/70 text-sm">Online now</div>
                      </div>
                    </div>
                  </div>
                  <div className="p-4 space-y-4">
                    <div className="flex justify-start">
                      <div className="bg-muted rounded-lg rounded-tl-none px-4 py-2 max-w-[80%]">
                        <p className="text-sm">Hello! Welcome to Smile Dental Clinic. How can I help you today?</p>
                      </div>
                    </div>
                    <div className="flex justify-end">
                      <div className="bg-primary text-primary-foreground rounded-lg rounded-tr-none px-4 py-2 max-w-[80%]">
                        <p className="text-sm">I'd like to book a teeth cleaning appointment</p>
                      </div>
                    </div>
                    <div className="flex justify-start">
                      <div className="bg-muted rounded-lg rounded-tl-none px-4 py-2 max-w-[80%]">
                        <p className="text-sm">Perfect! I can help with that. We have Dr. Sarah available tomorrow at 10:00 AM or 2:00 PM. Which works better for you?</p>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Features Section */}
      <section id="features" className="py-20 px-4 sm:px-6 lg:px-8 bg-muted/50">
        <div className="max-w-7xl mx-auto">
          <div className="text-center mb-12">
            <h2 className="text-3xl font-bold mb-4">Everything You Need</h2>
            <p className="text-muted-foreground max-w-2xl mx-auto">
              A complete solution to modernize your clinic's appointment booking experience
            </p>
          </div>
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
            <Card className="hover-elevate">
              <CardContent className="pt-6">
                <div className="w-12 h-12 rounded-lg bg-primary/10 flex items-center justify-center mb-4">
                  <MessageSquare className="h-6 w-6 text-primary" />
                </div>
                <h3 className="font-semibold text-lg mb-2">AI Chat Widget</h3>
                <p className="text-muted-foreground text-sm">
                  Embed a smart chat widget on your website. Patients can book appointments naturally in English or Dutch.
                </p>
              </CardContent>
            </Card>
            <Card className="hover-elevate">
              <CardContent className="pt-6">
                <div className="w-12 h-12 rounded-lg bg-primary/10 flex items-center justify-center mb-4">
                  <Calendar className="h-6 w-6 text-primary" />
                </div>
                <h3 className="font-semibold text-lg mb-2">Google Calendar Sync</h3>
                <p className="text-muted-foreground text-sm">
                  Each doctor can connect their Google Calendar. Appointments sync automatically to prevent double bookings.
                </p>
              </CardContent>
            </Card>
            <Card className="hover-elevate">
              <CardContent className="pt-6">
                <div className="w-12 h-12 rounded-lg bg-primary/10 flex items-center justify-center mb-4">
                  <Users className="h-6 w-6 text-primary" />
                </div>
                <h3 className="font-semibold text-lg mb-2">Multi-Doctor Support</h3>
                <p className="text-muted-foreground text-sm">
                  Manage multiple doctors, each with their own availability, specialties, and patient appointments.
                </p>
              </CardContent>
            </Card>
            <Card className="hover-elevate">
              <CardContent className="pt-6">
                <div className="w-12 h-12 rounded-lg bg-primary/10 flex items-center justify-center mb-4">
                  <Clock className="h-6 w-6 text-primary" />
                </div>
                <h3 className="font-semibold text-lg mb-2">Smart Scheduling</h3>
                <p className="text-muted-foreground text-sm">
                  AI suggests available slots based on doctor availability, clinic hours, and appointment duration.
                </p>
              </CardContent>
            </Card>
            <Card className="hover-elevate">
              <CardContent className="pt-6">
                <div className="w-12 h-12 rounded-lg bg-primary/10 flex items-center justify-center mb-4">
                  <Shield className="h-6 w-6 text-primary" />
                </div>
                <h3 className="font-semibold text-lg mb-2">Admin Dashboard</h3>
                <p className="text-muted-foreground text-sm">
                  Full control over appointments, doctors, patients, and clinic settings from one central dashboard.
                </p>
              </CardContent>
            </Card>
            <Card className="hover-elevate">
              <CardContent className="pt-6">
                <div className="w-12 h-12 rounded-lg bg-primary/10 flex items-center justify-center mb-4">
                  <Sparkles className="h-6 w-6 text-primary" />
                </div>
                <h3 className="font-semibold text-lg mb-2">Doctor Portal</h3>
                <p className="text-muted-foreground text-sm">
                  Each doctor gets their own panel to view bookings, manage availability, and connect their calendar.
                </p>
              </CardContent>
            </Card>
          </div>
        </div>
      </section>

      {/* How it Works */}
      <section id="how-it-works" className="py-20 px-4 sm:px-6 lg:px-8">
        <div className="max-w-7xl mx-auto">
          <div className="text-center mb-12">
            <h2 className="text-3xl font-bold mb-4">Book in Under 1 Minute</h2>
            <p className="text-muted-foreground max-w-2xl mx-auto">
              Our AI makes appointment booking fast and effortless for your patients
            </p>
          </div>
          <div className="grid md:grid-cols-4 gap-8">
            {[
              { step: "1", title: "Start Chat", desc: "Patient opens the chat widget on your website" },
              { step: "2", title: "Choose Service", desc: "AI asks about the type of appointment needed" },
              { step: "3", title: "Select Time", desc: "AI shows available doctors and time slots" },
              { step: "4", title: "Confirmed", desc: "Booking is saved and synced to doctor's calendar" },
            ].map((item) => (
              <div key={item.step} className="text-center">
                <div className="w-12 h-12 rounded-full bg-primary text-primary-foreground font-bold text-lg flex items-center justify-center mx-auto mb-4">
                  {item.step}
                </div>
                <h3 className="font-semibold mb-2">{item.title}</h3>
                <p className="text-sm text-muted-foreground">{item.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="py-20 px-4 sm:px-6 lg:px-8 bg-primary">
        <div className="max-w-4xl mx-auto text-center">
          <h2 className="text-3xl font-bold text-primary-foreground mb-4">
            Ready to Modernize Your Clinic?
          </h2>
          <p className="text-primary-foreground/80 mb-8 max-w-2xl mx-auto">
            Join clinics that save hours every week with AI-powered appointment booking.
          </p>
          <Button size="lg" variant="secondary" asChild data-testid="button-cta-signup">
            <a href="/api/login">Start Free Trial</a>
          </Button>
        </div>
      </section>

      {/* Footer */}
      <footer className="py-8 px-4 sm:px-6 lg:px-8 border-t">
        <div className="max-w-7xl mx-auto flex flex-col sm:flex-row justify-between items-center gap-4">
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 rounded bg-primary flex items-center justify-center">
              <Sparkles className="h-4 w-4 text-primary-foreground" />
            </div>
            <span className="font-medium">DentalAI</span>
          </div>
          <p className="text-sm text-muted-foreground">
            © 2025 DentalAI. All rights reserved.
          </p>
        </div>
      </footer>
    </div>
  );
}
