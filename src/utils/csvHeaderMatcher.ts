/**
 * Verbatim port of the real Laravel CRM's `App\Support\CsvHeaderMatcher::ALIASES` —
 * used to auto-suggest a column mapping when importing a CSV of leads.
 */
export const CSV_HEADER_ALIASES: Record<string, string[]> = {
  source_id: ['leadid', 'recordid', 'externalid', 'crmid', 'id', 'reference', 'refnumber', 'srnumber'],
  first_name: ['firstname', 'givenname', 'fname'],
  last_name: ['lastname', 'surname', 'familyname', 'lname'],
  full_name: ['name', 'fullname', 'contactname', 'leadname', 'customername', 'clientname', 'personname'],
  email: ['email', 'emailaddress', 'primaryemail', 'workemail', 'emailid', 'mailid'],
  phone: [
    'phone', 'phonenumber', 'mobile', 'mobilephone', 'mobilenumber', 'contactnumber', 'primaryphone',
    'whatsapp', 'whatsappnumber', 'cell', 'cellphone', 'telephone', 'tel', 'contact',
  ],
  company: ['company', 'companyname', 'organization', 'organisation', 'accountname', 'firm', 'business'],
  city: ['city', 'town', 'location'],
  source: ['leadsource', 'source', 'originalsource', 'channel', 'campaign'],
  status: ['leadstatus', 'status', 'stage', 'leadstage'],
  priority: ['leadtype', 'priority', 'temperature', 'leadtemperature', 'rating', 'leadquality'],
  deal_value: ['budget', 'dealvalue', 'amount', 'value', 'revenue', 'expectedrevenue', 'dealsize', 'price'],
  assigned: [
    'assignedto', 'owner', 'leadowner', 'salesrep', 'assigneduser', 'accountowner', 'hubspotowner', 'assignee',
    'agent', 'handledby',
  ],
  follow_up: ['nextfollowup', 'followupdate', 'nextfollowupdate', 'nextactiondate', 'followup', 'nextcall'],
  contacted: ['lastcontacted', 'lastcontact', 'lastactivitydate', 'lastactivity', 'lastcalled'],
  notes: ['notes', 'note', 'description', 'comments', 'remarks', 'message', 'requirements'],
};

export const CSV_TARGET_FIELDS = Object.keys(CSV_HEADER_ALIASES);

export function normalizeHeader(header: string): string {
  let norm = header.toLowerCase().replace(/[^a-z0-9]/g, '');
  norm = norm.replace(/(nos?|num|nmbr)$/, 'number');
  if (norm === 'ph' || norm === 'phno' || norm === 'phnumber') norm = 'phone';
  return norm;
}

/** Returns the target lead field a CSV header most likely maps to, or null if no alias matches. */
export function matchHeader(header: string): string | null {
  const norm = normalizeHeader(header);
  if (CSV_TARGET_FIELDS.includes(norm)) return norm;
  for (const [field, aliases] of Object.entries(CSV_HEADER_ALIASES)) {
    if (aliases.includes(norm)) return field;
  }
  return null;
}

/** Real `ProcessLeadImport` logic: splits on the first whitespace run into exactly 2 parts. */
export function splitFullName(fullName: string): { firstName?: string; lastName?: string } {
  const parts = fullName.trim().split(/\s+/);
  return { firstName: parts[0] || undefined, lastName: parts.slice(1).join(' ') || undefined };
}

/** Real `LeadFieldNormalizer::status()` — free-text spreadsheet values mapped to the LeadStatus enum. */
export function normalizeImportedStatus(raw: string): 'new' | 'contacted' | 'qualified' | 'won' | 'lost' {
  const r = raw.toLowerCase();
  if (r.includes('won') || r.includes('closed - won') || r.includes('convert')) return 'won';
  if (r.includes('lost') || r.includes('closed - lost') || r.includes('dead')) return 'lost';
  if (r.includes('qualif') || r.includes('propos') || r.includes('negotiat')) return 'qualified';
  if (r.includes('contact')) return 'contacted';
  return 'new';
}

/** Real `LeadFieldNormalizer::priority()`. */
export function normalizeImportedPriority(raw: string): 'low' | 'normal' | 'high' | 'urgent' {
  const r = raw.toLowerCase();
  if (r.includes('urgent') || r.includes('critical')) return 'urgent';
  if (r.includes('hot') || r.includes('high')) return 'high';
  if (r.includes('cold') || r.includes('low')) return 'low';
  return 'normal';
}

/** Minimal CSV parser — handles quoted fields and commas within quotes, sufficient for a mock import flow. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (inQuotes) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }
    } else if (char === '"') {
      inQuotes = true;
    } else if (char === ',') {
      row.push(field);
      field = '';
    } else if (char === '\n' || char === '\r') {
      if (char === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else {
      field += char;
    }
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((cell) => cell.trim() !== ''));
}
