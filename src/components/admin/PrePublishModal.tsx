/**
 * PrePublishModal
 *
 * Shown the first time the operator clicks "公開する" on an LP. Surfaces
 * the publish-readiness issues from src/lib/publish-check so they can
 * fix anything obvious (missing CTA, missing meta, no tracking) before
 * the LP goes live.
 *
 * Severity → behaviour:
 *   blocker — disables the publish button until the operator dismisses
 *             or fixes it
 *   warning — shown prominently but doesn't block publish
 *   info    — small note, doesn't block
 *
 * Each issue is clickable: in-page anchors scroll the editor, external
 * URLs open in a new tab so the publish flow isn't lost.
 *
 * The "次回以降このLPでは表示しない" toggle persists per-LP in
 * localStorage. LpActions checks that key before opening the modal.
 */

import { useState } from 'react';
import {
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  Info,
  MoveUpRight,
} from 'lucide-react';
import {
  hasBlockers,
  type CheckIssue,
  type CheckJump,
} from '../../lib/publish-check';
import AdminModal from './AdminModal';

interface Props {
  lpId: string;
  issues: CheckIssue[];
  publishing: boolean;
  onConfirm: (dismissForFuture: boolean) => void;
  onClose: () => void;
}

const SEVERITY_BADGE: Record<
  CheckIssue['severity'],
  { label: string; cardClasses: string; badgeClasses: string; iconClasses: string }
> = {
  blocker: {
    label: '必須',
    cardClasses: 'border-red-100 bg-red-50/80 text-red-800',
    badgeClasses: 'bg-white/80 text-red-700',
    iconClasses: 'bg-white text-red-600',
  },
  warning: {
    label: '推奨',
    cardClasses: 'border-amber-100 bg-amber-50/85 text-amber-800',
    badgeClasses: 'bg-white/80 text-amber-700',
    iconClasses: 'bg-white text-amber-600',
  },
  info: {
    label: '情報',
    cardClasses: 'border-[#d7deea] bg-[#f7f9fc] text-[#567baf]',
    badgeClasses: 'bg-white text-[#567baf]',
    iconClasses: 'bg-white text-[#567baf]',
  },
};

function SeverityIcon({ severity }: { severity: CheckIssue['severity'] }) {
  const className = "h-4 w-4";
  if (severity === 'blocker') {
    return <AlertCircle className={className} strokeWidth={2.4} aria-hidden="true" />;
  }
  if (severity === 'warning') {
    return <AlertTriangle className={className} strokeWidth={2.4} aria-hidden="true" />;
  }
  return <Info className={className} strokeWidth={2.4} aria-hidden="true" />;
}

