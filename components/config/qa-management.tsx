"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import {
  Plus,
  Pencil,
  Trash2,
  ChevronDown,
  ChevronRight,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import {
  useDemoQa,
  useCreateQaPair,
  useUpdateQaPair,
  useDeleteQaPair,
  type QaPair,
} from "@/src/hooks/use-demo-qa";

const qaPairSchema = z.object({
  category: z
    .string()
    .min(1, "Category is required")
    .max(100)
    .regex(/^[a-z0-9_]+$/, "Use lowercase letters, numbers, and underscores"),
  label: z.string().min(1, "Label is required").max(200),
  answerText: z.string().min(1, "Answer text is required"),
  audioUrl: z.string().url("Must be a valid URL").or(z.literal("")).optional(),
  sortOrder: z.preprocess(
    (val) => (val === "" || val === undefined ? undefined : Number(val)),
    z.number().int().min(0).optional(),
  ),
});

type QaPairFormValues = z.infer<typeof qaPairSchema>;

function PatternsEditor({
  patterns,
  onChange,
}: {
  patterns: string[];
  onChange: (patterns: string[]) => void;
}) {
  const [newPattern, setNewPattern] = useState("");

  const addPattern = () => {
    const trimmed = newPattern.trim();
    if (trimmed && !patterns.includes(trimmed)) {
      onChange([...patterns, trimmed]);
      setNewPattern("");
    }
  };

  const removePattern = (index: number) => {
    onChange(patterns.filter((_, i) => i !== index));
  };

  return (
    <div className="space-y-2">
      <label className="text-sm font-medium">
        Question Patterns
      </label>
      <p className="text-xs text-muted-foreground">
        Example questions that should match this answer. The first pattern is the
        canonical one.
      </p>
      <div className="flex gap-2">
        <Input
          value={newPattern}
          onChange={(e) => setNewPattern(e.target.value)}
          placeholder="Add a question pattern..."
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              addPattern();
            }
          }}
        />
        <Button type="button" variant="outline" size="sm" onClick={addPattern}>
          <Plus className="h-4 w-4" />
        </Button>
      </div>
      {patterns.length === 0 && (
        <p className="text-xs text-destructive">
          At least one question pattern is required
        </p>
      )}
      <div className="space-y-1">
        {patterns.map((pattern, i) => (
          <div
            key={i}
            className="flex items-center gap-2 rounded-md border px-3 py-1.5 text-sm"
          >
            {i === 0 && (
              <Badge variant="secondary" className="text-xs shrink-0">
                canonical
              </Badge>
            )}
            <span className="flex-1 truncate">{pattern}</span>
            <button
              type="button"
              onClick={() => removePattern(i)}
              className="shrink-0 text-muted-foreground hover:text-destructive"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

function QaPairDialog({
  open,
  onOpenChange,
  editingPair,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editingPair: QaPair | null;
}) {
  const createMutation = useCreateQaPair();
  const updateMutation = useUpdateQaPair();
  const [patterns, setPatterns] = useState<string[]>(
    editingPair?.patterns.map((p) => p.pattern) ?? []
  );

  const form = useForm<QaPairFormValues>({
    resolver: zodResolver(qaPairSchema),
    defaultValues: editingPair
      ? {
          category: editingPair.category,
          label: editingPair.label,
          answerText: editingPair.answerText,
          audioUrl: editingPair.audioUrl ?? "",
          sortOrder: editingPair.sortOrder,
        }
      : {
          category: "",
          label: "",
          answerText: "",
          audioUrl: "",
          sortOrder: 0,
        },
  });

  const onSubmit = async (values: QaPairFormValues) => {
    if (patterns.length === 0) {
      toast.error("At least one question pattern is required");
      return;
    }

    try {
      const payload = {
        ...values,
        audioUrl: values.audioUrl || null,
        patterns,
      };

      if (editingPair) {
        await updateMutation.mutateAsync({ id: editingPair.id, data: payload });
        toast.success("QA pair updated");
      } else {
        await createMutation.mutateAsync(payload);
        toast.success("QA pair created");
      }
      onOpenChange(false);
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to save QA pair"
      );
    }
  };

  const isPending = createMutation.isPending || updateMutation.isPending;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {editingPair ? "Edit QA Pair" : "Add QA Pair"}
          </DialogTitle>
          <DialogDescription>
            {editingPair
              ? "Update the category response and question patterns."
              : "Create a new category response with question patterns."}
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="category"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Category</FormLabel>
                    <FormControl>
                      <Input
                        placeholder="e.g. fund_manager"
                        {...field}
                        disabled={!!editingPair}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="label"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Label</FormLabel>
                    <FormControl>
                      <Input placeholder="e.g. Fund Manager" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <FormField
              control={form.control}
              name="answerText"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Answer Text</FormLabel>
                  <FormControl>
                    <textarea
                      className="flex min-h-[120px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                      placeholder="The scripted answer text..."
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="grid grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="audioUrl"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Audio URL (optional)</FormLabel>
                    <FormControl>
                      <Input placeholder="https://..." {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="sortOrder"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Sort Order</FormLabel>
                    <FormControl>
                      <Input type="number" min={0} {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <PatternsEditor patterns={patterns} onChange={setPatterns} />

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={isPending}>
                {isPending
                  ? "Saving..."
                  : editingPair
                    ? "Update"
                    : "Create"}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

function QaPairRow({
  pair,
  onEdit,
  onDelete,
}: {
  pair: QaPair;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="border rounded-lg">
      <div
        className="flex items-center gap-3 p-4 cursor-pointer hover:bg-muted/50"
        onClick={() => setExpanded(!expanded)}
      >
        {expanded ? (
          <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
        ) : (
          <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
        )}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-medium">{pair.label}</span>
            <Badge variant="outline" className="text-xs font-mono">
              {pair.category}
            </Badge>
            <Badge variant="secondary" className="text-xs">
              {pair.patterns.length} pattern{pair.patterns.length !== 1 && "s"}
            </Badge>
          </div>
          <p className="text-sm text-muted-foreground truncate mt-0.5">
            {pair.answerText}
          </p>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <Button
            variant="ghost"
            size="sm"
            onClick={(e) => {
              e.stopPropagation();
              onEdit();
            }}
          >
            <Pencil className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={(e) => {
              e.stopPropagation();
              onDelete();
            }}
          >
            <Trash2 className="h-4 w-4 text-destructive" />
          </Button>
        </div>
      </div>

      {expanded && (
        <div className="px-4 pb-4 pt-0 space-y-3 border-t">
          <div>
            <p className="text-sm font-medium mb-1">Answer</p>
            <p className="text-sm text-muted-foreground whitespace-pre-wrap">
              {pair.answerText}
            </p>
          </div>
          {pair.audioUrl && (
            <div>
              <p className="text-sm font-medium mb-1">Audio URL</p>
              <p className="text-sm text-muted-foreground break-all">
                {pair.audioUrl}
              </p>
            </div>
          )}
          <div>
            <p className="text-sm font-medium mb-1">Question Patterns</p>
            <ul className="space-y-1">
              {pair.patterns.map((p) => (
                <li key={p.id} className="text-sm text-muted-foreground flex items-center gap-2">
                  <span className="text-muted-foreground">-</span>
                  {p.pattern}
                  {p.isCanonical === 1 && (
                    <Badge variant="secondary" className="text-xs">
                      canonical
                    </Badge>
                  )}
                </li>
              ))}
            </ul>
          </div>
          <div className="text-xs text-muted-foreground">
            Sort order: {pair.sortOrder}
          </div>
        </div>
      )}
    </div>
  );
}

export function QaManagement() {
  const { data: qaPairs, isLoading } = useDemoQa();
  const deleteMutation = useDeleteQaPair();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingPair, setEditingPair] = useState<QaPair | null>(null);
  const [deletingPair, setDeletingPair] = useState<QaPair | null>(null);

  const handleEdit = (pair: QaPair) => {
    setEditingPair(pair);
    setDialogOpen(true);
  };

  const handleAdd = () => {
    setEditingPair(null);
    setDialogOpen(true);
  };

  const handleDelete = async () => {
    if (!deletingPair) return;
    try {
      await deleteMutation.mutateAsync(deletingPair.id);
      toast.success("QA pair deleted");
      setDeletingPair(null);
    } catch {
      toast.error("Failed to delete QA pair");
    }
  };

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <Skeleton className="h-6 w-48" />
          <Skeleton className="h-4 w-72" />
        </CardHeader>
        <CardContent className="space-y-3">
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-16 w-full" />
        </CardContent>
      </Card>
    );
  }

  return (
    <>
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>Question & Answer Pairs</CardTitle>
              <CardDescription>
                Manage demo response categories and their question patterns
              </CardDescription>
            </div>
            <Button onClick={handleAdd} size="sm">
              <Plus className="h-4 w-4 mr-1" />
              Add QA Pair
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {!qaPairs || qaPairs.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <p>No QA pairs configured yet.</p>
              <p className="text-sm mt-1">
                Add your first question and answer pair to get started.
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {qaPairs.map((pair) => (
                <QaPairRow
                  key={pair.id}
                  pair={pair}
                  onEdit={() => handleEdit(pair)}
                  onDelete={() => setDeletingPair(pair)}
                />
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {dialogOpen && (
        <QaPairDialog
          key={editingPair?.id ?? "new"}
          open={dialogOpen}
          onOpenChange={setDialogOpen}
          editingPair={editingPair}
        />
      )}

      <AlertDialog
        open={!!deletingPair}
        onOpenChange={(open) => !open && setDeletingPair(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete QA Pair</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete &quot;{deletingPair?.label}&quot;?
              This will also remove all associated question patterns. This action
              cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleteMutation.isPending ? "Deleting..." : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
