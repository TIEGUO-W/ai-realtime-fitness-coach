export type TtsPriority = 'high' | 'medium' | 'low';

interface TtsItem {
  id: number;
  text: string;
  priority: TtsPriority;
  timestamp: number;
}

export class TTSQueue {
  private queue: TtsItem[] = [];
  private isSpeaking = false;
  private nextId = 0;
  private readonly maxSize: number;
  private readonly dedupWindowMs: number;
  private onSpeak: ((text: string, priority: TtsPriority) => Promise<void>) | null = null;

  constructor(opts?: { maxSize?: number; dedupWindowMs?: number }) {
    this.maxSize = opts?.maxSize ?? 5;
    this.dedupWindowMs = opts?.dedupWindowMs ?? 5_000;
  }

  setHandler(fn: (text: string, priority: TtsPriority) => Promise<void>): void {
    this.onSpeak = fn;
  }

  enqueue(text: string, priority: TtsPriority): void {
    if (!text) return;

    // HIGH priority: clear all + stop current, speak immediately
    if (priority === 'high') {
      this.queue = [];
      this.isSpeaking = false;
      this.speakNow(text, priority);
      return;
    }

    // Dedup: same text within window
    const now = Date.now();
    const dup = this.queue.find(
      item => item.text === text && now - item.timestamp < this.dedupWindowMs
    );
    if (dup) return;

    // LOW priority: drop oldest LOW if at capacity
    if (priority === 'low' && this.queue.length >= this.maxSize) {
      const oldestLowIdx = this.queue.findIndex(item => item.priority === 'low');
      if (oldestLowIdx !== -1) {
        this.queue.splice(oldestLowIdx, 1);
      } else {
        return; // queue full of higher priority, drop this one
      }
    }

    // Absolute max safeguard
    if (this.queue.length >= this.maxSize * 2) return;

    this.queue.push({ id: this.nextId++, text, priority, timestamp: now });
    this.flush();
  }

  private speakNow(text: string, priority: TtsPriority): void {
    this.isSpeaking = true;
    Promise.resolve(this.onSpeak?.(text, priority))
      .catch(() => {})
      .finally(() => {
        this.isSpeaking = false;
        this.flush();
      });
  }

  private flush(): void {
    if (this.isSpeaking || this.queue.length === 0) return;
    const item = this.queue.shift()!;
    this.speakNow(item.text, item.priority);
  }

  clear(): void {
    this.queue = [];
  }
}
