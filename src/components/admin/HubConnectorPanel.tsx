import { useEffect, useState } from 'react';
import { confirmAdminAction } from '../../lib/admin-dialog';
import { showAdminToast } from '../../lib/admin-toast';
import { notifySiteSettingsStatusChanged } from '../../lib/site-settings-events';
import CollapseToggleIcon from './CollapseToggleIcon';
import {
  AdminActionRow,
  AdminCallout,
  AdminStatusPill,
  AdminToggleRow,
  EDITOR_DANGER_BUTTON_CLASS,
  EDITOR_INPUT_CLASS,
  EDITOR_PRIMARY_BUTTON_CLASS,
  EDITOR_TIGHT_STACK_CLASS,
  EditorField,
  EditorPanel,
  EditorSectionHeader,
} from './LpEditorPrimitives';

interface HubConnectorData {
  enabled: boolean;
  scriptEnabled: boolean;
  scriptUrl: string | null;
  hubBaseUrl: string | null;
  connectionId: string | null;
  status: string | null;
  serverTokenConfigured: boolean;
  connectedAt: string | null;
  lastVerifiedAt: string | null;
}

interface UrlForm {
  scriptUrl: string;
  hubBaseUrl: string;
  connectionId: string;
}

type ApiErr = { success: false; error: { code: string; message: string } };
type AdminTone = 'neutral' | 'info' | 'success' | 'warning' | 'danger';

const EMPTY_FORM: UrlForm = { scriptUrl: '', hubBaseUrl: '', connectionId: '' };
const STATUS_LABEL: Record<string, string> = {
  pending: '接続待ち',
  active: '接続済み',
  error: 'エラー',
  disabled: '無効',
};

interface Props {
  defaultOpen?: boolean;
  hideHeading?: boolean;
}

async function readErr(res: Response, fallback: string): Promise<string> {
  try {
    const d = (await res.json()) as ApiErr;
    return d?.error?.message ?? `${fallback} (${res.status})`;
  } catch {
    return `${fallback} (${res.status})`;
  }
}

function getStatusLabel(status: string | null | undefined): string {
  return status ? (STATUS_LABEL[status] ?? status) : '未設定';
}

function getStatusTone(status: string | null | undefined): AdminTone {
  if (status === 'active') return 'success';
  if (status === 'pending') return 'warning';
  if (status === 'error') return 'danger';
  return 'neutral';
}

