import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { Plus, UserCheck, UserX, Pencil, Trash2 } from "lucide-react";
import { useForm } from "react-hook-form";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import type { Doctor, InsertDoctor } from "@shared/schema";

export default function AdminDoctors() {
  const [isOpen, setIsOpen] = useState(false);
  const [editingDoctor, setEditingDoctor] = useState<Doctor | null>(null);
  const { toast } = useToast();

  const { data: doctors, isLoading } = useQuery<Doctor[]>({
    queryKey: ["/api/admin/doctors"],
  });

  const form = useForm<InsertDoctor>({
    defaultValues: {
      name: "",
      email: "",
      phone: "",
      specialty: "",
      bio: "",
      userId: "",
      isActive: true,
    },
  });

  const createMutation = useMutation({
    mutationFn: (data: InsertDoctor) => apiRequest("POST", "/api/admin/doctors", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/doctors"] });
      toast({ title: "Doctor added successfully" });
      setIsOpen(false);
      form.reset();
    },
    onError: () => {
      toast({ title: "Failed to add doctor", variant: "destructive" });
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: Partial<InsertDoctor> }) =>
      apiRequest("PATCH", `/api/admin/doctors/${id}`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/doctors"] });
      toast({ title: "Doctor updated successfully" });
      setIsOpen(false);
      setEditingDoctor(null);
      form.reset();
    },
    onError: () => {
      toast({ title: "Failed to update doctor", variant: "destructive" });
    },
  });

  const toggleActiveMutation = useMutation({
    mutationFn: ({ id, isActive }: { id: number; isActive: boolean }) =>
      apiRequest("PATCH", `/api/admin/doctors/${id}`, { isActive }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/doctors"] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/admin/doctors/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/doctors"] });
      toast({ title: "Doctor removed successfully" });
    },
    onError: () => {
      toast({ title: "Failed to remove doctor", variant: "destructive" });
    },
  });

  const handleSubmit = (data: InsertDoctor) => {
    if (editingDoctor) {
      updateMutation.mutate({ id: editingDoctor.id, data });
    } else {
      createMutation.mutate(data);
    }
  };

  const handleEdit = (doctor: Doctor) => {
    setEditingDoctor(doctor);
    form.reset({
      name: doctor.name,
      email: doctor.email,
      phone: doctor.phone || "",
      specialty: doctor.specialty,
      bio: doctor.bio || "",
      userId: doctor.userId,
      isActive: doctor.isActive,
    });
    setIsOpen(true);
  };

  const handleClose = () => {
    setIsOpen(false);
    setEditingDoctor(null);
    form.reset();
  };

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="flex justify-between items-center">
          <div>
            <h1 className="text-2xl font-bold">Doctors</h1>
            <p className="text-muted-foreground">Manage your clinic's doctors</p>
          </div>
          <Skeleton className="h-10 w-32" />
        </div>
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {[1, 2, 3].map((i) => (
            <Card key={i}>
              <CardContent className="pt-6">
                <Skeleton className="h-16 w-16 rounded-full mb-4" />
                <Skeleton className="h-5 w-32 mb-2" />
                <Skeleton className="h-4 w-24" />
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
          <h1 className="text-2xl font-bold">Doctors</h1>
          <p className="text-muted-foreground">Manage your clinic's doctors</p>
        </div>
        <Dialog open={isOpen} onOpenChange={handleClose}>
          <DialogTrigger asChild>
            <Button onClick={() => setIsOpen(true)} data-testid="button-add-doctor">
              <Plus className="h-4 w-4 mr-2" />
              Add Doctor
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>{editingDoctor ? "Edit Doctor" : "Add New Doctor"}</DialogTitle>
            </DialogHeader>
            <Form {...form}>
              <form onSubmit={form.handleSubmit(handleSubmit)} className="space-y-4">
                <FormField
                  control={form.control}
                  name="name"
                  rules={{ required: "Name is required" }}
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Name</FormLabel>
                      <FormControl>
                        <Input placeholder="Dr. John Smith" {...field} data-testid="input-doctor-name" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="email"
                  rules={{ required: "Email is required" }}
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Email</FormLabel>
                      <FormControl>
                        <Input type="email" placeholder="doctor@clinic.com" {...field} data-testid="input-doctor-email" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="phone"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Phone</FormLabel>
                      <FormControl>
                        <Input placeholder="+31 6 1234 5678" {...field} data-testid="input-doctor-phone" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="specialty"
                  rules={{ required: "Specialty is required" }}
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Specialty</FormLabel>
                      <FormControl>
                        <Input placeholder="General Dentistry" {...field} data-testid="input-doctor-specialty" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="bio"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Bio</FormLabel>
                      <FormControl>
                        <Textarea placeholder="Brief description..." {...field} data-testid="input-doctor-bio" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <div className="flex justify-end gap-2 pt-4">
                  <Button type="button" variant="outline" onClick={handleClose} data-testid="button-cancel">
                    Cancel
                  </Button>
                  <Button 
                    type="submit" 
                    disabled={createMutation.isPending || updateMutation.isPending}
                    data-testid="button-save-doctor"
                  >
                    {createMutation.isPending || updateMutation.isPending ? "Saving..." : "Save"}
                  </Button>
                </div>
              </form>
            </Form>
          </DialogContent>
        </Dialog>
      </div>

      {doctors && doctors.length > 0 ? (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {doctors.map((doctor) => (
            <Card key={doctor.id} data-testid={`card-doctor-${doctor.id}`}>
              <CardContent className="pt-6">
                <div className="flex items-start justify-between mb-4">
                  <div className="flex items-center gap-3">
                    <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center">
                      <span className="text-lg font-semibold text-primary">
                        {doctor.name.split(" ").map((n) => n[0]).join("").slice(0, 2)}
                      </span>
                    </div>
                    <div>
                      <h3 className="font-semibold">{doctor.name}</h3>
                      <p className="text-sm text-muted-foreground">{doctor.specialty}</p>
                    </div>
                  </div>
                  <Badge variant={doctor.isActive ? "default" : "secondary"}>
                    {doctor.isActive ? "Active" : "Inactive"}
                  </Badge>
                </div>
                <div className="space-y-2 text-sm text-muted-foreground mb-4">
                  <p>{doctor.email}</p>
                  {doctor.phone && <p>{doctor.phone}</p>}
                </div>
                <div className="flex items-center justify-between pt-4 border-t">
                  <div className="flex items-center gap-2">
                    <Switch
                      checked={doctor.isActive}
                      onCheckedChange={(checked) =>
                        toggleActiveMutation.mutate({ id: doctor.id, isActive: checked })
                      }
                      data-testid={`switch-doctor-active-${doctor.id}`}
                    />
                    <span className="text-sm text-muted-foreground">
                      {doctor.isActive ? "Active" : "Inactive"}
                    </span>
                  </div>
                  <div className="flex gap-1">
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => handleEdit(doctor)}
                      data-testid={`button-edit-doctor-${doctor.id}`}
                    >
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => deleteMutation.mutate(doctor.id)}
                      data-testid={`button-delete-doctor-${doctor.id}`}
                    >
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : (
        <Card>
          <CardContent className="py-12 text-center">
            <UserCheck className="h-12 w-12 mx-auto mb-4 text-muted-foreground opacity-50" />
            <h3 className="font-semibold mb-2">No doctors yet</h3>
            <p className="text-muted-foreground mb-4">Add your first doctor to get started</p>
            <Button onClick={() => setIsOpen(true)} data-testid="button-add-first-doctor">
              <Plus className="h-4 w-4 mr-2" />
              Add Doctor
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
