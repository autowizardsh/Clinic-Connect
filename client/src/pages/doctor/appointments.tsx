import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { Calendar, Clock, Check, X, Phone, MessageSquare, Pencil } from "lucide-react";
import type { Appointment, Patient } from "@shared/schema";

type AppointmentWithPatient = Appointment & { patient: Patient };

export default function DoctorAppointments() {
  const [selectedDate, setSelectedDate] = useState<string>(new Date().toISOString().split("T")[0]);
  const { toast } = useToast();

  const { data: appointments, isLoading } = useQuery<AppointmentWithPatient[]>({
    queryKey: ["/api/doctor/appointments"],
  });

  const updateStatusMutation = useMutation({
    mutationFn: ({ id, status }: { id: number; status: string }) =>
      apiRequest("PATCH", `/api/doctor/appointments/${id}`, { status }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/doctor/appointments"] });
      queryClient.invalidateQueries({ queryKey: ["/api/doctor/stats"] });
      toast({ title: "Appointment updated" });
    },
  });

  const todayAppointments = appointments?.filter(
    (apt) => new Date(apt.date).toDateString() === new Date().toDateString()
  );

  const upcomingAppointments = appointments?.filter(
    (apt) => new Date(apt.date) > new Date() && apt.status === "scheduled"
  );

  const pastAppointments = appointments?.filter(
    (apt) => new Date(apt.date) < new Date() || apt.status !== "scheduled"
  );

  const filteredByDate = appointments?.filter(
    (apt) => new Date(apt.date).toISOString().split("T")[0] === selectedDate
  );

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "scheduled":
        return <Badge variant="default">Scheduled</Badge>;
      case "completed":
        return <Badge className="bg-green-500">Completed</Badge>;
      case "cancelled":
        return <Badge variant="secondary">Cancelled</Badge>;
      default:
        return <Badge variant="outline">{status}</Badge>;
    }
  };

  const getSourceIcon = (source: string) => {
    switch (source) {
      case "chat":
        return <MessageSquare className="h-4 w-4 text-primary" />;
      case "voice":
        return <Phone className="h-4 w-4 text-green-500" />;
      default:
        return <Pencil className="h-4 w-4 text-muted-foreground" />;
    }
  };

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold">My Appointments</h1>
          <p className="text-muted-foreground">View and manage your appointments</p>
        </div>
        <Skeleton className="h-10 w-64" />
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {[1, 2, 3].map((i) => (
            <Card key={i}>
              <CardContent className="pt-6">
                <Skeleton className="h-32 w-full" />
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">My Appointments</h1>
        <p className="text-muted-foreground">View and manage your appointments</p>
      </div>

      <Tabs defaultValue="today" className="space-y-4">
        <TabsList>
          <TabsTrigger value="today" data-testid="tab-today">Today ({todayAppointments?.length || 0})</TabsTrigger>
          <TabsTrigger value="upcoming" data-testid="tab-upcoming">Upcoming ({upcomingAppointments?.length || 0})</TabsTrigger>
          <TabsTrigger value="calendar" data-testid="tab-calendar">By Date</TabsTrigger>
          <TabsTrigger value="past" data-testid="tab-past">Past</TabsTrigger>
        </TabsList>

        <TabsContent value="today" className="space-y-4">
          {todayAppointments && todayAppointments.length > 0 ? (
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {todayAppointments.map((apt) => (
                <AppointmentCard
                  key={apt.id}
                  appointment={apt}
                  getStatusBadge={getStatusBadge}
                  getSourceIcon={getSourceIcon}
                  onComplete={() => updateStatusMutation.mutate({ id: apt.id, status: "completed" })}
                  onCancel={() => updateStatusMutation.mutate({ id: apt.id, status: "cancelled" })}
                />
              ))}
            </div>
          ) : (
            <EmptyState message="No appointments for today" />
          )}
        </TabsContent>

        <TabsContent value="upcoming" className="space-y-4">
          {upcomingAppointments && upcomingAppointments.length > 0 ? (
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {upcomingAppointments.map((apt) => (
                <AppointmentCard
                  key={apt.id}
                  appointment={apt}
                  getStatusBadge={getStatusBadge}
                  getSourceIcon={getSourceIcon}
                  onComplete={() => updateStatusMutation.mutate({ id: apt.id, status: "completed" })}
                  onCancel={() => updateStatusMutation.mutate({ id: apt.id, status: "cancelled" })}
                />
              ))}
            </div>
          ) : (
            <EmptyState message="No upcoming appointments" />
          )}
        </TabsContent>

        <TabsContent value="calendar" className="space-y-4">
          <Input
            type="date"
            value={selectedDate}
            onChange={(e) => setSelectedDate(e.target.value)}
            className="max-w-xs"
            data-testid="input-filter-date"
          />
          {filteredByDate && filteredByDate.length > 0 ? (
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {filteredByDate.map((apt) => (
                <AppointmentCard
                  key={apt.id}
                  appointment={apt}
                  getStatusBadge={getStatusBadge}
                  getSourceIcon={getSourceIcon}
                  onComplete={() => updateStatusMutation.mutate({ id: apt.id, status: "completed" })}
                  onCancel={() => updateStatusMutation.mutate({ id: apt.id, status: "cancelled" })}
                />
              ))}
            </div>
          ) : (
            <EmptyState message={`No appointments on ${selectedDate}`} />
          )}
        </TabsContent>

        <TabsContent value="past" className="space-y-4">
          {pastAppointments && pastAppointments.length > 0 ? (
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {pastAppointments.slice(0, 20).map((apt) => (
                <AppointmentCard
                  key={apt.id}
                  appointment={apt}
                  getStatusBadge={getStatusBadge}
                  getSourceIcon={getSourceIcon}
                  readonly
                />
              ))}
            </div>
          ) : (
            <EmptyState message="No past appointments" />
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}

function AppointmentCard({
  appointment,
  getStatusBadge,
  getSourceIcon,
  onComplete,
  onCancel,
  readonly = false,
}: {
  appointment: AppointmentWithPatient;
  getStatusBadge: (status: string) => JSX.Element;
  getSourceIcon: (source: string) => JSX.Element;
  onComplete?: () => void;
  onCancel?: () => void;
  readonly?: boolean;
}) {
  return (
    <Card data-testid={`card-appointment-${appointment.id}`}>
      <CardContent className="pt-6">
        <div className="flex items-start justify-between mb-4">
          <div className="flex items-center gap-2">
            {getSourceIcon(appointment.source)}
            <span className="text-sm text-muted-foreground capitalize">{appointment.source}</span>
          </div>
          {getStatusBadge(appointment.status)}
        </div>
        <div className="space-y-3">
          <div>
            <p className="font-semibold">{appointment.patient?.name}</p>
            <p className="text-sm text-muted-foreground">{appointment.patient?.phone}</p>
          </div>
          <div>
            <p className="text-sm font-medium">{appointment.service}</p>
          </div>
          <div className="flex items-center gap-4 text-sm text-muted-foreground">
            <div className="flex items-center gap-1">
              <Calendar className="h-4 w-4" />
              {new Date(appointment.date).toLocaleDateString()}
            </div>
            <div className="flex items-center gap-1">
              <Clock className="h-4 w-4" />
              {new Date(appointment.date).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
            </div>
          </div>
          {appointment.notes && (
            <p className="text-sm text-muted-foreground border-t pt-2">{appointment.notes}</p>
          )}
        </div>
        {!readonly && appointment.status === "scheduled" && (
          <div className="flex gap-2 mt-4 pt-4 border-t">
            <Button variant="outline" size="sm" onClick={onComplete} data-testid={`button-complete-${appointment.id}`}>
              <Check className="h-4 w-4 mr-1" />
              Complete
            </Button>
            <Button variant="ghost" size="sm" onClick={onCancel} data-testid={`button-cancel-${appointment.id}`}>
              <X className="h-4 w-4 mr-1" />
              Cancel
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function EmptyState({ message }: { message: string }) {
  return (
    <Card>
      <CardContent className="py-12 text-center">
        <Calendar className="h-12 w-12 mx-auto mb-4 text-muted-foreground opacity-50" />
        <p className="text-muted-foreground">{message}</p>
      </CardContent>
    </Card>
  );
}
