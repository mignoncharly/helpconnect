export type NetworkMode = "normal" | "low" | "text";
export type NetworkModeSource = "automatic" | "manual";

export interface NetworkAdaptationState {
  readonly automaticMode: NetworkMode;
  readonly fastSuccesses: number;
  readonly mode: NetworkMode;
  readonly reason: string;
  readonly source: NetworkModeSource;
}

export interface NetworkAdaptationController {
  clearManualMode(): NetworkAdaptationState;
  getState(): NetworkAdaptationState;
  recordFailure(reason?: string): NetworkAdaptationState;
  recordSuccess(durationMs: number): NetworkAdaptationState;
  setManualMode(mode: NetworkMode): NetworkAdaptationState;
}

export const networkAdaptationPolicy: Readonly<{
  initialTimeoutMs: number;
  recoverySuccesses: number;
  retryTimeoutMs: number;
}>;

export function createNetworkAdaptationController(
  onChange?: (state: NetworkAdaptationState) => void
): NetworkAdaptationController;

export function runAdaptiveRequest<T>(
  attempt: (signal: AbortSignal, attemptNumber: 1 | 2) => Promise<T>,
  adaptation: NetworkAdaptationController,
  options?: Readonly<{
    initialTimeoutMs?: number;
    parentSignal?: AbortSignal;
    retryTimeoutMs?: number;
  }>
): Promise<T>;
