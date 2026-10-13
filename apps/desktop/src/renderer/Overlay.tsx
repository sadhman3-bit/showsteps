import { strings } from '@showsteps/ui';
import { useEffect, useRef, useState } from 'preact/hooks';
import { api } from './api';

interface View {
  ring?: { x: number; y: number; w: number; h: number };
  number: number;
  total: number;
  title: string;
  phase: 'showing' | 'not-found' | 'web' | 'done';
  canGoBack: boolean;
}

const g = strings.guidance;
const d = strings.desktop;

/**
 * Desktop Guide Me overlay (G8): a full-screen, transparent, click-through window. Only the
 * step card takes clicks (the window stops ignoring the mouse while the pointer is over it).
 */
export function Overlay() {
  const [view, setView] = useState<View>();
  const card = useRef<HTMLDivElement>(null);
  useEffect(() => api().on('overlay', (v) => setView(v as View)), []);
  if (!view) return null;
  const control = (action: 'next' | 'back' | 'stop') =>
    void api().invoke('overlay:control', action);
  const { ring } = view;
  const cardStyle = ring
    ? {
        left: `${Math.max(8, Math.min(ring.x, innerWidth - 360))}px`,
        top: `${ring.y + ring.h + 14 + 160 < innerHeight ? ring.y + ring.h + 14 : Math.max(8, ring.y - 174)}px`,
      }
    : { right: '24px', bottom: '24px' };
  return (
    <>
      {ring ? (
        <div
          class="ss-ovl__ring"
          style={{
            left: `${ring.x - 4}px`,
            top: `${ring.y - 4}px`,
            width: `${ring.w + 8}px`,
            height: `${ring.h + 8}px`,
          }}
        />
      ) : null}
      <div
        ref={card}
        class="ss-ovl__card"
        style={cardStyle}
        role="dialog"
        aria-label={g.stepOf(view.number, view.total)}
        onMouseEnter={() => api().overlayInteractive(true)}
        onMouseLeave={() => api().overlayInteractive(false)}
      >
        {view.phase === 'done' ? (
          <p class="ss-ovl__title">{d.allDone}</p>
        ) : (
          <>
            <p class="ss-ovl__count">{g.stepOf(view.number, view.total)}</p>
            <p class="ss-ovl__title">{view.title}</p>
            {view.phase === 'web' ? <p class="ss-ovl__note">{d.webStep}</p> : null}
            {view.phase === 'not-found' ? <p class="ss-ovl__note">{d.notFoundDesktop}</p> : null}
          </>
        )}
        <div class="ss-ovl__row">
          {view.canGoBack ? (
            <button type="button" onClick={() => control('back')}>
              {g.back}
            </button>
          ) : null}
          {view.phase !== 'done' ? (
            <button type="button" class="primary" onClick={() => control('next')}>
              {g.didIt}
            </button>
          ) : null}
          <button type="button" onClick={() => control('stop')}>
            {view.phase === 'done' ? strings.library.close : g.stop}
          </button>
        </div>
      </div>
    </>
  );
}
