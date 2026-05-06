export function stripLogTimingPrefix(message: string): string {
  return message.replace(/^\[\+\d+(?:\.\d+)?s\s+\|\s+Δ\d+(?:\.\d+)?s\]\s*/, '');
}

export function extractLogDeltaSeconds(message: string): number | null {
  const match = message.match(/\|\s*Δ(\d+(?:\.\d+)?)s\]/);

  if (!match) {
    return null;
  }

  return Number(match[1]);
}
