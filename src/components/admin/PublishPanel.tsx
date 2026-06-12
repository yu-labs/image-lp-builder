/**
 * PublishPanel
 *
 * Renders publish-related settings and pending-publication notices.
 *
 * URL editing lives in LpPublicUrlControl near the LP title.
 */

import { useEffect, useState } from 'react';
import { confirmAdminAction } from '../../lib/admin-dialog';
import { showAdminToast } from '../../lib/admin-toast';
import {
  notifyLpPasswordStateChanged,
  notifyLpScheduleStateChanged,
} from '../../lib/lp-events';
import {
  EDITOR_DANGER_BUTTON_CLASS,
  EDITOR_DIVIDER_CLASS,
  EDITOR_HELP_CLASS,
  EDITOR_INPUT_CLASS,
  EDITOR_LABEL_CLASS,
  EDITOR_PRIMARY_BUTTON_CLASS,
  EDITOR_SECONDARY_BUTTON_CLASS,
  EDITOR_TIGHT_STACK_CLASS,
  EditorPanel,
  EditorSectionHeader,
} from './LpEditorPrimitives';

interface Props {
  lpId: string;
  /** ISO datetime of when the LP becomes visible. null = no schedule. */
  initialPublishAt: string | null;
  /** ISO datetime of when the LP stops being visible. null = no expiry. */
  initialUnpublishAt: string | null;
  /** Whether the LP currently has a password set. The actual password
   * is never sent to the client — we just need to know the on/off state. */
  initialPasswordProtected: boolean;
}

type ApiError = { success: false; error: { code: string; message: string } };

const LABEL_CLASS = EDITOR_LABEL_CLASS;
const HELP_CLASS = EDITOR_HELP_CLASS;
const INPUT_CLASS = EDITOR_INPUT_CLASS;
const PRIMARY_BUTTON_CLASS = EDITOR_PRIMARY_BUTTON_CLASS;
const SECONDARY_BUTTON_CLASS = EDITOR_SECONDARY_BUTTON_CLASS;
const DANGER_BUTTON_CLASS = EDITOR_DANGER_BUTTON_CLASS;
const SECTION_DIVIDER_CLASS = EDITOR_DIVIDER_CLASS;
const SCHEDULE_ORDER_ERROR =
  '公開開始日時は公開停止日時より前にしてください';
const SCHEDULE_PAST_DATE_ERROR =
  '本日より前の日付は選択できません';

