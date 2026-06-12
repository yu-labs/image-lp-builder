import type { ReactNode } from 'react';
import { X } from 'lucide-react';
import AdminModal from './AdminModal';

interface Props {
  slug: string;
  busy: boolean;
  error: string | null;
  preview?: ReactNode;
  onSlugChange: (value: string) => void;
  onSubmit: () => void;
  onClose: () => void;
}

export default function LpDuplicateModal({
  slug,
  busy,
  error,
  preview,
  onSlugChange,
  onSubmit,
  onClose,
}: Props) {
  return (
    <AdminModal
      as="form"
      ariaLabel="LPを複製"
      closeOnBackdrop={!busy}
      onClose={onClose}
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit();
      }}
      panelClassName="p-5 sm:p-6"
    >
        <div className="mb-4 flex items-start justify-between gap-3">
          <div className="space-y-1">
            <h2 className="text-base font-bold text-[#3f4352]">
              このLPを複製します
            </h2>
            <p className="text-xs font-semibold leading-[1.45] text-[#8b91a1]">
              画像・ボタン・見た目をコピーし、公開設定や短縮URLはリセットします。
            </p>
          </div>
          <button
            type="button"
            aria-label="閉じる"
            disabled={busy}
            onClick={onClose}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[#9aa1ae] transition hover:bg-[#f2f4f8] hover:text-[#3f4352] disabled:opacity-50"
          >
            <X size={18} strokeWidth={2.5} aria-hidden="true" />
          </button>
        </div>

        <div className="space-y-4">
          {preview}

          <div className="grid gap-3 rounded-2xl bg-[#f6f8fb] p-3 text-sm">
            <InfoBlock
              title="コピーされるもの"
              items={['LP画像', 'ボタン', '背景色や表示幅などの見た目']}
            />
            <InfoBlock
              title="コピーされないもの"
              items={[
                '公開状態',
                'URL',
                '検索/SNS用のタイトル・説明・OGP画像',
                '予約公開、パスワード、短縮URLなどの運用設定',
              ]}
            />
          </div>

          <label className="block">
            <span className="text-sm font-semibold text-[#3f4352]">URL末尾</span>
            <input
              value={slug}
              onChange={(event) => onSlugChange(event.currentTarget.value)}
              className="mt-2 w-full rounded-xl border border-[#d7deea] px-3 py-3 text-base text-[#3f4352] outline-none focus:border-[#9bb4d6] focus:ring-2 focus:ring-[#d8e3f2]"
              placeholder="new-lp-url"
              autoFocus
            />
          </label>

          {error && (
            <p className="rounded-xl bg-red-50 px-3 py-2 text-sm font-semibold text-red-700">
              {error}
            </p>
          )}

          <div className="flex justify-end gap-2 pt-1">
            <button
              type="button"
              disabled={busy}
              onClick={onClose}
              className="rounded-full px-4 py-2 text-sm font-semibold text-[#596173] hover:bg-[#f2f4f8] disabled:opacity-50"
            >
              キャンセル
            </button>
            <button
              type="submit"
              disabled={busy}
              className="rounded-full bg-[#567baf] px-4 py-2 text-sm font-semibold text-white shadow-[0_10px_22px_rgba(86,123,175,0.24)] hover:bg-[#4c6f9f] disabled:opacity-50"
            >
              {busy ? '複製中...' : '複製して編集へ'}
            </button>
          </div>
        </div>
    </AdminModal>
  );
}

function InfoBlock({ title, items }: { title: string; items: string[] }) {
  return (
    <div>
      <p className="text-xs font-bold text-[#596173]">{title}</p>
      <ul className="mt-1 space-y-1 text-xs leading-relaxed text-[#7f8797]">
        {items.map((item) => (
          <li key={item}>・{item}</li>
        ))}
      </ul>
    </div>
  );
}
