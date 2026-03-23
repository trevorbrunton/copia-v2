"use client";

import { useState } from "react";
import { useDebouncedValue } from "@/src/hooks/use-debounce";
import { MapPin, Mail, Phone, Briefcase } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { useEmployees, type Employee } from "@/src/hooks/use-employees";

function EmployeeCard({ employee }: { employee: Employee }) {
  const { demographics } = employee;
  const name = `${demographics.first_name} ${demographics.last_name}`;

  return (
    <Card>
      <CardContent className="p-4 space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <p className="font-medium">{name}</p>
            <p className="text-xs text-muted-foreground">
              {employee.designation ?? employee.job_title ?? "Caregiver"}
            </p>
          </div>
          <Badge
            variant={employee.status === "active" ? "default" : "secondary"}
          >
            {employee.status}
          </Badge>
        </div>

        <div className="space-y-1.5 text-sm">
          {demographics.email && (
            <div className="flex items-center gap-2">
              <Mail className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="truncate">{demographics.email}</span>
            </div>
          )}
          {demographics.phone && (
            <div className="flex items-center gap-2">
              <Phone className="h-3.5 w-3.5 text-muted-foreground" />
              <span>{demographics.phone}</span>
            </div>
          )}
          {demographics.city && (
            <div className="flex items-center gap-2">
              <MapPin className="h-3.5 w-3.5 text-muted-foreground" />
              <span>
                {demographics.city}
                {demographics.state ? `, ${demographics.state}` : ""}
              </span>
            </div>
          )}
          {employee.job_title && employee.designation && (
            <div className="flex items-center gap-2">
              <Briefcase className="h-3.5 w-3.5 text-muted-foreground" />
              <span>{employee.job_title}</span>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

export default function EmployeesPage() {
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebouncedValue(search, 300);
  const { data, isLoading, error } = useEmployees(debouncedSearch || undefined);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Employees</h1>
        <p className="text-muted-foreground mt-1">
          Caregivers and staff from AlayaCare.
        </p>
      </div>

      <div className="flex items-center gap-3">
        <Input
          placeholder="Search by name or email..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="max-w-sm"
        />
        {data && (
          <span className="text-sm text-muted-foreground">
            {data.count} employee{data.count !== 1 ? "s" : ""}
          </span>
        )}
      </div>

      {isLoading && (
        <p className="text-muted-foreground">Loading employees...</p>
      )}
      {error && (
        <p className="text-destructive">
          Failed to load employees. Please try again later.
        </p>
      )}

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {data?.items.map((employee) => (
          <EmployeeCard key={employee.id} employee={employee} />
        ))}
      </div>

      {data && data.items.length === 0 && (
        <p className="text-muted-foreground text-center py-8">
          No employees found.
        </p>
      )}
    </div>
  );
}
