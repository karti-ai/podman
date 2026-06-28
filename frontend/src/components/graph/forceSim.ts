/**
 * A tiny dependency-free force-directed layout — the same family of forces as
 * d3-force (charge repulsion, link springs, centering, collision) integrated
 * with velocity-Verlet and an annealing `alpha`. Kept in-house so the dynamic
 * graph adds no new package / lockfile churn to a fast-moving shared `main`.
 *
 * Usage: `setData()` (diff-preserving — existing nodes keep their position),
 * then drive `tick()` from a requestAnimationFrame loop until `settled()`.
 */

export interface SimNodeInput {
  id: string;
  /** Drawing/collision radius. */
  radius: number;
  /** Initial position hint (e.g. the server layout), used only for new nodes. */
  seedX: number;
  seedY: number;
}

export interface SimLinkInput {
  source: string;
  target: string;
  /** Preferred rest length of the spring. */
  distance: number;
  /** 0..1 spring strength. */
  strength: number;
}

export interface SimNode {
  id: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** When non-null the node is pinned (dragged) and forces don't move it. */
  fx: number | null;
  fy: number | null;
  radius: number;
}

const ALPHA_MIN = 0.001;
const ALPHA_DECAY = 1 - Math.pow(ALPHA_MIN, 1 / 300); // settle in ~300 ticks
const FRICTION = 0.62; // velocity retained per tick
const REPEL = 4400; // charge repulsion strength — must dominate centering or the graph collapses
const LINK_K = 0.45; // spring stiffness multiplier
const CENTER_STRENGTH = 0.014; // gentle positional pull — only keeps the cloud roughly centered
const RECENTER = 0.5; // per-tick centroid recentering (no compression, keeps graph framed)
const COLLIDE_PAD = 12;
const COLLIDE_STRENGTH = 1; // hard separation so linked nodes never stack
const COLLIDE_ITERS = 2;
const BOUND_PAD = 30; // keep nodes this far inside the canvas edges

