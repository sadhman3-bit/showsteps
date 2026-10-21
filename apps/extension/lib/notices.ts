import { strings } from '@showsteps/ui/strings';
import type { Notice } from './schedules';

const n = strings.schedules.notify;

/**
 * The words of a scheduled-run notification. Built only from the schedule's name, a step number
 * and fixed text: a notice carries no typed values, so none can show on screen.
 */
export function noticeText(notice: Notice): { title: string; message: string; buttons: string[] } {
  switch (notice.kind) {
    case 'paused':
      return {
        title: n.title,
        message: n.paused[notice.reason](notice.name, notice.step),
        buttons: [n.open],
      };
    case 'due':
      return { title: n.title, message: n.due(notice.name), buttons: [n.start] };
    case 'finished':
      return { title: n.title, message: n.finished[notice.outcome](notice.name), buttons: [] };
    case 'check-failed':
      return { title: n.title, message: n.checkFailed(notice.name, notice.step), buttons: [] };
  }
}
