/**
 * Reference data available to every screen.
 *
 * The mock data modules that used to live here are gone — the admin panel now reads
 * everything from the backend (server/). What remains is the cached partner/project/lookup
 * data that screens resolve display names against, plus the static connector field schema
 * (which describes CRM integrations rather than holding any records).
 */
export * from './referenceData';
export * from './connectorFieldSchema';
