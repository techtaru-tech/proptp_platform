import type {
  LeaveBalanceRow, LeaveRequest, LeaveType, PayrollRun, PayrollRunDetail, SalaryStructureRow,
} from '../types';
import { api, toQueryString } from './apiClient';

// ---------------------------------------------------------------------------
// server/src/routes/admin/leave.ts + payroll.ts
// ---------------------------------------------------------------------------

export async function listLeaveTypes(): Promise<LeaveType[]> {
  const { types } = await api.get<{ types: LeaveType[] }>('/leave/types');
  return types;
}

export type LeaveTypeInput = Omit<LeaveType, 'id'>;

export async function createLeaveType(input: LeaveTypeInput): Promise<LeaveType> {
  return api.post('/leave/types', input);
}

export async function updateLeaveType(id: string, input: LeaveTypeInput): Promise<LeaveType> {
  return api.patch(`/leave/types/${id}`, input);
}

export async function deleteLeaveType(id: string): Promise<{ deactivated: boolean; message?: string }> {
  return api.delete(`/leave/types/${id}`);
}

export async function listLeaveRequests(params: { status?: string; userId?: string; year?: number } = {}): Promise<LeaveRequest[]> {
  const { requests } = await api.get<{ requests: LeaveRequest[] }>(`/leave/requests${toQueryString(params)}`);
  return requests;
}

export async function applyForLeave(input: {
  userId: string;
  leaveTypeId: string;
  startDate: string;
  endDate: string;
  halfDay?: boolean;
  reason: string;
}): Promise<LeaveRequest> {
  return api.post('/leave/requests', input);
}

export async function decideLeave(id: string, decision: 'approved' | 'rejected', note?: string): Promise<LeaveRequest> {
  return api.post(`/leave/requests/${id}/decide`, { decision, note });
}

export async function cancelLeave(id: string): Promise<LeaveRequest> {
  return api.post(`/leave/requests/${id}/cancel`);
}

export interface StaffLeaveBalances {
  userId: string;
  name: string;
  balances: LeaveBalanceRow[];
}

export async function listLeaveBalances(year: number): Promise<StaffLeaveBalances[]> {
  const { staff } = await api.get<{ staff: StaffLeaveBalances[] }>(`/leave/balances?year=${year}`);
  return staff;
}

export async function setLeaveAllocation(input: {
  userId: string;
  leaveTypeId: string;
  year: number;
  allocated: number;
}): Promise<void> {
  await api.put('/leave/balances', input);
}

// ---------------------------------------------------------------------------
// Payroll
// ---------------------------------------------------------------------------

export async function listSalaryStructures(): Promise<SalaryStructureRow[]> {
  const { staff } = await api.get<{ staff: SalaryStructureRow[] }>('/payroll/structures');
  return staff;
}

export async function saveSalaryStructure(
  userId: string,
  input: Pick<SalaryStructureRow, 'basic' | 'hra' | 'otherAllowance' | 'pfDeduction' | 'professionalTax' | 'otherDeduction'>
): Promise<void> {
  await api.put(`/payroll/structures/${userId}`, input);
}

export async function listPayrollRuns(): Promise<PayrollRun[]> {
  const { runs } = await api.get<{ runs: PayrollRun[] }>('/payroll/runs');
  return runs;
}

export async function getPayrollRun(id: string): Promise<PayrollRunDetail> {
  return api.get(`/payroll/runs/${id}`);
}

/** Building a month that already exists as a draft recalculates it from scratch. */
export async function buildPayrollRun(month: number, year: number, notes?: string): Promise<PayrollRun> {
  return api.post('/payroll/runs', { month, year, notes });
}

export async function setPayrollRunStatus(id: string, status: 'finalised' | 'paid'): Promise<PayrollRun> {
  return api.post(`/payroll/runs/${id}/status`, { status });
}

export async function deletePayrollRun(id: string): Promise<void> {
  await api.delete(`/payroll/runs/${id}`);
}
