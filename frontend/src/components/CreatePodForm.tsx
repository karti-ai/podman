import { useState } from 'react';
import { PlusIcon } from 'lucide-react';
import type { PodInput } from '@podman/shared';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Field, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

export function CreatePodForm({
  busy,
  onCreate,
  compact = false,
}: {
  busy: boolean;
  onCreate: (input: PodInput) => Promise<void>;
  compact?: boolean;
}) {
  const [open, setOpen] = useState(compact);
  const [name, setName] = useState('');
  const [repo, setRepo] = useState('karti-ai/podman');
  const [description, setDescription] = useState('');
  const [firstMember, setFirstMember] = useState('');

  async function submit() {
    if (!name.trim()) return;
    try {
      await onCreate({
        name: name.trim(),
        repo: repo.trim(),
        description: description.trim(),
        members: firstMember.trim() ? [firstMember.trim()] : [],
      });
      setName('');
      setDescription('');
      setFirstMember('');
      if (!compact) setOpen(false);
    } catch {
      /* parent owns the visible error */
    }
  }

  if (!open) {
    return (
      <button
        className="group flex min-h-64 flex-col items-center justify-center gap-3 rounded-lg border border-dashed bg-card p-6 text-center shadow-sm transition hover:bg-muted/30 hover:ring-1 hover:ring-black/10"
        onClick={() => setOpen(true)}
      >
        <span className="grid size-9 place-items-center rounded-md bg-muted transition group-hover:bg-background">
          <PlusIcon className="size-4 text-muted-foreground" />
        </span>
        <span className="text-sm font-medium">New pod</span>
        <span className="max-w-56 text-sm text-muted-foreground">
          Add a focused room for one repo or feature stream.
        </span>
      </button>
    );
  }

  return (
    <Card className={cn(compact && 'w-full border-0 shadow-none ring-0')}>
      <CardHeader>
        <CardTitle>New pod</CardTitle>
        <CardDescription>Create a focused room.</CardDescription>
      </CardHeader>
      <CardContent>
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="pod-name">Name</FieldLabel>
            <Input
              id="pod-name"
              placeholder="Payments"
              value={name}
              autoFocus
              onChange={(e) => setName(e.target.value)}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="pod-repo">Repository</FieldLabel>
            <Input
              id="pod-repo"
              placeholder="owner/repo"
              value={repo}
              onChange={(e) => setRepo(e.target.value)}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="pod-description">Summary</FieldLabel>
            <Input
              id="pod-description"
              placeholder="Optional"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="pod-member">First member</FieldLabel>
            <Input
              id="pod-member"
              placeholder="Optional"
              value={firstMember}
              onChange={(e) => setFirstMember(e.target.value)}
            />
          </Field>
        </FieldGroup>
      </CardContent>
      <CardFooter className="justify-end gap-2">
        {!compact && (
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
        )}
        <Button className="min-w-20" onClick={submit} disabled={busy || !name.trim()}>
          Create
        </Button>
      </CardFooter>
    </Card>
  );
}
