"use client";

import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "@/src/lib/api-client";
import type { AlayaPaginatedResponse } from "@/src/lib/alayacare-client";

export interface Employee {
  id: number;
  external_id: string | null;
  username: string;
  designation: string | null;
  job_title: string | null;
  status: string;
  latitude: number | null;
  longitude: number | null;
  demographics: {
    first_name: string;
    last_name: string;
    email: string;
    phone: string | null;
    address: string | null;
    city: string | null;
    state: string | null;
    zip: string | null;
    country: string | null;
    date_of_birth: string | null;
    gender: string | null;
  };
  created_at: string;
  updated_at: string;
}

export interface EmployeeSkill {
  employee_id: number;
  skill_id: number;
  comment: string | null;
  acquired_date: string | null;
  expired_date: string | null;
  created_at: string;
}

export function useEmployees(search?: string, status?: string) {
  const params = new URLSearchParams();
  if (search) params.set("filter", search);
  if (status) params.set("status", status);
  const qs = params.toString();

  return useQuery<AlayaPaginatedResponse<Employee>>({
    queryKey: ["employees", search, status],
    queryFn: async () => {
      const res = await apiFetch(`/api/employees${qs ? `?${qs}` : ""}`);
      if (!res.ok) throw new Error("Failed to fetch employees");
      return res.json();
    },
  });
}

export function useEmployeeSkills(employeeId: number | null) {
  return useQuery<AlayaPaginatedResponse<EmployeeSkill>>({
    queryKey: ["employee-skills", employeeId],
    queryFn: async () => {
      const res = await apiFetch(`/api/employees/${employeeId}/skills`);
      if (!res.ok) throw new Error("Failed to fetch employee skills");
      return res.json();
    },
    enabled: employeeId !== null,
  });
}
