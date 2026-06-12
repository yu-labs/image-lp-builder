import type { Cta, CtaLink, PageContent, Section, SectionImage } from './content';

const SUPPORTED_SCHEMA_VERSION = '1.0';
const SUPPORTED_DRAFT_TYPE = 'improvement_draft';

const SECTION_METADATA_KEYS = [
  'label',
  'role',
  'intent',
  'image_description',
  'visible_copy_summary',
  'notes_for_analysis',
] as const;

const CTA_METADATA_KEYS = [
  'label',
  'role',
  'destination_kind',
  'analysis_note',
] as const;

type SectionMetadataKey = (typeof SECTION_METADATA_KEYS)[number];
type CtaMetadataKey = (typeof CTA_METADATA_KEYS)[number];

type JsonRecord = Record<string, unknown>;

export type ImprovementDraftWarning = {
  code: string;
  message: string;
  change_id?: string;
  path?: string;
  details?: Record<string, unknown>;
};

export type AppliedImprovementChange = {
  id: string;
  type: string;
};

export type SkippedImprovementChange = {
  id: string;
  type: string;
  reason: string;
};

export type ImprovementDraft = {
  schema_version: typeof SUPPORTED_SCHEMA_VERSION;
  type: typeof SUPPORTED_DRAFT_TYPE;
  source_snapshot_id: string;
  source_publication_id?: string;
  target_lp_id: string;
  title?: string;
  changes: JsonRecord[];
};

export type ImprovementDraftParseResult =
  | { ok: true; draft: ImprovementDraft }
  | { ok: false; errors: string[] };

export type ImprovementDraftApplyResult = {
  content: PageContent;
  warnings: ImprovementDraftWarning[];
  applied_changes: AppliedImprovementChange[];
  skipped_changes: SkippedImprovementChange[];
  source_snapshot_id: string;
  source_publication_id?: string;
};

export type ImprovementDraftFreshnessError = {
  code: 'SOURCE_PUBLICATION_MISSING' | 'SOURCE_PUBLICATION_MISMATCH';
  message: string;
  details: {
    source_publication_id?: string;
    latest_publication_id: string | null;
  };
};

export type ImprovementDraftFreshnessResult =
  | { ok: true }
  | { ok: false; errors: ImprovementDraftFreshnessError[] };

export type ApplyImprovementDraftOptions = {
  targetLpId: string;
  currentPublicationId: string | null;
};

export function validateImprovementDraftFreshness(
  draft: ImprovementDraft,
  currentPublicationId: string | null
): ImprovementDraftFreshnessResult {
  if (!draft.source_publication_id) {
    return {
      ok: false,
      errors: [
        {
          code: 'SOURCE_PUBLICATION_MISSING',
          message:
            'source_publication_id is required before Builder can create an improvement draft.',
          details: { latest_publication_id: currentPublicationId },
        },
      ],
    };
  }

  if (draft.source_publication_id !== currentPublicationId) {
    return {
      ok: false,
      errors: [
        {
          code: 'SOURCE_PUBLICATION_MISMATCH',
          message:
            'source_publication_id does not match the LP latest_publication_id.',
          details: {
            source_publication_id: draft.source_publication_id,
            latest_publication_id: currentPublicationId,
          },
        },
      ],
    };
  }

  return { ok: true };
}

