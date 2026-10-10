import type { Guide, GuideStore, VersionInfo } from '@trailmark/core';
import { useEffect, useRef, useState } from 'preact/hooks';
import { BRAND_FONTS, brandStyle } from '../brand.js';
import { Button } from '../Button.js';
import { ConfirmDialog, Dialog } from '../components/Dialog.js';
import { GuideReader } from '../guide/GuideReader.js';
import { useImageUrl } from '../hooks.js';
import { strings } from '../strings.js';
import { relativeTime } from '../time.js';
import { encodeImage } from './imageio.js';

const v = strings.versions;
const b = strings.brand;

export function VersionsDialog(props: {
  store: GuideStore;
  guideId: string;
  onRestore: (version: Guide) => void;
  onClose: () => void;
}) {
  const [versions, setVersions] = useState<VersionInfo[] | null>(null);
  const [viewing, setViewing] = useState<Guide | null>(null);
  const [confirm, setConfirm] = useState<VersionInfo | null>(null);

  useEffect(() => {
    void props.store.listVersions(props.guideId).then(setVersions);
  }, [props.store, props.guideId]);

  const open = async (n: number) =>
    setViewing((await props.store.getVersion(props.guideId, n)) ?? null);
  const restore = async (info: VersionInfo) => {
    setConfirm(null);
    const version = await props.store.getVersion(props.guideId, info.n);
    if (version) props.onRestore(version);
  };

  if (viewing) {
    return (
      <Dialog
        title={v.title}
        onClose={props.onClose}
        actions={
          <>
            <Button onClick={() => setViewing(null)}>{v.back}</Button>
            <Button onClick={props.onClose}>{strings.library.close}</Button>
          </>
        }
      >
        <div class="tm-version-view">
          <GuideReader store={props.store} guide={viewing} />
        </div>
      </Dialog>
    );
  }

  return (
    <Dialog title={v.title} onClose={props.onClose}>
      {versions === null ? null : versions.length === 0 ? (
        <p class="tm-muted">{v.empty}</p>
      ) : (
        <ol class="tm-versions" aria-label={v.title}>
          {versions.map((ver, i) => (
            <li key={ver.n}>
              <div>
                <strong>{relativeTime(ver.savedAt)}</strong>
                {i === 0 ? <span class="tm-tag">{v.current}</span> : null}
                <div class="tm-muted">
                  {ver.title}
                  {ver.savedBy ? ` · ${v.by(ver.savedBy)}` : ''}
                </div>
              </div>
              <div class="tm-toolbar__group">
                <Button variant="ghost" onClick={() => void open(ver.n)}>
                  {v.view}
                </Button>
                {i > 0 ? <Button onClick={() => setConfirm(ver)}>{v.restore}</Button> : null}
              </div>
            </li>
          ))}
        </ol>
      )}
      {confirm ? (
        <ConfirmDialog
          title={v.restore}
          message={v.restoreConfirm(relativeTime(confirm.savedAt))}
          confirm={v.restore}
          onClose={() => setConfirm(null)}
          onConfirm={() => void restore(confirm)}
        />
      ) : null}
    </Dialog>
  );
}

export function BrandingDialog(props: {
  store: GuideStore;
  guide: Guide;
  onChange: (branding: Guide['branding']) => void;
  onClose: () => void;
}) {
  const branding = props.guide.branding ?? {};
  const logo = useImageUrl(props.store, props.guide.id, branding.logo?.replace(/^img\//, ''));
  const file = useRef<HTMLInputElement>(null);
  const set = (change: Partial<NonNullable<Guide['branding']>>) => {
    // Empty values remove that setting.
    const next = Object.fromEntries(
      Object.entries({ ...branding, ...change }).filter(([, v]) => !!v),
    );
    props.onChange(Object.keys(next).length ? next : undefined);
  };
  const chooseLogo = async (f: File | undefined) => {
    if (!f) return;
    const img = await encodeImage(f);
    const name = `branding-logo.${img.ext}`;
    await props.store.putImage(props.guide.id, name, img.full);
    set({ logo: `img/${name}` });
  };
  return (
    <Dialog title={b.title} onClose={props.onClose}>
      <p class="tm-muted">{b.hint}</p>
      <div class="tm-stack">
        <div class="tm-field">
          <span>{b.logo}</span>
          <div class="tm-toolbar__group">
            {logo ? <img class="tm-brand-logo" src={logo} alt="" /> : null}
            <Button onClick={() => file.current?.click()}>{b.chooseLogo}</Button>
            {branding.logo ? (
              <Button variant="ghost" onClick={() => set({ logo: '' })}>
                {b.removeLogo}
              </Button>
            ) : null}
            <input
              ref={file}
              type="file"
              accept="image/*"
              hidden
              aria-label={b.logo}
              onChange={(e) => void chooseLogo(e.currentTarget.files?.[0])}
            />
          </div>
        </div>
        <label class="tm-field">
          <span>{b.accent}</span>
          <input
            type="color"
            value={branding.accent ?? '#0f6b62'}
            onInput={(e) => set({ accent: e.currentTarget.value })}
          />
        </label>
        <label class="tm-field">
          <span>{b.font}</span>
          <select
            class="tm-input"
            value={branding.font ?? ''}
            onChange={(e) => set({ font: e.currentTarget.value })}
          >
            <option value="">{b.fontDefault}</option>
            {Object.keys(BRAND_FONTS).map((f) => (
              <option key={f} value={f} style={{ fontFamily: BRAND_FONTS[f] }}>
                {f}
              </option>
            ))}
          </select>
        </label>
        <div
          class="tm-brand-preview"
          style={brandStyle(props.guide.branding)}
          aria-label={b.preview}
        >
          <span class="tm-step__num">1</span> {props.guide.title}
        </div>
      </div>
    </Dialog>
  );
}

export function ShortcutsDialog({ onClose }: { onClose: () => void }) {
  return (
    <Dialog title={strings.shortcuts.title} onClose={onClose}>
      <table class="tm-shortcuts">
        <tbody>
          {strings.shortcuts.rows.map(([keys, what]) => (
            <tr key={keys}>
              <th scope="row">
                <kbd>{keys}</kbd>
              </th>
              <td>{what}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Dialog>
  );
}
