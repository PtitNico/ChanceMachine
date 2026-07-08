import { WritableSignal, signal } from '@angular/core';
import { range } from '../range.util';

export const DEF_OPTIONS: (number | 'KD')[] = ['KD', ...range(5, 25)];
export const ARM_OPTIONS = range(1, 35);
export const BOXES_OPTIONS = range(1, 99);
export const RESOURCE_OPTIONS = range(0, 15); // Focus / Fury

/** The shared target's fields, each its own signal - same "signal per field" rationale as `AttackRow`. */
export interface TargetState {
  readonly def: WritableSignal<number | 'KD'>;
  readonly arm: WritableSignal<number>;
  readonly boxes: WritableSignal<number>;
  readonly tough: WritableSignal<boolean>; // always succeeds on 5+ (no configurable threshold)
  readonly focus: WritableSignal<number>;
  readonly fury: WritableSignal<number>;
}

export function createTargetState(): TargetState {
  return {
    def: signal<number | 'KD'>(13),
    arm: signal(15),
    boxes: signal(5),
    tough: signal(false),
    focus: signal(0),
    fury: signal(0),
  };
}
