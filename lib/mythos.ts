import { createMythos } from '@mythos-work/sdk';

import { addListingId, getListingIds } from './listing-ids-store';

export const mythos = createMythos({
  resolveListingIds: getListingIds,
  onListingRegistered: addListingId,
});
