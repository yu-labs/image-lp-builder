#!/usr/bin/env node
import assert from 'node:assert/strict';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const root = process.cwd();
const tempDir = path.join(tmpdir(), `ilpb-improvement-draft-${process.pid}`);
mkdirSync(tempDir, { recursive: true });

try {
  const entryPath = path.join(tempDir, 'entry.ts');
  const bundlePath = path.join(tempDir, 'bundle.mjs');
  writeFileSync(
    entryPath,
    `
      export {
        applyImprovementDraft,
        parseImprovementDraftInput,
        validateImprovementDraftFreshness,
      } from ${JSON.stringify(path.join(root, 'src/lib/improvement-draft.ts'))};
      export { buildExportSectionsForContent } from ${JSON.stringify(
        path.join(root, 'src/lib/hub-export.ts')
      )};
      export { validateContentInput } from ${JSON.stringify(
        path.join(root, 'src/lib/content.ts')
      )};
    `
  );

  await build({
    entryPoints: [entryPath],
    bundle: true,
    format: 'esm',
    platform: 'node',
    outfile: bundlePath,
    logLevel: 'silent',
  });

  const {
    applyImprovementDraft,
    buildExportSectionsForContent,
    parseImprovementDraftInput,
    validateContentInput,
    validateImprovementDraftFreshness,
  } = await import(pathToFileURL(bundlePath).href);

  const targetLpId = '7a5d9c8c-82cd-4aba-8df6-714d9390c2c8';
  const sourcePublicationId = 'd76458eb-a98e-4c36-96d0-d9b1bd3f9e8b';
  const sourceSnapshotId = 'snap_6f7b91a7ba0449509821cf34b4d9210d';

  const baseContent = {
    version: 1,
    sections: [
      {
        id: 'section-fv',
        type: 'image',
        image: {
          url: '/img/fv.webp',
          width: 1200,
          height: 1800,
          alt: 'FV',
        },
        label: 'FV',
        role: 'first_view',
        intent: 'Lead with the main offer',
        image_description: 'Hero image',
        visible_copy_summary: 'Start AI acquisition today',
        notes_for_analysis: 'Watch first CTA engagement',
        ctas: [
          {
            id: 'cta-fv-line',
            buttonMode: 'text',
            text: 'LINEで相談する',
            position: { x: 10, y: 70 },
            size: { width: 80, height: 8 },
            style: {
              backgroundColor: '#06c755',
              textColor: '#ffffff',
              borderRadius: 999,
            },
            link: { type: 'custom_url', url: 'https://example.com/line-page' },
          },
          {
            id: 'cta-fv-image',
            buttonMode: 'image',
            text: 'LINE画像ボタン',
            position: { x: 15, y: 82 },
            size: { width: 70, height: 7 },
            style: {
              backgroundColor: '#111111',
              textColor: '#ffffff',
              borderRadius: 12,
            },
            link: {
              type: 'custom_url',
              url: 'https://line.me/R/ti/p/@image-like-url',
            },
            image: {
              url: '/img/line-like-button.webp',
              width: 900,
              height: 180,
            },
          },
        ],
      },
      {
        id: 'section-proof',
        type: 'image',
        image: { url: '/img/proof.webp', width: 1200, height: 1600 },
        ctas: [],
      },
      {
        id: 'section-offer',
        type: 'image',
        image: { url: '/img/offer.webp', width: 1200, height: 1600 },
        ctas: [],
      },
    ],
  };

  const metadataDraft = {
    schema_version: '1.0',
    type: 'improvement_draft',
    source: 'image-lp-connector',
    source_snapshot_id: sourceSnapshotId,
    source_publication_id: sourcePublicationId,
    target_lp_id: targetLpId,
    title: 'CTA metadata and section order draft',
    status: 'draft',
    changes: [
      {
        id: 'change_section_meta',
        type: 'update_section_metadata',
        target: { section_id: 'section-offer', section_index: 2 },
        section_metadata: {
          label: 'Offer',
          role: 'offer',
          intent: 'Show the strongest offer',
          image_description: 'Offer details',
          visible_copy_summary: 'Limited campaign',
          notes_for_analysis: 'Compare after FV',
        },
      },
      {
        id: 'change_cta_meta',
        type: 'update_cta_metadata',
        target: {
          section_id: 'section-fv',
          section_index: 0,
          cta_id: 'cta-fv-line',
          cta_index: 0,
        },
        cta_metadata: {
          label: '上部LINE CTA',
          role: 'primary_cv',
          destination_kind: 'line_friend',
          analysis_note: 'FV直後の主CVとして見る',
        },
      },
      {
        id: 'change_destination',
        type: 'update_cta_destination',
        target: {
          section_id: 'section-fv',
          cta_id: 'cta-fv-line',
        },
        destination_kind: 'line_friend',
        destination_url: 'https://line.me/R/ti/p/@new-line',
      },
      {
        id: 'change_reorder',
        type: 'reorder_sections',
        target: { target_lp_id: targetLpId },
        section_order: ['section-offer', 'section-fv'],
      },
      {
        id: 'change_unsupported',
        type: 'rewrite_copy_with_ai',
        target: { section_id: 'section-fv' },
      },
    ],
  };

  const parsed = parseImprovementDraftInput(metadataDraft, targetLpId);
  assert.equal(parsed.ok, true);
  const applied = applyImprovementDraft(baseContent, parsed.draft, {
    targetLpId,
    currentPublicationId: sourcePublicationId,
  });

  assert.deepEqual(
    applied.applied_changes.map((change) => change.id),
    [
      'change_section_meta',
      'change_cta_meta',
      'change_destination',
      'change_reorder',
    ]
  );
  assert.deepEqual(applied.skipped_changes, [
    {
      id: 'change_unsupported',
      type: 'rewrite_copy_with_ai',
      reason: 'unsupported_change_type',
    },
  ]);
  assert.equal(
    applied.warnings.some((warning) => warning.code === 'SOURCE_PUBLICATION_MISMATCH'),
    false
  );
  assert.equal(
    applied.warnings.some((warning) => warning.code === 'SOURCE_SNAPSHOT_UNVERIFIED'),
    true
  );
  assert.equal(applied.content.sections[0].id, 'section-offer');
  assert.equal(applied.content.sections[1].id, 'section-fv');
  assert.equal(applied.content.sections[2].id, 'section-proof');
  assert.equal(applied.content.sections[0].label, 'Offer');
  assert.equal(applied.content.sections[0].role, 'offer');

  const validation = validateContentInput(applied.content);
  assert.equal(validation.ok, true);

  const { sections, ctas } = buildExportSectionsForContent(applied.content);
  assert.equal(sections[0].id, 'section-offer');
  assert.equal(sections[0].section_index, 0);
  assert.equal(sections[1].id, 'section-fv');
  assert.equal(sections[1].section_index, 1);
  assert.equal(sections[1].ctas[0].id, 'cta-fv-line');
  assert.equal(sections[1].ctas[0].section_id, 'section-fv');
  assert.equal(sections[1].ctas[0].section_index, 1);
  assert.equal(sections[1].ctas[0].cta_index, 0);
  assert.equal(sections[1].ctas[0].label, '上部LINE CTA');
  assert.equal(sections[1].ctas[0].role, 'primary_cv');
  assert.equal(sections[1].ctas[0].destination_kind, 'line_friend');
  assert.equal(
    sections[1].ctas[0].destination_url,
    'https://line.me/R/ti/p/@new-line'
  );
  assert.equal(ctas[0].section_id, 'section-fv');
  assert.equal(ctas[0].destination_kind, 'line_friend');

  const imageCta = sections[1].ctas[1];
  assert.equal(imageCta.id, 'cta-fv-image');
  assert.equal(imageCta.buttonMode, 'image');
  assert.equal(imageCta.destination_kind, 'url');
  assert.equal(
    imageCta.destination_url,
    'https://line.me/R/ti/p/@image-like-url'
  );

  const mismatchApplied = applyImprovementDraft(baseContent, parsed.draft, {
    targetLpId,
    currentPublicationId: 'different_publication',
  });
  assert.equal(
    mismatchApplied.warnings.some(
      (warning) => warning.code === 'SOURCE_PUBLICATION_MISMATCH'
    ),
    true
  );

  const mismatchFreshness = validateImprovementDraftFreshness(
    parsed.draft,
    'different_publication'
  );
  assert.equal(mismatchFreshness.ok, false);
  assert.equal(mismatchFreshness.errors[0].code, 'SOURCE_PUBLICATION_MISMATCH');

  const missingSourcePublication = parseImprovementDraftInput(
    { ...metadataDraft, source_publication_id: undefined },
    targetLpId
  );
  assert.equal(missingSourcePublication.ok, true);
  const missingFreshness = validateImprovementDraftFreshness(
    missingSourcePublication.draft,
    sourcePublicationId
  );
  assert.equal(missingFreshness.ok, false);
  assert.equal(missingFreshness.errors[0].code, 'SOURCE_PUBLICATION_MISSING');

  const localFileImageDraft = {
    schema_version: '1.0',
    type: 'improvement_draft',
    source_snapshot_id: sourceSnapshotId,
    source_publication_id: sourcePublicationId,
    target_lp_id: targetLpId,
    changes: [
      {
        id: 'change_local_file',
        type: 'replace_section_image',
        target: { section_id: 'section-fv' },
        asset: {
          kind: 'generated_image',
          filename: 'fv-line-cv-v2.webp',
          content_type: 'image/webp',
          width: 1200,
          height: 1800,
          storage: 'local_file',
          path: 'outputs/fv-line-cv-v2.webp',
        },
      },
    ],
  };
  const parsedLocalFile = parseImprovementDraftInput(localFileImageDraft, targetLpId);
  assert.equal(parsedLocalFile.ok, true);
  const localFileApplied = applyImprovementDraft(
    baseContent,
    parsedLocalFile.draft,
    {
      targetLpId,
      currentPublicationId: sourcePublicationId,
    }
  );
  assert.equal(localFileApplied.applied_changes.length, 0);
  assert.equal(localFileApplied.skipped_changes[0].id, 'change_local_file');
  assert.equal(
    localFileApplied.warnings.some(
      (warning) => warning.code === 'LOCAL_FILE_ASSET_UNSUPPORTED'
    ),
    true
  );

  const imageUrlDraft = {
    ...localFileImageDraft,
    changes: [
      {
        id: 'change_image_url',
        type: 'replace_section_image',
        target: { section_id: 'section-fv' },
        asset: {
          kind: 'generated_image',
          filename: 'fv-line-cv-v2.webp',
          content_type: 'image/webp',
          width: 1200,
          height: 1800,
          url: '/img/fv-line-cv-v2.webp',
        },
      },
    ],
  };
  const parsedImageUrl = parseImprovementDraftInput(imageUrlDraft, targetLpId);
  assert.equal(parsedImageUrl.ok, true);
  const imageUrlApplied = applyImprovementDraft(baseContent, parsedImageUrl.draft, {
    targetLpId,
    currentPublicationId: sourcePublicationId,
  });
  assert.equal(imageUrlApplied.applied_changes[0].id, 'change_image_url');
  assert.equal(
    imageUrlApplied.content.sections[0].image.url,
    '/img/fv-line-cv-v2.webp'
  );
  assert.equal(imageUrlApplied.content.sections[0].image.alt, 'FV');

  const wrongTarget = parseImprovementDraftInput(
    { ...metadataDraft, target_lp_id: 'wrong_lp' },
    targetLpId
  );
  assert.equal(wrongTarget.ok, false);

  console.log('Improvement draft contract audit passed.');
} finally {
  rmSync(tempDir, { recursive: true, force: true });
}
