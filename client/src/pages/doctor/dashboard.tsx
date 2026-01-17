import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { Calendar, Clock, Users, Check, X, CalendarCheck } from "lucide-react";
import type { Appointment, Patient, Doctor } from "@shared/schema";

type AppointmentWithPatient = Appointment & { patient: Patient };

export default function DoctorDashboard() {
  const { toast } = useToast();

  const { data: profile, isLoading: profileLoading } = useQuery<Doctor>({
    queryKey: ["/api/doctor/profile"],
  });

  const { data: stats, isLoading: statsLoading } = useQuery<{
    todayAppointments: number;
    weekAppointments: number;
    totalPatients: number;
    upcomingAppointments: AppointmentWithPatient[];
  }>({
    queryKey: ["/api/doctor/stats"],
  });

  const updateStatusMutation = useMutation({
    mutationFn: ({ id, status }: { id: number; status: string }) =>
      apiRequest("PATCH", `/api/doctor/appointments/${id}`, { status }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/doctor/stats"] });
      queryClient.invalidateQueries({ queryKey: ["/api/doctor/appointments"] });
      toast({ title: "Appointment updated" });
    },
  });

  const isLoading = profileLoading || statsLoading;

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-4">
          <Skeleton className="h-16 w-16 rounded-full" />
          <div>
            <Skeleton className="h-6 w-48 mb-2" />
            <Skeleton className="h-4 w-32" />
          </div>
        </div>
        <div className="grid gap-4 md:grid-cols-3">
          {[1, 2, 3].map((i) => (
            <Card key={i}>
              <CardContent className="pt-6">
                <Skeleton className="h-16 w-full" />
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Welcome Header */}
      <div className="flex items-center gap-4">
        <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center">
          <span className="text-2xl font-bold text-primary">
            {profile?.name?.split(" ").map((n) => n[0]).join("").slice(0, 2)}
          </span>
        </div>
        <div>
          <h1 className="text-2xl font-bold">Welcome back, Dr. {profile?.name}</h1>
          <p className="text-muted-foreground">{profile?.specialty}</p>
        </div>
        {profile?.googleCalendarId ? (
          <Badge variant="outline" className="ml-auto hidden sm:flex items-center gap-1">
            <CalendarCheck className="h-3 w-3" />
            Calendar Connected
          </Badge>
        ) : (
          <Badge variant="secondary" className="ml-auto hidden sm:flex">
            Calendar Not Connected
          </Badge>
        )}
      </div>

      {/* Stats */}
      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2">
            <CardTitle className="text-sm font-medium">Today's Appointments</CardTitle>
            <Calendar className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold" data-testid="text-today-appointments">
              {stats?.todayAppointments ?? 0}
            </div>
            <p className="text-xs text-muted-foreground">Scheduled for today</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2">
            <CardTitle className="text-sm font-medium">This Week</CardTitle>
            <Clock className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold" data-testid="text-week-appointments">
              {stats?.weekAppointments ?? 0}
            </div>
            <p className="text-xs text-muted-foreground">Appointments this week</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2">
            <CardTitle className="text-sm font-medium">Total Patients</CardTitle>
            <Users className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold" data-testid="text-total-patients">
              {stats?.totalPatients ?? 0}
            </div>
            <p className="text-xs text-muted-foreground">Unique patients served</p>
          </CardContent>
        </Card>
      </div>

      {/* Upcoming Appointments */}
      <Card>
        <CardHeader>
          <CardTitle>Upcoming Appointments</CardTitle>
          <CardDescription>Your next scheduled appointments</CardDescription>
        </CardHeader>
        <CardContent>
          {stats?.upcomingAppointments && stats.upcomingAppointments.length > 0 ? (
            <div className="space-y-4">
              {stats.upcomingAppointments.map((apt) => (
                <div
                  key={apt.id}
                  className="flex items-center justify-between p-4 border rounded-lg"
                  data-testid={`card-appointment-${apt.id}`}
                >
                  <div className="flex items-center gap-4">
                    <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center">
                      <Calendar className="h-5 w-5 text-primary" />
                    </div>
                    <div>
                      <div className="font-medium">{apt.patient?.name}</div>
                      <div className="text-sm text-muted-foreground">{apt.service}</div>
                    </div>
                  </div>
                  <div className="flex items-center gap-4">
                    <div className="text-right">
                      <div className="text-sm font-medium">
                        {new Date(apt.date).toLocaleDateString()}
                      </div>
                      <div className="text-sm text-muted-foreground">
                        {new Date(apt.date).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                      </div>
                    </div>
                    {apt.status === "scheduled" && (
                      <div className="flex gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => updateStatusMutation.mutate({ id: apt.id, status: "completed" })}
                          data-testid={`button-complete-${apt.id}`}
                        >
                          <Check className="h-4 w-4 text-green-500" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => updateStatusMutation.mutate({ id: apt.id, status: "cancelled" })}
                          data-testid={`button-cancel-${apt.id}`}
                        >
                          <X className="h-4 w-4 text-destructive" />
                        </Button>
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center py-8 text-muted-foreground">
              <Calendar className="h-12 w-12 mx-auto mb-4 opacity-50" />
              <p>No upcoming appointments</p>
              <p className="text-sm">New bookings will appear here</p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
