import { createContext, useContext } from 'react';
import { portal as ownPortal, type PortalApi } from '../../services/vendorService';

/**
 * Which vendor's portal the pages are showing, and whether they may act in it. A vendor's own
 * login gets the default (their API, full rights); staff looking at a vendor get that vendor's
 * API and `readOnly`, so the same pages serve both without a second copy.
 */
export interface PortalCtx {
  api: PortalApi;
  readOnly: boolean;
}
export const PortalContext = createContext<PortalCtx>({ api: ownPortal, readOnly: false });
export const usePortal = () => useContext(PortalContext);
