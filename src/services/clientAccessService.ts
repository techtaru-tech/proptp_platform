import { api } from './apiClient';

/** Settings > Client Access (server/src/routes/admin/clientAccess.ts). */
export interface ClientLogin {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  roleName: string | null;
  panelRoleId: string | null;
  accessExpiresAt: string;
  state: 'active' | 'expired' | 'disabled';
  lastSeenAt: string | null;
  openSessions: number;
  createdAt: string;
}

export interface NewClientLogin {
  name: string;
  email: string;
  phone?: string;
  days: number;
  /** Left out, the server uses (and creates if needed) the "Client demo" role. */
  panelRoleId?: string;
}

/** The password comes back once, here, and is never readable again. */
export interface IssuedLogin { user: ClientLogin; password: string }

export const listClientLogins = () => api.get<ClientLogin[]>('/client-access');
export const createClientLogin = (input: NewClientLogin) => api.post<IssuedLogin>('/client-access', input);
export const extendClientLogin = (id: string, days: number) => api.post<ClientLogin>(`/client-access/${id}/extend`, { days });
export const revokeClientLogin = (id: string) => api.post<ClientLogin>(`/client-access/${id}/revoke`);
export const resetClientPassword = (id: string) => api.post<IssuedLogin>(`/client-access/${id}/reset-password`);
export const deleteClientLogin = (id: string) => api.delete(`/client-access/${id}`);
