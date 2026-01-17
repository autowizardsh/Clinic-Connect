import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { Clock, Calendar, Plus } from "lucide-react";
import type { DoctorAvailability } from "@shared/schema";

const DAYS_OF_WEEK = [
  { id: 0, label: "Sunday", short: "Sun" },
  { id: 1, label: "Monday", short: "Mon" },
  { id: 2, label: "Tuesday", short: "Tue" },
  { id: 3, label: "Wednesday", short: "Wed" },
  { id: 4, label: "Thursday", short: "Thu" },
  { id: 5, label: "Friday", short: "Fri" },
  { id: 6, label: "Saturday", short: "Sat" },
];

export default function DoctorAvailabilityPage() {
  const { toast } = useToast();

  const { data: availability, isLoading } = useQuery<DoctorAvailability[]>({
    queryKey: ["/api/doctor/availability"],
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: Partial<DoctorAvailability> }) =>
      apiRequest("PATCH", `/api/doctor/availability/${id}`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/doctor/availability"] });
      toast({ title: "Availability updated" });
    },
    onError: () => {
      toast({ title: "Failed to update availability", variant: "destructive" });
    },
  });

  const createMutation = useMutation({
    mutationFn: (data: { dayOfWeek: number; startTime: string; endTime: string }) =>
      apiRequest("POST", "/api/doctor/availability", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/doctor/availability"] });
      toast({ title: "Availability slot added" });
    },
    onError: () => {
      toast({ title: "Failed to add availability", variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/doctor/availability/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/doctor/availability"] });
      toast({ title: "Availability slot removed" });
    },
  });

  const getAvailabilityForDay = (dayOfWeek: number) => {
    return availability?.filter((a) => a.dayOfWeek === dayOfWeek) || [];
  };

  const handleAddSlot = (dayOfWeek: number) => {
    createMutation.mutate({
      dayOfWeek,
      startTime: "09:00",
      endTime: "17:00",
    });
  };

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold">Availability</h1>
          <p className="text-muted-foreground">Set your working hours</p>
        </div>
        <div className="grid gap-4">
          {[1, 2, 3, 4, 5].map((i) => (
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
      <div>
        <h1 className="text-2xl font-bold">Availability</h1>
        <p className="text-muted-foreground">Set your working hours for each day</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Calendar className="h-5 w-5" />
            Weekly Schedule
          </CardTitle>
          <CardDescription>
            Configure your available hours for each day of the week
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {DAYS_OF_WEEK.map((day) => {
            const daySlots = getAvailabilityForDay(day.id);

            return (
              <div
                key={day.id}
                className="p-4 border rounded-lg"
                data-testid={`availability-day-${day.id}`}
              >
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center">
                      <span className="text-sm font-medium text-primary">{day.short}</span>
                    </div>
                    <span className="font-medium">{day.label}</span>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleAddSlot(day.id)}
                    disabled={createMutation.isPending}
                    data-testid={`button-add-slot-${day.id}`}
                  >
                    <Plus className="h-4 w-4 mr-1" />
                    Add Slot
                  </Button>
                </div>

                {daySlots.length > 0 ? (
                  <div className="space-y-3 pl-13">
                    {daySlots.map((slot) => (
                      <div
                        key={slot.id}
                        className="flex items-center gap-4 p-3 bg-muted/50 rounded-lg"
                        data-testid={`slot-${slot.id}`}
                      >
                        <Switch
                          checked={slot.isAvailable}
                          onCheckedChange={(checked) =>
                            updateMutation.mutate({ id: slot.id, data: { isAvailable: checked } })
                          }
                          data-testid={`switch-available-${slot.id}`}
                        />
                        <div className="flex items-center gap-2">
                          <Clock className="h-4 w-4 text-muted-foreground" />
                          <Input
                            type="time"
                            value={slot.startTime}
                            onChange={(e) =>
                              updateMutation.mutate({ id: slot.id, data: { startTime: e.target.value } })
                            }
                            className="w-32"
                            data-testid={`input-start-time-${slot.id}`}
                          />
                          <span className="text-muted-foreground">to</span>
                          <Input
                            type="time"
                            value={slot.endTime}
                            onChange={(e) =>
                              updateMutation.mutate({ id: slot.id, data: { endTime: e.target.value } })
                            }
                            className="w-32"
                            data-testid={`input-end-time-${slot.id}`}
                          />
                        </div>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => deleteMutation.mutate(slot.id)}
                          className="ml-auto text-destructive hover:text-destructive"
                          data-testid={`button-delete-slot-${slot.id}`}
                        >
                          Remove
                        </Button>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground pl-13">No availability set for this day</p>
                )}
              </div>
            );
          })}
        </CardContent>
      </Card>
    </div>
  );
}
