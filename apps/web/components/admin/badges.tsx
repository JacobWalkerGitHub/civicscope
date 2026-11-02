import type { PublishState, VerificationStatus } from '@civicscope/core';
import { PUBLISH_STATE_LABELS, VERIFICATION_LABELS } from '@/lib/labels';

export function PublishBadge({ state }: { state: PublishState }) {
  return <span className={`badge badge-${state}`}>{PUBLISH_STATE_LABELS[state]}</span>;
}

export function VerificationBadge({ status }: { status: VerificationStatus }) {
  return <span className={`badge badge-review-${status}`}>{VERIFICATION_LABELS[status]}</span>;
}
