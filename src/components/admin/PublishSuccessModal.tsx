/**
 * PublishSuccessModal
 *
 * Shown after a successful publish or unpublish so the operator gets
 * a clear confirmation beat instead of just a silent page reload.
 * The `kind` prop swaps the copy and (for "published") shows the live
 * URL with a "別タブで開く" link.
 */

import { CheckCircle2, ExternalLink, EyeOff } from 'lucide-react';
import AdminModal from './AdminModal';

interface Props {
  kind: 'published' | 'unpublished';
  publicUrl?: string;
  onClose: () => void;
}

export default function PublishSuccessModal({
  kind,
  publicUrl,
  onClose,
}: Props) {
  const isPublished = kind === 'published';
  return (
    <AdminModal
      ariaLabel={isPublished ? '公開完了' : '公開停止完了'}
      zIndexClass="z-50"
      maxWidthClass="max-w-[30rem]"
      maxHeightClass="max-h-[calc(100dvh-2rem)]"
      overflowClass="overflow-hidden"
      panelClassName="flex flex-col border-white/80"
      onClose={onClose}
    >
        <div className="flex-1 overflow-y-auto px-6 py-7 text-center sm:px-8">
          <div
            className={`mx-auto flex h-14 w-14 items-center justify-center rounded-2xl ${
              isPublished
                ? 'bg-emerald-50 text-emerald-600'
                : 'bg-[#eef4fb] text-[#567baf]'
            }`}
            aria-hidden="true"
          >
            {isPublished ? (
              <CheckCircle2 className="h-7 w-7" strokeWidth={2.4} />
            ) : (
              <EyeOff className="h-7 w-7" strokeWidth={2.4} />
            )}
          </div>

          <h2 className="mt-4 text-xl font-extrabold leading-snug text-[#3f4352]">
            {isPublished ? '公開できました' : '公開を停止しました'}
          </h2>
          <p className="mt-2 text-sm font-semibold leading-relaxed text-[#7f8797]">
            {isPublished ? (
              <>
                LPが公開されました。<br />
                下のリンクから実際の見た目を確認できます。
              </>
            ) : (
              <>
                LPは非公開になりました。<br />
                編集すると新しい下書きが作成され、再公開できます。
              </>
            )}
          </p>

          {isPublished && publicUrl && (
            <>
              <div className="mt-5 w-full rounded-2xl border border-[#d7deea] bg-[#f7f9fc] p-4 text-left">
                <div className="mb-1 text-[11px] font-extrabold text-[#8b91a1]">
                  公開URL
                </div>
                <code className="block break-all font-mono text-xs font-semibold leading-relaxed text-[#3f4352]">
                  {publicUrl}
                </code>
              </div>

              <a
                href={publicUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-4 inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-full bg-gradient-to-r from-emerald-500 to-emerald-700 px-5 py-3 text-sm font-extrabold text-white shadow-[0_16px_30px_rgba(15,186,117,0.26)] transition hover:from-emerald-600 hover:to-emerald-800"
              >
                公開URLを開く
                <ExternalLink className="h-4 w-4" strokeWidth={2.4} aria-hidden="true" />
              </a>
            </>
          )}
        </div>

        <footer className="flex justify-end border-t border-[#e2e7f0] px-5 py-4">
          <button
            type="button"
            onClick={onClose}
            className="min-h-11 rounded-full bg-[#f2f4f8] px-5 py-2 text-sm font-extrabold text-[#596173] transition hover:bg-[#e9edf4]"
          >
            閉じる
          </button>
        </footer>
    </AdminModal>
  );
}
