import { RoleId, type AddressOption, type Agent, type Employee, type Leader, type PartnerUser, type Project, type PropertyTypeOption, type Team, type TeamLeader } from '../types';
import { api } from '../services/apiClient';

/**
 * Cached reference data — the partner directory, the project list and the form lookups.
 *
 * These used to be static mock arrays that screens imported and read synchronously to turn
 * an id into a name (`findUserById`, `projectById`, `amenityNamesForIds`). Those call sites
 * are unchanged; what changed is where the data comes from. It is fetched once after sign-in
 * and held in module-level arrays that are mutated IN PLACE, so the array identities stay
 * stable and `ReferenceDataProvider` only has to trigger one re-render when the load lands.
 *
 * Deliberately NOT cached here: plots (`PropertyUnit`) and bookings. There can be thousands
 * of those, so the screens that need them either fetch them per project or read the
 * pre-joined display names that the list endpoints now return.
 */

/** What the assignee list carries: enough to put a name in a dropdown or on a card. */
export interface AssigneeUser {
  id: string;
  name: string;
  role: RoleId;
  avatarUrl?: string;
  managerId?: string;
}

const ROLE_ID_BY_NAME: Record<string, RoleId> = {
  agent: RoleId.Agent,
  admin: RoleId.Admin,
  employee: RoleId.Employee,
  leader: RoleId.Leader,
  team_leader: RoleId.TeamLeader,
};

/** Whether the signed-in person may hand leads on. Set when the assignee list loads. */
let canAssignLeads = false;
let canUnassignLeads = false;
export function mayAssignLeads(): boolean {
  return canAssignLeads;
}
/** Taking an owner off a lead is only offered where the lead stays visible to the person doing it. */
export function mayUnassignLeads(): boolean {
  return canUnassignLeads;
}

export const refUsers: PartnerUser[] = [];
export const refAgents: Agent[] = [];
export const refEmployees: Employee[] = [];
export const refLeaders: Leader[] = [];
export const refTeamLeaders: TeamLeader[] = [];
/**
 * Who the signed-in person may assign a lead to — their own hierarchy, or everybody for an
 * administrator. Served by `/leads/assignees`, which needs only the CRM module, unlike the
 * partner directory above.
 */
export const refAssignees: AssigneeUser[] = [];
export const refProjects: Project[] = [];
export const refTeams: Team[] = [];

let amenities: { id: string; name: string }[] = [];
let propertyTypes: PropertyTypeOption[] = [];
let addresses: AddressOption[] = [];
let cities: string[] = [];

let loaded = false;
let inFlight: Promise<void> | null = null;

function replace<T>(target: T[], next: T[]): void {
  target.length = 0;
  target.push(...next);
}

/**
 * Loads (or reloads) the caches. Concurrent callers share one request, so the several
 * screens that mount at once after sign-in do not each trigger their own fetch.
 */
