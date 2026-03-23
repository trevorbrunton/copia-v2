import { Monitor, Smartphone, Tablet } from "lucide-react";
import { cn } from "@/src/lib/utils";

export function DeviceIcon({
  type,
  className,
}: {
  type: string | null;
  className?: string;
}) {
  const classes = cn("h-4 w-4", className);
  if (type === "mobile") return <Smartphone className={classes} />;
  if (type === "tablet") return <Tablet className={classes} />;
  return <Monitor className={classes} />;
}
