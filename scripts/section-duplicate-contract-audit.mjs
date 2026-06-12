#!/usr/bin/env node
import assert from 'node:assert/strict';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const root = process.cwd();
const tempDir = path.join(tmpdir(), `ilpb-section-duplicate-${process.pid}`);
mkdirSync(tempDir, { recursive: true });

try {
  const entryPath = path.join(tempDir, 'entry.ts');
  const bundlePath = path.join(tempDir, 'bundle.mjs');
  writeFileSync(
    entryPath,
    `
      export { duplicateSectionForNewIds } from ${JSON.stringify(
        path.join(root, 'src/lib/section-duplicate.ts')
      )};
      export { buildExportSectionsForContent } from ${JSON.stringify(
        path.join(root, 'src/lib/hub-export.ts')
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

  const { duplicateSectionForNewIds, buildExportSectionsForContent } =
    await import(pathToFileURL(bundlePath).href);

  const sourceSection = {
    id: 'section-source',
    type: 'image',
    image: {
      url: '/img/source.webp',
      width: 1200,
      height: 1600,
      alt: 'source section image',
    },
    label: 'FV',
    role: 'first_view',
    intent: 'Lead with the main offer',
    image_description: 'Hero image and offer badge',
    visible_copy_summary: 'Start AI acquisition today',
    notes_for_analysis: 'Watch first CTA engagement',
    ctas: [
      {
        id: 'cta-source-line',
        buttonMode: 'text',
        text: 'LINEで相談する',
        position: { x: 10, y: 70 },
        size: { width: 80, height: 8 },
        style: {
          backgroundColor: '#06c755',
          textColor: '#ffffff',
          borderRadius: 999,
        },
        link: { type: 'line_friend', url: 'https://line.me/R/ti/p/@demo' },
        label: 'LINE main',
        role: 'primary_cv',
        destination_kind: 'line',
        analysis_note: 'Primary conversion',
      },
      {
        id: 'cta-source-image',
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
        label: 'Image CTA',
        role: 'secondary_cv',
        analysis_note: 'Image CTA must not be inferred as LINE',
        image: {
          url: '/img/line-like-button.webp',
          width: 900,
          height: 180,
        },
      },
    ],
  };

  const duplicateSection = duplicateSectionForNewIds(sourceSection);

  assert.notEqual(duplicateSection.id, sourceSection.id);
  assert.equal(duplicateSection.type, sourceSection.type);
  assert.equal(duplicateSection.image.url, sourceSection.image.url);
  assert.equal(duplicateSection.image.alt, sourceSection.image.alt);
  assert.notStrictEqual(duplicateSection.image, sourceSection.image);
  assert.equal(duplicateSection.label, sourceSection.label);
  assert.equal(duplicateSection.role, sourceSection.role);
  assert.equal(duplicateSection.intent, sourceSection.intent);
  assert.equal(
    duplicateSection.image_description,
    sourceSection.image_description
  );
  assert.equal(
    duplicateSection.visible_copy_summary,
    sourceSection.visible_copy_summary
  );
  assert.equal(
    duplicateSection.notes_for_analysis,
    sourceSection.notes_for_analysis
  );
  assert.equal(duplicateSection.ctas.length, sourceSection.ctas.length);

  for (let i = 0; i < sourceSection.ctas.length; i += 1) {
    const sourceCta = sourceSection.ctas[i];
    const duplicateCta = duplicateSection.ctas[i];
    assert.notEqual(duplicateCta.id, sourceCta.id);
    assert.equal(duplicateCta.text, sourceCta.text);
    assert.equal(duplicateCta.label, sourceCta.label);
    assert.equal(duplicateCta.role, sourceCta.role);
    assert.equal(duplicateCta.destination_kind, sourceCta.destination_kind);
    assert.equal(duplicateCta.analysis_note, sourceCta.analysis_note);
    assert.deepEqual(duplicateCta.link, sourceCta.link);
    assert.notStrictEqual(duplicateCta.link, sourceCta.link);
    assert.notStrictEqual(duplicateCta.position, sourceCta.position);
    assert.notStrictEqual(duplicateCta.size, sourceCta.size);
    assert.notStrictEqual(duplicateCta.style, sourceCta.style);
    if (sourceCta.image) {
      assert.deepEqual(duplicateCta.image, sourceCta.image);
      assert.notStrictEqual(duplicateCta.image, sourceCta.image);
    }
  }

  const { sections, ctas } = buildExportSectionsForContent({
    version: 1,
    sections: [sourceSection, duplicateSection],
  });
  const [sourceExportSection, duplicateExportSection] = sections;

  assert.equal(sourceExportSection.id, sourceSection.id);
  assert.equal(duplicateExportSection.id, duplicateSection.id);
  assert.notEqual(duplicateExportSection.id, sourceExportSection.id);
  assert.equal(sourceExportSection.section_index, 0);
  assert.equal(duplicateExportSection.section_index, 1);
  assert.equal(duplicateExportSection.label, sourceSection.label);
  assert.equal(duplicateExportSection.role, sourceSection.role);
  assert.equal(duplicateExportSection.intent, sourceSection.intent);
  assert.equal(
    duplicateExportSection.image_description,
    sourceSection.image_description
  );
  assert.equal(
    duplicateExportSection.visible_copy_summary,
    sourceSection.visible_copy_summary
  );
  assert.equal(
    duplicateExportSection.notes_for_analysis,
    sourceSection.notes_for_analysis
  );

  const duplicateLineCta = duplicateExportSection.ctas[0];
  const duplicateImageCta = duplicateExportSection.ctas[1];
  assert.equal(ctas.length, 4);
  assert.equal(duplicateLineCta.section_id, duplicateSection.id);
  assert.equal(duplicateLineCta.section_index, 1);
  assert.equal(duplicateLineCta.cta_index, 0);
  assert.notEqual(duplicateLineCta.id, sourceExportSection.ctas[0].id);
  assert.equal(duplicateLineCta.destination_kind, 'line');
  assert.equal(duplicateLineCta.label, 'LINE main');
  assert.equal(duplicateLineCta.role, 'primary_cv');
  assert.equal(duplicateLineCta.analysis_note, 'Primary conversion');

  assert.equal(duplicateImageCta.section_id, duplicateSection.id);
  assert.equal(duplicateImageCta.section_index, 1);
  assert.equal(duplicateImageCta.cta_index, 1);
  assert.notEqual(duplicateImageCta.id, sourceExportSection.ctas[1].id);
  assert.equal(duplicateImageCta.destination_kind, 'url');
  assert.equal(duplicateImageCta.label, 'Image CTA');
  assert.equal(duplicateImageCta.role, 'secondary_cv');
  assert.equal(
    duplicateImageCta.analysis_note,
    'Image CTA must not be inferred as LINE'
  );

  console.log('Section duplicate contract audit passed.');
} finally {
  rmSync(tempDir, { recursive: true, force: true });
}
