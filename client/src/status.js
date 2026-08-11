// Shared UI state machine values (kept here to avoid circular imports).
export const STATUS = {
  IDLE: 'idle',
  COMPRESSING: 'compressing',
  ANALYZING: 'analyzing', // verifying / waiting for first token
  STREAMING: 'streaming', // report chunks arriving live
  DONE: 'done',
  ERROR: 'error',
};
