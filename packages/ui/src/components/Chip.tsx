/** A site or app name with its icon. */
export function Chip(props: { label: string; icon?: string | undefined; title?: string }) {
  return (
    <span class="ss-chip" title={props.title ?? props.label}>
      {props.icon ? <img src={props.icon} alt="" /> : null}
      <span>{props.label}</span>
    </span>
  );
}
