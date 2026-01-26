import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { Clock, CalendarX, Plus, Trash2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import type { DoctorAvailability } from "@shared/schema";

export default function DoctorAvailabilityPage() {
  const { toast } = useToast();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [newBlock, setNewBlock] = useState({
    date: "",
    startTime: "09:00",
    endTime: "17:00",
    reason: "",
  });

  const { data: availability, isLoading } = useQuery<DoctorAvailability[]>({
    queryKey: ["/api/doctor/availability"],
  });

  const createMutation = useMutation({
    mutationFn: (data: { date: string; startTime: string; endTime: string; reason?: string; isAvailable: boolean }) =>
      apiRequest("POST", "/api/doctor/availability", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/doctor/availability"] });
      toast({ title: "Time block added" });
      setDialogOpen(false);
      setNewBlock({ date: "", startTime: "09:00", endTime: "17:00", reason: "" });
    },
    onError: () => {
      toast({ title: "Failed to add time block", variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/doctor/availability/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/doctor/availability"] });
      toast({ title: "Time block removed" });
    },
  });

  const handleAddBlock = () => {
    if (!newBlock.date || !newBlock.startTime || !newBlock.endTime) {
      toast({ title: "Please fill in all required fields", variant: "destructive" });
      return;
    }
    createMutation.mutate({
      date: newBlock.date,
      startTime: newBlock.startTime,
      endTime: newBlock.endTime,
      reason: newBlock.reason || undefined,
      isAvailable: false,
    });
  };

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr + "T00:00:00");
    return date.toLocaleDateString("en-US", {
      weekday: "short",
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  };

  const formatTime = (timeStr: string) => {
    const [hours, minutes] = timeStr.split(":");
    const hour = parseInt(hours);
    const ampm = hour >= 12 ? "PM" : "AM";
    const hour12 = hour % 12 || 12;
    return `${hour12}:${minutes} ${ampm}`;
  };

  const getMinDate = () => {
    const today = new Date();
    return today.toISOString().split("T")[0];
  };

  const sortedAvailability = availability?.slice().sort((a, b) => {
    const dateA = new Date(a.date);
    const dateB = new Date(b.date);
    return dateA.getTime() - dateB.getTime();
  });

  const upcomingBlocks = sortedAvailability?.filter(block => {
    const blockDate = new Date(block.date + "T00:00:00");
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return blockDate >= today;
  }) || [];

  const pastBlocks = sortedAvailability?.filter(block => {
    const blockDate = new Date(block.date + "T00:00:00");
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return blockDate < today;
  }) || [];

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold">Availability</h1>
          <p className="text-muted-foreground">Manage your unavailable dates</p>
        </div>
        <Card>
          <CardContent className="pt-6">
            <Skeleton className="h-48 w-full" />
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Availability</h1>
          <p className="text-muted-foreground">Block specific dates and times when you are not available</p>
        </div>
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger asChild>
            <Button data-testid="button-add-block">
              <Plus className="h-4 w-4 mr-2" />
              Block Time
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Block Time Slot</DialogTitle>
              <DialogDescription>
                Add a date and time range when you will not be available for appointments.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label htmlFor="date">Date</Label>
                <Input
                  id="date"
                  type="date"
                  min={getMinDate()}
                  value={newBlock.date}
                  onChange={(e) => setNewBlock({ ...newBlock, date: e.target.value })}
                  data-testid="input-block-date"
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="startTime">From</Label>
                  <Input
                    id="startTime"
                    type="time"
                    value={newBlock.startTime}
                    onChange={(e) => setNewBlock({ ...newBlock, startTime: e.target.value })}
                    data-testid="input-block-start-time"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="endTime">To</Label>
                  <Input
                    id="endTime"
                    type="time"
                    value={newBlock.endTime}
                    onChange={(e) => setNewBlock({ ...newBlock, endTime: e.target.value })}
                    data-testid="input-block-end-time"
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="reason">Reason (optional)</Label>
                <Input
                  id="reason"
                  placeholder="e.g., Personal appointment, Training, etc."
                  value={newBlock.reason}
                  onChange={(e) => setNewBlock({ ...newBlock, reason: e.target.value })}
                  data-testid="input-block-reason"
                />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setDialogOpen(false)}>
                Cancel
              </Button>
              <Button onClick={handleAddBlock} disabled={createMutation.isPending} data-testid="button-save-block">
                {createMutation.isPending ? "Saving..." : "Block Time"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <CalendarX className="h-5 w-5" />
            Blocked Time Slots
          </CardTitle>
          <CardDescription>
            Patients cannot book appointments during these times
          </CardDescription>
        </CardHeader>
        <CardContent>
          {upcomingBlocks.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <CalendarX className="h-12 w-12 mx-auto mb-3 opacity-50" />
              <p>No blocked times scheduled</p>
              <p className="text-sm">Click "Block Time" to mark dates when you are unavailable</p>
            </div>
          ) : (
            <div className="space-y-3">
              {upcomingBlocks.map((block) => (
                <div
                  key={block.id}
                  className="flex items-center justify-between p-4 border rounded-lg"
                  data-testid={`block-${block.id}`}
                >
                  <div className="flex items-center gap-4">
                    <div className="w-12 h-12 rounded-lg bg-destructive/10 flex items-center justify-center">
                      <CalendarX className="h-6 w-6 text-destructive" />
                    </div>
                    <div>
                      <p className="font-medium">{formatDate(block.date)}</p>
                      <div className="flex items-center gap-2 text-sm text-muted-foreground">
                        <Clock className="h-4 w-4" />
                        <span>
                          {formatTime(block.startTime)} - {formatTime(block.endTime)}
                        </span>
                        {block.reason && (
                          <>
                            <span className="mx-1">-</span>
                            <span>{block.reason}</span>
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => deleteMutation.mutate(block.id)}
                    className="text-destructive hover:text-destructive hover:bg-destructive/10"
                    data-testid={`button-delete-block-${block.id}`}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {pastBlocks.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm text-muted-foreground">Past Blocked Times</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {pastBlocks.slice(0, 5).map((block) => (
                <div
                  key={block.id}
                  className="flex items-center justify-between p-3 border rounded-lg opacity-60"
                  data-testid={`past-block-${block.id}`}
                >
                  <div className="flex items-center gap-3">
                    <CalendarX className="h-4 w-4 text-muted-foreground" />
                    <span className="text-sm">{formatDate(block.date)}</span>
                    <span className="text-sm text-muted-foreground">
                      {formatTime(block.startTime)} - {formatTime(block.endTime)}
                    </span>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => deleteMutation.mutate(block.id)}
                    className="text-muted-foreground hover:text-destructive"
                    data-testid={`button-delete-past-block-${block.id}`}
                  >
                    <Trash2 className="h-3 w-3" />
                  </Button>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
