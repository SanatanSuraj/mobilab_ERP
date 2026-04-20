import { mockFetch } from './client';

export type DealStagePayload = {
  stage: 'WON' | 'LOST' | 'QUALIFICATION' | 'PROPOSAL' | 'NEGOTIATION';
  lostReason?: string;
};

export type DealWonResult = {
  dealId: string;
  workOrderId: string;
  pid: string;
  mrpStatus: 'RUNNING' | 'COMPLETE';
  reservedItems: number;
  shortfallItems: number;
};

export const dealsApi = {
  updateStage: async (dealId: string, payload: DealStagePayload): Promise<DealWonResult | null> => {
    // Simulate WO creation on WON
    if (payload.stage === 'WON') {
      return mockFetch<DealWonResult>({
        dealId,
        workOrderId: 'mwo-new-001',
        pid: 'WO-2026-006',
        mrpStatus: 'RUNNING',
        reservedItems: 4,
        shortfallItems: 1,
      }, 800);
    }
    return mockFetch(null);
  },
};