export default function PrePublishModal({
  lpId: _lpId,
  issues,
  publishing,
  onConfirm,
  onClose,
}: Props) {
  const [dismiss, setDismiss] = useState(false);
  const blocked = hasBlockers(issues);
  const hasAny = issues.length > 0;

  function jump(jumpTo: CheckJump) {
    if (jumpTo.type === 'url') {
      // Navigate in the same tab so the modal naturally closes. The
      // user can come back via the browser back button, then re-click
      // "公開する" to re-run the check against the now-updated state.
      window.location.href = jumpTo.href;
      return;
    }
    const el = document.getElementById(jumpTo.id);
    if (el) {
      // Auto-open any collapsed disclosure (accordion header) inside
      // the target so the operator lands on the open form. The
      // :not([aria-haspopup]) filter avoids triggering popover-style
      // controls like the per-section kebab menu, which would surface
      // an unrelated action list instead.
      const collapsedToggle = el.querySelector<HTMLButtonElement>(
        'button[aria-expanded="false"]:not([aria-haspopup])'
      );
      if (collapsedToggle) collapsedToggle.click();

      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      // Brief flash so the destination is obvious in a long page.
      el.style.transition = 'box-shadow 0.6s';
      el.style.boxShadow = '0 0 0 3px rgba(59, 130, 246, 0.45)';
      window.setTimeout(() => {
        el.style.boxShadow = '';
      }, 1100);
      onClose();
    }
  }

  return (
    <AdminModal
      ariaLabel="公開前チェック"
      zIndexClass="z-50"
      maxWidthClass="max-w-[34rem]"
      maxHeightClass="max-h-[calc(100dvh-2rem)]"
      overflowClass="overflow-hidden"
      panelClassName="flex flex-col border-white/80"
      closeOnBackdrop={!publishing}
      onClose={onClose}
    >
        <header className="border-b border-[#e2e7f0] px-6 py-5 sm:px-7">
          <div className="flex items-start gap-3">
            <span
              className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl ${
                blocked ? 'bg-red-50 text-red-600' : 'bg-emerald-50 text-emerald-600'
              }`}
              aria-hidden="true"
            >
              {blocked ? (
                <AlertCircle className="h-5 w-5" strokeWidth={2.4} />
              ) : (
                <CheckCircle2 className="h-5 w-5" strokeWidth={2.4} />
              )}
            </span>
            <div className="min-w-0">
              <h2 className="text-lg font-extrabold leading-snug text-[#3f4352]">
                公開前チェック
              </h2>
              {!hasAny && (
                <p className="mt-1 text-sm font-bold text-emerald-700">
                  このまま公開できます
                </p>
              )}
              {hasAny && !blocked && (
                <>
                  <p className="mt-1 text-sm font-bold text-emerald-700">
                    このまま公開できます
                  </p>
                  <p className="mt-1 text-xs font-semibold leading-relaxed text-[#7f8797]">
                    推奨項目があります。気になる箇所はクリックで修正に移動できます。
                  </p>
                </>
              )}
              {blocked && (
                <p className="mt-1 text-sm font-bold leading-relaxed text-red-700">
                  必須項目を解決してから公開できます
                </p>
              )}
            </div>
          </div>
        </header>

        <div className="flex-1 space-y-3 overflow-auto px-6 py-5 sm:px-7">
          {issues.length === 0 && (
            <p className="rounded-2xl border border-emerald-100 bg-emerald-50/80 px-4 py-3 text-sm font-semibold text-emerald-700">
              すべて問題ありません。
            </p>
          )}
          {issues.map((issue) => {
            const sev = SEVERITY_BADGE[issue.severity];
            const hasJump = issue.jumpTo !== undefined;
            const Wrapper = hasJump ? 'button' : 'div';
            const interactiveProps = hasJump
              ? {
                  type: 'button' as const,
                  onClick: () => jump(issue.jumpTo!),
                }
              : {};
            return (
              <Wrapper
                key={issue.key}
                {...interactiveProps}
                className={`w-full rounded-2xl border px-4 py-3 text-left shadow-[0_10px_24px_rgba(31,34,48,0.045)] ${sev.cardClasses} ${hasJump ? 'cursor-pointer transition hover:-translate-y-0.5 hover:shadow-[0_14px_30px_rgba(31,34,48,0.075)]' : ''}`}
              >
                <div className="flex items-start gap-3">
                  <span
                    className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${sev.iconClasses}`}
                  >
                    <SeverityIcon severity={issue.severity} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-extrabold">
                        {issue.label}
                      </span>
                      <span className={`rounded-full px-2 py-0.5 text-[10px] font-extrabold ${sev.badgeClasses}`}>
                        {sev.label}
                      </span>
                    </div>
                    {issue.description && (
                      <p className="mt-1 text-xs font-semibold leading-relaxed opacity-90">
                        {issue.description}
                      </p>
                    )}
                    {hasJump && (
                      <span className="mt-2 inline-flex items-center gap-1 text-xs font-extrabold underline underline-offset-4">
                        {issue.jumpTo!.type === 'url'
                          ? '→ 設定ページへ移動'
                          : '↑ 修正箇所に移動'}
                        <MoveUpRight className="h-3.5 w-3.5" strokeWidth={2.4} aria-hidden="true" />
                      </span>
                    )}
                  </div>
                </div>
              </Wrapper>
            );
          })}
        </div>

        <footer className="flex flex-col gap-3 border-t border-[#e2e7f0] px-6 py-4 sm:px-7">
          <label className="flex cursor-pointer items-center gap-2 text-xs font-semibold text-[#7f8797]">
            <input
              type="checkbox"
              checked={dismiss}
              onChange={(e) => setDismiss(e.target.checked)}
              className="h-4 w-4 accent-[#567baf]"
            />
            次回以降このLPでは表示しない
          </label>
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <button
              type="button"
              onClick={onClose}
              disabled={publishing}
              className="min-h-12 rounded-full bg-[#f2f4f8] px-5 py-3 text-sm font-extrabold text-[#596173] transition hover:bg-[#e9edf4] disabled:opacity-50"
            >
              キャンセル
            </button>
            <button
              type="button"
              onClick={() => onConfirm(dismiss)}
              disabled={blocked || publishing}
              className="min-h-12 rounded-full bg-gradient-to-r from-emerald-500 to-emerald-700 px-6 py-3 text-sm font-extrabold text-white shadow-[0_16px_30px_rgba(15,186,117,0.26)] transition hover:from-emerald-600 hover:to-emerald-800 disabled:cursor-not-allowed disabled:opacity-50"
              title={
                blocked ? '必須項目を解決してから公開できます' : undefined
              }
            >
              {publishing ? '公開中...' : '公開する'}
            </button>
          </div>
        </footer>
    </AdminModal>
  );
}
