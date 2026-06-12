/**
 * SectionList
 *
 * Renders the LP's sections as a sortable list with per-row controls:
 * - drag-and-drop reordering (handle on the leading "⋮⋮ NN" block)
 * - inline alt-text editing (click the alt label, blur/Enter saves,
 *   Esc cancels)
 * - image replacement via the same client-side WebP pipeline as
 *   SectionAdder
 * - delete
 *
 * All mutations are optimistic. The local sections array is updated
 * first; we then GET the latest content (so we don't clobber
 * server-side changes we didn't see) and PUT the merged result.
 * On failure we roll back and surface the message in the caller's
 * UI when it has a better context, otherwise via the admin toast.
 */

import { useEffect, useState } from 'react';
import {
  Copy,
  Eye,
  FileText,
  GripVertical,
  ImagePlus,
  MoreVertical,
  Pencil,
  RefreshCcw,
  Trash2,
} from 'lucide-react';
import {
  DndContext,
  type DragEndEvent,
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  closestCenter,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import imageCompression from 'browser-image-compression';
import { confirmAdminAction } from '../../lib/admin-dialog';
import { showAdminToast } from '../../lib/admin-toast';
import { notifyLpContentSaved } from '../../lib/lp-events';
import type {
  ArchivedSection,
  Section,
  PageContent,
} from '../../lib/content';
import { uploadOneAsSection } from '../../lib/upload';
import Lightbox from './Lightbox';
import CtaEditor from './CtaEditor';
import CollapseToggleIcon from './CollapseToggleIcon';
import DropZone from './DropZone';
import type { Cta } from '../../lib/content';
import { duplicateSectionForNewIds } from '../../lib/section-duplicate';
import {
  EDITOR_DANGER_BUTTON_CLASS,
  EDITOR_INPUT_CLASS,
  EDITOR_PRIMARY_BUTTON_CLASS,
  EDITOR_SECONDARY_BUTTON_CLASS,
  EDITOR_SUB_PANEL_CLASS,
} from './LpEditorPrimitives';

interface Props {
  lpId: string;
  initialSections: Section[];
  initialArchivedSections: ArchivedSection[];
}

type ApiError = { success: false; error: { code: string; message: string } };

const MAX_DIMENSION = 1200;
const SECTION_ACTION_BUTTON_CLASS =
  'min-h-[2.5rem] gap-1.5 px-3 py-2 text-xs';

const IMG_FILE_PATTERN =
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\.(?:webp|png|jpg)$/;
const SECTION_METADATA_FIELDS = [
  { key: 'label', label: '分析ラベル', placeholder: '例：FV' },
  { key: 'role', label: '役割', placeholder: '例：first_view' },
  { key: 'intent', label: '意図', placeholder: 'このセクションで伝えたいこと' },
  {
    key: 'image_description',
    label: '画像の説明',
    placeholder: '画像に写っている内容',
  },
  {
    key: 'visible_copy_summary',
    label: '見えているコピーの要約',
    placeholder: '画像内テキストの要約',
  },
  {
    key: 'notes_for_analysis',
    label: '分析メモ',
    placeholder: 'Connector分析で補足したいこと',
  },
] as const;
type SectionMetadataKey = (typeof SECTION_METADATA_FIELDS)[number]['key'];
type SectionMetadataPatch = Partial<Pick<Section, SectionMetadataKey>>;

export default function SectionList({
  lpId,
  initialSections,
  initialArchivedSections,
}: Props) {
  const [sections, setSections] = useState<Section[]>(initialSections);
  const [archivedSections, setArchivedSections] = useState<ArchivedSection[]>(
    initialArchivedSections
  );
  const [busy, setBusy] = useState(false);
  const [busyDeleteId, setBusyDeleteId] = useState<string | null>(null);
  const [busyDuplicateId, setBusyDuplicateId] = useState<string | null>(null);
  const [busyReplaceId, setBusyReplaceId] = useState<string | null>(null);
  const [previewIndex, setPreviewIndex] = useState<number | null>(null);
  const [ctaEditId, setCtaEditId] = useState<string | null>(null);
  const [sectionMetaEditId, setSectionMetaEditId] = useState<string | null>(null);
  const [archivedOpen, setArchivedOpen] = useState(false);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    // Touch: long-press to start, so vertical scroll on phones still
    // wins by default. 250ms gives a clear "drag mode" feel without
    // dragging the user too long.
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  /**
   * Replace the current sections (and optionally the archived
   * sections) on the server, preserving everything else in the
   * content payload (meta, promotions, etc.) by always GET-ing the
   * latest first and spreading it into the PUT body.
   *
   * For per-section field edits (alt, image, CTAs) the merge logic
   * keeps any concurrent server-side change to *other* sections.
   */
  async function persistSections(
    nextSections: Section[],
    previous: Section[],
    options: {
      mergeWithLatest?: boolean;
      nextArchived?: ArchivedSection[];
      showAlert?: boolean;
    } = {}
  ) {
    const { mergeWithLatest = true, nextArchived, showAlert = true } = options;
    setBusy(true);
    try {
      const getRes = await fetch(`/api/lps/${lpId}`);
      if (!getRes.ok) {
        throw new Error(await readApiError(getRes, 'LP取得失敗'));
      }
      const getJson = (await getRes.json()) as {
        success: true;
        data: { content: PageContent };
      };
      const serverContent = getJson.data.content;

      let chosenSections: Section[];
      if (mergeWithLatest) {
        const latestById = new Map(
          serverContent.sections.map((s) => [s.id, s])
        );
        // For each id in our local order, take our local copy if we
        // changed it, otherwise prefer the server's latest. This
        // keeps reorder-only operations from clobbering ctas etc.
        // We detect "changed" by reference equality: the caller
        // passed an updated section object, the server-only one is
        // a different reference.
        chosenSections = nextSections.map((local) => {
          const fromServer = latestById.get(local.id);
          const previousLocal = previous.find((p) => p.id === local.id);
          if (previousLocal === local && fromServer) {
            return fromServer;
          }
          return local;
        });
      } else {
        chosenSections = nextSections;
      }

      const nextContent: PageContent = {
        ...serverContent,
        version: 1,
        sections: chosenSections,
        ...(nextArchived !== undefined && {
          archived_sections: nextArchived,
        }),
      };

      const putRes = await fetch(`/api/lps/${lpId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: nextContent }),
      });
      if (!putRes.ok) {
        throw new Error(await readApiError(putRes, 'LP更新失敗'));
      }
      notifyLpContentSaved();
    } catch (err) {
      setSections(previous);
      if (showAlert) {
        showAdminToast({
          tone: 'danger',
          message: `エラー： ${err instanceof Error ? err.message : String(err)}`,
        });
      }
      throw err;
    } finally {
      setBusy(false);
    }
  }

  function onDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const oldIndex = sections.findIndex((s) => s.id === active.id);
    const newIndex = sections.findIndex((s) => s.id === over.id);
    if (oldIndex === -1 || newIndex === -1) return;

    const previous = sections;
    const next = arrayMove(sections, oldIndex, newIndex);
    setSections(next);
    persistSections(next, previous).catch(() => {
      /* error already surfaced; rollback already happened */
    });
  }

  /**
   * Soft-delete: move the section into archived_sections so the user
   * can restore it from the archive pane below. The R2 image stays
   * put — only "完全削除" from the archive removes it.
   */
  async function deleteSection(sectionId: string) {
    if (busy) return;
    const target = sections.find((s) => s.id === sectionId);
    if (!target) return;
    const confirmed = await confirmAdminAction({
      title: 'このセクションを削除しますか?',
      message: '下の「削除済みセクション」から復元できます。',
      confirmLabel: '削除する',
      tone: 'danger',
    });
    if (!confirmed)
      return;

    setBusyDeleteId(sectionId);
    const previous = sections;
    const previousArchived = archivedSections;
    const next = sections.filter((s) => s.id !== sectionId);
    const nextArchived: ArchivedSection[] = [
      ...archivedSections,
      { ...target, archived_at: new Date().toISOString() },
    ];
    setSections(next);
    setArchivedSections(nextArchived);
    try {
      await persistSections(next, previous, {
        mergeWithLatest: false,
        nextArchived,
      });
      showAdminToast({
        tone: 'danger',
        message: '削除しました。削除済みセクションから復元できます。',
      });
    } catch {
      setArchivedSections(previousArchived);
    } finally {
      setBusyDeleteId(null);
    }
  }

  async function duplicateSection(sectionId: string) {
    if (busy) return;
    const sourceIndex = sections.findIndex((s) => s.id === sectionId);
    if (sourceIndex === -1) return;

    const previous = sections;
    const nextSection = duplicateSectionForNewIds(sections[sourceIndex]);
    const next = [
      ...sections.slice(0, sourceIndex + 1),
      nextSection,
      ...sections.slice(sourceIndex + 1),
    ];
    setBusyDuplicateId(sectionId);
    setSections(next);
    try {
      // Keep the inserted copy directly after its source. The new
      // section/CTA ids are client-side only, so merging by latest id
      // would not have a server counterpart yet.
      await persistSections(next, previous, { mergeWithLatest: false });
      showAdminToast({ message: 'セクションを複製しました。' });
    } catch {
      // persistSections already rolls sections back and surfaces the toast.
    } finally {
      setBusyDuplicateId(null);
    }
  }

  /**
   * Move an archived section back into the active list. Appends to
   * the end — preserving the original index would require carrying
   * it in the archive entry, which isn't worth the complexity.
   */
  async function restoreFromArchive(sectionId: string) {
    if (busy) return;
    const target = archivedSections.find((s) => s.id === sectionId);
    if (!target) return;

    const previous = sections;
    const previousArchived = archivedSections;
    // Strip archived_at when promoting back to a live Section.
    const { archived_at: _archivedAt, ...sectionOnly } = target;
    const next: Section[] = [...sections, sectionOnly];
    const nextArchived = archivedSections.filter((s) => s.id !== sectionId);
    setSections(next);
    setArchivedSections(nextArchived);
    try {
      await persistSections(next, previous, {
        mergeWithLatest: false,
        nextArchived,
      });
      showAdminToast({ message: '復元しました。' });
    } catch {
      setArchivedSections(previousArchived);
    }
  }

  /**
   * Permanently remove an archived section. Drops the entry from
   * archived_sections AND deletes the underlying R2 image. This
   * is the only path in the editor that destroys a stored image,
   * so the confirmation copy spells that out.
   */
  async function permanentlyDelete(sectionId: string) {
    if (busy) return;
    const target = archivedSections.find((s) => s.id === sectionId);
    if (!target) return;
    const confirmed = await confirmAdminAction({
      title: 'このセクションを完全に削除しますか?',
      message: '画像も含めて元に戻せません。',
      confirmLabel: '完全に削除',
      tone: 'danger',
    });
    if (!confirmed)
      return;

    const previousArchived = archivedSections;
    const nextArchived = archivedSections.filter((s) => s.id !== sectionId);
    setArchivedSections(nextArchived);
    try {
      await persistSections(sections, sections, {
        mergeWithLatest: false,
        nextArchived,
      });
      // R2 cleanup is best-effort: if the section is dropped from
      // content but the bucket DELETE fails, we have an orphaned
      // image — annoying but not corrupt. Don't roll back the
      // archive removal on R2 failure.
      const file = target.image.url.replace(/^\/img\//, '');
      if (IMG_FILE_PATTERN.test(file)) {
        await fetch(`/api/uploads/${file}`, { method: 'DELETE' }).catch(
          () => {}
        );
      }
      showAdminToast({ tone: 'danger', message: '完全に削除しました。' });
    } catch {
      setArchivedSections(previousArchived);
    }
  }

  async function updateAlt(sectionId: string, newAlt: string) {
    if (busy) return;
    const trimmed = newAlt;
    const target = sections.find((s) => s.id === sectionId);
    if (!target) return;
    if (target.image.alt === trimmed) return; // no-op, skip PUT

    const previous = sections;
    const next = sections.map((s) =>
      s.id === sectionId
        ? { ...s, image: { ...s.image, alt: trimmed } }
        : s
    );
    setSections(next);
    try {
      await persistSections(next, previous);
    } catch {
      /* handled */
    }
  }

  async function saveSectionMetadata(
    sectionId: string,
    patch: SectionMetadataPatch
  ) {
    if (busy) return;
    const previous = sections;
    const next = sections.map((s) =>
      s.id === sectionId ? applySectionMetadataPatch(s, patch) : s
    );
    setSections(next);
    try {
      await persistSections(next, previous, { showAlert: false });
      showAdminToast({ message: 'セクション分析メモを保存しました。' });
    } catch (err) {
      showAdminToast({
        tone: 'danger',
        message: `エラー： ${err instanceof Error ? err.message : String(err)}`,
      });
      throw err;
    }
  }

  async function insertAt(index: number, files: File[]) {
    if (busy || files.length === 0) return;
    setBusy(true);
    const previous = sections;
    try {
      const newSections: Section[] = [];
      for (const file of files) {
        const section = await uploadOneAsSection(file);
        newSections.push(section);
      }
      const next = [
        ...sections.slice(0, index),
        ...newSections,
        ...sections.slice(index),
      ];
      setSections(next);
      // mergeWithLatest: false because we're injecting brand new
      // sections at a precise index; merging with the server view
      // would lose the position.
      await persistSections(next, previous, { mergeWithLatest: false });
    } catch (err) {
      setSections(previous);
      showAdminToast({
        tone: 'danger',
        message: `エラー： ${err instanceof Error ? err.message : String(err)}`,
      });
    } finally {
      setBusy(false);
    }
  }

  async function saveCtas(sectionId: string, newCtas: Cta[]) {
    if (busy) return;
    const previous = sections;
    const next = sections.map((s) =>
      s.id === sectionId ? { ...s, ctas: newCtas } : s
    );
    setSections(next);
    try {
      await persistSections(next, previous, { showAlert: false });
    } catch (err) {
      // persistSections already rolled the local state back. Re-throw
      // so CtaEditor (the caller) treats this as a
      // failed save and keeps the modal open with the user's drafts —
      // otherwise the editor closes and any unsaved tweaks are lost.
      throw err;
    }
  }

  async function replaceImage(sectionId: string, file: File) {
    if (busy) return;
    setBusyReplaceId(sectionId);
    setBusy(true);
    try {
      const compressed = await imageCompression(file, {
        maxWidthOrHeight: MAX_DIMENSION,
        maxSizeMB: 2,
        fileType: 'image/webp',
        useWebWorker: true,
      });
      const dims = await readImageDimensions(compressed);

      const formData = new FormData();
      formData.append('file', compressed, withWebpExt(file.name));
      formData.append('width', String(dims.width));
      formData.append('height', String(dims.height));

      const uploadRes = await fetch('/api/upload', {
        method: 'POST',
        body: formData,
      });
      if (!uploadRes.ok) {
        throw new Error(await readApiError(uploadRes, 'アップロード失敗'));
      }
      const uploadJson = (await uploadRes.json()) as {
        success: true;
        data: { url: string; width: number; height: number };
      };

      const previous = sections;
      const next = sections.map((s) =>
        s.id === sectionId
          ? {
              ...s,
              image: {
                ...s.image,
                url: uploadJson.data.url,
                width: uploadJson.data.width,
                height: uploadJson.data.height,
              },
            }
          : s
      );
      setSections(next);
      // The PUT path is wrapped in its own setBusy(true/false), so we
      // briefly have setBusy true here -> false in persistSections ->
      // true again. That's fine; UI just stays disabled throughout.
      await persistSections(next, previous);
    } catch (err) {
      showAdminToast({
        tone: 'danger',
        message: `エラー： ${err instanceof Error ? err.message : String(err)}`,
      });
    } finally {
      setBusyReplaceId(null);
      setBusy(false);
    }
  }

  return (
    <>
      <div className="space-y-4">
      {sections.length === 0 ? (
        <div className="space-y-3">
          <DropZone lpId={lpId} compact />
        </div>
      ) : (
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={onDragEnd}
      >
        <SortableContext
          items={sections.map((s) => s.id)}
          strategy={verticalListSortingStrategy}
        >
          <div className="space-y-1">
            <InsertSlot
              busy={busy}
              onPick={(files) => insertAt(0, files)}
            />
            {sections.map((section, i) => (
              <div key={section.id}>
                <SortableRow
                  section={section}
                  index={i}
                  busy={busy}
                  isDeleting={busyDeleteId === section.id}
                  isDuplicating={busyDuplicateId === section.id}
                  isReplacing={busyReplaceId === section.id}
                  onDelete={() => deleteSection(section.id)}
                  onDuplicate={() => duplicateSection(section.id)}
                  onAltSave={(newAlt) => updateAlt(section.id, newAlt)}
                  onReplace={(file) => replaceImage(section.id, file)}
                  onPreview={() => setPreviewIndex(i)}
                  onEditCtas={() => setCtaEditId(section.id)}
                  onEditMetadata={() => setSectionMetaEditId(section.id)}
                />
                <InsertSlot
                  busy={busy}
                  onPick={(files) => insertAt(i + 1, files)}
                />
              </div>
            ))}
          </div>
        </SortableContext>
      </DndContext>
      )}

        {sections.length > 0 && <DropZone lpId={lpId} compact />}

      {archivedSections.length > 0 && (
        <ArchivePane
          items={archivedSections}
          open={archivedOpen}
          busy={busy}
          onToggle={() => setArchivedOpen((v) => !v)}
          onRestore={restoreFromArchive}
          onPermanentDelete={permanentlyDelete}
        />
      )}
      </div>
      {previewIndex !== null && (
        <Lightbox
          images={sections.map((s) => ({
            url: s.image.url,
            alt: s.image.alt ?? '',
          }))}
          initialIndex={previewIndex}
          onClose={() => setPreviewIndex(null)}
        />
      )}
      {ctaEditId !== null &&
        (() => {
          const editing = sections.find((s) => s.id === ctaEditId);
          if (!editing) return null;
          return (
            <CtaEditor
              section={editing}
              busy={busy}
              onClose={() => setCtaEditId(null)}
              onSave={(newCtas) => saveCtas(editing.id, newCtas)}
            />
          );
        })()}
      {sectionMetaEditId !== null &&
        (() => {
          const editing = sections.find((s) => s.id === sectionMetaEditId);
          if (!editing) return null;
          return (
            <SectionMetadataEditor
              key={editing.id}
              section={editing}
              busy={busy}
              onClose={() => setSectionMetaEditId(null)}
              onSave={(patch) => saveSectionMetadata(editing.id, patch)}
            />
          );
        })()}
    </>
  );
}

interface RowProps {
  section: Section;
  index: number;
  busy: boolean;
  isDeleting: boolean;
  isDuplicating: boolean;
  isReplacing: boolean;
  onDelete: () => void;
  onDuplicate: () => void;
  onAltSave: (newAlt: string) => void;
  onReplace: (file: File) => void;
  onPreview: () => void;
  onEditCtas: () => void;
  onEditMetadata: () => void;
}

function SortableRow({
  section,
  index,
  busy,
  isDeleting,
  isDuplicating,
  isReplacing,
  onDelete,
  onDuplicate,
  onAltSave,
  onReplace,
  onPreview,
  onEditCtas,
  onEditMetadata,
}: RowProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: section.id });

  const [editingAlt, setEditingAlt] = useState(false);
  const [altDraft, setAltDraft] = useState(section.image.alt ?? '');
  const [rowDragOver, setRowDragOver] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    if (!menuOpen) return;
    const onClick = (e: MouseEvent) => {
      const target = e.target as Element | null;
      if (target?.closest('[data-row-action-menu]')) return;
      setMenuOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenuOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [menuOpen]);

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.6 : 1,
    zIndex: menuOpen ? 80 : isDragging ? 10 : undefined,
  };

  function startEditingAlt() {
    if (busy) return;
    setAltDraft(section.image.alt ?? '');
    setEditingAlt(true);
  }

  function commitAlt() {
    setEditingAlt(false);
    onAltSave(altDraft);
  }

  function cancelAlt() {
    setEditingAlt(false);
    setAltDraft(section.image.alt ?? '');
  }

  function onAltKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      e.preventDefault();
      commitAlt();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      cancelAlt();
    }
  }

  function onFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    onReplace(file);
  }

  return (
    <div
      ref={setNodeRef}
      style={style}
      onDragOver={(e) => {
        if (busy) return;
        // Only react to file drags (ignore the @dnd-kit sortable drag)
        if (!Array.from(e.dataTransfer.types).includes('Files')) return;
        e.preventDefault();
        setRowDragOver(true);
      }}
      onDragLeave={(e) => {
        if (e.currentTarget.contains(e.relatedTarget as Node)) return;
        setRowDragOver(false);
      }}
      onDrop={(e) => {
        if (!Array.from(e.dataTransfer.types).includes('Files')) return;
        e.preventDefault();
        setRowDragOver(false);
        if (busy) return;
        const file = e.dataTransfer.files?.[0];
        if (file) onReplace(file);
      }}
      className={`relative flex items-center gap-3 rounded-2xl border p-3 shadow-[0_12px_30px_rgba(31,34,48,0.055)] backdrop-blur-xl transition sm:p-4 ${
        menuOpen ? 'z-50' : 'z-0'
      } ${
        rowDragOver
          ? 'border-[#567baf] bg-[#eef4fb]/92 ring-2 ring-[#9bb4d6]'
          : 'border-white/75 bg-white/82'
      }`}
    >
      <button
        type="button"
        {...attributes}
        {...listeners}
        className="-ml-1 flex cursor-grab items-center gap-1 rounded-full px-1.5 py-1 text-[#8b91a1] transition hover:bg-[#eef4fb] hover:text-[#567baf] active:cursor-grabbing focus:outline-none focus:ring-2 focus:ring-[#9bb4d6] sm:gap-1.5 sm:px-2"
        aria-label="ドラッグして並び替え"
      >
        <GripVertical size={17} strokeWidth={2.3} aria-hidden="true" />
        <span className="font-mono text-xs font-extrabold sm:text-sm">
          {String(index + 1).padStart(2, '0')}
        </span>
      </button>

      <button
        type="button"
        onClick={onPreview}
        className="group relative shrink-0 rounded-xl focus:outline-none focus:ring-2 focus:ring-[#9bb4d6]"
        aria-label="画像を拡大表示"
      >
        <img
          src={section.image.url}
          alt={section.image.alt ?? ''}
          className="h-16 w-16 rounded-xl bg-[#eef4fb] object-cover sm:h-20 sm:w-20"
          loading="lazy"
        />
        <span
          className="pointer-events-none absolute inset-0 flex items-center justify-center rounded-xl bg-[#1f2230]/50 opacity-0 transition-opacity group-hover:opacity-100"
          aria-hidden="true"
        >
          <Eye className="h-6 w-6 text-white" strokeWidth={2.2} aria-hidden="true" />
        </span>
      </button>

      <div className="flex-1 min-w-0">
        {editingAlt ? (
          <input
            type="text"
            value={altDraft}
            onChange={(e) => setAltDraft(e.target.value)}
            onBlur={commitAlt}
            onKeyDown={onAltKeyDown}
            placeholder="例：FV、お悩み"
            autoFocus
            className={`${EDITOR_INPUT_CLASS} w-full border-[#9bb4d6] font-semibold focus:ring-[#d8e3f2]`}
            maxLength={50}
          />
        ) : (
          <button
            type="button"
            onClick={startEditingAlt}
            disabled={busy}
            title="クリックしてラベルを編集"
            className={`flex w-full min-w-0 items-center gap-1.5 rounded-xl border border-dashed border-transparent px-2 py-1 text-left text-sm font-extrabold transition hover:border-[#c8d5e8] hover:bg-[#f8fafc] disabled:opacity-50 ${
              section.image.alt
                ? 'text-[#3f4352]'
                : 'text-[#8b91a1]'
            }`}
          >
            <Pencil className="h-3.5 w-3.5 shrink-0 text-[#8b91a1]" strokeWidth={2.3} aria-hidden="true" />
            <span className="min-w-0 flex-1 truncate">
              {section.image.alt || 'ラベルを追加'}
            </span>
          </button>
        )}
        <div className="mt-0.5 truncate px-2 text-xs font-semibold text-[#8b91a1]">
          CTA {section.ctas.length}個
        </div>
      </div>

      {/* Wide screens: keep primary editing actions inline. Secondary /
          destructive actions stay in the kebab menu. Below lg, all actions
          stay in the existing kebab menu. */}
      <label
        className={`${EDITOR_SECONDARY_BUTTON_CLASS} ${SECTION_ACTION_BUTTON_CLASS} max-lg:!hidden lg:!inline-flex cursor-pointer transition ${
          busy
            ? 'cursor-not-allowed text-[#a0a6b5]'
            : ''
        }`}
        title="クリックでファイル選択（行にドロップでも差し替え可）"
      >
        <RefreshCcw size={14} strokeWidth={2.3} aria-hidden="true" />
        {isReplacing ? '差し替え中...' : '画像差し替え'}
        <input
          type="file"
          accept="image/png,image/jpeg,image/webp"
          className="sr-only"
          onChange={onFileChange}
          disabled={busy}
        />
      </label>

      <button
        type="button"
        onClick={onEditCtas}
        disabled={busy}
        className={`${EDITOR_PRIMARY_BUTTON_CLASS} ${SECTION_ACTION_BUTTON_CLASS} max-lg:!hidden lg:!inline-flex`}
        title="ボタンの追加・編集"
      >
        ボタン追加{section.ctas.length > 0 ? `（${section.ctas.length}）` : ''}
      </button>

      {/* Desktop secondary actions */}
      <div className="relative hidden shrink-0 lg:block" data-row-action-menu>
        <button
          type="button"
          aria-label="その他の操作を開く"
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen((v) => !v)}
          className="rounded-full p-3 text-[#8b91a1] transition hover:bg-[#eef4fb] hover:text-[#567baf]"
        >
          <MoreVertical size={22} strokeWidth={2.3} aria-hidden="true" />
        </button>
        {menuOpen && (
          <div
            role="menu"
            className="absolute right-0 top-full z-[120] mt-2 min-w-[180px] rounded-2xl border border-white/80 bg-white/95 p-2 shadow-[0_18px_44px_rgba(31,34,48,0.16)] backdrop-blur-xl"
          >
            <button
              type="button"
              role="menuitem"
              disabled={busy}
              onClick={() => {
                setMenuOpen(false);
                onEditMetadata();
              }}
              className="flex w-full items-center gap-3 whitespace-nowrap rounded-xl px-3.5 py-3 text-left text-sm font-bold text-[#3f4352] transition hover:bg-[#eef4fb] disabled:opacity-50"
            >
              <FileText size={16} strokeWidth={2.3} aria-hidden="true" />
              分析メモ
            </button>
            <button
              type="button"
              role="menuitem"
              disabled={busy}
              onClick={() => {
                setMenuOpen(false);
                onDuplicate();
              }}
              className="flex w-full items-center gap-3 whitespace-nowrap rounded-xl px-3.5 py-3 text-left text-sm font-bold text-[#3f4352] transition hover:bg-[#eef4fb] disabled:opacity-50"
            >
              <Copy size={16} strokeWidth={2.3} aria-hidden="true" />
              {isDuplicating ? '複製中...' : 'セクション複製'}
            </button>
            <button
              type="button"
              role="menuitem"
              disabled={busy}
              onClick={() => {
                setMenuOpen(false);
                onDelete();
              }}
              className="flex w-full items-center gap-3 whitespace-nowrap rounded-xl px-3.5 py-3 text-left text-sm font-bold text-red-700 transition hover:bg-red-50 disabled:opacity-50"
            >
              <Trash2 size={16} strokeWidth={2.3} aria-hidden="true" />
              {isDeleting ? '削除中...' : '削除'}
            </button>
          </div>
        )}
      </div>

      {/* SP / narrow widths: kebab menu */}
      <div className="relative shrink-0 lg:!hidden" data-row-action-menu>
        <button
          type="button"
          aria-label="操作メニューを開く"
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen((v) => !v)}
          className="rounded-full p-3 text-[#8b91a1] transition hover:bg-[#eef4fb] hover:text-[#567baf]"
        >
          <MoreVertical size={22} strokeWidth={2.3} aria-hidden="true" />
        </button>
        {menuOpen && (
          <div
            role="menu"
            className="absolute right-0 top-full z-[120] mt-2 min-w-[220px] rounded-2xl border border-white/80 bg-white/95 p-2 shadow-[0_18px_44px_rgba(31,34,48,0.16)] backdrop-blur-xl"
          >
            <label
              className={`flex w-full cursor-pointer items-center gap-3 whitespace-nowrap rounded-xl px-3.5 py-3 text-left text-sm font-bold text-[#3f4352] transition hover:bg-[#eef4fb] ${
                busy ? 'opacity-50 cursor-not-allowed' : ''
              }`}
            >
              <RefreshCcw size={16} strokeWidth={2.3} aria-hidden="true" />
              {isReplacing ? '差し替え中...' : '画像差し替え'}
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp"
                className="sr-only"
                onChange={(e) => {
                  setMenuOpen(false);
                  onFileChange(e);
                }}
                disabled={busy}
              />
            </label>
            <button
              type="button"
              role="menuitem"
              disabled={busy}
              onClick={() => {
                setMenuOpen(false);
                onEditMetadata();
              }}
              className="flex w-full items-center gap-3 whitespace-nowrap rounded-xl px-3.5 py-3 text-left text-sm font-bold text-[#3f4352] transition hover:bg-[#eef4fb] disabled:opacity-50"
            >
              <FileText size={16} strokeWidth={2.3} aria-hidden="true" />
              分析メモ
            </button>
            <button
              type="button"
              role="menuitem"
              disabled={busy}
              onClick={() => {
                setMenuOpen(false);
                onDuplicate();
              }}
              className="flex w-full items-center gap-3 whitespace-nowrap rounded-xl px-3.5 py-3 text-left text-sm font-bold text-[#3f4352] transition hover:bg-[#eef4fb] disabled:opacity-50"
            >
              <Copy size={16} strokeWidth={2.3} aria-hidden="true" />
              {isDuplicating ? '複製中...' : 'セクション複製'}
            </button>
            <button
              type="button"
              role="menuitem"
              disabled={busy}
              onClick={() => {
                setMenuOpen(false);
                onEditCtas();
              }}
              className="flex w-full items-center gap-3 whitespace-nowrap rounded-xl px-3.5 py-3 text-left text-sm font-bold text-[#567baf] transition hover:bg-[#567baf]/10 disabled:opacity-50"
            >
              <ImagePlus size={16} strokeWidth={2.3} aria-hidden="true" />
              ボタン追加{section.ctas.length > 0 ? `（${section.ctas.length}）` : ''}
            </button>
            <button
              type="button"
              role="menuitem"
              disabled={busy}
              onClick={() => {
                setMenuOpen(false);
                onDelete();
              }}
              className="flex w-full items-center gap-3 whitespace-nowrap rounded-xl px-3.5 py-3 text-left text-sm font-bold text-red-700 transition hover:bg-red-50 disabled:opacity-50"
            >
              <Trash2 size={16} strokeWidth={2.3} aria-hidden="true" />
              {isDeleting ? '削除中...' : '削除'}
            </button>
          </div>
        )}
      </div>
      {rowDragOver && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center rounded-2xl bg-[#567baf]/18">
          <span className="rounded-full bg-[#567baf] px-4 py-2 text-sm font-extrabold text-white shadow-[0_14px_28px_rgba(86,123,175,0.24)]">
            ドロップして画像を差し替え
          </span>
        </div>
      )}
    </div>
  );
}