export function parseImprovementDraftInput(
  input: unknown,
  targetLpId: string
): ImprovementDraftParseResult {
  if (!isRecord(input)) {
    return { ok: false, errors: ['improvement_draft must be a JSON object'] };
  }

  const rawDraft = isRecord(input.improvement_draft)
    ? input.improvement_draft
    : input;
  const errors: string[] = [];

  if (rawDraft.schema_version !== SUPPORTED_SCHEMA_VERSION) {
    errors.push(`schema_version must be ${SUPPORTED_SCHEMA_VERSION}`);
  }
  if (rawDraft.type !== SUPPORTED_DRAFT_TYPE) {
    errors.push(`type must be ${SUPPORTED_DRAFT_TYPE}`);
  }
  if (
    typeof rawDraft.source_snapshot_id !== 'string' ||
    rawDraft.source_snapshot_id.trim().length === 0
  ) {
    errors.push('source_snapshot_id is required');
  }
  if (
    rawDraft.source_publication_id !== undefined &&
    typeof rawDraft.source_publication_id !== 'string'
  ) {
    errors.push('source_publication_id must be a string when present');
  }
  if (
    typeof rawDraft.target_lp_id !== 'string' ||
    rawDraft.target_lp_id.trim().length === 0
  ) {
    errors.push('target_lp_id is required');
  } else if (rawDraft.target_lp_id !== targetLpId) {
    errors.push('target_lp_id does not match the LP id in the route');
  }
  if (rawDraft.title !== undefined && typeof rawDraft.title !== 'string') {
    errors.push('title must be a string when present');
  }
  if (!Array.isArray(rawDraft.changes)) {
    errors.push('changes must be an array');
  }

  if (errors.length > 0) return { ok: false, errors };

  const sourceSnapshotId = rawDraft.source_snapshot_id as string;
  const targetLpIdFromDraft = rawDraft.target_lp_id as string;

  return {
    ok: true,
    draft: {
      schema_version: SUPPORTED_SCHEMA_VERSION,
      type: SUPPORTED_DRAFT_TYPE,
      source_snapshot_id: sourceSnapshotId,
      source_publication_id:
        cleanString(rawDraft.source_publication_id) ?? undefined,
      target_lp_id: targetLpIdFromDraft,
      title: cleanString(rawDraft.title) ?? undefined,
      changes: rawDraft.changes as JsonRecord[],
    },
  };
}

export function applyImprovementDraft(
  baseContent: PageContent,
  draft: ImprovementDraft,
  options: ApplyImprovementDraftOptions
): ImprovementDraftApplyResult {
  const content = cloneContent(baseContent);
  const warnings: ImprovementDraftWarning[] = [];
  const applied_changes: AppliedImprovementChange[] = [];
  const skipped_changes: SkippedImprovementChange[] = [];

  warnings.push({
    code: 'SOURCE_SNAPSHOT_UNVERIFIED',
    message:
      'source_snapshot_id is owned by Connector and cannot be fully verified inside Builder; freshness is checked with source_publication_id.',
    details: { source_snapshot_id: draft.source_snapshot_id },
  });

  if (!draft.source_publication_id) {
    warnings.push({
      code: 'SOURCE_PUBLICATION_MISSING',
      message:
        'source_publication_id is missing; Builder cannot compare the draft with the current latest_publication_id.',
    });
  } else if (draft.source_publication_id !== options.currentPublicationId) {
    warnings.push({
      code: 'SOURCE_PUBLICATION_MISMATCH',
      message:
        'source_publication_id does not match the LP latest_publication_id.',
      details: {
        source_publication_id: draft.source_publication_id,
        latest_publication_id: options.currentPublicationId,
      },
    });
  }

  for (const rawChange of draft.changes) {
    const changeId = cleanString(rawChange.id) ?? 'unknown_change';
    const changeType = cleanString(rawChange.type) ?? 'unknown';

    let applied = false;
    switch (changeType) {
      case 'replace_section_image':
        applied = applyReplaceSectionImage(content, rawChange, warnings);
        break;
      case 'update_section_metadata':
        applied = applyUpdateSectionMetadata(content, rawChange, warnings);
        break;
      case 'update_cta_metadata':
        applied = applyUpdateCtaMetadata(content, rawChange, warnings);
        break;
      case 'update_cta_destination':
        applied = applyUpdateCtaDestination(content, rawChange, warnings);
        break;
      case 'reorder_sections':
        applied = applyReorderSections(content, rawChange, warnings);
        break;
      default:
        warnings.push({
          code: 'UNSUPPORTED_CHANGE_TYPE',
          message: `Unsupported improvement_draft change type: ${changeType}`,
          change_id: changeId,
          path: 'changes[].type',
        });
        skipped_changes.push({
          id: changeId,
          type: changeType,
          reason: 'unsupported_change_type',
        });
        continue;
    }

    if (applied) {
      applied_changes.push({ id: changeId, type: changeType });
    } else {
      skipped_changes.push({
        id: changeId,
        type: changeType,
        reason: 'no_applicable_update',
      });
    }
  }

  return {
    content,
    warnings,
    applied_changes,
    skipped_changes,
    source_snapshot_id: draft.source_snapshot_id,
    source_publication_id: draft.source_publication_id,
  };
}

