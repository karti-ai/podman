import { useState } from 'react';
import { MoreHorizontalIcon, PlusIcon, Trash2Icon, UserRoundIcon, VideoIcon } from 'lucide-react';
import type { Pod, PodInput } from '@podman/shared';
import { Avatar, AvatarBadge, AvatarFallback, AvatarGroup } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Field, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Separator } from '@/components/ui/separator';

export function PodCard({
  pod,
  busy,
  presence,
  onJoin,
  onAddAndJoin,
  onAddMember,
  onRemoveMember: _onRemoveMember,
  onUpdate,
  onDelete,
}: {
  pod: Pod;
  busy: boolean;
  presence: string[];
  onJoin: (pod: Pod, member: string) => void;
  onAddAndJoin: (pod: Pod, name: string) => void;
  onAddMember: (id: string, name: string) => void;
  onRemoveMember: (id: string, name: string) => void;
  onUpdate: (id: string, patch: PodInput) => void;
  onDelete: (id: string) => void;
}) {
  const [newMember, setNewMember] = useState('');
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<PodInput>({
    name: pod.name,
    repo: pod.repo,
    description: pod.description ?? '',
  });

  const inRoom = (name: string) => presence.some((p) => p.toLowerCase() === name.toLowerCase());
  const active = presence.length > 0;
  const primaryMember = pod.members[0] ?? '';

  function saveEdit() {
    onUpdate(pod.id, {
      name: draft.name?.trim(),
      repo: draft.repo?.trim(),
      description: draft.description?.trim(),
    });
    setEditing(false);
  }

  function submitMember(join: boolean) {
    const name = newMember.trim();
    if (!name) return;
    if (join) onAddAndJoin(pod, name);
    else onAddMember(pod.id, name);
    setNewMember('');
  }

  return (
    <>
      <Card className="min-h-64 transition duration-200 hover:-translate-y-0.5 hover:shadow-[0_2px_6px_rgba(0,0,0,0.06),0_28px_70px_rgba(0,0,0,0.06)] hover:ring-black/15">
        <CardHeader>
          <CardTitle className="truncate text-[1.05rem]">{pod.name}</CardTitle>
          <CardDescription className="truncate font-mono text-xs">
            {pod.repo || 'No repository set'}
          </CardDescription>
          <CardAction>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon-sm">
                  <MoreHorizontalIcon />
                  <span className="sr-only">Pod actions</span>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuGroup>
                  <DropdownMenuItem onSelect={() => setEditing(true)}>Edit pod</DropdownMenuItem>
                  <DropdownMenuItem
                    variant="destructive"
                    onSelect={() => onDelete(pod.id)}
                    disabled={busy}
                  >
                    <Trash2Icon />
                    Delete
                  </DropdownMenuItem>
                </DropdownMenuGroup>
              </DropdownMenuContent>
            </DropdownMenu>
          </CardAction>
        </CardHeader>

        <CardContent>
          <div className="flex flex-col gap-5">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <p className="line-clamp-2 min-h-10 text-sm text-muted-foreground">
                  {pod.description || 'Focused workspace for live engineering coordination.'}
                </p>
              </div>
              <Badge variant={active ? 'default' : 'secondary'} className="rounded-md">
                {active ? `${presence.length} live` : 'quiet'}
              </Badge>
            </div>

            <Separator />

            <div className="flex items-center justify-between gap-4">
              <AvatarGroup>
                {pod.members.slice(0, 4).map((member) => (
                  <Avatar key={member} title={member}>
                    <AvatarFallback>{initials(member)}</AvatarFallback>
                    {inRoom(member) && <AvatarBadge />}
                  </Avatar>
                ))}
                {pod.members.length > 4 && <span className="text-sm text-muted-foreground">+</span>}
              </AvatarGroup>
              <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
                <UserRoundIcon className="size-4" />
                {pod.members.length}
              </div>
            </div>

            <div className="flex gap-2">
              <Input
                placeholder="Your name"
                value={newMember}
                onChange={(e) => setNewMember(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') submitMember(true);
                }}
              />
              <Button
                variant="outline"
                size="icon"
                onClick={() => submitMember(false)}
                disabled={busy || !newMember.trim()}
              >
                <PlusIcon />
                <span className="sr-only">Add member</span>
              </Button>
            </div>
          </div>
        </CardContent>

        <CardFooter className="justify-between gap-2">
          <Button
            variant="outline"
            onClick={() => primaryMember && onJoin(pod, primaryMember)}
            disabled={busy || !primaryMember}
          >
            <VideoIcon data-icon="inline-start" />
            Join
          </Button>
          <Button
            className="min-w-28"
            onClick={() => submitMember(true)}
            disabled={busy || !newMember.trim()}
          >
            Add and join
          </Button>
        </CardFooter>
      </Card>

      <Dialog open={editing} onOpenChange={setEditing}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit pod</DialogTitle>
            <DialogDescription>
              Refine only what people need to recognize this room.
            </DialogDescription>
          </DialogHeader>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor={`${pod.id}-name`}>Name</FieldLabel>
              <Input
                id={`${pod.id}-name`}
                value={draft.name ?? ''}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor={`${pod.id}-repo`}>Repository</FieldLabel>
              <Input
                id={`${pod.id}-repo`}
                value={draft.repo ?? ''}
                onChange={(e) => setDraft({ ...draft, repo: e.target.value })}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor={`${pod.id}-description`}>Summary</FieldLabel>
              <Input
                id={`${pod.id}-description`}
                value={draft.description ?? ''}
                onChange={(e) => setDraft({ ...draft, description: e.target.value })}
              />
            </Field>
          </FieldGroup>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(false)}>
              Cancel
            </Button>
            <Button onClick={saveEdit} disabled={busy}>
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .map((w) => w[0] ?? '')
    .join('')
    .slice(0, 2)
    .toUpperCase();
}