function SectionMetadataEditor({
  section,
  busy,
  onClose,
  onSave,
}: {
  section: Section;
  busy: boolean;
  onClose: () => void;
  onSave: (patch: SectionMetadataPatch) => Promise<void>;
}) {
  const [draft, setDraft] = useState<Record<SectionMetadataKey, string>>(() =>
    sectionMetadataDraft(section)
  );
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setDraft(sectionMetadataDraft(section));
  }, [
    section.id,
    section.label,
    section.role,
    section.intent,
    section.image_description,
    section.visible_copy_summary,
    section.notes_for_analysis,
  ]);

  async function handleSave() {
    if (saving || busy) return;
    setSaving(true);
    try {
      await onSave(cleanSectionMetadataDraft(draft));
      onClose();
    } catch {
      // Caller surfaces the toast and keeps the modal open.
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      className="admin-modal-backdrop fixed inset-0 z-50 flex items-center justify-center bg-[#1f2230]/72 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label="セクション分析メモ"
      onClick={() => {
        if (!saving) onClose();
      }}
    >
      <div
        className="w-full max-w-2xl rounded-2xl bg-white shadow-[0_28px_80px_rgba(31,34,48,0.28)]"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-center justify-between gap-3 border-b border-[#e2e7f0] px-5 py-4">
          <div className="min-w-0">
            <h2 className="text-base font-extrabold text-[#3f4352]">
              セクション分析メモ
            </h2>
            <p className="mt-1 truncate text-xs font-semibold text-[#8b91a1]">
              {section.image.alt || section.id}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="rounded-full px-3 py-2 text-xs font-extrabold text-[#8b91a1] transition hover:bg-[#eef4fb] hover:text-[#567baf] disabled:opacity-50"
          >
            閉じる
          </button>
        </header>
        <div className="grid gap-4 px-5 py-5 sm:grid-cols-2">
          {SECTION_METADATA_FIELDS.map((field) => {
            const multiline =
              field.key === 'intent' ||
              field.key === 'image_description' ||
              field.key === 'visible_copy_summary' ||
              field.key === 'notes_for_analysis';
            return (
              <label
                key={field.key}
                className={`flex min-w-0 flex-col gap-1.5 ${
                  multiline ? 'sm:col-span-2' : ''
                }`}
              >
                <span className="text-xs font-extrabold text-[#596173]">
                  {field.label}
                </span>
                {multiline ? (
                  <textarea
                    value={draft[field.key]}
                    onChange={(e) =>
                      setDraft((cur) => ({
                        ...cur,
                        [field.key]: e.target.value,
                      }))
                    }
                    placeholder={field.placeholder}
                    className={`${EDITOR_INPUT_CLASS} min-h-20 w-full resize-y`}
                    maxLength={500}
                  />
                ) : (
                  <input
                    type="text"
                    value={draft[field.key]}
                    onChange={(e) =>
                      setDraft((cur) => ({
                        ...cur,
                        [field.key]: e.target.value,
                      }))
                    }
                    placeholder={field.placeholder}
                    className={`${EDITOR_INPUT_CLASS} w-full`}
                    maxLength={120}
                  />
                )}
              </label>
            );
          })}
        </div>
        <footer className="flex justify-end gap-2 border-t border-[#e2e7f0] px-5 py-4">
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className={`${EDITOR_SECONDARY_BUTTON_CLASS} min-h-10 px-4 py-2 text-xs`}
          >
            キャンセル
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={saving || busy}
            className={`${EDITOR_PRIMARY_BUTTON_CLASS} min-h-10 px-4 py-2 text-xs`}
          >
            {saving ? '保存中...' : '保存'}
          </button>
        </footer>
      </div>
    </div>
  );
}

interface InsertSlotProps {
  busy: boolean;
  onPick: (files: File[]) => void;
}

function InsertSlot({ busy, onPick }: InsertSlotProps) {
  function onChange(e: React.ChangeEvent<HTMLInputElement>) {
    const files = e.target.files ? Array.from(e.target.files) : [];
    e.target.value = '';
    if (files.length > 0) onPick(files);
  }

  return (
    <label
      className={`group relative block py-1.5 z-20 transition-all ${
        busy ? 'pointer-events-none opacity-50' : 'cursor-pointer'
      }`}
    >
      {/* thin guide line */}
      <span className="pointer-events-none absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-transparent transition-colors group-hover:bg-[#9bb4d6]" />
      {/* hover-only image section insert pill */}
      <span className="pointer-events-none absolute left-1/2 top-1/2 z-30 flex min-h-9 -translate-x-1/2 -translate-y-1/2 items-center gap-1 rounded-full bg-[#567baf] px-3 text-xs font-extrabold text-white opacity-0 shadow-[0_12px_24px_rgba(86,123,175,0.2)] transition-opacity group-hover:opacity-100 whitespace-nowrap">
        <ImagePlus size={14} strokeWidth={2.4} aria-hidden="true" />
        画像セクションを追加
      </span>
      <input
        type="file"
        accept="image/png,image/jpeg,image/webp"
        multiple
        className="sr-only"
        onChange={onChange}
        disabled={busy}
      />
    </label>
  );
}

function sectionMetadataDraft(
  section: Section
): Record<SectionMetadataKey, string> {
  return SECTION_METADATA_FIELDS.reduce(
    (acc, field) => ({
      ...acc,
      [field.key]: section[field.key] ?? '',
    }),
    {} as Record<SectionMetadataKey, string>
  );
}

function cleanSectionMetadataDraft(
  draft: Record<SectionMetadataKey, string>
): SectionMetadataPatch {
  const patch: SectionMetadataPatch = {};
  for (const field of SECTION_METADATA_FIELDS) {
    const value = draft[field.key].trim();
    patch[field.key] = value.length > 0 ? value : undefined;
  }
  return patch;
}

function applySectionMetadataPatch(
  section: Section,
  patch: SectionMetadataPatch
): Section {
  const next: Section = { ...section };
  for (const field of SECTION_METADATA_FIELDS) {
    const hasPatchValue = Object.prototype.hasOwnProperty.call(patch, field.key);
    const rawValue = hasPatchValue ? patch[field.key] : next[field.key];
    const value = (rawValue ?? '').trim();
    if (value.length > 0) {
      next[field.key] = value;
    } else {
      delete next[field.key];
    }
  }
  return next;
}

async function readImageDimensions(
  file: Blob
): Promise<{ width: number; height: number }> {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return { width: img.naturalWidth, height: img.naturalHeight };
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function readApiError(res: Response, fallback: string): Promise<string> {
  try {
    const data = (await res.json()) as ApiError;
    return data?.error?.message ?? `${fallback} (${res.status})`;
  } catch {
    return `${fallback} (${res.status})`;
  }
}

function withWebpExt(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot === -1 ? `${name}.webp` : `${name.slice(0, dot)}.webp`;
}

interface ArchivePaneProps {
  items: ArchivedSection[];
  open: boolean;
  busy: boolean;
  onToggle: () => void;
  onRestore: (id: string) => void;
  onPermanentDelete: (id: string) => void;
}

function ArchivePane({
  items,
  open,
  busy,
  onToggle,
  onRestore,
  onPermanentDelete,
}: ArchivePaneProps) {
  return (
    <div className={`${EDITOR_SUB_PANEL_CLASS} mt-5 border border-white/75 backdrop-blur-xl`}>
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center justify-between gap-3 rounded-xl px-2 py-1 text-left text-sm font-extrabold text-[#3f4352] transition hover:text-[#567baf]"
        aria-expanded={open}
      >
        <span>削除済みセクション （{items.length}）</span>
        <CollapseToggleIcon open={open} />
      </button>

      {open && (
        <ul className="mt-3 space-y-2">
          {items.map((item) => (
            <li
              key={item.id}
              className="flex items-center gap-3 rounded-2xl bg-white/82 p-3 shadow-[0_10px_26px_rgba(31,34,48,0.06)] sm:p-4"
            >
              <img
                src={item.image.url}
                alt={item.image.alt ?? ''}
                className="h-16 w-16 shrink-0 rounded-xl bg-[#eef4fb] object-cover"
                loading="lazy"
              />
              <div className="min-w-0 flex-1 text-xs text-[#596173]">
                <div className="truncate font-extrabold text-[#3f4352]">
                  CTA {item.ctas.length} 個 / {item.image.width}×
                  {item.image.height}
                </div>
                <div className="mt-1 text-[11px] font-semibold text-[#8b91a1]">
                  削除日： {formatArchivedAt(item.archived_at)}
                </div>
              </div>
              <div className="flex shrink-0 gap-2">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => onRestore(item.id)}
                  className={`${EDITOR_SECONDARY_BUTTON_CLASS} min-h-[2.5rem] px-3 py-2 text-xs`}
                >
                  復元
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => onPermanentDelete(item.id)}
                  className={`${EDITOR_DANGER_BUTTON_CLASS} min-h-[2.5rem] px-3 py-2 text-xs`}
                >
                  完全削除
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function formatArchivedAt(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const pad = (n: number) => n.toString().padStart(2, '0');
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ` +
    `${pad(d.getHours())}:${pad(d.getMinutes())}`
  );
}
