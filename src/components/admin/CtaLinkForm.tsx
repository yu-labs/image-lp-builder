/**
 * CtaLinkForm — the "what happens when the button is tapped" editor
 * inside the CTA modal. Lets the operator pick a destination mode
 * (URL / tel / email / saved MyLink) and edit its value, with inline
 * validation. Extracted from CtaEditor.tsx; driven purely by props so
 * it holds no CTA state beyond the local mode selection.
 */

import { useState } from 'react';
import { ExternalLink } from 'lucide-react';
import type { CtaLink } from '../../lib/content';
import {
  ctaEmailError,
  ctaTelError,
  ctaUrlError,
  validateCtaLinkForEditor,
  type MyLink,
} from './cta-editor-helpers';
import {
  CTA_MODAL_ERROR_CLASS,
  CTA_MODAL_INPUT_CLASS,
  CTA_MODAL_INPUT_ERROR_CLASS,
} from './cta-editor-styles';
import AdminSelect from './AdminSelect';
import {
  EDITOR_HELP_CLASS,
  EDITOR_LABEL_CLASS,
  EDITOR_TIGHT_STACK_CLASS,
  EditorField,
} from './LpEditorPrimitives';

interface LinkFormProps {
  link: CtaLink;
  onChange: (link: CtaLink) => void;
  myLinks: MyLink[];
}

type CtaLinkEditorMode = 'url' | 'tel' | 'email' | 'my_link';

const CTA_LINK_EDITOR_MODE_OPTIONS: ReadonlyArray<{
  value: CtaLinkEditorMode;
  label: string;
}> = [
  { value: 'url', label: 'URL' },
  { value: 'tel', label: '電話' },
  { value: 'email', label: 'メール' },
  { value: 'my_link', label: 'よく使うリンク' },
];

/**
 * Treat any of the seed URLs we ship in CTA presets as "no real value
 * was entered yet" so type changes don't carry the placeholder forward
 * into the new shape. Same intent as forcing empty defaults — we want
 * the operator to put their own URL in.
 */
function isPlaceholderUrl(url: string): boolean {
  if (!url) return true;
  const u = url.trim().toLowerCase();
  return (
    u === '' || u === 'https://' || u === 'http://' || u === 'https://lin.ee/'
  );
}

function getCtaLinkEditorMode(link: CtaLink): CtaLinkEditorMode {
  if ('myLinkId' in link && link.myLinkId) return 'my_link';
  if (link.type === 'tel') return 'tel';
  if (link.type === 'mailto') return 'email';
  return 'url';
}

function stripCtaHrefScheme(value: string, scheme: 'tel' | 'mailto'): string {
  return value.trim().replace(new RegExp(`^${scheme}:`, 'i'), '').trim();
}

function myLinkKindLabel(url: string): string {
  if (/^tel:/i.test(url)) return '電話';
  if (/^mailto:/i.test(url)) return 'メール';
  return 'URL';
}

function displayMyLinkUrl(url: string): string {
  if (/^tel:/i.test(url)) return stripCtaHrefScheme(url, 'tel');
  if (/^mailto:/i.test(url)) return stripCtaHrefScheme(url, 'mailto');
  return url;
}

function urlValueFromLink(link: CtaLink): string {
  return 'url' in link ? link.url : '';
}

function urlValueForInlineUrl(link: CtaLink): string {
  const url = urlValueFromLink(link);
  if (/^(tel|mailto):/i.test(url)) return '';
  return url;
}

function urlValueForModeSwitch(link: CtaLink): string {
  const url = urlValueFromLink(link);
  if (/^(tel|mailto):/i.test(url)) return '';
  return isPlaceholderUrl(url) ? '' : url;
}

function phoneValueFromLink(link: CtaLink, selectedMyLink?: MyLink): string {
  if (link.type === 'tel') return link.number;
  const source = selectedMyLink?.url ?? urlValueFromLink(link);
  return /^tel:/i.test(source) ? stripCtaHrefScheme(source, 'tel') : '';
}

