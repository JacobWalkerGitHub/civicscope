import type { CorrectionState } from '@civicscope/core';

export const CORRECTION_STATE_LABELS: Record<CorrectionState, string> = {
  new: 'New',
  in_review: 'Being checked',
  fixed: 'Fixed',
  no_change: 'Checked, no change needed',
  spam: 'Spam',
};