function applyReplaceSectionImage(
  content: PageContent,
  change: JsonRecord,
  warnings: ImprovementDraftWarning[]
): boolean {
  const changeId = cleanString(change.id);
  const found = findTargetSection(content, change, warnings);
  if (!found) return false;

  const asset = isRecord(change.asset) ? change.asset : null;
  if (!asset) {
    warn(warnings, 'INVALID_ASSET', 'asset object is required', changeId);
    return false;
  }

  const image = imageFromAsset(asset, found.section.image, warnings, changeId);
  if (!image) return false;

  found.section.image = image;
  return true;
}

function applyUpdateSectionMetadata(
  content: PageContent,
  change: JsonRecord,
  warnings: ImprovementDraftWarning[]
): boolean {
  const changeId = cleanString(change.id);
  const found = findTargetSection(content, change, warnings);
  if (!found) return false;

  const metadata = isRecord(change.section_metadata)
    ? change.section_metadata
    : pickDirectMetadata(change, SECTION_METADATA_KEYS);
  return applyStringMetadata(
    found.section as unknown as Record<string, unknown>,
    metadata,
    SECTION_METADATA_KEYS,
    warnings,
    changeId
  );
}

function applyUpdateCtaMetadata(
  content: PageContent,
  change: JsonRecord,
  warnings: ImprovementDraftWarning[]
): boolean {
  const changeId = cleanString(change.id);
  const found = findTargetCta(content, change, warnings);
  if (!found) return false;

  const metadata = isRecord(change.cta_metadata)
    ? change.cta_metadata
    : pickDirectMetadata(change, CTA_METADATA_KEYS);
  return applyStringMetadata(
    found.cta as unknown as Record<string, unknown>,
    metadata,
    CTA_METADATA_KEYS,
    warnings,
    changeId
  );
}

function applyUpdateCtaDestination(
  content: PageContent,
  change: JsonRecord,
  warnings: ImprovementDraftWarning[]
): boolean {
  const changeId = cleanString(change.id);
  const found = findTargetCta(content, change, warnings);
  if (!found) return false;

  const destination = isRecord(change.destination) ? change.destination : change;
  const explicitKind = cleanString(destination.destination_kind);
  const destinationUrl = cleanString(destination.destination_url);
  let applied = false;

  if (explicitKind) {
    found.cta.destination_kind = explicitKind;
    applied = true;
  }

  if (destinationUrl) {
    const nextLink = buildCtaLinkFromDestination(
      found.cta.link,
      explicitKind,
      destinationUrl,
      warnings,
      changeId
    );
    if (!nextLink) return applied;
    found.cta.link = nextLink;
    applied = true;
  }

  if (!applied) {
    warn(
      warnings,
      'INVALID_CTA_DESTINATION',
      'destination_kind or destination_url is required',
      changeId
    );
  }

  return applied;
}

function applyReorderSections(
  content: PageContent,
  change: JsonRecord,
  warnings: ImprovementDraftWarning[]
): boolean {
  const changeId = cleanString(change.id);
  if (!Array.isArray(change.section_order)) {
    warn(
      warnings,
      'INVALID_SECTION_ORDER',
      'section_order must be an array of section_id strings',
      changeId
    );
    return false;
  }

  const byId = new Map(content.sections.map((section) => [section.id, section]));
  const seen = new Set<string>();
  const ordered: Section[] = [];

  for (const value of change.section_order) {
    if (typeof value !== 'string' || value.length === 0) {
      warn(
        warnings,
        'INVALID_SECTION_ORDER_ID',
        'section_order contains a non-string or blank section_id',
        changeId
      );
      continue;
    }
    if (seen.has(value)) {
      warn(
        warnings,
        'DUPLICATE_SECTION_ORDER_ID',
        'section_order contains a duplicate section_id; duplicate was ignored',
        changeId,
        { section_id: value }
      );
      continue;
    }
    seen.add(value);

    const section = byId.get(value);
    if (!section) {
      warn(
        warnings,
        'SECTION_NOT_FOUND',
        'section_order references an unknown section_id',
        changeId,
        { section_id: value }
      );
      continue;
    }
    ordered.push(section);
  }

  if (ordered.length === 0) return false;

  const orderedIds = new Set(ordered.map((section) => section.id));
  const remaining = content.sections.filter((section) => !orderedIds.has(section.id));
  content.sections = [...ordered, ...remaining];
  return true;
}

