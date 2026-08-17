export interface PanicWipeResult {
  readonly cacheCount: number;
  readonly databaseCount: number;
  readonly registrationCount: number;
}

export interface PanicWipeOptions {
  readonly abort?: () => void;
  readonly clearMemory?: () => void;
  readonly clearTimeout?: typeof clearTimeout;
  readonly databaseTimeoutMilliseconds?: number;
  readonly knownDatabaseNames?: readonly string[];
  readonly neutralize?: () => void;
  readonly replaceNavigation?: () => void;
  readonly root?: typeof globalThis;
  readonly setTimeout?: typeof setTimeout;
}

export function listenForPanicWipe(callback: () => void, root?: typeof globalThis): () => void;
export function panicWipe(options?: PanicWipeOptions): Promise<PanicWipeResult>;
export const panicWipeProtocol: Readonly<{ channelName: string; messageType: string }>;
