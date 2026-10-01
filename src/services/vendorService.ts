import { api } from './apiClient';

/** Vendors, work orders, bills and material (server/src/routes/admin/vendors.ts) and the vendor's own portal. */

export type VendorCategory = 'contractor' | 'supplier' | 'architect' | 'consultant' | 'agency';
export const VENDOR_CATEGORIES: { value: VendorCategory; label: string }[] = [
  { value: 'contractor', label: 'Contractor' }, { value: 'supplier', label: 'Supplier' }, { value: 'architect', label: 'Architect' },
  { value: 'consultant', label: 'Consultant' }, { value: 'agency', label: 'Agency' },
];

export interface VendorRow {
  id: string; name: string; category: VendorCategory; contactPerson: string | null; phone: string | null; email: string | null;
  contractValue: number; active: boolean; documentCount: number; workOrderCount: number; loginEmail: string | null;
}
export interface VendorDetail extends Omit<VendorRow, 'documentCount' | 'workOrderCount' | 'loginEmail'> {
  address: string | null; gstin: string | null; notes: string | null; userId: string | null;
  user: { email: string | null; status: string } | null;
  documents: { id: string; title: string; url: string; expiresAt: string | null }[];
  workOrders: { id: string; number: string; description: string; amount: number; projectName: string; billed: number; paid: number }[];
  performance: { deliveries: number; onTimePct: number | null; rejectionPct: number | null; pendingIssues: number; updateDisciplinePct: number | null };
}
export interface BillRow {
  id: string; vendorId: string; billNumber: string; amount: number; billDate: string; status: 'submitted' | 'approved' | 'rejected' | 'paid';
  rejectionReason: string | null; paymentRef: string | null; fileUrl: string | null; vendorName?: string; workOrderNumber: string; workOrderAmount?: number;
  projectName?: string; description?: string;
}
export interface StockRow { projectId: string; projectName: string; materialId: string; material: string; unit: string; received: number; issued: number; inStock: number }
export interface MaterialPhoto { id: string; kind: 'material' | 'challan' | 'vehicle'; url: string; takenAt: string; latitude: number; longitude: number }
export interface MaterialEntryRow {
  id: string; projectName: string; material: string; unit: string; quantity: number; vendorName: string | null; challanNo: string; vehicleNo: string;
  receivedBy: string; receivedOn: string; expectedOn: string | null; enteredBy: string; status: 'pending' | 'verified' | 'rejected';
  rejectionReason: string | null; photos: MaterialPhoto[];
}
export interface IssueRow { id: string; projectName: string; material: string; unit: string; quantity: number; purpose: string; issuedTo: string | null; issuedBy: string; issuedOn: string }

export const listVendors = (category = 'all', search = '') => api.get<VendorRow[]>(`/vendors?category=${category}&search=${encodeURIComponent(search)}`);
export const getVendor = (id: string) => api.get<VendorDetail>(`/vendors/${id}`);
export const createVendor = (input: Record<string, unknown>) => api.post<{ id: string }>('/vendors', input);
export const updateVendor = (id: string, input: Record<string, unknown>) => api.patch(`/vendors/${id}`, input);
export const addVendorDocument = (id: string, input: { title: string; url: string; expiresAt?: string }) => api.post(`/vendors/${id}/documents`, input);
export const deleteVendorDocument = (docId: string) => api.delete(`/vendors/documents/${docId}`);
export const createWorkOrder = (vendorId: string, input: { projectId: string; description: string; amount: number }) => api.post(`/vendors/${vendorId}/work-orders`, input);
export const listAllBills = (status: string) => api.get<BillRow[]>(`/vendors/bills/all?status=${status}`);
export const reviewBill = (id: string, decision: 'approve' | 'reject' | 'pay', extra: { reason?: string; paymentRef?: string } = {}) =>
  api.post(`/vendors/bills/${id}/review`, { decision, ...extra });

export const getStock = (projectId?: string) => api.get<StockRow[]>(`/materials/stock${projectId ? `?projectId=${projectId}` : ''}`);
export const listMaterialEntries = (status: string) => api.get<MaterialEntryRow[]>(`/materials/entries?status=${status}`);
export const reviewMaterialEntry = (id: string, decision: 'verify' | 'reject', reason?: string) => api.post(`/materials/entries/${id}/review`, { decision, reason });
export const listMaterialIssues = () => api.get<IssueRow[]>('/materials/issues');
export const createMaterialIssue = (input: { projectId: string; materialId: string; quantity: number; purpose: string; issuedTo?: string }) => api.post('/materials/issues', input);
export const getMaterialLookups = () => api.get<{ vendors: { id: string; name: string }[]; projects: { id: string; projectName: string }[]; materials: { id: string; name: string; unit: string }[] }>('/materials/lookups');

export interface PortalMe {
  id: string; name: string; category: VendorCategory; contractValue: number;
  workOrders: { id: string; number: string; description: string; amount: number; projectId: string; projectName: string; billed: number; paid: number }[];
}
export interface PortalActivity { id: string; project: string; phase: string; block: string; name: string; planned_end: string; planned_percent: number; actual_percent: number; days_behind: number }
/** The portal's calls, for `base`: the vendor's own login, or staff looking at one vendor (read-only). */
export const makePortal = (base: string) => ({
  me: () => api.get<PortalMe>(`${base}/me`),
  activities: () => api.get<{ activities: PortalActivity[] }>(`${base}/activities`),
  updates: () => api.get<{ updates: { id: string; activity: string; work_done: string; percent_complete: number; status: string; rejection_reason: string | null; captured_at: string }[] }>(`${base}/updates`),
  postUpdate: (form: FormData) => api.upload<{ id: string; duplicate: boolean }>(`${base}/updates`, form),
  materials: () => api.get<{ id: string; projectName: string; material: string; unit: string; quantity: number; challanNo: string; receivedOn: string; status: string; rejectionReason: string | null }[]>(`${base}/materials`),
  postMaterial: (form: FormData) => api.upload<{ id: string }>(`${base}/materials`, form),
  bills: () => api.get<BillRow[]>(`${base}/bills`),
  postBill: (input: { workOrderId: string; billNumber: string; amount: number; billDate: string }) => api.post(`${base}/bills`, input),
});
export type PortalApi = ReturnType<typeof makePortal>;
export const portal = makePortal('/vendor-portal');
export const postStaffMaterial = (form: FormData) => api.upload<{ id: string }>('/materials/entries', form);
