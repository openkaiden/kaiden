import { getContext, setContext } from 'svelte';

export class Lock {
  userScrolledAway = $state(false);
  transitionLockCount = $state(0);

  get locked(): boolean {
    return this.userScrolledAway || this.transitionLockCount > 0;
  }

  lockTransition(): void {
    this.transitionLockCount++;
  }

  unlockTransition(): void {
    this.transitionLockCount = Math.max(0, this.transitionLockCount - 1);
  }
}

const lockKey = (key: string): symbol => Symbol.for(`lock:${key}`);

export function getLock(key: string): Lock {
  const k = lockKey(key);
  let lock = getContext<Lock>(k);
  if (!lock) {
    lock = new Lock();
    setContext(k, lock);
  }
  return lock;
}
