import { AsyncLocalStorage } from 'async_hooks';

/**
 * Per-request scratch space. The Prisma layer in prisma.ts records what each update changed here,
 * and the audit writer attaches it to the entry for the request — without any route having to
 * remember to pass a before-and-after around.
 */
export interface FieldChange {
  model: string;
  id: string;
  field: string;
  from: string | null;
  to: string | null;
}
export interface RequestStore {
  changes: FieldChange[];
}

export const requestStore = new AsyncLocalStorage<RequestStore>();
export const currentStore = () => requestStore.getStore();

/** The most field changes one request records; a bulk edit keeps a sample, not a novel. */
export const MAX_CHANGES = 100;
