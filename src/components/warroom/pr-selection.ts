/** Hand-off from the war room to the Pull Requests page: which PR to open when the page mounts. */
let requested: string | null = null;

export function requestPrSelection(prKey: string): void {
  requested = prKey;
}

export function takeRequestedPr(): string | null {
  const key = requested;
  requested = null;
  return key;
}
