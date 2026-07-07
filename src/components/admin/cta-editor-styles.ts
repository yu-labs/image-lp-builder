/**
 * Shared Tailwind class strings for the CTA editor's modal forms.
 * Extracted so both CtaEditor and the split-out sub-forms (e.g.
 * CtaLinkForm) reference the same constants without a circular import
 * back through CtaEditor.
 */
import { EDITOR_INPUT_CLASS } from './LpEditorPrimitives';

export const CTA_MODAL_INPUT_CLASS = `${EDITOR_INPUT_CLASS} w-full`;

export const CTA_MODAL_INPUT_ERROR_CLASS =
  'border-[#e19a9a] bg-[#fffafa] focus:border-[#d98282] focus:ring-[#f7d9d9]';

export const CTA_MODAL_ERROR_CLASS =
  'rounded-xl border border-[#f0b6b6] bg-[#fff6f6] px-3 py-2 text-xs font-semibold leading-relaxed text-[#b83232]';
