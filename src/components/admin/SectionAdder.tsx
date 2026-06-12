/**
 * SectionAdder
 *
 * Button + hidden file input that lets the user pick one or many
 * image files (PNG/JPG/WebP) or a ZIP archive of images. Each
 * selected file is processed by the shared client-side pipeline
 * (compress -> upload -> append section). On completion the page
 * reloads so the server-rendered list reflects the newest content.
 */

import { useRef, useState } from 'react';
import { ImagePlus } from 'lucide-react';
import { processFiles } from '../../lib/upload';
import { showAdminToast } from '../../lib/admin-toast';
import { EDITOR_PRIMARY_BUTTON_CLASS } from './LpEditorPrimitives';

interface Props {
  lpId: string;
}

export default function SectionAdder({ lpId }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState('');

  function openPicker() {
    if (busy) return;
    inputRef.current?.click();
  }

  async function onFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const files = e.target.files ? Array.from(e.target.files) : [];
    e.target.value = '';
    if (files.length === 0) return;

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
    <>
      <input
        ref={inputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp,.zip"
        multiple
        className="hidden"
        onChange={onFileChange}
      />
      <button
        type="button"
        disabled={busy}
        onClick={openPicker}
        className={`section-add-button ${EDITOR_PRIMARY_BUTTON_CLASS} min-h-14 gap-2 px-5 py-3 text-base sm:min-h-[2.75rem] sm:px-4 sm:py-2 sm:text-sm`}
        title="画像 / 複数選択 / ZIP対応"
      >
        {!busy && <ImagePlus size={17} strokeWidth={2.4} aria-hidden="true" />}
        <span>{busy ? progress || '処理中...' : '画像セクションを追加'}</span>
      </button>
    </>
  );
}