export default function PublishPanel({
  lpId,
  initialPublishAt,
  initialUnpublishAt,
  initialPasswordProtected,
}: Props) {
  const [publishAt, setPublishAt] = useState<string>(
    toLocalInput(initialPublishAt)
  );
  const [unpublishAt, setUnpublishAt] = useState<string>(
    toLocalInput(initialUnpublishAt)
  );
  const [savedPublishAt, setSavedPublishAt] = useState<string | null>(
    normalizeInitialSchedule(initialPublishAt)
  );
  const [savedUnpublishAt, setSavedUnpublishAt] = useState<string | null>(
    normalizeInitialSchedule(initialUnpublishAt)
  );
  const [savingSchedule, setSavingSchedule] = useState<
    'save' | 'clear' | null
  >(null);
  const [scheduleError, setScheduleError] = useState<string | null>(null);
  const [passwordProtected, setPasswordProtected] = useState(
    initialPasswordProtected
  );
  const [passwordDraft, setPasswordDraft] = useState('');
  const [changingPassword, setChangingPassword] = useState(false);
  const [passwordAction, setPasswordAction] = useState<'save' | 'remove' | null>(
    null
  );

  useEffect(() => {
    let cancelled = false;

    async function refreshPasswordState() {
      try {
        const res = await fetch(`/api/lps/${lpId}`);
        if (!res.ok) return;
        const json = (await res.json()) as {
          success: true;
          data: {
            password_hash?: string | null;
            publish_at?: string | null;
            unpublish_at?: string | null;
          };
        };
        if (cancelled) return;
        const nextProtected = Boolean(json.data?.password_hash);
        setPasswordProtected(nextProtected);
        notifyLpPasswordStateChanged(nextProtected);
        notifyLpScheduleStateChanged(
          Boolean(json.data?.publish_at || json.data?.unpublish_at)
        );
        if (!nextProtected) {
          setChangingPassword(false);
        }
      } catch {
        // ignore — the server-rendered value remains the fallback.
      }
    }

    function onVisibleAgain() {
      void refreshPasswordState();
    }

    void refreshPasswordState();
    window.addEventListener('pageshow', onVisibleAgain);
    window.addEventListener('focus', onVisibleAgain);
    return () => {
      cancelled = true;
      window.removeEventListener('pageshow', onVisibleAgain);
      window.removeEventListener('focus', onVisibleAgain);
    };
  }, [lpId]);

  async function patch(body: object, onDone: () => void): Promise<boolean> {
    try {
      const res = await fetch(`/api/lps/${lpId}/settings`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(await readApiError(res, '更新失敗'));
      return true;
    } catch (err) {
      showAdminToast({
        tone: 'danger',
        message: `保存できませんでした：${err instanceof Error ? err.message : String(err)}`,
      });
      return false;
    } finally {
      onDone();
    }
  }

  async function clearSchedule() {
    const confirmed = await confirmAdminAction({
      title: '公開スケジュールを解除しますか?',
      message:
        '公開開始日時・公開停止日時を削除します。\nすでに公開中になっているLPは、解除後も公開中のままです。',
      confirmLabel: '解除する',
      tone: 'warning',
    });
    if (!confirmed) return;

    setSavingSchedule('clear');
    const ok = await patch({ publishAt: null, unpublishAt: null }, () =>
      setSavingSchedule(null)
    );
    if (!ok) return;
    setPublishAt('');
    setUnpublishAt('');
    setSavedPublishAt(null);
    setSavedUnpublishAt(null);
    setScheduleError(null);
    notifyLpScheduleStateChanged(false);
    showAdminToast({ message: '公開スケジュールを解除しました', tone: 'info' });
  }

  function resetScheduleInput(kind: 'publish' | 'unpublish') {
    if (kind === 'publish') {
      setPublishAt('');
    } else {
      setUnpublishAt('');
    }
    setScheduleError(null);
  }

  async function saveSchedule() {
    const nextPublishAt = fromLocalInput(publishAt);
    const nextUnpublishAt = fromLocalInput(unpublishAt);

    if (isBeforeTodayLocalInput(publishAt) || isBeforeTodayLocalInput(unpublishAt)) {
      setScheduleError(SCHEDULE_PAST_DATE_ERROR);
      showAdminToast({ message: SCHEDULE_PAST_DATE_ERROR, tone: 'danger' });
      return;
    }

    if (!validateScheduleOrder(nextPublishAt, nextUnpublishAt)) return;

    if (!nextPublishAt && !nextUnpublishAt) {
      const message = '公開開始日時または公開停止日時を選択してください';
      setScheduleError(message);
      showAdminToast({ message, tone: 'danger' });
      return;
    }
    if (
      nextPublishAt === savedPublishAt &&
      nextUnpublishAt === savedUnpublishAt
    ) {
      return;
    }

    setSavingSchedule('save');
    const ok = await patch(
      { publishAt: nextPublishAt, unpublishAt: nextUnpublishAt },
      () => setSavingSchedule(null)
    );
    if (!ok) return;
    setSavedPublishAt(nextPublishAt);
    setSavedUnpublishAt(nextUnpublishAt);
    setScheduleError(null);
    notifyLpScheduleStateChanged(true);
    showAdminToast({ message: '公開スケジュールを保存しました', tone: 'success' });
  }

  async function savePassword() {
    if (!isPasswordDraftValid) return;
    const wasProtected = passwordProtected;
    setPasswordAction('save');
    const ok = await patch({ password: passwordDraft }, () =>
      setPasswordAction(null)
    );
    if (!ok) return;
    setPasswordProtected(true);
    notifyLpPasswordStateChanged(true);
    setChangingPassword(false);
    setPasswordDraft('');
    showAdminToast({
      message: wasProtected
        ? 'パスワードを変更しました'
        : 'パスワードを設定しました',
      tone: 'success',
    });
  }

  async function removePassword() {
    const confirmed = await confirmAdminAction({
      title: 'パスワード保護を解除しますか?',
      message: '以後はパスワード無しで誰でも見られます。',
      confirmLabel: '解除する',
      tone: 'warning',
    });
    if (!confirmed) return;
    setPasswordAction('remove');
    const ok = await patch({ password: null }, () => setPasswordAction(null));
    if (!ok) return;
    setPasswordProtected(false);
    notifyLpPasswordStateChanged(false);
    setChangingPassword(false);
    setPasswordDraft('');
    showAdminToast({ message: 'パスワード保護を解除しました', tone: 'info' });
  }

  function validateScheduleOrder(
    nextPublishAt: string | null,
    nextUnpublishAt: string | null
  ): boolean {
    if (!nextPublishAt || !nextUnpublishAt) {
      setScheduleError(null);
      return true;
    }
    if (new Date(nextPublishAt).getTime() < new Date(nextUnpublishAt).getTime()) {
      setScheduleError(null);
      return true;
    }
    setScheduleError(SCHEDULE_ORDER_ERROR);
    showAdminToast({ message: SCHEDULE_ORDER_ERROR, tone: 'danger' });
    return false;
  }

  const draftPublishAt = fromLocalInput(publishAt);
  const draftUnpublishAt = fromLocalInput(unpublishAt);
  const hasSavedSchedule = savedPublishAt !== null || savedUnpublishAt !== null;
  const hasScheduleInput = draftPublishAt !== null || draftUnpublishAt !== null;
  const passwordBusy = passwordAction !== null;
  const isPasswordDraftValid =
    passwordDraft.length >= 4 &&
    passwordDraft.length <= 16 &&
    /^[\x21-\x7e]+$/.test(passwordDraft);
  const scheduleMin = todayLocalInputMin();
  const schedulePastInvalid =
    isBeforeTodayLocalInput(publishAt) || isBeforeTodayLocalInput(unpublishAt);
  const scheduleOrderInvalid =
    draftPublishAt !== null &&
    draftUnpublishAt !== null &&
    new Date(draftPublishAt).getTime() >= new Date(draftUnpublishAt).getTime();
  const scheduleDirty =
    draftPublishAt !== savedPublishAt || draftUnpublishAt !== savedUnpublishAt;
  const scheduleMessage = schedulePastInvalid
    ? SCHEDULE_PAST_DATE_ERROR
    : scheduleOrderInvalid
      ? SCHEDULE_ORDER_ERROR
      : scheduleError;

  return (
    <EditorPanel>
      <div className={EDITOR_TIGHT_STACK_CLASS}>
        <EditorSectionHeader
          title="パスワード保護"
          titleAdornment={
            passwordProtected ? (
              <span className="rounded-full bg-emerald-50 px-3 py-1 text-[11px] font-extrabold uppercase tracking-wider text-emerald-700">
                有効
              </span>
            ) : null
          }
          description={
            passwordProtected ? (
              <>
                パスワードは安全のため表示できません。忘れた時は新しいパスワードに変更してください
              </>
            ) : (
              <>
                パスワード入力でLPが表示されます。設定後は確認できません。<br />
                忘れた時は新しいパスワードに変更してください。
              </>
            )
          }
        />
        {!passwordProtected || changingPassword ? (
          <div className="max-w-md space-y-2">
            {passwordProtected && (
              <div className="rounded-xl bg-[#f7f9fc] px-3 py-2 text-xs font-bold leading-relaxed text-[#687082]">
                現在のパスワードを表示せず、新しいパスワードで上書きします。
              </div>
            )}
            <div className="flex flex-wrap gap-2">
              <input
                type="text"
                value={passwordDraft}
                onChange={(e) => setPasswordDraft(e.target.value)}
                placeholder={
                  passwordProtected
                    ? '新しいパスワード'
                    : '4〜16文字、半角英数字・記号'
                }
                minLength={4}
                maxLength={16}
                pattern="[\x21-\x7e]+"
                autoComplete="off"
                autoCorrect="off"
                spellCheck={false}
                className={`${INPUT_CLASS} min-w-[12rem] flex-[1_1_12rem] [-webkit-text-security:disc]`}
              />
              <button
                type="button"
                disabled={!isPasswordDraftValid || passwordBusy}
                onClick={() => void savePassword()}
                className={`${PRIMARY_BUTTON_CLASS} min-w-[4.5rem] shrink-0 whitespace-nowrap px-4`}
              >
                {passwordAction === 'save'
                  ? passwordProtected
                    ? '変更中...'
                    : '設定中...'
                  : passwordProtected
                    ? '変更する'
                    : '設定'}
              </button>
              {passwordProtected && (
                <button
                  type="button"
                  disabled={passwordBusy}
                  onClick={() => {
                    setChangingPassword(false);
                    setPasswordDraft('');
                  }}
                  className={`${SECONDARY_BUTTON_CLASS} shrink-0 whitespace-nowrap`}
                >
                  キャンセル
                </button>
              )}
              {passwordProtected && (
                <button
                  type="button"
                  disabled={passwordBusy}
                  onClick={() => void removePassword()}
                  className={`${DANGER_BUTTON_CLASS} shrink-0 whitespace-nowrap`}
                >
                  {passwordAction === 'remove' ? '解除中...' : '保護を解除'}
                </button>
              )}
            </div>
            <p className={HELP_CLASS}>
              4〜16文字、半角英数字・記号のみ使えます。
            </p>
          </div>
        ) : (
          <div className="flex max-w-md flex-col gap-3 rounded-xl bg-[#f7f9fc] px-3 py-3 text-sm sm:flex-row sm:items-center sm:justify-between">
            <span className="font-bold text-[#3f4352]">
              パスワード保護中です
            </span>
            <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-row">
              <button
                type="button"
                disabled={passwordBusy}
                onClick={() => {
                  setChangingPassword(true);
                  setPasswordDraft('');
                }}
                className={`${SECONDARY_BUTTON_CLASS} min-w-0 justify-center whitespace-nowrap px-3`}
              >
                パスワードを変更
              </button>
              <button
                type="button"
                disabled={passwordBusy}
                onClick={() => void removePassword()}
                className={`${DANGER_BUTTON_CLASS} min-w-0 justify-center whitespace-nowrap px-3`}
              >
                {passwordAction === 'remove' ? '解除中...' : '保護を解除'}
              </button>
            </div>
          </div>
        )}
      </div>

      <div className={`${SECTION_DIVIDER_CLASS} ${EDITOR_TIGHT_STACK_CLASS}`}>
        <EditorSectionHeader
          title="公開スケジュール"
          description={
            <>
            指定日時になると自動で公開・非公開になります。<br />
            非公開になると「掲載終了しました」ページになります。
            </>
          }
        />

        <div className="publish-schedule-container">
          <div className="publish-schedule-layout">
            <ScheduleDateField
              label="公開開始日時（任意）"
              value={publishAt}
              min={scheduleMin}
              invalid={isBeforeTodayLocalInput(publishAt)}
              help=""
              disabled={savingSchedule !== null}
              onChange={(value) => {
                setPublishAt(value);
                setScheduleError(null);
              }}
              onClear={() => resetScheduleInput('publish')}
            />

            <ScheduleDateField
              label="公開停止日時（任意）"
              value={unpublishAt}
              min={scheduleMin}
              invalid={isBeforeTodayLocalInput(unpublishAt)}
              help=""
              disabled={savingSchedule !== null}
              onChange={(value) => {
                setUnpublishAt(value);
                setScheduleError(null);
              }}
              onClear={() => resetScheduleInput('unpublish')}
            />

            <ScheduleActions
              showClear={hasSavedSchedule}
              disabled={savingSchedule !== null}
              saveDisabled={
                savingSchedule !== null ||
                !hasScheduleInput ||
                !scheduleDirty ||
                schedulePastInvalid ||
                scheduleOrderInvalid
              }
              onClear={() => void clearSchedule()}
              onSave={() => void saveSchedule()}
            />
          </div>
        </div>
        <style>{`
          .publish-schedule-container {
            container-type: inline-size;
          }

          .publish-schedule-layout {
            align-items: end;
            display: flex;
            flex-wrap: wrap;
            gap: 0.75rem;
          }

          .publish-schedule-field,
          .publish-schedule-field-row,
          .publish-schedule-actions {
            max-width: 100%;
            width: 100%;
          }

          .publish-schedule-input {
            flex: 0 1 auto;
            max-width: 100%;
            width: 100%;
          }

          @container (min-width: 36rem) {
            .publish-schedule-field,
            .publish-schedule-field-row,
            .publish-schedule-actions {
              width: fit-content;
            }

            .publish-schedule-input {
              width: auto;
            }
          }
        `}</style>
        {scheduleMessage && (
          <p className="rounded-xl bg-[#fff5f5] px-3 py-2 text-xs font-bold leading-relaxed text-[#b83232]">
            {scheduleMessage}
          </p>
        )}
      </div>
    </EditorPanel>
  );
}

interface ScheduleDateFieldProps {
  label: string;
  value: string;
  min: string;
  invalid: boolean;
  help: string;
  disabled: boolean;
  onChange: (value: string) => void;
  onClear: () => void;
}

function ScheduleDateField({
  label,
  value,
  min,
  invalid,
  help,
  disabled,
  onChange,
  onClear,
}: ScheduleDateFieldProps) {
  return (
    <div className="publish-schedule-field flex min-w-0 flex-col gap-1">
      <span className={`${LABEL_CLASS} flex items-center gap-2`}>{label}</span>
      <div className="publish-schedule-field-row flex min-w-0 items-center gap-2">
        <input
          type="datetime-local"
          value={value}
          min={min}
          onChange={(e) => onChange(e.target.value)}
          className={`${INPUT_CLASS} publish-schedule-input min-w-0 ${
            invalid
              ? 'border-[#d74444] focus:border-[#d74444] focus:ring-[#ffe0e0]'
              : ''
          }`}
        />
        {value && (
          <button
            type="button"
            onClick={onClear}
            disabled={disabled}
            className={`${SECONDARY_BUTTON_CLASS} shrink-0 whitespace-nowrap px-3 py-2 text-xs`}
          >
            クリア
          </button>
        )}
      </div>
      {help && <span className={HELP_CLASS}>{help}</span>}
    </div>
  );
}

interface ScheduleActionsProps {
  showClear: boolean;
  disabled: boolean;
  saveDisabled: boolean;
  onClear: () => void;
  onSave: () => void;
}

function ScheduleActions({
  showClear,
  disabled,
  saveDisabled,
  onClear,
  onSave,
}: ScheduleActionsProps) {
  return (
    <div
      className={`publish-schedule-actions ${
        showClear ? 'has-clear' : 'save-only'
      } grid min-w-0 gap-2 ${
        showClear ? 'grid-cols-2' : 'grid-cols-1'
      } sm:flex sm:flex-wrap`}
    >
      {showClear && (
        <button
          type="button"
          onClick={onClear}
          disabled={disabled}
          className={`${DANGER_BUTTON_CLASS} min-h-14 min-w-0 justify-center whitespace-nowrap px-3 text-base sm:min-h-[2.75rem] sm:px-4 sm:py-0 sm:text-sm`}
        >
          スケジュールを解除
        </button>
      )}
      <button
        type="button"
        onClick={onSave}
        disabled={saveDisabled}
        className={`${PRIMARY_BUTTON_CLASS} min-h-14 min-w-0 justify-center whitespace-nowrap px-3 text-base sm:min-h-[2.75rem] sm:px-4 sm:py-0 sm:text-sm`}
      >
        スケジュールを保存
      </button>
    </div>
  );
}

/**
 * Convert an ISO datetime to the value `<input type="datetime-local">`
 * expects (YYYY-MM-DDTHH:MM, in the browser's local timezone). Empty
 * string for null / unparseable.
 */
function toLocalInput(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n: number) => n.toString().padStart(2, '0');
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `T${pad(d.getHours())}:${pad(d.getMinutes())}`
  );
}

function fromLocalInput(value: string): string | null {
  if (!value) return null;
  const d = new Date(value); // browser interprets as local time
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

function normalizeInitialSchedule(iso: string | null): string | null {
  return fromLocalInput(toLocalInput(iso));
}

function todayLocalInputMin(): string {
  return `${todayLocalDate()}T00:00`;
}

function todayLocalDate(): string {
  const d = new Date();
  const pad = (n: number) => n.toString().padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function isBeforeTodayLocalInput(value: string): boolean {
  const date = value.split('T')[0];
  return Boolean(date) && date < todayLocalDate();
}

async function readApiError(res: Response, fallback: string): Promise<string> {
  try {
    const data = (await res.json()) as ApiError;
    return data?.error?.message ?? `${fallback} (${res.status})`;
  } catch {
    return `${fallback} (${res.status})`;
  }
}