export class ForceSim {
  nodes: SimNode[] = [];
  links: SimLinkInput[] = [];
  alpha = 1;
  private byId = new Map<string, SimNode>();
  private alphaTarget = 0;
  private center: { x: number; y: number };
  private width: number;
  private height: number;

  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
    this.center = { x: width / 2, y: height / 2 };
  }

  settled(): boolean {
    return this.alpha < ALPHA_MIN && this.alphaTarget === 0;
  }

  reheat(a = 0.7): void {
    this.alpha = Math.max(this.alpha, a);
  }

  /** Hold the simulation warm while dragging, then release. */
  setActive(active: boolean): void {
    this.alphaTarget = active ? 0.18 : 0;
    if (active) this.reheat(0.25);
  }

  get(id: string): SimNode | undefined {
    return this.byId.get(id);
  }

  pin(id: string, x: number, y: number): void {
    const n = this.byId.get(id);
    if (n) {
      n.fx = x;
      n.fy = y;
    }
  }

  unpin(id: string): void {
    const n = this.byId.get(id);
    if (n) {
      n.fx = null;
      n.fy = null;
    }
  }

  /** Replace the graph, preserving the positions/pins of nodes that persist. */
  setData(nodeInputs: SimNodeInput[], linkInputs: SimLinkInput[]): { added: string[] } {
    const prev = this.byId;
    const next = new Map<string, SimNode>();
    const added: string[] = [];
    for (const inp of nodeInputs) {
      const old = prev.get(inp.id);
      if (old) {
        old.radius = inp.radius;
        next.set(inp.id, old);
      } else {
        next.set(inp.id, {
          id: inp.id,
          x: inp.seedX + (Math.random() - 0.5) * 14,
          y: inp.seedY + (Math.random() - 0.5) * 14,
          vx: 0,
          vy: 0,
          fx: null,
          fy: null,
          radius: inp.radius,
        });
        added.push(inp.id);
      }
    }
    this.byId = next;
    this.nodes = [...next.values()];
    this.links = linkInputs.filter((l) => next.has(l.source) && next.has(l.target));
    return { added };
  }

  /** Advance one step. Returns false when already settled (no work done). */
  tick(): boolean {
    if (this.settled()) return false;
    this.alpha += (this.alphaTarget - this.alpha) * ALPHA_DECAY;
    const a = this.alpha;
    this.applyCharge(a);
    this.applyLinks(a);
    this.applyCenter(a);
    for (let k = 0; k < COLLIDE_ITERS; k++) this.applyCollide();
    const maxX = this.width - BOUND_PAD;
    const maxY = this.height - BOUND_PAD;
    for (const n of this.nodes) {
      if (n.fx != null) {
        n.x = n.fx;
        n.vx = 0;
      } else {
        n.vx *= FRICTION;
        n.x += n.vx;
        if (n.x < BOUND_PAD) {
          n.x = BOUND_PAD;
          n.vx = 0;
        } else if (n.x > maxX) {
          n.x = maxX;
          n.vx = 0;
        }
      }
      if (n.fy != null) {
        n.y = n.fy;
        n.vy = 0;
      } else {
        n.vy *= FRICTION;
        n.y += n.vy;
        if (n.y < BOUND_PAD) {
          n.y = BOUND_PAD;
          n.vy = 0;
        } else if (n.y > maxY) {
          n.y = maxY;
          n.vy = 0;
        }
      }
    }
    return true;
  }

  private applyCharge(alpha: number): void {
    const ns = this.nodes;
    for (let i = 0; i < ns.length; i++) {
      const a = ns[i];
      if (!a) continue;
      for (let j = i + 1; j < ns.length; j++) {
        const b = ns[j];
        if (!b) continue;
        let dx = b.x - a.x;
        let dy = b.y - a.y;
        let d2 = dx * dx + dy * dy;
        if (d2 === 0) {
          dx = (j - i) * 0.5;
          dy = (i + 1) * 0.4;
          d2 = dx * dx + dy * dy;
        }
        const dist = Math.sqrt(d2);
        const force = (REPEL * alpha) / d2;
        const ux = dx / dist;
        const uy = dy / dist;
        a.vx -= ux * force;
        a.vy -= uy * force;
        b.vx += ux * force;
        b.vy += uy * force;
      }
    }
  }

  private applyLinks(alpha: number): void {
    for (const link of this.links) {
      const s = this.byId.get(link.source);
      const t = this.byId.get(link.target);
      if (!s || !t) continue;
      let dx = t.x - s.x;
      let dy = t.y - s.y;
      let d2 = dx * dx + dy * dy;
      if (d2 === 0) {
        dx = 0.5;
        dy = 0.5;
        d2 = 0.5;
      }
      const dist = Math.sqrt(d2);
      const k = ((dist - link.distance) / dist) * alpha * link.strength * LINK_K;
      const mx = dx * k * 0.5;
      const my = dy * k * 0.5;
      s.vx += mx;
      s.vy += my;
      t.vx -= mx;
      t.vy -= my;
    }
  }

  private applyCenter(alpha: number): void {
    const n = this.nodes.length;
    if (!n) return;
    // Recenter the whole cloud so its centroid sits at canvas center (this does
    // NOT compress the layout — repulsion/links set the spread), plus a gentle
    // positional pull so stray/isolated nodes don't park against the edge.
    let cx = 0;
    let cy = 0;
    for (const nd of this.nodes) {
      cx += nd.x;
      cy += nd.y;
    }
    cx = (this.center.x - cx / n) * RECENTER;
    cy = (this.center.y - cy / n) * RECENTER;
    for (const nd of this.nodes) {
      if (nd.fx == null) {
        nd.x += cx;
        nd.vx += (this.center.x - nd.x) * CENTER_STRENGTH * alpha;
      }
      if (nd.fy == null) {
        nd.y += cy;
        nd.vy += (this.center.y - nd.y) * CENTER_STRENGTH * alpha;
      }
    }
  }

  private applyCollide(): void {
    const ns = this.nodes;
    for (let i = 0; i < ns.length; i++) {
      const a = ns[i];
      if (!a) continue;
      for (let j = i + 1; j < ns.length; j++) {
        const b = ns[j];
        if (!b) continue;
        let dx = b.x - a.x;
        let dy = b.y - a.y;
        const d2 = dx * dx + dy * dy;
        const min = a.radius + b.radius + COLLIDE_PAD;
        if (d2 >= min * min) continue;
        let dist = Math.sqrt(d2);
        if (dist === 0) {
          dx = j - i;
          dy = i + 1;
          dist = Math.sqrt(dx * dx + dy * dy) || 1;
        }
        const push = ((min - dist) / dist) * 0.5 * COLLIDE_STRENGTH;
        const ox = dx * push;
        const oy = dy * push;
        if (a.fx == null) a.x -= ox;
        if (a.fy == null) a.y -= oy;
        if (b.fx == null) b.x += ox;
        if (b.fy == null) b.y += oy;
      }
    }
  }
}
