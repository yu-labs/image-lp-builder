/**
 * DropZone
 *
 * A drag-and-drop target that accepts the same inputs as SectionAdder:
 * loose images (PNG/JPG/WebP) or a ZIP archive containing images.
 * Files dropped here go through the shared upload pipeline.
 *
 * Visual states:
 * - idle: dashed border, neutral colors
 * - drag-over: highlighted border + subtle background tint
 * - busy: progress text, blocking new drops
 */

import { useState } from 'react';
import { showAdminToast } from '../../lib/admin-toast';
import { processFiles } from '../../lib/upload';
import ImageUploadDropBox from './ImageUploadDropBox';

interface Props {
  lpId: string;
  compact?: boolean;
}

export default function DropZone({ lpId, compact = false }: Props) {
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState('');

  async function processSelected(files: File[]) {
    if (busy || files.length === 0) return;
    setBusy(true);
    try {
      const results = await processFiles(files, lpId, (p) => {
        const stageLabel =
          p.stage === 'compressing'
            ? '変換中'
            : p.stage === 'uploading'
              ? 'アップロード中'
              : '保存中';
        setProgress(`${p.current}/${p.total} ${stageLabel}: ${p.fileName}`);
      });

      const succeeded = results.filter((r) => r.ok).length;
      const failed = results.filter((r) => !r.ok);

      if (failed.length > 0) {
        const detail = failed
          .map((f) => `- ${f.fileName}: ${f.error}`)
          .join('\n');
        showAdminToast({
          tone: 'danger',
          message: `${succeeded}件追加、${failed.length}件失敗\n${detail}`,
        });
      } else if (succeeded === 0) {
        showAdminToast({
          tone: 'danger',
          message: '画像ファイルが見つかりませんでした（PNG/JPG/WebP/ZIPに対応）',
        });
      }

      if (succeeded > 0) {
        window.location.reload();
        return;
      }
    } catch (err) {
      showAdminToast({
        tone: 'danger',
        message: `エラー： ${err instanceof Error ? err.message : String(err)}`,
      });
    } finally {
      setBusy(false);
      setProgress('');
    }
  }

  return (
    <ImageUploadDropBox
      accept="image/png,image/jpeg,image/webp,.zip"
      busy={busy}
      buttonLabel="画像セクションを追加"
      compact={compact}
      description={
        <>
          PNG / JPG / WebP（複数可）<br />
          画像をまとめたZIPも対応
        </>
      }
      multiple
      onFiles={(files) => void processSelected(files)}
      progress={progress}
      title="LP画像をドラッグ&ドロップ"
    />
  );
}