function findTargetSection(
  content: PageContent,
  change: JsonRecord,
  warnings: ImprovementDraftWarning[]
): { section: Section; sectionIndex: number } | null {
  const changeId = cleanString(change.id);
  const target = isRecord(change.target) ? change.target : null;
  const sectionId = cleanString(target?.section_id);
  if (!sectionId) {
    warn(warnings, 'SECTION_ID_REQUIRED', 'target.section_id is required', changeId);
    return null;
  }

  const sectionIndex = content.sections.findIndex((section) => section.id === sectionId);
  if (sectionIndex < 0) {
    warn(warnings, 'SECTION_NOT_FOUND', 'target section_id was not found', changeId, {
      section_id: sectionId,
    });
    return null;
  }

  const declaredIndex = target?.section_index;
  if (
    typeof declaredIndex === 'number' &&
    Number.isInteger(declaredIndex) &&
    declaredIndex !== sectionIndex
  ) {
    warn(
      warnings,
      'SECTION_INDEX_MISMATCH',
      'target.section_index does not match the current section order; section_id was used as the source of truth',
      changeId,
      { section_id: sectionId, declared_index: declaredIndex, actual_index: sectionIndex }
    );
  }

  return { section: content.sections[sectionIndex], sectionIndex };
}

function findTargetCta(
  content: PageContent,
  change: JsonRecord,
  warnings: ImprovementDraftWarning[]
): { section: Section; sectionIndex: number; cta: Cta; ctaIndex: number } | null {
  const changeId = cleanString(change.id);
  const section = findTargetSection(content, change, warnings);
  if (!section) return null;

  const target = isRecord(change.target) ? change.target : null;
  const ctaId = cleanString(target?.cta_id);
  if (!ctaId) {
    warn(warnings, 'CTA_ID_REQUIRED', 'target.cta_id is required', changeId);
    return null;
  }

  const ctaIndex = section.section.ctas.findIndex((cta) => cta.id === ctaId);
  if (ctaIndex < 0) {
    warn(warnings, 'CTA_NOT_FOUND', 'target cta_id was not found', changeId, {
      section_id: section.section.id,
      cta_id: ctaId,
    });
    return null;
  }

  const declaredCtaIndex = target?.cta_index;
  if (
    typeof declaredCtaIndex === 'number' &&
    Number.isInteger(declaredCtaIndex) &&
    declaredCtaIndex !== ctaIndex
  ) {
    warn(
      warnings,
      'CTA_INDEX_MISMATCH',
      'target.cta_index does not match the current CTA order; cta_id was used as the source of truth',
      changeId,
      {
        section_id: section.section.id,
        cta_id: ctaId,
        declared_index: declaredCtaIndex,
        actual_index: ctaIndex,
      }
    );
  }

  return {
    section: section.section,
    sectionIndex: section.sectionIndex,
    cta: section.section.ctas[ctaIndex],
    ctaIndex,
  };
}

function imageFromAsset(
  asset: JsonRecord,
  currentImage: SectionImage,
  warnings: ImprovementDraftWarning[],
  changeId: string | undefined
): SectionImage | null {
  const candidateUrl = cleanString(asset.url) ?? cleanString(asset.path);
  const storage = cleanString(asset.storage);
  if (!candidateUrl) {
    warn(
      warnings,
      'IMAGE_ASSET_URL_REQUIRED',
      'asset.url is required; local_file asset.path cannot be imported by Builder unless it is already a /img/... URL',
      changeId
    );
    return null;
  }
  if (!isBuilderReadableImageUrl(candidateUrl)) {
    warn(
      warnings,
      storage === 'local_file'
        ? 'LOCAL_FILE_ASSET_UNSUPPORTED'
        : 'UNSUPPORTED_IMAGE_ASSET_URL',
      'Only asset.url values or Builder-readable /img/... paths are supported in this import step',
      changeId,
      { asset_url: candidateUrl, storage }
    );
    return null;
  }

  if (typeof asset.width !== 'number' || asset.width <= 0) {
    warn(warnings, 'IMAGE_ASSET_WIDTH_REQUIRED', 'asset.width must be a positive number', changeId);
    return null;
  }
  if (typeof asset.height !== 'number' || asset.height <= 0) {
    warn(warnings, 'IMAGE_ASSET_HEIGHT_REQUIRED', 'asset.height must be a positive number', changeId);
    return null;
  }

  return {
    url: candidateUrl,
    width: asset.width,
    height: asset.height,
    alt: cleanString(asset.alt) ?? currentImage.alt,
  };
}

