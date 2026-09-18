import type { SupportTicket, TicketStatus } from '../types';
import { api, toQueryString } from './apiClient';
import type { ListParams, ListResult } from './mockClient';

export interface TicketListParams extends ListParams {
  status?: TicketStatus | 'all';
}

export async function listTickets(params: TicketListParams = {}): Promise<ListResult<SupportTicket>> {
  return api.get<ListResult<SupportTicket>>(`/support${toQueryString(params)}`);
}

export async function getTicket(id: string): Promise<SupportTicket | undefined> {
  return api.get<SupportTicket>(`/support/${id}`).catch(() => undefined);
}

/**
 * Replying also notifies the partner in the app. An untouched ticket moves to `pending`
 * (waiting on them); a resolved or closed one keeps its status.
 */
export async function replyToTicket(id: string, message: string, attachments?: string[]): Promise<SupportTicket | undefined> {
  return api.post<SupportTicket>(`/support/${id}/reply`, { message, attachments }).catch(() => undefined);
}

export async function updateTicketStatus(id: string, status: TicketStatus): Promise<SupportTicket | undefined> {
  return api.post<SupportTicket>(`/support/${id}/status`, { status }).catch(() => undefined);
}