function emailValueFromLink(link: CtaLink, selectedMyLink?: MyLink): string {
  if (link.type === 'mailto') return link.email;
  const source = selectedMyLink?.url ?? urlValueFromLink(link);
  return /^mailto:/i.test(source) ? stripCtaHrefScheme(source, 'mailto') : '';
}

export default function CtaLinkForm({ link, onChange, myLinks }: LinkFormProps) {
  const [linkMode, setLinkMode] = useState<CtaLinkEditorMode>(() =>
    getCtaLinkEditorMode(link),
  );
  const myLinkId = 'myLinkId' in link ? link.myLinkId : undefined;
  const selectedMyLink = myLinkId
    ? myLinks.find((m) => m.id === myLinkId)
    : undefined;
  const hasDeletedMyLink = Boolean(myLinkId && !selectedMyLink);
  const usingMyLink = Boolean(selectedMyLink);
  const linkForValidation: CtaLink =
    linkMode === 'url' && link.type === 'webhook'
      ? { type: 'custom_url', url: link.url }
      : link;
  const linkErrors =
    linkMode === 'my_link' && !selectedMyLink
      ? ['よく使うリンクを選択してください']
      : validateCtaLinkForEditor(linkForValidation);
  const inlineUrlValue =
    linkMode === 'url' && 'url' in link ? urlValueForInlineUrl(link) : '';
  const telValue = linkMode === 'tel' && link.type === 'tel' ? link.number : '';
  const emailValue =
    linkMode === 'email' && link.type === 'mailto' ? link.email : '';
  const urlError = linkMode === 'url' ? ctaUrlError(inlineUrlValue) : null;
  const telError = linkMode === 'tel' ? ctaTelError(telValue) : null;
  const emailError = linkMode === 'email' ? ctaEmailError(emailValue) : null;

  function changeMode(nextMode: CtaLinkEditorMode) {
    if (nextMode === linkMode) return;
    setLinkMode(nextMode);
    switch (nextMode) {
      case 'url':
        onChange({ type: 'custom_url', url: urlValueForModeSwitch(link) });
        return;
      case 'tel':
        onChange({
          type: 'tel',
          number: phoneValueFromLink(link, selectedMyLink),
        });
        return;
      case 'email':
        onChange({
          type: 'mailto',
          email: emailValueFromLink(link, selectedMyLink),
        });
        return;
      case 'my_link': {
        const first = selectedMyLink ?? myLinks[0];
        onChange(
          first
            ? { type: 'custom_url', myLinkId: first.id, url: first.url }
            : { type: 'custom_url', url: '' },
        );
        return;
      }
    }
  }

  function pickMyLink(id: string) {
    if (id === '') {
      onChange({ type: 'custom_url', url: '' });
      return;
    }
    const ml = myLinks.find((m) => m.id === id);
    if (!ml) return;
    // Snap inline url to the MyLink url so it acts as a fallback if
    // the MyLink later disappears, and the field reflects reality.
    onChange({ type: 'custom_url', myLinkId: id, url: ml.url });
  }

  function changeUrl(url: string) {
    onChange({ type: 'custom_url', url });
  }

  return (
    <div className={`${EDITOR_TIGHT_STACK_CLASS} w-full text-sm`}>
      {linkErrors.length > 0 && (
        <div className={CTA_MODAL_ERROR_CLASS}>
          保存するにはリンク設定を入力してください。
          <ul className="mt-1 list-disc pl-4">
            {linkErrors.map((err) => (
              <li key={err}>{err}</li>
            ))}
          </ul>
        </div>
      )}

      <EditorField label="リンクの種類">
        <AdminSelect
          value={linkMode}
          onChange={(e) => {
            changeMode(e.target.value as CtaLinkEditorMode);
          }}
        >
          {CTA_LINK_EDITOR_MODE_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </AdminSelect>
        <span className={EDITOR_HELP_CLASS}>
          URLにはLINE・予約フォーム・問い合わせページなどを入れられます。
        </span>
      </EditorField>

      {linkMode === 'my_link' && (
        <div className="flex min-w-0 flex-col gap-1.5">
          <span className={EDITOR_LABEL_CLASS}>使うリンク</span>
          <AdminSelect
            value={selectedMyLink?.id ?? ''}
            onChange={(e) => pickMyLink(e.target.value)}
          >
            <option value="">リンクを選択してください</option>
            {myLinks.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}（{myLinkKindLabel(m.url)}）
              </option>
            ))}
          </AdminSelect>
          {usingMyLink && (
            <span
              className={`${EDITOR_HELP_CLASS} mt-0.5 break-all`}
              title={myLinks.find((m) => m.id === myLinkId)?.url}
            >
              ↳ {displayMyLinkUrl(myLinks.find((m) => m.id === myLinkId)?.url ?? '')}
            </span>
          )}
          {hasDeletedMyLink && (
            <span className="mt-0.5 rounded-xl border border-[#f2cf91] bg-[#fff8e5] px-3 py-2 text-xs font-semibold text-[#9b5d0a]">
              選ばれていたリンクは削除済みです。別のリンクを選ぶか、クリック後の動きをURLに切り替えてください。
            </span>
          )}
          {myLinks.length === 0 && (
            <span className={`${EDITOR_HELP_CLASS} mt-0.5`}>
              よく使うリンクが登録されていません（
              <a
                href="/admin/my-links"
                target="_blank"
                className="font-extrabold text-[#567baf] underline"
              >
                ここで登録
              </a>
              すると一元管理できます）
            </span>
          )}
        </div>
      )}

      {linkMode === 'my_link' && selectedMyLink && (
        <EditorField label="選択中のリンク">
          <input
            type="text"
            value={displayMyLinkUrl(selectedMyLink.url)}
            readOnly
            className={`${CTA_MODAL_INPUT_CLASS} bg-[#f8fafc] font-mono text-[#8b91a1]`}
          />
          <span className={EDITOR_HELP_CLASS}>
            リンク先を変える場合は
            <a
              href="/admin/my-links"
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 font-extrabold text-[#567baf] underline underline-offset-2"
            >
              よく使うリンク
              <ExternalLink size={12} strokeWidth={2.4} aria-hidden="true" />
            </a>
            を別タブで開いて編集します。
          </span>
        </EditorField>
      )}

      {linkMode === 'url' && (
        <EditorField label="URL">
          <input
            type="url"
            value={inlineUrlValue}
            onChange={(e) => changeUrl(e.target.value)}
            placeholder="https://example.com/..."
            className={`${CTA_MODAL_INPUT_CLASS} ${
              urlError ? CTA_MODAL_INPUT_ERROR_CLASS : ''
            }`}
          />
          {urlError && (
            <span className="text-xs font-semibold text-[#b83232]">
              {urlError}
            </span>
          )}
        </EditorField>
      )}

      {linkMode === 'tel' && (
        <EditorField label="電話番号">
          <input
            type="text"
            value={telValue}
            onChange={(e) => onChange({ type: 'tel', number: e.target.value })}
            placeholder="03-0000-0000"
            className={`${CTA_MODAL_INPUT_CLASS} ${
              telError ? CTA_MODAL_INPUT_ERROR_CLASS : ''
            }`}
          />
          {telError && (
            <span className="text-xs font-semibold text-[#b83232]">
              {telError}
            </span>
          )}
        </EditorField>
      )}

      {linkMode === 'email' && (
        <EditorField label="メールアドレス">
          <input
            type="email"
            value={emailValue}
            onChange={(e) => onChange({ type: 'mailto', email: e.target.value })}
            placeholder="contact@example.com"
            className={`${CTA_MODAL_INPUT_CLASS} ${
              emailError ? CTA_MODAL_INPUT_ERROR_CLASS : ''
            }`}
          />
          {emailError && (
            <span className="text-xs font-semibold text-[#b83232]">
              {emailError}
            </span>
          )}
        </EditorField>
      )}

    </div>
  );
}
