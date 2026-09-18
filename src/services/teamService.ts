import type { PartnerUser, Team, TeamTreeNode } from '../types';
import { api } from './apiClient';

export async function listTeams(): Promise<Team[]> {
  const { teams } = await api.get<{ teams: Team[] }>('/teams');
  return teams;
}

export async function getTeam(id: string): Promise<Team | undefined> {
  return api.get<Team>(`/teams/${id}`).catch(() => undefined);
}

/** The downline tree under a leader, built server-side (depth-capped, one query per level). */
export async function getTeamTree(leaderId: string): Promise<TeamTreeNode | undefined> {
  return api.get<TeamTreeNode>(`/teams/tree/${leaderId}`).catch(() => undefined);
}

export async function getTeamMembers(teamId: string): Promise<PartnerUser[]> {
  const { members } = await api.get<{ members: PartnerUser[] }>(`/teams/${teamId}/members`);
  return members;
}
