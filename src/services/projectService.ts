import type { AuditEntry, BookingRow, Project, ProjectStatus, PropertyUnit, UnitBookingStatus } from '../types';
import { api, toQueryString } from './apiClient';
import type { ListParams, ListResult } from './mockClient';
import { amenityOptions, addressOptions, cityOptions, loadReferenceData, propertyTypeOptions } from '../data/referenceData';

export interface ProjectListParams extends ListParams {
  status?: ProjectStatus | 'all';
  city?: string | 'all';
}

/**
 * Real `projects.project_location` is one free-text field (e.g. "Vesu, Surat") — there is no
 * separate city column, so "city" is the segment after the last comma. Filtering by it now
 * happens server-side; this helper stays for the screens that display a city.
 */
export function cityFromLocation(location: string): string {
  const parts = location.split(',');
  return parts[parts.length - 1]?.trim() ?? location;
}

export async function listProjects(params: ProjectListParams = {}): Promise<ListResult<Project>> {
  return api.get<ListResult<Project>>(`/projects${toQueryString(params)}`);
}

export async function getProject(id: string): Promise<Project | undefined> {
  return api.get<Project>(`/projects/${id}`).catch(() => undefined);
}

export interface ProjectDetailBundle {
  project: Project;
  units: PropertyUnit[];
  bookings: BookingRow[];
  amenityNames: string[];
  counts: { total: number; available: number; booked: number; soldOut: number };
  audit: AuditEntry[];
}

/** Everything the Project Detail page renders, in one request. */
export async function getProjectDetail(id: string): Promise<ProjectDetailBundle | undefined> {
  return api.get<ProjectDetailBundle>(`/projects/${id}/detail`).catch(() => undefined);
}

export interface UnitListParams {
  bookingStatus?: UnitBookingStatus | 'all';
  search?: string;
}

export async function listProjectUnits(projectId: string, params: UnitListParams = {}): Promise<PropertyUnit[]> {
  const { units } = await api.get<{ units: PropertyUnit[] }>(
    `/projects/${projectId}/units${toQueryString({ ...params })}`
  );
  return units;
}

const EMPTY_COUNTS = { total: 0, available: 0, booked: 0, soldOut: 0 } as const;

/**
 * A project's plot tallies. The counts now arrive on the project row itself (counted in the
 * same query), so this reads them rather than scanning a client-side plot catalogue.
 */
export function getProjectUnitCounts(project?: Project): { total: number; available: number; booked: number; soldOut: number } {
  return project?.unitCounts ?? { ...EMPTY_COUNTS };
}

export async function getUnit(unitId: string): Promise<PropertyUnit | undefined> {
  return api.get<PropertyUnit>(`/units/${unitId}`).catch(() => undefined);
}

export interface FlatUnitListParams extends ListParams {
  projectId?: string | 'all';
  bookingStatus?: UnitBookingStatus | 'all';
}

/** Mirrors the real `admin.propertyList` — a flat list of plots across ALL projects. */
export async function listUnits(params: FlatUnitListParams = {}): Promise<ListResult<PropertyUnit>> {
  return api.get<ListResult<PropertyUnit>>(`/units${toQueryString(params)}`);
}

// The form Select sources come from the cached lookup tables; see data/referenceData.ts.
export { amenityOptions, propertyTypeOptions, addressOptions, cityOptions };

export async function createProject(data: Partial<Project>): Promise<Project> {
  const created = await api.post<Project>('/projects', data);
  await loadReferenceData(true).catch(() => {});
  return created;
}

export async function updateProject(id: string, data: Partial<Project>): Promise<Project | undefined> {
  const updated = await api.patch<Project>(`/projects/${id}`, data).catch(() => undefined);
  if (updated) await loadReferenceData(true).catch(() => {});
  return updated;
}

/**
 * Deactivating a project is what the partner app reads as "on hold", so a reason can be
 * captured with it; reactivating always clears the reason.
 */
export async function toggleProjectStatus(id: string, holdReason?: string): Promise<Project | undefined> {
  const updated = await api.post<Project>(`/projects/${id}/toggle-status`, { holdReason }).catch(() => undefined);
  if (updated) await loadReferenceData(true).catch(() => {});
  return updated;
}

/** Project media rows — JDA/RERA certificates and dated construction photographs. */
export async function addProjectFile(
  projectId: string,
  input: { kind: 'jda' | 'rera' | 'construction'; file: string; caption?: string; capturedOn?: string; isVideo?: boolean }
): Promise<{ id: string; file: string }> {
  return api.post(`/projects/${projectId}/files`, input);
}

export async function deleteProjectFile(fileId: string): Promise<void> {
  await api.delete(`/projects/files/${fileId}`);
}

export async function createUnit(projectId: string, data: Partial<PropertyUnit>): Promise<PropertyUnit> {
  return api.post<PropertyUnit>('/units', { ...data, projectId });
}

export async function updateUnit(unitId: string, data: Partial<PropertyUnit>): Promise<PropertyUnit | undefined> {
  return api.patch<PropertyUnit>(`/units/${unitId}`, data).catch(() => undefined);
}

export async function deleteUnit(unitId: string): Promise<void> {
  await api.delete(`/units/${unitId}`);
}

export async function toggleUnitStatus(unitId: string): Promise<PropertyUnit | undefined> {
  return api.post<PropertyUnit>(`/units/${unitId}/toggle-status`).catch(() => undefined);
}

/** Mirrors the real `BulkPriceController` — only unbooked, active plots can be repriced. */
export async function getBulkPriceableUnits(projectId: string): Promise<PropertyUnit[]> {
  const { units } = await api.get<{ units: PropertyUnit[] }>(`/projects/${projectId}/bulk-priceable`);
  return units;
}

export interface BulkPriceUpdateRow {
  unitId: string;
  totalInvestmentAmount: number;
  perAreaAmount: number;
}

export async function bulkUpdateUnitPricing(rows: BulkPriceUpdateRow[]): Promise<number> {
  const { updated } = await api.post<{ updated: number }>('/units/bulk-price', { rows });
  return updated;
}
