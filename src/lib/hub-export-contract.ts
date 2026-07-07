/**
 * Shared contract for the published-LP export payload exchanged through
 * the Hub Connector endpoints (`GET /api/hub/exports/:id` response body
 * and the `export_payload` field of the snapshot push request).
 *
 * This file is duplicated verbatim on the sender and receiver sides of
 * the integration. Keep every copy byte-identical: a sync check compares
 * the copies by content, and any drift fails that check. When the payload
 * shape changes, update every copy and the shared fixture
 * (`hub-export-payload.json`) in the same change set and bump
 * `HUB_EXPORT_CONTRACT_VERSION`.
 *
 * The validation here is intentionally exactly as strict as what the
 * receiver has always enforced: three record fields with non-empty string
 * ids, three array fields, and an optional string `public_url`. Do not
 * tighten it casually — a stricter receiver starts rejecting payloads
 * from older senders.
 */

export const HUB_EXPORT_CONTRACT_VERSION = 1;

export interface HubExportContractPayload {
  page: Record<string, unknown>;
  version: Record<string, unknown>;
  publication: Record<string, unknown>;
  sections: unknown[];
  ctas: unknown[];
  images: unknown[];
  public_url: string | null;
}

export type HubExportContractValidation =
  | { ok: true; payload: HubExportContractPayload }
  | { ok: false; errors: string[] };

/**
 * Structurally validate an export payload (the bare payload, not the
 * `{ success, data }` API envelope). Returns a normalized copy on
 * success: `public_url` is trimmed, and blank / missing / non-string
 * values become `null`.
 */
export function validateHubExportPayload(
  value: unknown
): HubExportContractValidation {
  if (!isRecord(value)) {
    return { ok: false, errors: ['payload must be a JSON object'] };
  }

  const errors: string[] = [];

  const page = readRecord(value, 'page', errors);
  const version = readRecord(value, 'version', errors);
  const publication = readRecord(value, 'publication', errors);

  if (page) requireNonEmptyString(page, 'id', 'page.id', errors);
  if (version) requireNonEmptyString(version, 'id', 'version.id', errors);
  if (publication) {
    requireNonEmptyString(publication, 'id', 'publication.id', errors);
  }

  const sections = readArray(value, 'sections', errors);
  const ctas = readArray(value, 'ctas', errors);
  const images = readArray(value, 'images', errors);

  if (errors.length > 0 || !page || !version || !publication) {
    return { ok: false, errors };
  }

  const publicUrl =
    typeof value.public_url === 'string' && value.public_url.trim()
      ? value.public_url.trim()
      : null;

  return {
    ok: true,
    payload: {
      page,
      version,
      publication,
      sections: sections ?? [],
      ctas: ctas ?? [],
      images: images ?? [],
      public_url: publicUrl,
    },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function readRecord(
  source: Record<string, unknown>,
  key: string,
  errors: string[]
): Record<string, unknown> | null {
  const value = source[key];
  if (!isRecord(value)) {
    errors.push(`${key} must be a JSON object`);
    return null;
  }
  return value;
}

function readArray(
  source: Record<string, unknown>,
  key: string,
  errors: string[]
): unknown[] | null {
  const value = source[key];
  if (!Array.isArray(value)) {
    errors.push(`${key} must be an array`);
    return null;
  }
  return value;
}

function requireNonEmptyString(
  source: Record<string, unknown>,
  key: string,
  label: string,
  errors: string[]
): void {
  const value = source[key];
  if (typeof value !== 'string' || !value.trim()) {
    errors.push(`${label} is required`);
  }
}
