export class KeyMutex {
  private tail = new Map<string, Promise<void>>();

  async acquire(key: string): Promise<() => void> {
    const previous = this.tail.get(key) ?? Promise.resolve();
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    this.tail.set(key, previous.then(() => held));
    await previous;
    return release;
  }
}
