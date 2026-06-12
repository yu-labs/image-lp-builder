/**
 * DomainSettingsPanel
 *
 * Lets the self-hoster wire a custom domain to this Worker.
 *
 * Two-step model:
 *   1. Self-hoster registers lp.{domain} as a Custom Domain in
 *      Cloudflare's dashboard.
 *   2. Self-hoster types the bare apex into this panel; we sanitise,
 *      validate, probe lp.{domain} for our X-Image-LP-Builder-Version header,
 *      and only then commit it to D1. From that point on canonical
 *      URLs, QR codes, share links and Set-Cookie domains all flip
 *      to the new host.
 *
 * The probe is the interesting part — we lean on /api/site-domain
 * (Worker side) to call lp.{domain} so the browser doesn't have to
 * deal with CORS. The self-hoster checks the connection explicitly,
 * and the save button only unlocks once lp.{domain} is reachable.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { showAdminToast } from '../../lib/admin-toast';
import { notifySiteSettingsStatusChanged } from '../../lib/site-settings-events';
import AdminModal from './AdminModal';
import {
  AdminActionRow,
  AdminCallout,
  AdminChecklist,
  AdminStatusPill,
  AdminToggleRow,
  EDITOR_DANGER_BUTTON_CLASS,
  EDITOR_HELP_CLASS,
  EDITOR_INPUT_CLASS,
  EDITOR_LABEL_CLASS,
  EDITOR_PRIMARY_BUTTON_CLASS,
  EDITOR_SECONDARY_BUTTON_CLASS,
  EditorPanel,
  EditorSectionHeader,
} from './LpEditorPrimitives';

type ApiError = { success: false; error: { code: string; message: string; details?: Record<string, unknown> } };

interface DomainState {
  domain: string | null;
  workersDevDisabled: boolean;
}

interface ProbeReport {
  status: 'ok' | 'no_dns' | 'apex_only' | 'other_worker';
  detail?: string;
}

interface ProbePreview {
  cleaned: string;
  notes: string[];
  validationError: string | null;
  connection?: ProbeReport;
}

type Modal =
  | { kind: 'none' }
  | {
      kind: 'probe-warning';
      cleaned: string;
      notes: string[];
      probe: ProbeReport;
      workersDevDisabled: boolean;
    }
  | { kind: 'save-success'; domain: string; slugs: string[] }
  | { kind: 'delete-confirm' };

type DomainCheckState =
  | { status: 'idle' }
  | { status: 'checking' }
  | { status: 'ok'; domain: string }
  | { status: 'error'; domain: string; message: string };

interface PageSummary {
  slug: string;
  status: string;
}

const PROBE_DEBOUNCE_MS = 350;

interface Props {
  hideHeading?: boolean;
}

export default function DomainSettingsPanel({ hideHeading = false }: Props) {
  const [loading, setLoading] = useState(true);
  const [saved, setSaved] = useState<DomainState>({
    domain: null,
    workersDevDisabled: false,
  });

  // Working copy of the input field. Doesn't touch `saved` until we
  // get a 2xx back from PUT — that way "Cancel" is just a re-render.
  const [input, setInput] = useState('');
  const [workersDevDisabled, setWorkersDevDisabled] = useState(false);

  const [preview, setPreview] = useState<ProbePreview | null>(null);
  const [domainCheck, setDomainCheck] = useState<DomainCheckState>({
    status: 'idle',
  });
  const [domainValidationVisible, setDomainValidationVisible] = useState(false);
  const [setupChecks, setSetupChecks] = useState({
    cloudflareZone: false,
    customDomain: false,
    bareDomain: false,
  });
  const [setupValidationVisible, setSetupValidationVisible] = useState(false);
  // After a blur-triggered auto-correction we freeze the before/after
  // pair here so the self-hoster can see exactly what we changed. Cleared
  // the next time the input is edited so we don't keep stale evidence
  // around once they've moved on.
  const [lastCorrection, setLastCorrection] = useState<{
    before: string;
    after: string;
    notes: string[];
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [modal, setModal] = useState<Modal>({ kind: 'none' });
  const [currentOrigin, setCurrentOrigin] = useState('');
  // The "保存して反映" link in the auto-correction notice scrolls
  // here and pulses for a beat so the self-hoster's eye lands on the
  // actual button instead of stopping at the link text.
  const saveButtonRef = useRef<HTMLButtonElement | null>(null);
  const [saveHighlight, setSaveHighlight] = useState(false);

  useEffect(() => {
    void load();
    if (typeof window !== 'undefined') setCurrentOrigin(window.location.origin);
  }, []);

  async function load() {
    try {
      const res = await fetch('/api/site-domain');
      if (!res.ok) throw new Error(await readApiError(res, '取得失敗'));
      const json = (await res.json()) as { success: true; data: DomainState };
      setSaved(json.data);
      setInput(json.data.domain ?? '');
      setWorkersDevDisabled(json.data.workersDevDisabled);
      setSetupChecks({
        cloudflareZone: Boolean(json.data.domain),
        customDomain: Boolean(json.data.domain),
        bareDomain: Boolean(json.data.domain),
      });
      setDomainCheck(
        json.data.domain
          ? { status: 'ok', domain: json.data.domain }
          : { status: 'idle' }
      );
    } catch (err) {
      showAdminToast({
        tone: 'danger',
        message: `エラー： ${err instanceof Error ? err.message : String(err)}`,
      });
    } finally {
      setLoading(false);
    }
  }

  // Debounce the preview probe — every keystroke would hammer D1
  // (it does a no-op SELECT on the workspace row) for nothing.
  useEffect(() => {
    if (input.trim().length === 0) {
      setPreview(null);
      return;
    }
    const handle = setTimeout(() => {
      void runPreview(input);
    }, PROBE_DEBOUNCE_MS);
    return () => clearTimeout(handle);
  }, [input]);

  // Auto-snap the input to the cleaned value once the typing pause
  // has produced a preview. Doing it here instead of on blur means
  // the self-hoster never has to click somewhere else to trigger the
  // correction — paste, pause, done.
  useEffect(() => {
    if (!preview) return;
    const before = input;
    const after = preview.cleaned;
    if (before.trim() === after) return;
    setInput(after);
    if (preview.notes.length > 0) {
      setLastCorrection({ before, after, notes: preview.notes });
    }
  }, [preview]);

  function jumpToSaveButton() {
    const el = saveButtonRef.current;
    if (!el) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    setSaveHighlight(true);
    // Pulse for ~1.5s then clear so the highlight doesn't linger
    // forever and start to look like a permanent state.
    setTimeout(() => setSaveHighlight(false), 1500);
  }

  function toggleSetupCheck(key: keyof typeof setupChecks) {
    setSetupChecks((current) => ({
      ...current,
      [key]: !current[key],
    }));
    setSetupValidationVisible(false);
  }

  async function runPreview(value: string) {
    try {
      const res = await fetch(
        `/api/site-domain?probe=${encodeURIComponent(value)}`
      );
      if (!res.ok) return;
      const json = (await res.json()) as {
        success: true;
        data: DomainState & { probe?: ProbePreview };
      };
      if (json.data.probe) setPreview(json.data.probe);
    } catch {
      // Preview is best-effort; the real PUT will surface errors.
    }
  }

  async function checkDomainConnection() {
    if (busy || domainCheck.status === 'checking') return;
    const raw = input.trim();
    if (raw.length === 0) {
      setDomainCheck({
        status: 'error',
        domain: '',
        message: 'ドメイン名を入力してください',
      });
      return;
    }
    if (!Object.values(setupChecks).every(Boolean)) {
      setSetupValidationVisible(true);
      return;
    }

    setDomainCheck({ status: 'checking' });
    setDomainValidationVisible(true);
    try {
      const res = await fetch(
        `/api/site-domain?probe=${encodeURIComponent(raw)}&check=1`
      );
      if (!res.ok) throw new Error(await readApiError(res, '接続確認失敗'));
      const json = (await res.json()) as {
        success: true;
        data: DomainState & { probe?: ProbePreview };
      };
      const probe = json.data.probe;
      if (!probe) throw new Error('接続確認に失敗しました');

      setPreview(probe);
      if (probe.cleaned !== raw.toLowerCase()) {
        setInput(probe.cleaned);
      }
      if (probe.notes.length > 0) {
        setLastCorrection({
          before: raw,
          after: probe.cleaned,
          notes: probe.notes,
        });
      }

      if (probe.validationError) {
        setDomainCheck({
          status: 'error',
          domain: probe.cleaned,
          message: probe.validationError,
        });
        return;
      }

      if (probe.connection?.status === 'ok') {
        setDomainCheck({ status: 'ok', domain: probe.cleaned });
        return;
      }

      setDomainCheck({
        status: 'error',
        domain: probe.cleaned,
        message:
          probe.connection?.detail ??
          `lp.${probe.cleaned} へ接続できませんでした`,
      });
    } catch (err) {
      setDomainCheck({
        status: 'error',
        domain: raw.toLowerCase(),
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  async function loadPublishedSlugs(): Promise<string[]> {
    try {
      const res = await fetch('/api/lps?limit=100');
      if (!res.ok) return [];
      const json = (await res.json()) as {
        success: true;
        data: { pages: PageSummary[] };
      };
      return json.data.pages
        .filter((p) => p.status === 'published')
        .map((p) => p.slug);
    } catch {
      return [];
    }
  }

  async function handleSave(force: boolean) {
    if (busy) return;
    setBusy(true);
    try {
      const res = await fetch('/api/site-domain', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          domain: input,
          workersDevDisabled,
          force,
        }),
      });
      if (res.status === 409 && !force) {
        const errBody = (await res.json()) as ApiError;
        const details = errBody.error.details ?? {};
        const cleanedDomain = String(details.cleaned ?? input);
        const probe = (details.probe as ProbeReport | undefined) ?? {
          status: 'no_dns',
          detail: errBody.error.message,
        };
        setDomainCheck({
          status: 'error',
          domain: cleanedDomain,
          message: probe.detail ?? errBody.error.message,
        });
        setModal({
          kind: 'probe-warning',
          cleaned: cleanedDomain,
          notes: Array.isArray(details.notes) ? (details.notes as string[]) : [],
          probe,
          workersDevDisabled,
        });
        return;
      }
      if (!res.ok) throw new Error(await readApiError(res, '保存失敗'));
      const json = (await res.json()) as {
        success: true;
        data: DomainState & { notes?: string[] };
      };
      setSaved(json.data);
      setInput(json.data.domain ?? '');
      setWorkersDevDisabled(json.data.workersDevDisabled);
      setPreview(null);
      setSetupChecks({
        cloudflareZone: Boolean(json.data.domain),
        customDomain: Boolean(json.data.domain),
        bareDomain: Boolean(json.data.domain),
      });
      setDomainCheck(
        json.data.domain
          ? { status: 'ok', domain: json.data.domain }
          : { status: 'idle' }
      );
      const slugs = await loadPublishedSlugs();
      setModal({
        kind: 'save-success',
        domain: json.data.domain ?? '',
        slugs,
      });
      notifySiteSettingsStatusChanged();
    } catch (err) {
      showAdminToast({
        tone: 'danger',
        message: `エラー： ${err instanceof Error ? err.message : String(err)}`,
      });
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete() {
    if (busy) return;
    setBusy(true);
    try {
      const res = await fetch('/api/site-domain', { method: 'DELETE' });
      if (!res.ok) throw new Error(await readApiError(res, '削除失敗'));
      const json = (await res.json()) as { success: true; data: DomainState };
      setSaved(json.data);
      setInput('');
      setWorkersDevDisabled(false);
      setPreview(null);
      setDomainValidationVisible(false);
      setSetupChecks({
        cloudflareZone: false,
        customDomain: false,
        bareDomain: false,
      });
      setSetupValidationVisible(false);
      setDomainCheck({ status: 'idle' });
      setModal({ kind: 'none' });
      notifySiteSettingsStatusChanged();
    } catch (err) {
      showAdminToast({
        tone: 'danger',
        message: `エラー： ${err instanceof Error ? err.message : String(err)}`,
      });
    } finally {
      setBusy(false);
    }
  }

  const cleaned = preview?.cleaned ?? saved.domain ?? '';
  const inputNormalised = input.trim().toLowerCase();
  const previewMatchesInput =
    preview === null || preview.cleaned === inputNormalised;
  const currentDomainValue = previewMatchesInput
    ? (preview?.cleaned ?? inputNormalised)
    : inputNormalised;
  const savedDomainReady =
    Boolean(saved.domain) && currentDomainValue === saved.domain;
  const checkedDomainReady =
    domainCheck.status === 'ok' && domainCheck.domain === currentDomainValue;
  const setupChecksComplete = Object.values(setupChecks).every(Boolean);
  const domainReadyToSave =
    input.trim().length > 0 &&
    previewMatchesInput &&
    !preview?.validationError &&
    setupChecksComplete &&
    (savedDomainReady || checkedDomainReady);
  const displayDomain =
    preview?.cleaned || input.trim().toLowerCase() || saved.domain || '{ドメイン名}';
  const displayLpHost = `lp.${displayDomain}`;
  const displayPublicUrl = `https://${displayLpHost}/{URL末尾}`;
  const currentPublicUrl = `${currentOrigin || '現在のURL'}/{URL末尾}`;
  const dirty = useMemo(() => {
    const inputNormalised = input.trim().toLowerCase();
    return (
      inputNormalised !== (saved.domain ?? '') ||
      workersDevDisabled !== saved.workersDevDisabled
    );
  }, [input, workersDevDisabled, saved]);

  if (loading) {
    return <p className="text-sm text-[#8b91a1]">読み込み中...</p>;
  }

  return (
    <EditorPanel className="space-y-5">
      <header className="space-y-3">
        {!hideHeading && (
          <EditorSectionHeader title="独自ドメイン" />
        )}
        <AdminCallout>
          <div className="text-xs font-bold text-[#8b91a1]">現在の公開URL</div>
          <code className="mt-1 block break-all font-mono text-base font-bold leading-[1.45] text-[#567baf] sm:text-lg">
            {currentPublicUrl}
          </code>
          <p className="mt-2 text-xs leading-[1.55] text-[#8b91a1]">
            独自ドメインを保存すると
            <code className="mx-1 rounded-full bg-[#eef4fb] px-2 py-0.5 font-mono text-[11px] text-[#567baf]">
              {displayPublicUrl}
            </code>
            の形に切り替わります。<br />
            新しく取得する場合は、このツールではCloudflareで管理する前提になるためCloudflare取得を推奨します。
          </p>
        </AdminCallout>
        <AdminCallout tone="info" title="設定の流れ">
          <ol className="space-y-1.5 pl-5 text-xs leading-[1.55] list-decimal">
            <li>
              ドメインをCloudflareに追加し、Activeの状態にします。
            </li>
            <li>
              CloudflareのCustom Domainに
              <code className="mx-1 rounded-full bg-white px-2 py-0.5 font-mono text-[11px] text-[#244464]">
                {displayLpHost}
              </code>
              を追加します。
            </li>
            <li>
              この画面には
              <code className="mx-1 rounded-full bg-white px-2 py-0.5 font-mono text-[11px] text-[#244464]">
                {displayDomain}
              </code>
              だけ入力します。
            </li>
            <li>
              保存後、公開URLが
              <code className="mx-1 rounded-full bg-white px-2 py-0.5 font-mono text-[11px] text-[#244464]">
                {displayPublicUrl}
              </code>
              に切り替わります。
            </li>
          </ol>
          <a
            href="https://developers.cloudflare.com/workers/configuration/routing/custom-domains/"
            target="_blank"
            rel="noopener noreferrer"
            className="mt-3 inline-flex rounded-full bg-white/80 px-3 py-1.5 text-xs font-bold text-[#567baf] transition hover:bg-white"
          >
            Cloudflare公式手順を開く
          </a>
        </AdminCallout>
      </header>

      <div className="space-y-2">
        <label
          htmlFor="domain-input"
          className={EDITOR_LABEL_CLASS}
        >
          変更したいドメイン名
        </label>
        <input
          id="domain-input"
          type="text"
          value={input}
          onChange={(e) => {
            setInput(e.target.value);
            setDomainCheck({ status: 'idle' });
            setDomainValidationVisible(false);
            setSetupChecks({
              cloudflareZone: false,
              customDomain: false,
              bareDomain: false,
            });
            setSetupValidationVisible(false);
            // The previous correction now describes a stale state —
            // the self-hoster is editing again, so drop the explanation.
            if (lastCorrection) setLastCorrection(null);
          }}
          onBlur={() => {
            if (input.trim().length > 0) setDomainValidationVisible(true);
          }}
          placeholder="example.com"
          autoComplete="off"
          spellCheck={false}
          className={`${EDITOR_INPUT_CLASS} block w-full font-mono`}
        />
        {domainValidationVisible && preview?.validationError && (
          <p className="text-xs font-bold leading-[1.55] text-red-700">
            {preview.validationError}
          </p>
        )}
        <AdminChecklist
          title="保存前チェック"
          items={[
            {
              id: 'cloudflare-zone',
              checked: setupChecks.cloudflareZone,
              onChange: () => toggleSetupCheck('cloudflareZone'),
              label: 'ドメインをCloudflareに追加し、Activeになっている。',
            },
            {
              id: 'custom-domain',
              checked: setupChecks.customDomain,
              onChange: () => toggleSetupCheck('customDomain'),
              label: (
                <>
                  CloudflareのCustom Domainに
                  <code className="mx-1 font-mono text-[#3f4352]">
                    {displayLpHost}
                  </code>
                  を追加済み。
                </>
              ),
            },
            {
              id: 'bare-domain',
              checked: setupChecks.bareDomain,
              onChange: () => toggleSetupCheck('bareDomain'),
              label: (
                <>
                  この欄には
                  <code className="mx-1 font-mono text-[#3f4352]">
                    {displayDomain}
                  </code>
                  だけ入力。
                </>
              ),
            },
          ]}
          help="3つチェックして、接続チェックがOKになると保存できます。"
          error={
            setupValidationVisible && !setupChecksComplete
              ? '保存前チェックを3つすべて確認してください。'
              : undefined
          }
        />
        <AdminActionRow>
          <button
            type="button"
            onClick={() => void checkDomainConnection()}
            disabled={
              busy ||
              domainCheck.status === 'checking' ||
              input.trim().length === 0 ||
              !setupChecksComplete
            }
            className={EDITOR_SECONDARY_BUTTON_CLASS}
          >
            {domainCheck.status === 'checking' ? '確認中...' : '接続チェック'}
          </button>
          {domainCheck.status === 'ok' && (
            <AdminStatusPill tone="success">接続OK</AdminStatusPill>
          )}
          {domainCheck.status === 'idle' && !savedDomainReady && (
            <span className={EDITOR_HELP_CLASS}>
              保存する前に接続チェックが必要です。
            </span>
          )}
        </AdminActionRow>
        {domainCheck.status === 'error' && (
          <AdminCallout tone="danger" title="接続チェックに失敗しました">
            <p>{domainCheck.message}</p>
          </AdminCallout>
        )}
        {lastCorrection ? (
          <AdminCallout tone="warning" title="自動で直しました" className="space-y-1.5">
            <div className="font-mono text-[11px] break-all">
              <span className="text-[#8b91a1] line-through">
                {lastCorrection.before}
              </span>
              <span className="mx-1 text-[#b0b6c2]">→</span>
              <span className="text-amber-900 font-semibold">
                {lastCorrection.after}
              </span>
            </div>
            <p>
              内容を確認して
              <button
                type="button"
                onClick={jumpToSaveButton}
                className="mx-0.5 text-amber-900 font-semibold underline underline-offset-2 hover:text-amber-700"
              >
                「保存して反映」
              </button>
              ボタンを押してください。
            </p>
          </AdminCallout>
        ) : (
          preview?.notes &&
          preview.notes.length > 0 && (
            <AdminCallout tone="warning" title="自動で直しています...">
              <ul className="list-disc list-inside space-y-0.5">
                {preview.notes.map((note, i) => (
                  <li key={i}>{note}</li>
                ))}
              </ul>
            </AdminCallout>
          )
        )}
      </div>

      {/* Live preview of the URL the self-hoster will end up with. We
          show a placeholder slug rather than picking the first
          published one to avoid confusing them when the list is
          empty or they haven't published yet. */}
      {cleaned && !preview?.validationError && (
        <AdminCallout title="公開URLのプレビュー" className="space-y-1">
          <div>
            <span className="text-[#8b91a1]">入力するドメイン名：</span>{' '}
            <code className="font-mono">{cleaned}</code>
          </div>
          <div>
            <span className="text-[#8b91a1]">公開URL:</span>{' '}
            <code className="font-mono text-[#567baf]">
              https://lp.{cleaned}/{'{URL末尾}'}
            </code>
          </div>
        </AdminCallout>
      )}

      <div className="space-y-2 border-t border-[#e8ecf3] pt-4">
        <AdminToggleRow
          title="workers.dev URLから独自ドメインへ転送"
          help={
            <>
              ONにすると、古いworkers.devの
              <span className="mx-1 font-mono text-[#596173]">
                /{"{URL末尾}"}
              </span>
              へアクセスされた時、
              <span className="mx-1 font-mono text-[#596173]">
                https://lp.{'{ドメイン}'}/{"{URL末尾}"}
              </span>
              へ移動させます。（旧URLでもアクセスできるようにしたい場合はOFFにしてください。）
            </>
          }
          checked={workersDevDisabled}
          onChange={setWorkersDevDisabled}
          disabled={input.trim().length === 0}
          className="bg-white/80"
        />
      </div>

      <AdminActionRow className="pt-2">
        <button
          ref={saveButtonRef}
          type="button"
          onClick={() => void handleSave(false)}
          disabled={
            busy ||
            !dirty ||
            (preview?.validationError !== null &&
              preview?.validationError !== undefined) ||
            input.trim().length === 0 ||
            // The auto-correction effect runs slightly after the
            // probe arrives. Until the input matches preview.cleaned,
            // the visible text and the actual save target are out
            // of sync — disable so the self-hoster can't fire a save
            // against an in-flight correction.
            (preview !== null &&
              preview.cleaned !== input.trim().toLowerCase()) ||
            !domainReadyToSave
          }
          className={`${EDITOR_PRIMARY_BUTTON_CLASS} px-5 py-3.5 text-base sm:px-4 sm:py-2 sm:text-sm ${
            saveHighlight
              ? 'ring-4 ring-[#567baf]/30 animate-pulse shadow-lg'
              : ''
          }`}
        >
          {busy ? '処理中...' : '保存して反映'}
        </button>
        {saved.domain && (
          <button
            type="button"
            onClick={() => setModal({ kind: 'delete-confirm' })}
            disabled={busy}
            className={`${EDITOR_DANGER_BUTTON_CLASS} px-5 py-3.5 text-base sm:px-4 sm:py-2 sm:text-sm`}
          >
            ドメイン設定を削除
          </button>
        )}
        {dirty && (
          <button
            type="button"
            onClick={() => {
              setInput(saved.domain ?? '');
              setWorkersDevDisabled(saved.workersDevDisabled);
              setPreview(null);
              setSetupChecks({
                cloudflareZone: Boolean(saved.domain),
                customDomain: Boolean(saved.domain),
                bareDomain: Boolean(saved.domain),
              });
              setSetupValidationVisible(false);
              setDomainCheck(
                saved.domain
                  ? { status: 'ok', domain: saved.domain }
                  : { status: 'idle' }
              );
            }}
            disabled={busy}
            className={`${EDITOR_SECONDARY_BUTTON_CLASS} px-5 py-3.5 text-base sm:px-4 sm:py-2 sm:text-sm`}
          >
            変更を破棄
          </button>
        )}
      </AdminActionRow>

      {modal.kind === 'probe-warning' && (
        <Modal onClose={() => setModal({ kind: 'none' })}>
          <ModalHeader title="ドメインがまだ繋がっていません" tone="warning" />
          <p className="text-sm leading-[1.55] text-[#596173]">
            <code className="rounded-full bg-[#f2f4f8] px-2 py-0.5 font-mono">
              lp.{modal.cleaned}
            </code>{' '}
            への接続を確認できませんでした。<br />Cloudflare側の設定が必要です。
          </p>
          <AdminCallout title="よくある原因と対処" className="space-y-2">
            <ul className="space-y-1.5">
              <li>
                <span className="font-bold">
                  CloudflareでCustom Domainを登録していない
                </span>
                <span className="ml-3 block text-[#8b91a1]">
                  → Cloudflare管理画面のWorkers & Pages → Settings →
                  Domains & RoutesからCustom Domainを追加してください
                </span>
              </li>
              <li>
                <span className="font-bold">
                  ルートドメイン（{modal.cleaned}）で登録した
                </span>
                <span className="ml-3 block text-[#8b91a1]">
                  → lp.{modal.cleaned} として登録し直してください
                </span>
              </li>
              <li>
                <span className="font-bold">取得直後でDNS反映待ち</span>
                <span className="ml-3 block text-[#8b91a1]">
                  → 最大24時間ほど待ってから再度お試しください
                </span>
              </li>
              <li>
                <span className="font-bold">ドメイン名の打ち間違い</span>
                <span className="ml-3 block text-[#8b91a1]">
                  → スペル / ピリオドを確認して入力し直してください
                </span>
              </li>
            </ul>
          </AdminCallout>
          <AdminActionRow className="pt-2">
            <button
              type="button"
              onClick={() => setModal({ kind: 'none' })}
              disabled={busy}
              className={`${EDITOR_SECONDARY_BUTTON_CLASS} gap-1 px-3 py-2`}
            >
              <span aria-hidden="true">←</span>
              入力し直す
            </button>
            <button
              type="button"
              onClick={() => {
                setModal({ kind: 'none' });
                void checkDomainConnection();
              }}
              disabled={busy}
              className={`${EDITOR_SECONDARY_BUTTON_CLASS} sm:ml-auto`}
            >
              接続チェックをやり直す
            </button>
          </AdminActionRow>
        </Modal>
      )}

      {modal.kind === 'save-success' && (
        <Modal onClose={() => setModal({ kind: 'none' })}>
          <ModalHeader title="独自ドメインを設定しました" tone="success" />
          <p className="text-sm leading-[1.55] text-[#596173]">
            <code className="rounded-full bg-[#eef4fb] px-2 py-0.5 font-mono text-[#567baf]">
              lp.{modal.domain}
            </code>{' '}
            を公開URLとして使う設定を保存しました。<br />
            各LPのURL末尾はそのままです。
          </p>
          {modal.slugs.length > 0 ? (
            <div className="space-y-1 text-xs leading-[1.55] text-[#596173]">
              <p className="font-bold text-[#3f4352]">公開済みLPの新URL:</p>
              <ul className="list-disc list-inside space-y-0.5">
                {modal.slugs.map((slug) => (
                  <li key={slug}>
                    <a
                      href={`https://lp.${modal.domain}/${slug}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="font-mono text-[#567baf] hover:underline"
                    >
                      https://lp.{modal.domain}/{slug}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <p className="text-xs leading-[1.55] text-[#8b91a1]">
              公開済みのLPがまだないため、URLリンクは省略しました。
            </p>
          )}
          <p className="border-t border-[#e8ecf3] pt-3 text-xs leading-[1.55] text-[#8b91a1]">
            workers.dev URLも引き続き表示できます。<br />
            独自ドメインへ寄せたい場合は「workers.dev URLから独自ドメインへ転送」をONにしてください。
          </p>
          <AdminActionRow align="end" className="pt-2">
            <button
              type="button"
              onClick={() => setModal({ kind: 'none' })}
              className={EDITOR_PRIMARY_BUTTON_CLASS}
            >
              閉じる
            </button>
          </AdminActionRow>
        </Modal>
      )}

      {modal.kind === 'delete-confirm' && (
        <Modal onClose={() => setModal({ kind: 'none' })}>
          <ModalHeader title="独自ドメインの設定を削除しますか?" tone="danger" />
          <p className="text-sm leading-[1.55] text-[#596173]">
            全LPのURLがworkers.devに戻ります。<br />CloudflareのCustom Domainは別途、Cloudflare管理画面のWorkers & Pages → Settings → Domains & Routesから削除してください。
          </p>
          <p className="text-xs leading-[1.55] text-[#8b91a1]">
            workers.dev URLの停止トグルも自動でOFFに戻ります。
          </p>
          <AdminActionRow className="pt-2">
            <button
              type="button"
              onClick={() => setModal({ kind: 'none' })}
              disabled={busy}
              className={EDITOR_SECONDARY_BUTTON_CLASS}
            >
              キャンセル
            </button>
            <button
              type="button"
              onClick={() => void handleDelete()}
              disabled={busy}
              className={`${EDITOR_DANGER_BUTTON_CLASS} sm:ml-auto`}
            >
              {busy ? '削除中...' : '削除してworkers.devに戻す'}
            </button>
          </AdminActionRow>
        </Modal>
      )}
    </EditorPanel>
  );
}

function Modal({
  onClose,
  children,
}: {
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <AdminModal
      ariaLabel="独自ドメイン設定"
      zIndexClass="z-[140]"
      maxHeightClass="max-h-[86dvh] sm:max-h-[92vh]"
      panelClassName="space-y-3 bg-[#f6f8fb]/95 p-5"
      onClose={onClose}
    >
      {children}
    </AdminModal>
  );
}

function ModalHeader({
  title,
  tone,
}: {
  title: string;
  tone: 'warning' | 'success' | 'danger';
}) {
  const colour =
    tone === 'success'
      ? 'text-[#567baf]'
      : tone === 'danger'
        ? 'text-red-700'
        : 'text-amber-700';
  return <h3 className={`text-base font-bold ${colour}`}>{title}</h3>;
}

async function readApiError(res: Response, fallback: string): Promise<string> {
  try {
    const data = (await res.json()) as ApiError;
    return data?.error?.message ?? `${fallback} (${res.status})`;
  } catch {
    return `${fallback} (${res.status})`;
  }
}
