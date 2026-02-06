import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { Plus, Calendar, Clock, MessageSquare, Phone, Pencil, X, Check } from "lucide-react";
import { useForm } from "react-hook-form";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import type { Appointment, Doctor, Patient, InsertAppointment } from "@shared/schema";

type AppointmentWithRelations = Appointment & { doctor: Doctor; patient: Patient };

export default function AdminAppointments() {
  const [isOpen, setIsOpen] = useState(false);
  const [selectedDate, setSelectedDate] = useState<string>(new Date().toISOString().split("T")[0]);
  const { toast } = useToast();

  const { data: appointments, isLoading } = useQuery<AppointmentWithRelations[]>({
    queryKey: ["/api/admin/appointments"],
  });

  const { data: doctors } = useQuery<Doctor[]>({
    queryKey: ["/api/admin/doctors"],
  });

  const { data: patients } = useQuery<Patient[]>({
    queryKey: ["/api/admin/patients"],
  });

  const { data: clinicSettings } = useQuery<{ services: string[] }>({
    queryKey: ["/api/admin/settings"],
  });

  const form = useForm({
    defaultValues: {
      doctorId: "",
      patientId: "",
      date: "",
      time: "",
      service: "",
      notes: "",
    },
  });

  const createMutation = useMutation({
    mutationFn: async (data: any) => {
      const response = await apiRequest("POST", "/api/admin/appointments", {
        doctorId: parseInt(data.doctorId),
        patientId: parseInt(data.patientId),
        date: data.date,
        time: data.time,
        service: data.service,
        notes: data.notes,
        source: "admin",
      });
      return response;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/appointments"] });
      toast({ title: "Appointment created successfully" });
      setIsOpen(false);
      form.reset();
    },
    onError: async (error: any) => {
      let message = "Failed to create appointment";
      if (error?.response) {
        try {
          const data = await error.response.json();
          message = data.error || message;
        } catch {}
      } else if (error?.message) {
        message = error.message;
      }
      toast({ title: message, variant: "destructive" });
    },
  });

  const updateStatusMutation = useMutation({
    mutationFn: ({ id, status }: { id: number; status: string }) =>
      apiRequest("PATCH", `/api/admin/appointments/${id}`, { status }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/appointments"] });
      toast({ title: "Appointment updated" });
    },
  });

  const cancelMutation = useMutation({
    mutationFn: (id: number) =>
      apiRequest("PATCH", `/api/admin/appointments/${id}`, { status: "cancelled" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/appointments"] });
      toast({ title: "Appointment cancelled" });
    },
  });

  const todayAppointments = appointments?.filter(
    (apt) => new Date(apt.date).toDateString() === new Date().toDateString()
  );

  const upcomingAppointments = appointments?.filter(
    (apt) => new Date(apt.date) > new Date() && apt.status === "scheduled"
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
        <div className="flex justify-between items-center">
          <div>
            <h1 className="text-2xl font-bold">Appointments</h1>
            <p className="text-muted-foreground">Manage all appointments</p>
          </div>
          <Skeleton className="h-10 w-40" />
        </div>
        <Skeleton className="h-10 w-full max-w-xs" />
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
      <div className="flex justify-between items-center flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-bold">Appointments</h1>
          <p className="text-muted-foreground">Manage all appointments</p>
        </div>
        <Dialog open={isOpen} onOpenChange={setIsOpen}>
          <DialogTrigger asChild>
            <Button data-testid="button-create-appointment">
              <Plus className="h-4 w-4 mr-2" />
              New Appointment
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>Create Appointment</DialogTitle>
            </DialogHeader>
            <Form {...form}>
              <form onSubmit={form.handleSubmit((data) => createMutation.mutate(data))} className="space-y-4">
                <FormField
                  control={form.control}
                  name="patientId"
                  rules={{ required: "Patient is required" }}
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Patient</FormLabel>
                      <Select onValueChange={field.onChange} value={field.value}>
                        <FormControl>
                          <SelectTrigger data-testid="select-patient">
                            <SelectValue placeholder="Select patient" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {patients?.map((patient) => (
                            <SelectItem key={patient.id} value={patient.id.toString()}>
                              {patient.name} - {patient.phone}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="doctorId"
                  rules={{ required: "Doctor is required" }}
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Doctor</FormLabel>
                      <Select onValueChange={field.onChange} value={field.value}>
                        <FormControl>
                          <SelectTrigger data-testid="select-doctor">
                            <SelectValue placeholder="Select doctor" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {doctors?.filter((d) => d.isActive).map((doctor) => (
                            <SelectItem key={doctor.id} value={doctor.id.toString()}>
                              Dr. {doctor.name} - {doctor.specialty}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="service"
                  rules={{ required: "Service is required" }}
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Service</FormLabel>
                      <Select onValueChange={field.onChange} value={field.value}>
                        <FormControl>
                          <SelectTrigger data-testid="select-service">
                            <SelectValue placeholder="Select service" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {clinicSettings?.services?.map((service: string) => (
                            <SelectItem key={service} value={service}>
                              {service}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <div className="grid grid-cols-2 gap-4">
                  <FormField
                    control={form.control}
                    name="date"
                    rules={{ required: "Date is required" }}
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Date</FormLabel>
                        <FormControl>
                          <Input type="date" {...field} data-testid="input-appointment-date" />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="time"
                    rules={{ required: "Time is required" }}
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Time</FormLabel>
                        <FormControl>
                          <Input type="time" {...field} data-testid="input-appointment-time" />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
                <FormField
                  control={form.control}
                  name="notes"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Notes (Optional)</FormLabel>
                      <FormControl>
                        <Input placeholder="Any notes..." {...field} data-testid="input-appointment-notes" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <div className="flex justify-end gap-2 pt-4">
                  <Button type="button" variant="outline" onClick={() => setIsOpen(false)}>
                    Cancel
                  </Button>
                  <Button type="submit" disabled={createMutation.isPending} data-testid="button-save-appointment">
                    {createMutation.isPending ? "Creating..." : "Create"}
                  </Button>
                </div>
              </form>
            </Form>
          </DialogContent>
        </Dialog>
      </div>

      <Tabs defaultValue="today" className="space-y-4">
        <TabsList>
          <TabsTrigger value="today" data-testid="tab-today">Today ({todayAppointments?.length || 0})</TabsTrigger>
          <TabsTrigger value="upcoming" data-testid="tab-upcoming">Upcoming ({upcomingAppointments?.length || 0})</TabsTrigger>
          <TabsTrigger value="calendar" data-testid="tab-calendar">By Date</TabsTrigger>
          <TabsTrigger value="all" data-testid="tab-all">All ({appointments?.length || 0})</TabsTrigger>
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
                  onCancel={() => cancelMutation.mutate(apt.id)}
                  onComplete={() => updateStatusMutation.mutate({ id: apt.id, status: "completed" })}
                />
              ))}
            </div>
          ) : (
            <EmptyState message="No appointments scheduled for today" />
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
                  onCancel={() => cancelMutation.mutate(apt.id)}
                  onComplete={() => updateStatusMutation.mutate({ id: apt.id, status: "completed" })}
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
                  onCancel={() => cancelMutation.mutate(apt.id)}
                  onComplete={() => updateStatusMutation.mutate({ id: apt.id, status: "completed" })}
                />
              ))}
            </div>
          ) : (
            <EmptyState message={`No appointments on ${selectedDate}`} />
          )}
        </TabsContent>

        <TabsContent value="all" className="space-y-4">
          {appointments && appointments.length > 0 ? (
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {appointments.map((apt) => (
                <AppointmentCard
                  key={apt.id}
                  appointment={apt}
                  getStatusBadge={getStatusBadge}
                  getSourceIcon={getSourceIcon}
                  onCancel={() => cancelMutation.mutate(apt.id)}
                  onComplete={() => updateStatusMutation.mutate({ id: apt.id, status: "completed" })}
                />
              ))}
            </div>
          ) : (
            <EmptyState message="No appointments yet" />
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
  onCancel,
  onComplete,
}: {
  appointment: AppointmentWithRelations;
  getStatusBadge: (status: string) => JSX.Element;
  getSourceIcon: (source: string) => JSX.Element;
  onCancel: () => void;
  onComplete: () => void;
}) {
  return (
    <Card data-testid={`card-appointment-${appointment.id}`}>
      <CardContent className="pt-6">
        <div className="flex items-start justify-between mb-4">
          <div className="flex items-center gap-2">
            {getSourceIcon(appointment.source)}
            <span className="text-sm text-muted-foreground capitalize">{appointment.source}</span>
          </div>
          <div className="flex items-center gap-2">
            {appointment.referenceNumber && (
              <Badge variant="outline" data-testid={`badge-ref-${appointment.id}`}>
                {appointment.referenceNumber}
              </Badge>
            )}
            {getStatusBadge(appointment.status)}
          </div>
        </div>
        <div className="space-y-3">
          <div>
            <p className="font-semibold">{appointment.patient?.name}</p>
            <p className="text-sm text-muted-foreground">{appointment.service}</p>
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
          <p className="text-sm">
            <span className="text-muted-foreground">Doctor:</span> Dr. {appointment.doctor?.name}
          </p>
        </div>
        {appointment.status === "scheduled" && (
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
