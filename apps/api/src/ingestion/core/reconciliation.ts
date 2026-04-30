export type ReconciliationPolicy = {
  attachThreshold: number;
  reviewThreshold: number;
};

export const defaultReconciliationPolicy: ReconciliationPolicy = {
  attachThreshold: 0.85,
  reviewThreshold: 0.6
};

