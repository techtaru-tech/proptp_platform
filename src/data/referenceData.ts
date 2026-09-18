import { RoleId, type AddressOption, type Agent, type Employee, type Leader, type PartnerUser, type Project, type PropertyTypeOption, type Team } from '../types';
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

export const refUsers: PartnerUser[] = [];
export const refAgents: Agent[] = [];
export const refEmployees: Employee[] = [];
export const refLeaders: Leader[] = [];
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
    const [{ users }, projects, { teams }, lookups] = await Promise.all([
      api.get<{ users: PartnerUser[] }>('/users'),
      api.get<{ items: Project[] }>('/projects?pageSize=200'),
      api.get<{ teams: Team[] }>('/teams'),
      api.get<{
        amenities: { id: string; name: string }[];
        propertyTypes: PropertyTypeOption[];
        addresses: AddressOption[];
        cities: string[];
      }>('/projects/lookups'),
    ]);

    replace(refUsers, users);
    replace(refAgents, users.filter((u): u is Agent => u.role === RoleId.Agent));
    replace(refEmployees, users.filter((u): u is Employee => u.role === RoleId.Employee));
    replace(refLeaders, users.filter((u): u is Leader => u.role === RoleId.Leader));
    replace(refProjects, projects.items);
    replace(refTeams, teams);

    amenities = lookups.amenities;
    propertyTypes = lookups.propertyTypes;
    addresses = lookups.addresses;
    cities = lookups.cities;
    loaded = true;
  })().finally(() => {
    inFlight = null;
  });

  return inFlight;
}

/** Clears the caches on sign-out, so a different admin never sees the previous one's data. */
export function resetReferenceData(): void {
  [refUsers, refAgents, refEmployees, refLeaders, refProjects, refTeams].forEach((arr) => {
    arr.length = 0;
  });
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

/** Assignable owners for CRM lead assignment and form ownership. */
export function assignableUsers(): PartnerUser[] {
  return [...refEmployees, ...refLeaders];
}
