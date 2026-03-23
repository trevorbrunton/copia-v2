"use client";

import { useState } from "react";
import { useDebouncedValue } from "@/src/hooks/use-debounce";
import { MapPin, Mail, Phone, Heart } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  useAlayaClients,
  type AlayaClient,
} from "@/src/hooks/use-alaya-clients";

function ClientCard({ client }: { client: AlayaClient }) {
  const name = `${client.first_name} ${client.last_name}`;

  return (
    <Card>
      <CardContent className="p-4 space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <p className="font-medium">{name}</p>
            <p className="text-xs text-muted-foreground">Client #{client.id}</p>
          </div>
          <Badge
            variant={client.status === "active" ? "default" : "secondary"}
          >
            {client.status}
          </Badge>
        </div>

        <div className="space-y-1.5 text-sm">
          {client.email && (
            <div className="flex items-center gap-2">
              <Mail className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="truncate">{client.email}</span>
            </div>
          )}
          {client.phone_main && (
            <div className="flex items-center gap-2">
              <Phone className="h-3.5 w-3.5 text-muted-foreground" />
              <span>{client.phone_main}</span>
            </div>
          )}
          {client.city && (
            <div className="flex items-center gap-2">
              <MapPin className="h-3.5 w-3.5 text-muted-foreground" />
              <span>
                {client.city}
                {client.state ? `, ${client.state}` : ""}
              </span>
            </div>
          )}
          {client.care_needs && (
            <div className="flex items-center gap-2">
              <Heart className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="line-clamp-1">{client.care_needs}</span>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

export default function ClientsPage() {
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebouncedValue(search, 300);
  const { data, isLoading, error } = useAlayaClients(debouncedSearch || undefined);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Clients</h1>
        <p className="text-muted-foreground mt-1">
          Care recipients from AlayaCare.
        </p>
      </div>

      <div className="flex items-center gap-3">
        <Input
          placeholder="Search by name..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="max-w-sm"
        />
        {data && (
          <span className="text-sm text-muted-foreground">
            {data.count} client{data.count !== 1 ? "s" : ""}
          </span>
        )}
      </div>

      {isLoading && (
        <p className="text-muted-foreground">Loading clients...</p>
      )}
      {error && (
        <p className="text-destructive">
          Failed to load clients. Please try again later.
        </p>
      )}

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {data?.items.map((client) => (
          <ClientCard key={client.id} client={client} />
        ))}
      </div>

      {data && data.items.length === 0 && (
        <p className="text-muted-foreground text-center py-8">
          No clients found.
        </p>
      )}
    </div>
  );
}
