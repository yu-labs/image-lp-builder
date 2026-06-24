import {
  BarChart3,
  Code2,
  FileText,
  Globe2,
  House,
  Image,
  Link2,
  Megaphone,
  MousePointerClick,
  ShieldAlert,
  X,
  type LucideIcon,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import AdminModal from './AdminModal';
import DomainSettingsPanel from './DomainSettingsPanel';
import HubConnectorPanel from './HubConnectorPanel';
import {
  AdminStatusPill,
  EDITOR_HELP_CLASS,
  EDITOR_TIGHT_STACK_CLASS,
  EditorPanel,
  EditorSectionHeader,
} from './LpEditorPrimitives';
import { SITE_SETTINGS_STATUS_CHANGED } from '../../lib/site-settings-events';
import SiteMetaPanel from './SiteMetaPanel';
import SiteLegalLinksPanel from './SiteLegalLinksPanel';
import SiteSettingsPanel from './SiteSettingsPanel';
import HomePageSettingsPanel from './HomePageSettingsPanel';

type SettingsCardId =
  | 'site-icon'
  | 'home-page'
  | 'legal-links'
  | 'maintenance'
  | 'gtm'
  | 'ga4'
  | 'clarity'
  | 'meta-pixel'
  | 'domain'
  | 'custom-head'
  | 'hub-connector';

interface SettingsCard {
  id: SettingsCardId;
  title: string;
  description: string;
  icon: LucideIcon;
  iconClassName: string;
}

type CardStatus = '設定済み' | '未設定' | '要確認' | 'ON' | 'OFF';

const GROUPS: Array<{ title: string; cards: SettingsCard[] }> = [
  {
    title: 'サイト表示',
    cards: [
      {
        id: 'site-icon',
        title: 'サイトアイコン',
        description: 'ブラウザタブやスマホ保存時のアイコン',
        icon: Image,
        iconClassName: 'text-[#567baf]',
      },
      {
        id: 'home-page',
        title: 'サイトトップ',
        description: '公開URLの / から開くLP',
        icon: House,
        iconClassName: 'text-[#567baf]',
      },
      {
        id: 'legal-links',
        title: '法務リンク',
        description: 'LP下部に表示する外部URL',
        icon: FileText,
        iconClassName: 'text-[#567baf]',
      },
      {
        id: 'domain',
        title: '独自ドメイン',
        description: '公開URLを自社ドメインに変更',
        icon: Globe2,
        iconClassName: 'text-[#567baf]',
      },
      {
        id: 'maintenance',
        title: 'メンテナンス表示',
        description: '全LPを一時的に非公開表示へ切り替え',
        icon: ShieldAlert,
        iconClassName: 'text-amber-600',
      },
    ],
  },
  {
    title: '計測タグ',
    cards: [
      {
        id: 'gtm',
        title: 'Google Tag Manager',
        description: '迷ったらこれ。複数タグをまとめて管理',
        icon: MousePointerClick,
        iconClassName: 'text-[#4c7fe8]',
      },
      {
        id: 'ga4',
        title: 'Google Analytics',
        description: 'LPへのアクセス数や流入を計測',
        icon: BarChart3,
        iconClassName: 'text-orange-500',
      },
      {
        id: 'clarity',
        title: 'Microsoft Clarity',
        description: 'ヒートマップや操作録画で改善点を確認',
        icon: BarChart3,
        iconClassName: 'text-[#21a3a9]',
      },
      {
        id: 'meta-pixel',
        title: 'Meta Pixel',
        description: 'Facebook / Instagram広告の計測',
        icon: Megaphone,
        iconClassName: 'text-[#1877f2]',
      },
    ],
  },
  {
    title: '外部連携',
    cards: [
      {
        id: 'hub-connector',
        title: '連携コネクター',
        description: '接続コードでConnectorと接続',
        icon: Link2,
        iconClassName: 'text-[#567baf]',
      },
    ],
  },
  {
    title: '開発者向け',
    cards: [
      {
        id: 'custom-head',
        title: 'カスタムHTML',
        description: 'タグやHTMLを直接追加',
        icon: Code2,
        iconClassName: 'text-gray-700',
      },
    ],
  },
];

const TRACKING_FIELD_BY_CARD: Partial<
  Record<SettingsCardId, 'gtmId' | 'ga4Id' | 'clarityId' | 'metaPixelId'>
> = {
  gtm: 'gtmId',
  ga4: 'ga4Id',
  clarity: 'clarityId',
  'meta-pixel': 'metaPixelId',
};

export default function SiteSettingsHub() {
  const [selected, setSelected] = useState<SettingsCardId | null>(null);
  const [statuses, setStatuses] = useState<Partial<Record<SettingsCardId, CardStatus>>>({});
  const cards = GROUPS.flatMap((group) => group.cards);
  const activeCard = selected ? cards.find((card) => card.id === selected) : null;

  useEffect(() => {
    void loadStatuses();
    const handleStatusChanged = () => void loadStatuses();
    window.addEventListener(SITE_SETTINGS_STATUS_CHANGED, handleStatusChanged);
    return () => {
      window.removeEventListener(
        SITE_SETTINGS_STATUS_CHANGED,
        handleStatusChanged
      );
    };
  }, []);

  useEffect(() => {
    if (!selected) return;
    function closeOnEscape(e: KeyboardEvent) {
      if (e.key === 'Escape') closeModal();
    }
    document.addEventListener('keydown', closeOnEscape);
    return () => document.removeEventListener('keydown', closeOnEscape);
  }, [selected]);

  function closeModal() {
    setSelected(null);
  }

  function openModal(id: SettingsCardId) {
    setSelected(id);
  }

  async function loadStatuses() {
    try {
      const [meta, homepage, settings, tags, domain, hub] = await Promise.all([
        fetchJson('/api/site-meta'),
        fetchJson('/api/site-homepage'),
        fetchJson('/api/site-settings'),
        fetchJson('/api/tracking-tags'),
        fetchJson('/api/site-domain'),
        fetchJson('/api/hub-connector'),
      ]);

      const tagData = tags?.data ?? {};
      const homepageData = homepage?.data ?? {};
      const hubData = hub?.data ?? {};
      const hubConfigured =
        hubData.scriptUrl ||
        hubData.hubBaseUrl ||
        hubData.connectionId ||
        hubData.serverTokenConfigured;
      setStatuses({
        'site-icon': meta?.data?.faviconUrl || meta?.data?.appleTouchIconUrl
          ? '設定済み'
          : '未設定',
        'home-page': homepageData.homePage
          ? '設定済み'
          : homepageData.homePageNeedsReview
            ? '要確認'
            : '未設定',
        'legal-links':
          meta?.data?.termsOfServiceUrl ||
          meta?.data?.privacyPolicyUrl ||
          meta?.data?.commercialTransactionUrl
            ? '設定済み'
            : '未設定',
        maintenance: settings?.data?.maintenanceMode ? 'ON' : 'OFF',
        gtm: tagData.gtmId ? '設定済み' : '未設定',
        ga4: tagData.ga4Id ? '設定済み' : '未設定',
        clarity: tagData.clarityId ? '設定済み' : '未設定',
        'meta-pixel': tagData.metaPixelId ? '設定済み' : '未設定',
        domain: domain?.data?.domain ? '設定済み' : '未設定',
        'custom-head': tagData.customHead ? '設定済み' : '未設定',
        'hub-connector': hubData.enabled
          ? 'ON'
          : hubConfigured
            ? '設定済み'
            : '未設定',
      });
    } catch {
      // Status badges are convenience only; each panel still loads its own data.
    }
  }

  return (
    <div className={EDITOR_TIGHT_STACK_CLASS}>
      {GROUPS.map((group) => (
        <EditorPanel key={group.title}>
          <div className="mb-4">
            <EditorSectionHeader title={group.title} />
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {group.cards.map((card) => (
              <SettingsCardButton
                key={card.id}
                card={card}
                status={statuses[card.id]}
                onClick={() => openModal(card.id)}
              />
            ))}
          </div>
        </EditorPanel>
      ))}

      {selected && activeCard && (
        <AdminModal
          key={selected}
          ariaLabel={activeCard.title}
          zIndexClass="z-[120]"
          maxWidthClass="max-w-3xl"
          maxHeightClass="max-h-[86dvh] sm:max-h-[92vh]"
          overflowClass="overflow-hidden"
          panelClassName="admin-modal-panel flex flex-col"
          onClose={closeModal}
        >
          <header className="flex items-start justify-between gap-4 border-b border-[#e2e7f0] bg-white/80 px-5 py-4">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-lg font-bold text-[#3f4352]">
                  {activeCard.title}
                </h2>
              </div>
              <p className="mt-1 text-sm leading-[1.55] text-[#8b91a1]">
                {activeCard.description}
              </p>
            </div>
            <button
              type="button"
              onClick={closeModal}
              aria-label="閉じる"
              className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-[#9aa1ae] transition hover:bg-[#f2f4f8] hover:text-[#3f4352]"
            >
              <X size={20} strokeWidth={2.4} aria-hidden="true" />
            </button>
          </header>
          <div className="overflow-y-auto bg-[#f6f8fb]/70 p-4 sm:p-5">
            {renderPanel(selected)}
          </div>
        </AdminModal>
      )}
    </div>
  );
}

function SettingsCardButton({
  card,
  status,
  onClick,
}: {
  card: SettingsCard;
  status?: CardStatus;
  onClick: () => void;
}) {
  const Icon = card.icon;
  return (
    <button
      type="button"
      onClick={onClick}
      className="group min-h-[7rem] rounded-2xl border border-white/75 bg-white/88 p-4 text-left shadow-[0_10px_26px_rgba(31,34,48,0.05)] transition hover:border-[#c8d5e8] hover:bg-white hover:shadow-[0_14px_32px_rgba(86,123,175,0.12)]"
    >
      <div className="flex h-full flex-col justify-between gap-3">
        <div className="flex items-start gap-3">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-[#f2f4f8] transition group-hover:bg-[#567baf]/10">
            <Icon
              size={25}
              strokeWidth={2.4}
              className={card.iconClassName}
            />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <p className="text-base font-extrabold text-[#3f4352]">{card.title}</p>
            </div>
            <p className={`${EDITOR_HELP_CLASS} mt-1 text-[0.8rem]`}>
              {card.description}
            </p>
          </div>
        </div>
        {status && (
          <AdminStatusPill
            tone={statusTone(status)}
            className="w-fit"
          >
            {status}
          </AdminStatusPill>
        )}
      </div>
    </button>
  );
}

function renderPanel(active: SettingsCardId) {
  if (active === 'site-icon') return <SiteMetaPanel key={active} hideHeading />;
  if (active === 'home-page') return <HomePageSettingsPanel key={active} />;
  if (active === 'legal-links') return <SiteLegalLinksPanel key={active} />;
  if (active === 'maintenance') {
    return <SiteSettingsPanel key={active} variant="maintenance" hideHeading />;
  }
  if (TRACKING_FIELD_BY_CARD[active]) {
    return (
      <SiteSettingsPanel
        key={active}
        variant="tracking"
        trackingField={TRACKING_FIELD_BY_CARD[active]}
        hideHeading
      />
    );
  }
  if (active === 'domain') return <DomainSettingsPanel key={active} hideHeading />;
  if (active === 'custom-head') {
    return <SiteSettingsPanel key={active} variant="customHead" hideHeading />;
  }
  if (active === 'hub-connector') {
    return <HubConnectorPanel key={active} hideHeading />;
  }
  return null;
}

function statusTone(status: CardStatus) {
  if (status === '設定済み' || status === 'ON') return 'success';
  if (status === '要確認') return 'warning';
  return 'neutral';
}

async function fetchJson(url: string) {
  const res = await fetch(url);
  if (!res.ok) return null;
  return (await res.json()) as { success: true; data: Record<string, unknown> };
}