export function loadReferenceData(force = false): Promise<void> {
  if (loaded && !force) return Promise.resolve();
  if (inFlight) return inFlight;

  inFlight = (async () => {
    // Each piece is allowed to fail on its own. A sales user's panel role has no Partners,
    // Projects or Teams module, so those three answer 403 for them — which must not take the
    // assignee list (the one thing they do need) down with it.
    const [usersR, projectsR, teamsR, lookupsR, assigneesR] = await Promise.allSettled([
      api.get<{ users: PartnerUser[] }>('/users'),
      api.get<{ items: Project[] }>('/projects?pageSize=200'),
      api.get<{ teams: Team[] }>('/teams'),
      api.get<{
        amenities: { id: string; name: string }[];
        propertyTypes: PropertyTypeOption[];
        addresses: AddressOption[];
        cities: string[];
      }>('/projects/lookups'),
      api.get<{ canAssign: boolean; canUnassign: boolean; users: { id: string; name: string; role: string; avatarUrl?: string; reportingLeaderId?: string | null }[] }>('/leads/assignees'),
    ]);

    const assignees: AssigneeUser[] =
      assigneesR.status === 'fulfilled'
        ? assigneesR.value.users.map((u) => ({
            id: u.id,
            name: u.name,
            role: ROLE_ID_BY_NAME[u.role] ?? RoleId.Employee,
            avatarUrl: u.avatarUrl ?? undefined,
            managerId: u.reportingLeaderId ?? undefined,
          }))
        : [];
    canAssignLeads = assigneesR.status === 'fulfilled' && assigneesR.value.canAssign;
    canUnassignLeads = assigneesR.status === 'fulfilled' && assigneesR.value.canUnassign;
    replace(refAssignees, assignees);

    // The full partner directory when the role allows it; otherwise the people the assignee
    // list does give us, so a name on a lead or a note still resolves instead of showing a dash.
    const users: PartnerUser[] =
      usersR.status === 'fulfilled'
        ? usersR.value.users
        : (assignees.map((a) => ({ ...a, status: 'active', phone: '', email: '' })) as unknown as PartnerUser[]);

    replace(refUsers, users);
    replace(refAgents, users.filter((u): u is Agent => u.role === RoleId.Agent));
    replace(refEmployees, users.filter((u): u is Employee => u.role === RoleId.Employee));
    replace(refLeaders, users.filter((u): u is Leader => u.role === RoleId.Leader));
    replace(refTeamLeaders, users.filter((u): u is TeamLeader => u.role === RoleId.TeamLeader));
    replace(refProjects, projectsR.status === 'fulfilled' ? projectsR.value.items : []);
    replace(refTeams, teamsR.status === 'fulfilled' ? teamsR.value.teams : []);

    if (lookupsR.status === 'fulfilled') {
      amenities = lookupsR.value.amenities;
      propertyTypes = lookupsR.value.propertyTypes;
      addresses = lookupsR.value.addresses;
      cities = lookupsR.value.cities;
    }
    // Sign-in is only ever blocked by something that is not a permission: if every request
    // failed there is nothing useful to show and the caller's retry should run.
    if ([usersR, projectsR, teamsR, lookupsR, assigneesR].every((r) => r.status === 'rejected')) {
      throw (assigneesR as PromiseRejectedResult).reason;
    }
    loaded = true;
  })().finally(() => {
    inFlight = null;
  });

  return inFlight;
}

/** Clears the caches on sign-out, so a different admin never sees the previous one's data. */
export function resetReferenceData(): void {
  [refUsers, refAgents, refEmployees, refLeaders, refTeamLeaders, refAssignees, refProjects, refTeams].forEach((arr) => {
    arr.length = 0;
  });
  canAssignLeads = false;
  canUnassignLeads = false;
  amenities = [];
  propertyTypes = [];
  addresses = [];
  cities = [];
  loaded = false;
}

export function isReferenceDataLoaded(): boolean {
  return loaded;
}

// ---------------------------------------------------------------------------
// Lookups — same names and signatures the screens already call.
// ---------------------------------------------------------------------------

export function findUserById(id?: string): PartnerUser | undefined {
  return id ? refUsers.find((u) => u.id === id) : undefined;
}

/** A partner's name, or a dash — screens render this straight into a table cell. */
export function userDisplayName(id?: string): string {
  return findUserById(id)?.name ?? '—';
}

export function projectById(id?: string): Project | undefined {
  return id ? refProjects.find((p) => p.id === id) : undefined;
}

export function teamById(id?: string): Team | undefined {
  return id ? refTeams.find((t) => t.id === id) : undefined;
}

export function amenityOptions(): { id: string; name: string }[] {
  return amenities;
}

export function amenityNamesForIds(ids: string[]): string[] {
  return ids.map((id) => amenities.find((a) => a.id === id)?.name).filter((name): name is string => !!name);
}

export function propertyTypeOptions(): PropertyTypeOption[] {
  return propertyTypes;
}

export function addressOptions(): AddressOption[] {
  return addresses;
}

/**
 * The city filter's options. Real `projects.project_location` is one free-text field
 * ("Vesu, Surat") with no separate city column, so the backend derives these from the
 * segment after the last comma — the same rule the frontend used to apply itself.
 */
export function cityOptions(): string[] {
  return cities;
}

/** Assignable owners for CRM lead assignment and form ownership — the caller's own hierarchy. */
export function assignableUsers(): AssigneeUser[] {
  return refAssignees;
}
