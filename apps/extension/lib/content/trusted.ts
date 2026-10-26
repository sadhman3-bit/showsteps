/**
 * H5: a listener for ShowSteps's own buttons that ignores events the page made up
 * (`isTrusted` false), so a page script can't press Confirm, Skip, Stop or Finish. Real clicks,
 * keyboard activation of a focused button and Playwright's input are all trusted.
 */
export function trusted<E extends Event>(handler: (e: E) => void): (e: E) => void {
  return (e) => {
    if (e.isTrusted) handler(e);
  };
}
