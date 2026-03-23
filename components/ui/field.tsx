"use client"

import * as React from "react"
import { cn } from "@/src/lib/utils"

function FieldGroup({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return <div className={cn("space-y-2", className)} {...props} />
}

function Field({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return <div className={cn("space-y-1.5", className)} {...props} />
}

function FieldLabel({
  className,
  ...props
}: React.ComponentProps<"label">) {
  return (
    <label
      className={cn(
        "text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70",
        className
      )}
      {...props}
    />
  )
}

function FieldError({
  className,
  ...props
}: React.ComponentProps<"p">) {
  return (
    <p
      className={cn("text-[0.8rem] font-medium text-destructive", className)}
      {...props}
    />
  )
}

export { FieldGroup, Field, FieldLabel, FieldError }