function buildCtaLinkFromDestination(
  currentLink: CtaLink,
  explicitKind: string | undefined,
  destinationUrl: string,
  warnings: ImprovementDraftWarning[],
  changeId: string | undefined
): CtaLink | null {
  const normalizedKind = normalizeDestinationKind(explicitKind ?? currentLink.type);
  switch (normalizedKind) {
    case 'line_friend':
      return { type: 'line_friend', url: destinationUrl };
    case 'custom_url':
      return { type: 'custom_url', url: destinationUrl };
    case 'tel':
      return { type: 'tel', number: destinationUrl.replace(/^tel:/i, '') };
    case 'mailto':
      return { type: 'mailto', email: destinationUrl.replace(/^mailto:/i, '') };
    case 'webhook':
      if (currentLink.type !== 'webhook') {
        warn(
          warnings,
          'WEBHOOK_DESTINATION_UNSUPPORTED',
          'webhook destination updates require an existing webhook CTA so tag/apiKey can be preserved',
          changeId
        );
        return null;
      }
      return { ...currentLink, url: destinationUrl };
    default:
      warn(
        warnings,
        'UNSUPPORTED_DESTINATION_KIND',
        'destination_kind is not supported for CTA link conversion',
        changeId,
        { destination_kind: explicitKind }
      );
      return null;
  }
}

function normalizeDestinationKind(kind: string): string {
  switch (kind) {
    case 'line':
    case 'line_friend':
      return 'line_friend';
    case 'url':
    case 'custom_url':
      return 'custom_url';
    case 'tel':
    case 'phone':
      return 'tel';
    case 'mailto':
    case 'email':
      return 'mailto';
    case 'webhook':
      return 'webhook';
    default:
      return kind;
  }
}

function applyStringMetadata(
  target: Record<string, unknown>,
  metadata: JsonRecord,
  keys: readonly (SectionMetadataKey | CtaMetadataKey)[],
  warnings: ImprovementDraftWarning[],
  changeId: string | undefined
): boolean {
  let applied = false;
  for (const key of keys) {
    if (!(key in metadata)) continue;

    const value = metadata[key];
    if (value === null || value === '') {
      delete target[key];
      applied = true;
      continue;
    }
    if (typeof value !== 'string') {
      warn(
        warnings,
        'INVALID_METADATA_VALUE',
        `${key} must be a string, null, or blank string`,
        changeId,
        { key }
      );
      continue;
    }
    target[key] = value;
    applied = true;
  }

  if (!applied) {
    warn(
      warnings,
      'NO_SUPPORTED_METADATA_FIELDS',
      'No supported metadata fields were found',
      changeId
    );
  }

  return applied;
}

function pickDirectMetadata(
  source: JsonRecord,
  keys: readonly string[]
): JsonRecord {
  const metadata: JsonRecord = {};
  for (const key of keys) {
    if (key in source) metadata[key] = source[key];
  }
  return metadata;
}

function warn(
  warnings: ImprovementDraftWarning[],
  code: string,
  message: string,
  changeId?: string,
  details?: Record<string, unknown>
): void {
  warnings.push({
    code,
    message,
    ...(changeId && { change_id: changeId }),
    ...(details && { details }),
  });
}

function cleanString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isBuilderReadableImageUrl(value: string): boolean {
  return (
    value.startsWith('/img/') ||
    value.startsWith('http://') ||
    value.startsWith('https://')
  );
}

function cloneContent(content: PageContent): PageContent {
  return JSON.parse(JSON.stringify(content)) as PageContent;
}
