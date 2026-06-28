/**
 * What PodMan currently believes an engineer is doing, derived from vision on
 * their shared screen and refreshed every few seconds. This is the live,
 * pre-push signal that the GitHub API cannot see.
 */
export interface EngineerContext {
  engineerId: string;
  podId: string;
  /** File path PodMan sees open/active in the editor, e.g. "src/auth.ts". */
  currentFile?: string;
  /** Function/class/symbol being edited, if vision can resolve it. */
  currentSymbol?: string;
  /** Higher-level feature/action inferred from the screen. */
  activity?: string;
  /** Whether the screen shows uncommitted/unpushed changes (gutter/diff). */
  hasUnpushedChanges?: boolean;
  /** 0–1 confidence in this read of the screen. */
  confidence: number;
  /** Small redacted-size JPEG data URL for sidebar preview, not the full frame. */
  screenshotDataUrl?: string;
  /** ISO timestamp of the observation this context came from. */
  observedAt: string;
}