function getOnOffTone(enabled: boolean | undefined): AdminTone {
  return enabled ? 'success' : 'neutral';
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function notifyError(prefix: string, err: unknown) {
  showAdminToast({ tone: 'danger', message: `${prefix}。${errorMessage(err)}` });
}

export default function HubConnectorPanel({
  defaultOpen = false,
  hideHeading = false,
}: Props) {
  const [data, setData] = useState<HubConnectorData | null>(null);
  const [form, setForm] = useState<UrlForm>(EMPTY_FORM);
  const [original, setOriginal] = useState<UrlForm>(EMPTY_FORM);
  const [open, setOpen] = useState(defaultOpen || hideHeading);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [savingEnabled, setSavingEnabled] = useState(false);
  const [savingScript, setSavingScript] = useState(false);
  const [saving, setSaving] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [clearingToken, setClearingToken] = useState(false);
  const [connectCode, setConnectCode] = useState('');
  const [serverToken, setServerToken] = useState('');
  const [savedAt, setSavedAt] = useState<number | null>(null);

  useEffect(() => {
    void load();
  }, []);

  async function load() {
    try {
      const res = await fetch('/api/hub-connector');
      if (!res.ok) throw new Error(await readErr(res, '取得失敗'));
      const json = (await res.json()) as { success: true; data: HubConnectorData };
      applyData(json.data);
    } catch (err) {
      notifyError('連携コネクターを取得できませんでした', err);
    } finally {
      setLoading(false);
    }
  }

  function applyData(d: HubConnectorData) {
    setData(d);
    const f: UrlForm = {
      scriptUrl: d.scriptUrl ?? '',
      hubBaseUrl: d.hubBaseUrl ?? '',
      connectionId: d.connectionId ?? '',
    };
    setForm(f);
    setOriginal(f);
    setServerToken('');
  }

  async function put(body: Record<string, unknown>): Promise<HubConnectorData> {
    const res = await fetch('/api/hub-connector', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(await readErr(res, '保存失敗'));
    const json = (await res.json()) as { success: true; data: HubConnectorData };
    return json.data;
  }

  async function connectWithCode() {
    if (!connectCode.trim() || connecting) return;
    setConnecting(true);
    try {
      const res = await fetch('/api/hub-connector/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ connectCode: connectCode.trim() }),
      });
      if (!res.ok) throw new Error(await readErr(res, '接続失敗'));
      const json = (await res.json()) as { success: true; data: HubConnectorData };
      applyData(json.data);
      setConnectCode('');
      setSavedAt(Date.now());
      window.setTimeout(() => setSavedAt(null), 2000);
      notifySiteSettingsStatusChanged();
      showAdminToast({ tone: 'success', message: '連携コネクターに接続しました。' });
    } catch (err) {
      notifyError('接続できませんでした', err);
    } finally {
      setConnecting(false);
    }
  }

  async function toggleEnabled(next: boolean) {
    setSavingEnabled(true);
    try {
      const updated = await put({ enabled: next });
      setData(updated);
      notifySiteSettingsStatusChanged();
      showAdminToast({
        message: next
          ? '連携コネクターをONにしました。'
          : '連携コネクターをOFFにしました。',
      });
    } catch (err) {
      notifyError('保存できませんでした', err);
    } finally {
      setSavingEnabled(false);
    }
  }

  async function toggleScriptEnabled(next: boolean) {
    setSavingScript(true);
    try {
      const updated = await put({ scriptEnabled: next });
      setData(updated);
      notifySiteSettingsStatusChanged();
      showAdminToast({
        message: next
          ? 'スクリプト出力をONにしました。'
          : 'スクリプト出力をOFFにしました。',
      });
    } catch (err) {
      notifyError('保存できませんでした', err);
    } finally {
      setSavingScript(false);
    }
  }

  const isDirty = JSON.stringify(form) !== JSON.stringify(original);
  const hasTokenInput = serverToken.trim().length > 0;

  async function save() {
    if ((!isDirty && !hasTokenInput) || saving) return;
    setSaving(true);
    try {
      const body: Record<string, unknown> = {
        scriptUrl: form.scriptUrl.trim() || null,
        hubBaseUrl: form.hubBaseUrl.trim() || null,
        connectionId: form.connectionId.trim() || null,
      };
      if (hasTokenInput) {
        body.serverToken = serverToken.trim();
      }
      const updated = await put(body);
      applyData(updated);
      setSavedAt(Date.now());
      window.setTimeout(() => setSavedAt(null), 2000);
      notifySiteSettingsStatusChanged();
      showAdminToast({ message: '連携設定を保存しました。' });
    } catch (err) {
      notifyError('保存できませんでした', err);
    } finally {
      setSaving(false);
    }
  }

  async function clearServerToken() {
    if (!data?.serverTokenConfigured || clearingToken) return;
    const confirmed = await confirmAdminAction({
      title: 'サーバートークンを削除しますか?',
      message: '連携コネクターの接続に使うサーバートークンを削除します。',
      confirmLabel: '削除する',
      tone: 'danger',
    });
    if (!confirmed) return;
    setClearingToken(true);
    try {
      const updated = await put({ serverToken: null });
      applyData(updated);
      setSavedAt(Date.now());
      window.setTimeout(() => setSavedAt(null), 2000);
      notifySiteSettingsStatusChanged();
      showAdminToast({ tone: 'danger', message: 'サーバートークンを削除しました。' });
    } catch (err) {
      notifyError('削除できませんでした', err);
    } finally {
      setClearingToken(false);
    }
  }

  if (loading) return <p className="text-sm text-[#8b91a1]">読み込み中...</p>;

  const statusLabel = getStatusLabel(data?.status);
  const panelClass = hideHeading
    ? 'space-y-4 bg-transparent p-0 shadow-none ring-0 sm:p-0'
    : 'space-y-5';

  return (
    <EditorPanel className={panelClass}>
      {!hideHeading && (
        <header className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <EditorSectionHeader
            title="連携コネクター"
            titleAdornment={<AdminStatusPill tone="info">接続コード</AdminStatusPill>}
            description="Connectorから発行された接続コードを貼って接続します。通常は未接続のままで使えます。"
          />
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full transition hover:bg-[#eef4fb]"
            aria-expanded={open}
            aria-label={open ? '連携コネクターを閉じる' : '連携コネクターを開く'}
            title={open ? '閉じる' : '開く'}
          >
            <CollapseToggleIcon open={open} />
          </button>
        </header>
      )}

      {!open && (
        <div className={EDITOR_TIGHT_STACK_CLASS}>
          {hideHeading && (
            <AdminCallout tone="info" title="必要な場合だけ設定します">
              Connectorを使う場合は、発行された接続コードを貼って接続します。
              使わない場合は未接続のままで構いません。
            </AdminCallout>
          )}
          <ConnectorSummary data={data} statusLabel={statusLabel} />
          {hideHeading && (
            <AdminActionRow align="end">
              <button
                type="button"
                onClick={() => setOpen(true)}
                className={EDITOR_PRIMARY_BUTTON_CLASS}
              >
                接続コードを入力
              </button>
            </AdminActionRow>
          )}
        </div>
      )}

      {open && (
        <div className={EDITOR_TIGHT_STACK_CLASS}>
          <AdminCallout tone="info" title="接続コードで接続します">
            Connectorから発行された接続コードまたは接続URLを貼ってください。
            接続しない場合、公開LPや管理画面の通常利用には影響しません。
          </AdminCallout>

          <div className="rounded-2xl border border-[#dbe4f0] bg-white/85 p-4 shadow-[0_12px_30px_rgba(31,41,55,0.06)]">
            <EditorField
              label="接続コード"
              help="Connector側で発行された接続コードまたは接続URLを入力します。"
            >
              <div className="flex flex-col gap-3 lg:flex-row">
                <input
                  type="text"
                  value={connectCode}
                  onChange={(e) => setConnectCode(e.target.value)}
                  placeholder="connect_xxx または https://connector.example.com/connect/..."
                  maxLength={768}
                  className={`${EDITOR_INPUT_CLASS} min-w-0 flex-1 font-mono placeholder:text-[#b0b6c2]`}
                />
                <button
                  type="button"
                  onClick={connectWithCode}
                  disabled={!connectCode.trim() || connecting}
                  className={`${EDITOR_PRIMARY_BUTTON_CLASS} shrink-0`}
                >
                  {connecting ? '接続中...' : '接続する'}
                </button>
              </div>
            </EditorField>
          </div>

          <div className="grid gap-3 lg:grid-cols-2">
            <AdminToggleRow
              title="連携コネクター"
              help="ワークスペース全体のコネクター接続を切り替えます。"
              checked={data?.enabled ?? false}
              disabled={savingEnabled}
              onChange={toggleEnabled}
            />
            <AdminToggleRow
              title="スクリプト出力"
              help="公開LPの<head>にコネクタースクリプトを出力します。"
              checked={data?.scriptEnabled ?? false}
              disabled={savingScript}
              onChange={toggleScriptEnabled}
            />
          </div>

          <button
            type="button"
            onClick={() => setDetailsOpen((v) => !v)}
            className="inline-flex items-center gap-2 text-sm font-bold text-[#4d5f7a] transition hover:text-[#1f6feb]"
            aria-expanded={detailsOpen}
          >
            <CollapseToggleIcon open={detailsOpen} />
            {detailsOpen ? '上級者向け詳細設定を閉じる' : '上級者向け詳細設定を開く'}
          </button>

          {detailsOpen && (
            <div className={EDITOR_TIGHT_STACK_CLASS}>
              <AdminCallout tone="warning" title="手動検証用の詳細設定です">
                接続コードを使わずに、検証用の接続先を直接指定したい場合だけ使います。
              </AdminCallout>

              <div className="grid gap-4 md:grid-cols-2">
                <Field
                  className="md:col-span-2"
                  label="スクリプトURL"
                  help="https:// URL のみ有効。空欄でクリアします。"
                  value={form.scriptUrl}
                  onChange={(v) => setForm((c) => ({ ...c, scriptUrl: v }))}
                  placeholder="https://hub.example.com/connector.js"
                />
                <Field
                  label="Hub ベースURL"
                  help="https:// URL のみ有効。空欄でクリアします。"
                  value={form.hubBaseUrl}
                  onChange={(v) => setForm((c) => ({ ...c, hubBaseUrl: v }))}
                  placeholder="https://hub.example.com"
                />
                <Field
                  label="コネクションID"
                  help="英数字・ハイフン・アンダースコアのみ。"
                  value={form.connectionId}
                  onChange={(v) => setForm((c) => ({ ...c, connectionId: v }))}
                  placeholder="my-workspace"
                />
              </div>

              <div className={EDITOR_TIGHT_STACK_CLASS}>
                <Field
                  label="サーバートークン"
                  help="保存後は表示されません。空欄のまま保存すると既存値を維持します。"
                  value={serverToken}
                  onChange={setServerToken}
                  placeholder={data?.serverTokenConfigured ? '設定済み' : '新しいトークン'}
                  type="password"
                />
                <AdminActionRow align="between">
                  <AdminStatusPill tone={data?.serverTokenConfigured ? 'success' : 'neutral'}>
                    {data?.serverTokenConfigured ? 'トークン設定済み' : 'トークン未設定'}
                  </AdminStatusPill>
                  {data?.serverTokenConfigured && (
                    <button
                      type="button"
                      onClick={clearServerToken}
                      disabled={clearingToken}
                      className={`${EDITOR_DANGER_BUTTON_CLASS} min-h-[2rem] px-3 py-1 text-xs`}
                    >
                      {clearingToken ? '削除中...' : 'トークンを削除'}
                    </button>
                  )}
                </AdminActionRow>
              </div>

              <AdminActionRow align="end" className="pt-1">
                {savedAt && <AdminStatusPill tone="success">保存しました</AdminStatusPill>}
                <button
                  type="button"
                  onClick={save}
                  disabled={(!isDirty && !hasTokenInput) || saving}
                  className={EDITOR_PRIMARY_BUTTON_CLASS}
                >
                  {saving ? '保存中...' : '詳細設定を保存'}
                </button>
              </AdminActionRow>
            </div>
          )}

          {data?.status && (
            <AdminCallout tone="neutral">
              <span className="font-bold text-[#3f4352]">ステータス：</span>
              <AdminStatusPill tone={getStatusTone(data.status)} className="mx-1">
                {statusLabel}
              </AdminStatusPill>
              {data.connectedAt ? ` 接続: ${data.connectedAt}` : ''}
              {data.lastVerifiedAt ? ` 最終確認: ${data.lastVerifiedAt}` : ''}
            </AdminCallout>
          )}
        </div>
      )}
    </EditorPanel>
  );
}

function ConnectorSummary({
  data,
  statusLabel,
}: {
  data: HubConnectorData | null;
  statusLabel: string;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-white/75 bg-white/80 px-4 py-3">
      <AdminStatusPill tone={getOnOffTone(data?.enabled)}>
        連携 {data?.enabled ? 'ON' : 'OFF'}
      </AdminStatusPill>
      <AdminStatusPill tone={getOnOffTone(data?.scriptEnabled)}>
        スクリプト {data?.scriptEnabled ? 'ON' : 'OFF'}
      </AdminStatusPill>
      <AdminStatusPill tone={getStatusTone(data?.status)}>
        {statusLabel}
      </AdminStatusPill>
      {data?.serverTokenConfigured && (
        <AdminStatusPill tone="success">トークン設定済み</AdminStatusPill>
      )}
    </div>
  );
}

interface FieldProps {
  label: string;
  help?: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: 'text' | 'password';
  className?: string;
}

function Field({
  label,
  help,
  value,
  onChange,
  placeholder,
  type = 'text',
  className,
}: FieldProps) {
  return (
    <EditorField label={label} help={help} className={className}>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        maxLength={256}
        className={`${EDITOR_INPUT_CLASS} w-full font-mono placeholder:text-[#b0b6c2]`}
      />
    </EditorField>
  );
}
