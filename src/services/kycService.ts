import type { PartnerUser } from '../types';
import { api, toQueryString } from './apiClient';
import type { ListParams, ListResult } from './mockClient';

export interface KycListParams extends ListParams {
  status?: 0 | 1 | 2 | 'all';
}

/** A submitted KYC document, so the approvals screen can show what was uploaded. */
export interface KycDocumentRef {
  kind: 'aadhaarFront' | 'aadhaarBack' | 'panCard' | 'passportPhoto' | 'cancelledCheque';
  fileUrl: string;
}

export type KycRequestRow = PartnerUser & { kycDocuments: KycDocumentRef[] };

export async function listKycRequests(params: KycListParams = {}): Promise<ListResult<KycRequestRow>> {
  return api.get<ListResult<KycRequestRow>>(`/kyc${toQueryString(params)}`);
}

/**
 * Mirrors the real `UsersController::kycAction()` exactly: only two outcomes exist, no
 * rejection-reason field is captured, and rejecting a submission ALSO deactivates the
 * account (`adhar_verification=2` + `status=0`).
 */
export async function approveKyc(userId: string): Promise<PartnerUser | undefined> {
  return api.post<PartnerUser>(`/kyc/${userId}/approve`).catch(() => undefined);
}

export async function rejectKyc(userId: string): Promise<PartnerUser | undefined> {
  return api.post<PartnerUser>(`/kyc/${userId}/reject`).catch(() => undefined);
}
