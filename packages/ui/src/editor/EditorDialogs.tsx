import { DEFAULT_ACCENT, type Guide, type GuideStore, type VersionInfo } from '@showsteps/core';
import { useEffect, useRef, useState } from 'preact/hooks';
import { BRAND_FONTS, brandStyle } from '../brand.js';
import { listKits, useBrandSources, type KitList } from '../brand/sources.js';
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
        <div class="ss-version-view">
          <GuideReader store={props.store} guide={viewing} />
        </div>
      </Dialog>
    );
  }

  return (
    <Dialog title={v.title} onClose={props.onClose}>
      {versions === null ? null : versions.length === 0 ? (
        <p class="ss-muted">{v.empty}</p>
      ) : (
        <ol class="ss-versions" aria-label={v.title}>
          {versions.map((ver, i) => (
            <li key={ver.n}>
              <div>
                <strong>{relativeTime(ver.savedAt)}</strong>
                {i === 0 ? <span class="ss-tag">{v.current}</span> : null}
                <div class="ss-muted">
                  {ver.title}
                  {ver.savedBy ? ` · ${v.by(ver.savedBy)}` : ''}
                </div>
              </div>
              <div class="ss-toolbar__group">
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
  // B6: the guide's brand kit; the changes below are this guide's own, on top of it.
  const getSources = useBrandSources();
  const [kits, setKits] = useState<KitList>();
  useEffect(() => {
    void getSources().then(async (sources) => setKits(await listKits(sources)));
  }, []);
  const ownChanges = !!(branding.logo || branding.accent || branding.font || branding.overrides);
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
      <p class="ss-muted">{b.hint}</p>
      <div class="ss-stack">
        {kits ? (
          <label class="ss-field">
            {b.kit}
            <select
              class="ss-input"
              value={branding.kit ?? ''}
              onChange={(e) => set({ kit: e.currentTarget.value })}
            >
              <option value="">
                {b.kitDefault(kits.kits.find((k) => k.id === kits.defaultKit)?.name)}
              </option>
              <option value="showsteps">{strings.share.brandShowSteps}</option>
              {kits.kits.map((k) => (
                <option key={k.id} value={k.id}>
                  {kits.teamIds.has(k.id) ? strings.share.brandTeam(k.name) : k.name}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        <p class="ss-muted">{b.ownHint}</p>
        <div class="ss-field">
          <span>{b.logo}</span>
          <div class="ss-toolbar__group">
            {logo ? <img class="ss-brand-logo" src={logo} alt="" /> : null}
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
        <label class="ss-field">
          <span>{b.accent}</span>
          <input
            type="color"
            value={branding.accent ?? DEFAULT_ACCENT}
            onInput={(e) => set({ accent: e.currentTarget.value })}
          />
        </label>
        <label class="ss-field">
          <span>{b.font}</span>
          <select
            class="ss-input"
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
          class="ss-brand-preview"
          style={brandStyle(props.guide.branding)}
          aria-label={b.preview}
        >
          <span class="ss-step__num">1</span> {props.guide.title}
        </div>
        {ownChanges ? (
          <div>
            <Button
              size="sm"
              onClick={() => set({ logo: '', accent: '', font: '', overrides: undefined })}
            >
              {b.reset}
            </Button>
          </div>
        ) : null}
      </div>
    </Dialog>
  );
}

export function ShortcutsDialog({ onClose }: { onClose: () => void }) {
  return (
    <Dialog title={strings.shortcuts.title} onClose={onClose}>
      <table class="ss-shortcuts">
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
