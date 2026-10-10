/** Undo/redo over immutable snapshots. Pushing after an undo discards the redo branch. */
export class History<T> {
  private past: T[] = [];
  private future: T[] = [];

  constructor(
    private present: T,
    private readonly limit = 100,
  ) {}

  get current(): T {
    return this.present;
  }

  get canUndo(): boolean {
    return this.past.length > 0;
  }

  get canRedo(): boolean {
    return this.future.length > 0;
  }

  /** Record a new state. Identical (===) states are ignored. */
  push(next: T): T {
    if (next === this.present) return this.present;
    this.past.push(this.present);
    if (this.past.length > this.limit) this.past.shift();
    this.present = next;
    this.future = [];
    return next;
  }

  /** Replace the current state without making an undo point (e.g. typing in one field). */
  replace(next: T): T {
    this.present = next;
    return next;
  }

  undo(): T {
    const prev = this.past.pop();
    if (prev === undefined) return this.present;
    this.future.push(this.present);
    this.present = prev;
    return prev;
  }

  redo(): T {
    const next = this.future.pop();
    if (next === undefined) return this.present;
    this.past.push(this.present);
    this.present = next;
    return next;
  }

  /** Start over from a state (e.g. after restoring a version), clearing undo and redo. */
  reset(state: T): T {
    this.past = [];
    this.future = [];
    this.present = state;
    return state;
  }
}
