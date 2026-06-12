import { useState } from 'react';
import { showAdminToast } from '../../lib/admin-toast';
import {
  AdminStatusPill,
  AdminToggleRow,
  EditorSectionHeader,
  EditorSubPanel,
} from './LpEditorPrimitives';

interface Props {
  lpId: string;
  initialEnabled: boolean;
}

export default function LpHubConnectorPanel({ lpId, initialEnabled }: Props) {
  const [enabled, setEnabled] = useState(initialEnabled);
  const [saving, setSaving] = useState(false);

  async function toggle(next: boolean) {
    setSaving(true);
    try {
      const res = await fetch(`/api/lps/${lpId}/settings`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ hubConnectorEnabled: next }),
      });
      if (!res.ok) {
        let msg = `保存失敗 (${res.status})`;
        try {
          const d = (await res.json()) as {
            success: false;
            error: { message: string };
          };
          if (d.error?.message) msg = d.error.message;
        } catch {
          /* ignore */
        }
        throw new Error(msg);
      }
      setEnabled(next);
      showAdminToast({
        message: next
          ? 'このLPの連携コネクターをONにしました。'
          : 'このLPの連携コネクターをOFFにしました。',
      });
    } catch (err) {
      showAdminToast({
        tone: 'danger',
        message: `保存できませんでした。${err instanceof Error ? err.message : String(err)}`,
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <EditorSubPanel className="space-y-4 bg-white/85">
      <EditorSectionHeader
        title="連携コネクター"
        titleAdornment={
          <AdminStatusPill tone={enabled ? 'success' : 'neutral'}>
            {enabled ? 'ON' : 'OFF'}
          </AdminStatusPill>
        }
        description="このLPで連携コネクターを使うかどうかを切り替えます。サイト設定側がOFFの場合は出力されません。"
      />
      <AdminToggleRow
        title={enabled ? 'このLPで使用する' : 'このLPでは使用しない'}
        help="外部Hubと接続するLPだけONにします。通常はOFFのままで問題ありません。"
        checked={enabled}
        disabled={saving}
        onChange={toggle}
        className="bg-[#f8fafc]/82"
      />
    </EditorSubPanel>
  );
}
