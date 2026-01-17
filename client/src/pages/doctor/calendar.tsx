import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Calendar, CalendarCheck, CalendarX, RefreshCw, ExternalLink, Info } from "lucide-react";
import { SiGoogle } from "react-icons/si";

export default function DoctorCalendarPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Google Calendar</h1>
        <p className="text-muted-foreground">Sync your appointments with Google Calendar</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <SiGoogle className="h-5 w-5" />
            Google Calendar Integration
          </CardTitle>
          <CardDescription>
            Connect your Google Calendar to automatically sync appointments
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Coming Soon Notice */}
          <div className="flex items-start gap-4 p-4 border rounded-lg bg-primary/5">
            <div className="w-12 h-12 rounded-full bg-primary/20 flex items-center justify-center flex-shrink-0">
              <Info className="h-6 w-6 text-primary" />
            </div>
            <div>
              <div className="flex items-center gap-2 mb-1">
                <span className="font-medium">Coming Soon</span>
                <Badge variant="secondary">MVP</Badge>
              </div>
              <p className="text-sm text-muted-foreground">
                Google Calendar integration is planned for the next release. For now, you can manage your 
                appointments through the Appointments section. All bookings made through the AI chat 
                widget will appear there automatically.
              </p>
            </div>
          </div>

          {/* Planned Features */}
          <div className="space-y-4">
            <h3 className="font-medium">Planned Features:</h3>
            <div className="grid gap-3 md:grid-cols-2">
              <div className="flex items-start gap-3 p-3 border rounded-lg opacity-70">
                <Calendar className="h-5 w-5 text-primary mt-0.5" />
                <div>
                  <p className="font-medium text-sm">Automatic Sync</p>
                  <p className="text-sm text-muted-foreground">
                    Appointments automatically added to your calendar
                  </p>
                </div>
              </div>
              <div className="flex items-start gap-3 p-3 border rounded-lg opacity-70">
                <CalendarX className="h-5 w-5 text-primary mt-0.5" />
                <div>
                  <p className="font-medium text-sm">Prevent Double Booking</p>
                  <p className="text-sm text-muted-foreground">
                    AI checks your calendar before suggesting slots
                  </p>
                </div>
              </div>
              <div className="flex items-start gap-3 p-3 border rounded-lg opacity-70">
                <RefreshCw className="h-5 w-5 text-primary mt-0.5" />
                <div>
                  <p className="font-medium text-sm">Real-time Updates</p>
                  <p className="text-sm text-muted-foreground">
                    Cancellations and changes sync instantly
                  </p>
                </div>
              </div>
              <div className="flex items-start gap-3 p-3 border rounded-lg opacity-70">
                <ExternalLink className="h-5 w-5 text-primary mt-0.5" />
                <div>
                  <p className="font-medium text-sm">Mobile Access</p>
                  <p className="text-sm text-muted-foreground">
                    View appointments on any device
                  </p>
                </div>
              </div>
            </div>
          </div>

          {/* Current Workaround */}
          <div className="p-4 bg-muted/50 rounded-lg">
            <p className="text-sm font-medium mb-2">Current Workflow</p>
            <p className="text-sm text-muted-foreground">
              Until Google Calendar integration is available, you can manually add appointments 
              to your calendar. All AI-booked appointments appear in your Appointments section 
              with complete details (patient name, time, service).
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
