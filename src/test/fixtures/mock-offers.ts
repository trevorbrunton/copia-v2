/**
 * Mock visit offer data for testing and mock-alaya seed.
 * Covers edge cases:
 * - Employees with high acceptance rates
 * - Employees with high decline rates
 * - Employees with no offer history
 * - Various decline reasons
 */

export interface MockOffer {
  id: number;
  visit_id: number;
  employee_id: number;
  status: string;
  decline_reason: string | null;
  offered_at: string;
  responded_at: string | null;
}

const DECLINE_REASONS = [
  "Schedule conflict",
  "Too far",
  "Personal reasons",
  "Already committed",
  null,
];

function generateOffers(): MockOffer[] {
  const offers: MockOffer[] = [];
  let offerId = 1;
  const baseDate = new Date("2026-03-01");

  for (let empId = 1; empId <= 150; empId++) {
    // Edge case: employees 111-120 have NO offer history
    if (empId >= 111 && empId <= 120) continue;

    // Edge case: employees 101-105 have HIGH acceptance (19/20)
    if (empId >= 101 && empId <= 105) {
      for (let j = 0; j < 20; j++) {
        const isDecline = j === 0;
        const offeredAt = new Date(baseDate.getTime() - j * 24 * 60 * 60 * 1000);
        offers.push({
          id: offerId++,
          visit_id: (empId * 100) + j,
          employee_id: empId,
          status: isDecline ? "declined" : "accepted",
          decline_reason: isDecline ? "Schedule conflict" : null,
          offered_at: offeredAt.toISOString(),
          responded_at: new Date(offeredAt.getTime() + 30 * 60000).toISOString(),
        });
      }
      continue;
    }

    // Edge case: employees 106-110 have HIGH decline rate (1/10 accepted)
    if (empId >= 106 && empId <= 110) {
      for (let j = 0; j < 10; j++) {
        const isAccept = j === 0;
        const offeredAt = new Date(baseDate.getTime() - j * 24 * 60 * 60 * 1000);
        offers.push({
          id: offerId++,
          visit_id: (empId * 100) + j,
          employee_id: empId,
          status: isAccept ? "accepted" : "declined",
          decline_reason: isAccept ? null : DECLINE_REASONS[j % DECLINE_REASONS.length],
          offered_at: offeredAt.toISOString(),
          responded_at: new Date(offeredAt.getTime() + 30 * 60000).toISOString(),
        });
      }
      continue;
    }

    // Regular employees: 3-8 offers with ~60% acceptance
    const offerCount = 3 + (empId % 6);
    for (let j = 0; j < offerCount; j++) {
      const accepted = (empId + j) % 5 !== 0; // ~80% acceptance for most
      const offeredAt = new Date(baseDate.getTime() - j * 2 * 24 * 60 * 60 * 1000);

      // Edge case: some offers still pending (no response)
      const isPending = j === 0 && empId % 10 === 0;

      offers.push({
        id: offerId++,
        visit_id: (empId * 100) + j,
        employee_id: empId,
        status: isPending ? "pending" : accepted ? "accepted" : "declined",
        decline_reason: isPending || accepted ? null : DECLINE_REASONS[j % DECLINE_REASONS.length],
        offered_at: offeredAt.toISOString(),
        responded_at: isPending ? null : new Date(offeredAt.getTime() + 30 * 60000).toISOString(),
      });
    }
  }

  return offers;
}

export const MOCK_OFFERS: MockOffer[] = generateOffers();

// Named subsets
export const HIGH_ACCEPTANCE_EMPLOYEES = [101, 102, 103, 104, 105];
export const HIGH_DECLINE_EMPLOYEES = [106, 107, 108, 109, 110];
export const NO_HISTORY_EMPLOYEES = [111, 112, 113, 114, 115, 116, 117, 118, 119, 120];
