import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Settings, Building2, Clock, Calendar, MessageSquare, Plus, X, Bell, Globe, Palette } from "lucide-react";
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

  const COMMON_TIMEZONES = [
    { value: "Europe/Amsterdam", label: "Europe/Amsterdam (CET/CEST)" },
    { value: "Europe/London", label: "Europe/London (GMT/BST)" },
    { value: "Europe/Berlin", label: "Europe/Berlin (CET/CEST)" },
    { value: "Europe/Paris", label: "Europe/Paris (CET/CEST)" },
    { value: "Europe/Brussels", label: "Europe/Brussels (CET/CEST)" },
    { value: "Europe/Madrid", label: "Europe/Madrid (CET/CEST)" },
    { value: "Europe/Rome", label: "Europe/Rome (CET/CEST)" },
    { value: "Europe/Zurich", label: "Europe/Zurich (CET/CEST)" },
    { value: "Europe/Vienna", label: "Europe/Vienna (CET/CEST)" },
    { value: "Europe/Istanbul", label: "Europe/Istanbul (TRT)" },
    { value: "Europe/Moscow", label: "Europe/Moscow (MSK)" },
    { value: "Asia/Dubai", label: "Asia/Dubai (GST)" },
    { value: "Asia/Kolkata", label: "Asia/Kolkata (IST)" },
    { value: "Asia/Singapore", label: "Asia/Singapore (SGT)" },
    { value: "Asia/Tokyo", label: "Asia/Tokyo (JST)" },
    { value: "Australia/Sydney", label: "Australia/Sydney (AEST/AEDT)" },
    { value: "America/New_York", label: "America/New York (EST/EDT)" },
    { value: "America/Chicago", label: "America/Chicago (CST/CDT)" },
    { value: "America/Denver", label: "America/Denver (MST/MDT)" },
    { value: "America/Los_Angeles", label: "America/Los Angeles (PST/PDT)" },
    { value: "America/Toronto", label: "America/Toronto (EST/EDT)" },
    { value: "America/Sao_Paulo", label: "America/Sao Paulo (BRT)" },
  ];

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
      timezone: settings?.timezone || "Europe/Amsterdam",
      welcomeMessage: settings?.welcomeMessage || "",
      chatBotName: settings?.chatBotName || "Dental Assistant",
      chatWidgetColor: settings?.chatWidgetColor || "#0891b2",
      workingDays: settings?.workingDays || [1, 2, 3, 4, 5],
      services: settings?.services || [],
      reminderEnabled: settings?.reminderEnabled || false,
      reminderChannels: settings?.reminderChannels || ["email"],
      reminderOffsets: settings?.reminderOffsets || [1440, 60],
    },
    values: settings ? {
      clinicName: settings.clinicName,
      address: settings.address || "",
      phone: settings.phone || "",
      email: settings.email || "",
      appointmentDuration: settings.appointmentDuration,
      openTime: settings.openTime,
      closeTime: settings.closeTime,
      timezone: settings.timezone || "Europe/Amsterdam",
      welcomeMessage: settings.welcomeMessage || "",
      chatBotName: settings.chatBotName || "Dental Assistant",
      chatWidgetColor: settings.chatWidgetColor || "#0891b2",
      workingDays: settings.workingDays || [1, 2, 3, 4, 5],
      services: settings.services || [],
      reminderEnabled: settings.reminderEnabled ?? false,
      reminderChannels: settings.reminderChannels || ["email"],
      reminderOffsets: settings.reminderOffsets || [1440, 60],
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
                  name="timezone"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="flex items-center gap-2">
                        <Globe className="h-4 w-4" />
                        Clinic Timezone
                      </FormLabel>
                      <Select onValueChange={field.onChange} value={field.value}>
                        <FormControl>
                          <SelectTrigger data-testid="select-timezone">
                            <SelectValue placeholder="Select timezone" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {COMMON_TIMEZONES.map((tz) => (
                            <SelectItem key={tz.value} value={tz.value} data-testid={`timezone-${tz.value}`}>
                              {tz.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormDescription>All appointments and schedules use this timezone</FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
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
                <FormField
                  control={form.control}
                  name="chatBotName"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Bot Name</FormLabel>
                      <FormControl>
                        <Input placeholder="Dental Assistant" {...field} data-testid="input-chat-bot-name" />
                      </FormControl>
                      <FormDescription>Name shown in the chat widget header</FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="chatWidgetColor"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="flex items-center gap-2">
                        <Palette className="h-4 w-4" />
                        Widget Color
                      </FormLabel>
                      <div className="flex items-center gap-3">
                        <FormControl>
                          <input
                            type="color"
                            value={field.value}
                            onChange={field.onChange}
                            className="w-10 h-10 rounded-md border cursor-pointer p-0.5"
                            data-testid="input-chat-widget-color"
                          />
                        </FormControl>
                        <Input
                          value={field.value}
                          onChange={field.onChange}
                          placeholder="#0891b2"
                          className="w-28 font-mono text-sm"
                          data-testid="input-chat-widget-color-hex"
                        />
                        <div
                          className="flex-1 h-10 rounded-md border"
                          style={{ backgroundColor: field.value }}
                        />
                      </div>
                      <FormDescription>Theme color for the chat button, header, and message bubbles</FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </CardContent>
            </Card>
          </div>

          {/* Appointment Reminders */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Bell className="h-5 w-5" />
                Appointment Reminders
              </CardTitle>
              <CardDescription>Automatically remind patients before their appointments</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <FormField
                control={form.control}
                name="reminderEnabled"
                render={({ field }) => (
                  <FormItem className="flex items-center justify-between gap-4">
                    <div>
                      <FormLabel>Enable Reminders</FormLabel>
                      <FormDescription>Send automatic appointment reminders to patients</FormDescription>
                    </div>
                    <FormControl>
                      <Switch
                        checked={field.value}
                        onCheckedChange={field.onChange}
                        data-testid="switch-reminder-enabled"
                      />
                    </FormControl>
                  </FormItem>
                )}
              />

              {form.watch("reminderEnabled") && (
                <>
                  <FormField
                    control={form.control}
                    name="reminderChannels"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Reminder Channels</FormLabel>
                        <div className="flex flex-col gap-2">
                          <div className="flex items-center space-x-2">
                            <Checkbox
                              id="channel-email"
                              checked={field.value?.includes("email")}
                              onCheckedChange={(checked) => {
                                const current = field.value || [];
                                if (checked) {
                                  field.onChange([...current, "email"]);
                                } else {
                                  field.onChange(current.filter((c: string) => c !== "email"));
                                }
                              }}
                              data-testid="checkbox-channel-email"
                            />
                            <label htmlFor="channel-email" className="text-sm">Email</label>
                          </div>
                          <div className="flex items-center space-x-2">
                            <Checkbox
                              id="channel-whatsapp"
                              checked={field.value?.includes("whatsapp")}
                              onCheckedChange={(checked) => {
                                const current = field.value || [];
                                if (checked) {
                                  field.onChange([...current, "whatsapp"]);
                                } else {
                                  field.onChange(current.filter((c: string) => c !== "whatsapp"));
                                }
                              }}
                              data-testid="checkbox-channel-whatsapp"
                            />
                            <label htmlFor="channel-whatsapp" className="text-sm">WhatsApp</label>
                          </div>
                        </div>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="reminderOffsets"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Reminder Timing</FormLabel>
                        <FormDescription>Select when to send reminders before each appointment</FormDescription>
                        <div className="flex flex-col gap-2">
                          {[
                            { value: 2880, label: "2 days before" },
                            { value: 1440, label: "1 day before" },
                            { value: 120, label: "2 hours before" },
                            { value: 60, label: "1 hour before" },
                            { value: 30, label: "30 minutes before" },
                          ].map((option) => (
                            <div key={option.value} className="flex items-center space-x-2">
                              <Checkbox
                                id={`offset-${option.value}`}
                                checked={field.value?.includes(option.value)}
                                onCheckedChange={(checked) => {
                                  const current = field.value || [];
                                  if (checked) {
                                    field.onChange([...current, option.value].sort((a, b) => b - a));
                                  } else {
                                    field.onChange(current.filter((v: number) => v !== option.value));
                                  }
                                }}
                                data-testid={`checkbox-offset-${option.value}`}
                              />
                              <label htmlFor={`offset-${option.value}`} className="text-sm">{option.label}</label>
                            </div>
                          ))}
                        </div>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </>
              )}
            </CardContent>
          </Card>

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
