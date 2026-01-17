import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Calendar, CalendarCheck, RefreshCw, Loader2, CheckCircle2, XCircle } from "lucide-react";
import { SiGoogle } from "react-icons/si";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";

interface CalendarEvent {
  id: string;
  summary?: string;
  start?: { dateTime?: string; date?: string };
  end?: { dateTime?: string; date?: string };
}

export default function DoctorCalendarPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [selectedCalendar] = useState("primary");

  const { data: status, isLoading: statusLoading } = useQuery<{ connected: boolean; message?: string }>({
    queryKey: ["/api/doctor/calendar/status"],
  });

  const { data: events, isLoading: eventsLoading } = useQuery<CalendarEvent[]>({
    queryKey: ["/api/doctor/calendar/events"],
    enabled: status?.connected === true,
  });

  const syncMutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest("POST", "/api/doctor/calendar/sync", {
        calendarId: selectedCalendar,
      });
      return response.json();
    },
    onSuccess: (data) => {
      toast({
        title: "Sync Complete",
        description: data.message || "Appointments synced to Google Calendar",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/doctor/calendar/events"] });
    },
    onError: (error: Error) => {
      toast({
        title: "Sync Failed",
        description: error.message || "Failed to sync appointments",
        variant: "destructive",
      });
    },
  });

  const formatEventDate = (event: CalendarEvent) => {
    const dateStr = event.start?.dateTime || event.start?.date;
    if (!dateStr) return "Unknown date";
    const date = new Date(dateStr);
    return date.toLocaleDateString("en-US", {
      weekday: "short",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  if (statusLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

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
          <div className="flex items-center justify-between p-4 border rounded-lg">
            <div className="flex items-center gap-3">
              {status?.connected ? (
                <>
                  <CheckCircle2 className="h-6 w-6 text-green-500" />
                  <div>
                    <p className="font-medium">Connected</p>
                    <p className="text-sm text-muted-foreground">
                      Your Google Calendar is connected and ready to sync
                    </p>
                  </div>
                </>
              ) : (
                <>
                  <XCircle className="h-6 w-6 text-muted-foreground" />
                  <div>
                    <p className="font-medium">Not Connected</p>
                    <p className="text-sm text-muted-foreground">
                      {status?.message || "Google Calendar is not connected"}
                    </p>
                  </div>
                </>
              )}
            </div>
            {status?.connected && (
              <Button
                onClick={() => syncMutation.mutate()}
                disabled={syncMutation.isPending}
                data-testid="button-sync-calendar"
              >
                {syncMutation.isPending ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Syncing...
                  </>
                ) : (
                  <>
                    <RefreshCw className="mr-2 h-4 w-4" />
                    Sync Now
                  </>
                )}
              </Button>
            )}
          </div>

          {status?.connected && (
            <>
              <div className="space-y-4">
                <h3 className="font-medium flex items-center gap-2">
                  <Calendar className="h-5 w-5" />
                  Upcoming Events
                </h3>
                {eventsLoading ? (
                  <div className="flex items-center justify-center py-8">
                    <Loader2 className="h-6 w-6 animate-spin text-primary" />
                  </div>
                ) : events && events.length > 0 ? (
                  <div className="space-y-2">
                    {events.slice(0, 10).map((event) => (
                      <div
                        key={event.id}
                        className="flex items-center justify-between p-3 border rounded-lg"
                        data-testid={`event-${event.id}`}
                      >
                        <div className="flex items-center gap-3">
                          <CalendarCheck className="h-5 w-5 text-primary" />
                          <div>
                            <p className="font-medium text-sm">{event.summary || "Untitled Event"}</p>
                            <p className="text-xs text-muted-foreground">{formatEventDate(event)}</p>
                          </div>
                        </div>
                        <Badge variant="secondary">Synced</Badge>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-center py-8 text-muted-foreground">
                    <Calendar className="h-12 w-12 mx-auto mb-3 opacity-50" />
                    <p>No upcoming events found</p>
                    <p className="text-sm">Sync your appointments to see them here</p>
                  </div>
                )}
              </div>

              <div className="grid gap-3 md:grid-cols-2">
                <div className="flex items-start gap-3 p-3 border rounded-lg">
                  <Calendar className="h-5 w-5 text-primary mt-0.5" />
                  <div>
                    <p className="font-medium text-sm">Automatic Sync</p>
                    <p className="text-sm text-muted-foreground">
                      Click "Sync Now" to push appointments to your calendar
                    </p>
                  </div>
                </div>
                <div className="flex items-start gap-3 p-3 border rounded-lg">
                  <RefreshCw className="h-5 w-5 text-primary mt-0.5" />
                  <div>
                    <p className="font-medium text-sm">Real-time Updates</p>
                    <p className="text-sm text-muted-foreground">
                      New bookings can be synced instantly
                    </p>
                  </div>
                </div>
              </div>
            </>
          )}

          {!status?.connected && (
            <div className="p-4 bg-muted/50 rounded-lg">
              <p className="text-sm font-medium mb-2">How to Connect</p>
              <p className="text-sm text-muted-foreground">
                The Google Calendar connection needs to be set up through the Replit integrations panel.
                Once connected, you'll be able to sync your appointments directly to your calendar.
              </p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
