let socketAdapterAttached = false;

export function setSocketAdapterAttached(value: boolean): void {
  socketAdapterAttached = value;
}

export function isSocketAdapterAttached(): boolean {
  return socketAdapterAttached;
}
