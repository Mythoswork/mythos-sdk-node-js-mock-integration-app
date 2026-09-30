export function logMythosError(message: string, error: unknown): void {
  const errorType = error instanceof Error ? error.name : typeof error;
  console.error('[mythos]', message, { errorType });
}
