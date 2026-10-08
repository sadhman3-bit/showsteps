import { strings } from '@trailmark/ui';

export function SidePanel() {
  return (
    <main class="tm-sidepanel">
      <h1>{strings.sidePanel.title}</h1>
      <p>{strings.app.tagline}</p>
      <p class="tm-sidepanel__note">{strings.sidePanel.privacyNote}</p>
    </main>
  );
}
