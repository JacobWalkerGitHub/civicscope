import type { PublishState } from '@civicscope/core';
import { PUBLISH_STATE_LABELS } from '@/lib/labels';

export function PublishBadge({ state }: { state: PublishState }) {
  return <span className={`badge badge-${state}`}>{PUBLISH_STATE_LABELS[state]}</span>;
}
