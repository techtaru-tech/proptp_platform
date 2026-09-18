import type { AccountRole, ModuleKey, PanelRole, PanelUser } from '../types';
import { api } from './apiClient';

/**
 * Admin-panel roles and the users assigned to them (server/src/routes/admin/panelAccess.ts).
 * Every endpoint here is full-access only — a module-scoped user gets a 403, which is what
 * stops a manager widening their own permissions.
 */

export interface ModuleOption {
  key: ModuleKey;
  label: string;
}

export async function listModules(): Promise<ModuleOption[]> {
  return api.get<ModuleOption[]>('/panel-roles/modules');
}

export async function listPanelRoles(): Promise<PanelRole[]> {
  return api.get<PanelRole[]>('/panel-roles');
}

export interface PanelRoleInput {
  name: string;
  description?: string;
  modules: ModuleKey[];
}

export async function createPanelRole(input: PanelRoleInput): Promise<PanelRole> {
  return api.post<PanelRole>('/panel-roles', input);
}

export async function updatePanelRole(id: string, input: Partial<PanelRoleInput>): Promise<PanelRole> {
  return api.patch<PanelRole>(`/panel-roles/${id}`, input);
}

export async function deletePanelRole(id: string): Promise<void> {
  await api.delete(`/panel-roles/${id}`);
}

export async function listPanelUsers(): Promise<PanelUser[]> {
  return api.get<PanelUser[]>('/panel-users');
}

export interface PanelUserInput {
  name: string;
  email: string;
  phone: string;
  password: string;
  panelRoleId: string;
  /** Defaults to `admin` server-side, which is what every panel user was before this existed. */
  accountRole?: AccountRole;
}

export async function createPanelUser(input: PanelUserInput): Promise<PanelUser> {
  return api.post<PanelUser>('/panel-users', input);
}

export interface PanelUserUpdate {
  name?: string;
  panelRoleId?: string;
  status?: string;
  /** Only sent when the admin actually typed a new one. */
  password?: string;
}

export async function updatePanelUser(id: string, input: PanelUserUpdate): Promise<PanelUser> {
  return api.patch<PanelUser>(`/panel-users/${id}`, input);
}

export async function deletePanelUser(id: string): Promise<void> {
  await api.delete(`/panel-users/${id}`);
}
