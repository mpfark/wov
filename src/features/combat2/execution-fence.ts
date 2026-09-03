import { useEffect, useRef } from 'react';

/** A lease expires permanently on suspension/unmount, including across awaits. */
export class ExecutionFence {
  private enabled = false;
  private generation = 0;
  setEnabled(enabled: boolean) {
    if (enabled !== this.enabled) this.generation++;
    this.enabled = enabled;
  }
  allowed = () => this.enabled;
  capture = () => {
    const generation = this.generation;
    return () => this.enabled && this.generation === generation;
  };
}

export function useExecutionFence(enabled: boolean) {
  const ref = useRef(new ExecutionFence());
  ref.current.setEnabled(enabled);
  useEffect(() => {
    ref.current.setEnabled(enabled);
    return () => ref.current.setEnabled(false);
  }, [enabled]);
  return ref.current;
}
