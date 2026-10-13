import { LOCKUP_SVG } from '../brand/art.js';
import { RipplePattern } from '../patterns/Patterns.js';
import { strings } from '../strings.js';
import { Dialog } from './Dialog.js';

const a = strings.about;

/** Name, version, privacy promise and licences, on a Ripple band. */
export function AboutDialog(props: { version: string; licencesUrl: string; onClose: () => void }) {
  return (
    <Dialog title={a.title} onClose={props.onClose}>
      <div class="ss-about">
        <div class="ss-about__band">
          <RipplePattern />
          <span
            class="ss-lockup ss-about__lockup"
            role="img"
            aria-label={strings.app.name}
            dangerouslySetInnerHTML={{ __html: LOCKUP_SVG }}
          />
        </div>
        <p>{strings.app.tagline}</p>
        <p class="ss-muted">{a.version(props.version)}</p>
        <p>{a.privacy}</p>
        <p class="ss-muted">
          {a.licences}{' '}
          <a href={props.licencesUrl} target="_blank" rel="noreferrer">
            {a.licencesLink}
          </a>
        </p>
      </div>
    </Dialog>
  );
}
