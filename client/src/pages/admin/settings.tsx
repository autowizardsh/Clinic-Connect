import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { Settings, Building2, Clock, Calendar, MessageSquare, Plus, X } from "lucide-react";
import { useForm } from "react-hook-form";
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { useState } from "react";
import type { ClinicSettings } from "@shared/schema";

const DAYS_OF_WEEK = [
  { id: 0, label: "Sunday" },
  { id: 1, label: "Monday" },
  { id: 2, label: "Tuesday" },
  { id: 3, label: "Wednesday" },
  { id: 4, label: "Thursday" },
  { id: 5, label: "Friday" },
  { id: 6, label: "Saturday" },
];

export default function AdminSettings() {
  const { toast } = useToast();
  const [newService, setNewService] = useState("");

  const { data: settings, isLoading } = useQuery<ClinicSettings>({
    queryKey: ["/api/admin/settings"],
  });

  const form = useForm({
    defaultValues: {
      clinicName: settings?.clinicName || "",
      address: settings?.address || "",
      phone: settings?.phone || "",
      email: settings?.email || "",
      appointmentDuration: settings?.appointmentDuration || 30,
      openTime: settings?.openTime || "09:00",
      closeTime: settings?.closeTime || "17:00",
      welcomeMessage: settings?.welcomeMessage || "",
      workingDays: settings?.workingDays || [1, 2, 3, 4, 5],
      services: settings?.services || [],
    },
    values: settings ? {
      clinicName: settings.clinicName,
      address: settings.address || "",
      phone: settings.phone || "",
      email: settings.email || "",
      appointmentDuration: settings.appointmentDuration,
      openTime: settings.openTime,
      closeTime: settings.closeTime,
      welcomeMessage: settings.welcomeMessage || "",
      workingDays: settings.workingDays || [1, 2, 3, 4, 5],
      services: settings.services || [],
    } : undefined,
  });

  const updateMutation = useMutation({
    mutationFn: (data: Partial<ClinicSettings>) =>
      apiRequest("PATCH", "/api/admin/settings", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/settings"] });
      toast({ title: "Settings saved successfully" });
    },
    onError: () => {
      toast({ title: "Failed to save settings", variant: "destructive" });
    },
  });

  const handleAddService = () => {
    if (newService.trim()) {
      const currentServices = form.getValues("services") || [];
      form.setValue("services", [...currentServices, newService.trim()]);
      setNewService("");
    }
  };

  const handleRemoveService = (index: number) => {
    const currentServices = form.getValues("services") || [];
    form.setValue(
      "services",
      currentServices.filter((_, i) => i !== index)
    );
  };

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold">Settings</h1>
          <p className="text-muted-foreground">Configure your clinic</p>
        </div>
        <div className="grid gap-6 lg:grid-cols-2">
          {[1, 2, 3, 4].map((i) => (
            <Card key={i}>
              <CardHeader>
                <Skeleton className="h-5 w-32" />
                <Skeleton className="h-4 w-48" />
              </CardHeader>
              <CardContent>
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
        <h1 className="text-2xl font-bold">Settings</h1>
        <p className="text-muted-foreground">Configure your clinic</p>
      </div>

      <Form {...form}>
        <form onSubmit={form.handleSubmit((data) => updateMutation.mutate(data))} className="space-y-6">
          <div className="grid gap-6 lg:grid-cols-2">
            {/* Clinic Info */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Building2 className="h-5 w-5" />
                  Clinic Information
                </CardTitle>
                <CardDescription>Basic information about your clinic</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <FormField
                  control={form.control}
                  name="clinicName"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Clinic Name</FormLabel>
                      <FormControl>
                        <Input placeholder="Your Dental Clinic" {...field} data-testid="input-clinic-name" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="address"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Address</FormLabel>
                      <FormControl>
                        <Input placeholder="123 Main St, City" {...field} data-testid="input-clinic-address" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <div className="grid grid-cols-2 gap-4">
                  <FormField
                    control={form.control}
                    name="phone"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Phone</FormLabel>
                        <FormControl>
                          <Input placeholder="+31 20 123 4567" {...field} data-testid="input-clinic-phone" />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="email"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Email</FormLabel>
                        <FormControl>
                          <Input type="email" placeholder="info@clinic.com" {...field} data-testid="input-clinic-email" />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
              </CardContent>
            </Card>

            {/* Working Hours */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Clock className="h-5 w-5" />
                  Working Hours
                </CardTitle>
                <CardDescription>Set your clinic's operating hours</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <FormField
                    control={form.control}
                    name="openTime"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Opening Time</FormLabel>
                        <FormControl>
                          <Input type="time" {...field} data-testid="input-open-time" />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="closeTime"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Closing Time</FormLabel>
                        <FormControl>
                          <Input type="time" {...field} data-testid="input-close-time" />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
                <FormField
                  control={form.control}
                  name="appointmentDuration"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Appointment Duration (minutes)</FormLabel>
                      <FormControl>
                        <Input
                          type="number"
                          min="15"
                          max="120"
                          step="15"
                          {...field}
                          onChange={(e) => field.onChange(parseInt(e.target.value))}
                          data-testid="input-appointment-duration"
                        />
                      </FormControl>
                      <FormDescription>Default duration for appointments</FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </CardContent>
            </Card>

            {/* Working Days */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Calendar className="h-5 w-5" />
                  Working Days
                </CardTitle>
                <CardDescription>Select days when your clinic is open</CardDescription>
              </CardHeader>
              <CardContent>
                <FormField
                  control={form.control}
                  name="workingDays"
                  render={({ field }) => (
                    <FormItem>
                      <div className="grid grid-cols-2 gap-3">
                        {DAYS_OF_WEEK.map((day) => (
                          <div key={day.id} className="flex items-center space-x-2">
                            <Checkbox
                              id={`day-${day.id}`}
                              checked={field.value?.includes(day.id)}
                              onCheckedChange={(checked) => {
                                const current = field.value || [];
                                if (checked) {
                                  field.onChange([...current, day.id].sort());
                                } else {
                                  field.onChange(current.filter((d) => d !== day.id));
                                }
                              }}
                              data-testid={`checkbox-day-${day.id}`}
                            />
                            <label
                              htmlFor={`day-${day.id}`}
                              className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
                            >
                              {day.label}
                            </label>
                          </div>
                        ))}
                      </div>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </CardContent>
            </Card>

            {/* Chat Widget */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <MessageSquare className="h-5 w-5" />
                  Chat Widget
                </CardTitle>
                <CardDescription>Customize the AI chat experience</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <FormField
                  control={form.control}
                  name="welcomeMessage"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Welcome Message</FormLabel>
                      <FormControl>
                        <Textarea
                          placeholder="Welcome to our clinic! How can I help you today?"
                          className="resize-none"
                          rows={3}
                          {...field}
                          data-testid="input-welcome-message"
                        />
                      </FormControl>
                      <FormDescription>First message patients see when opening the chat</FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </CardContent>
            </Card>
          </div>

          {/* Services */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Settings className="h-5 w-5" />
                Services
              </CardTitle>
              <CardDescription>Services your clinic offers</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <FormField
                control={form.control}
                name="services"
                render={({ field }) => (
                  <FormItem>
                    <div className="flex flex-wrap gap-2 mb-4">
                      {field.value?.map((service, index) => (
                        <div
                          key={index}
                          className="flex items-center gap-1 px-3 py-1 bg-secondary rounded-full text-sm"
                        >
                          {service}
                          <button
                            type="button"
                            onClick={() => handleRemoveService(index)}
                            className="ml-1 text-muted-foreground hover:text-foreground"
                            data-testid={`button-remove-service-${index}`}
                          >
                            <X className="h-3 w-3" />
                          </button>
                        </div>
                      ))}
                    </div>
                    <div className="flex gap-2">
                      <Input
                        placeholder="Add a service..."
                        value={newService}
                        onChange={(e) => setNewService(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.preventDefault();
                            handleAddService();
                          }
                        }}
                        data-testid="input-new-service"
                      />
                      <Button type="button" variant="outline" onClick={handleAddService} data-testid="button-add-service">
                        <Plus className="h-4 w-4" />
                      </Button>
                    </div>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </CardContent>
          </Card>

          <div className="flex justify-end">
            <Button type="submit" disabled={updateMutation.isPending} data-testid="button-save-settings">
              {updateMutation.isPending ? "Saving..." : "Save Settings"}
            </Button>
          </div>
        </form>
      </Form>
    </div>
  );
}
