export const CONTROL_MODES = ['recognition', 'mouse-control', 'mirror'] as const;

export type ControlMode = (typeof CONTROL_MODES)[number];

export function isControlMode(value: unknown): value is ControlMode {
  return typeof value === 'string' && CONTROL_MODES.some((mode) => mode === value);
}
