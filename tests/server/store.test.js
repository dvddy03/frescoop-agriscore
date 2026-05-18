import { describe, it, expect } from 'vitest';
import { normalizeStore, dedupeOrders, preservePrivateUserFields } from '../../server/lib.js';

const emptyStore = {
  users: [],
  products: [],
  dossiers: [],
  attestations: [],
  transactions: [],
  proofs: [],
  hubs: [],
  orders: [],
  messages: [],
  notifications: [],
  lots: [],
  buyerOrders: [],
  reservations: [],
  paymentRecords: [],
  consentRecords: [],
  auditLogs: [],
  loans: [],
  surveyLeads: [],
};

describe('normalizeStore', () => {
  it('returns correct structure from empty input', () => {
    const result = normalizeStore({}, emptyStore);
    expect(Object.keys(result).sort()).toEqual(Object.keys(emptyStore).sort());
    Object.values(result).forEach((v) => expect(Array.isArray(v)).toBe(true));
  });

  it('preserves valid arrays', () => {
    const input = { users: [{ id: 'u1' }], products: [{ id: 'p1' }] };
    const result = normalizeStore(input, emptyStore);
    expect(result.users).toHaveLength(1);
    expect(result.products).toHaveLength(1);
  });

  it('replaces non-array values with empty arrays', () => {
    const input = { users: 'not-an-array', products: 42 };
    const result = normalizeStore(input, emptyStore);
    expect(result.users).toEqual([]);
    expect(result.products).toEqual([]);
  });

  it('handles null input gracefully', () => {
    const result = normalizeStore(null, emptyStore);
    expect(result.users).toEqual([]);
  });
});

describe('dedupeOrders', () => {
  it('removes duplicate orders', () => {
    const order = {
      id: 'ord-1',
      createdAt: '2026-05-01',
      productId: 'prod-1',
      sellerId: 'seller-1',
      clientId: 'client-1',
      quantity: 5,
      unit: 'kg',
      unitPrice: 500,
      totalPrice: 2500,
      status: 'Nouvelle',
      paymentStatus: '',
      message: '',
    };
    const result = dedupeOrders([order, { ...order, id: 'ord-2' }]);
    expect(result).toHaveLength(1);
  });

  it('keeps orders with different data', () => {
    const order1 = { id: 'ord-1', createdAt: '2026-05-01', productId: 'p1', sellerId: 's1', clientId: 'c1', quantity: 5, status: 'Nouvelle' };
    const order2 = { id: 'ord-2', createdAt: '2026-05-01', productId: 'p2', sellerId: 's1', clientId: 'c1', quantity: 5, status: 'Nouvelle' };
    const result = dedupeOrders([order1, order2]);
    expect(result).toHaveLength(2);
  });

  it('handles empty/invalid input', () => {
    expect(dedupeOrders([])).toEqual([]);
    expect(dedupeOrders(null)).toEqual([]);
    expect(dedupeOrders([null, undefined])).toEqual([]);
  });
});

describe('preservePrivateUserFields', () => {
  it('preserves passwordHash from current store when incoming has none', () => {
    const current = { users: [{ id: 'u1', email: 'a@b.com', passwordHash: 'secret123' }] };
    const incoming = { users: [{ id: 'u1', email: 'a@b.com' }] };
    const result = preservePrivateUserFields(incoming, current);
    expect(result.users[0].passwordHash).toBe('secret123');
  });

  it('allows explicit passwordHash from incoming (admin creation)', () => {
    const current = { users: [{ id: 'u1', email: 'a@b.com', passwordHash: 'old' }] };
    const incoming = { users: [{ id: 'u1', email: 'a@b.com', passwordHash: 'new' }] };
    const result = preservePrivateUserFields(incoming, current);
    expect(result.users[0].passwordHash).toBe('new');
  });

  it('handles new users not in current store', () => {
    const current = { users: [] };
    const incoming = { users: [{ id: 'u-new', email: 'new@b.com', passwordHash: 'hash' }] };
    const result = preservePrivateUserFields(incoming, current);
    expect(result.users[0].passwordHash).toBe('hash');
  });

  it('matches by email when id differs', () => {
    const current = { users: [{ id: 'u1', email: 'Test@B.com', passwordHash: 'secret' }] };
    const incoming = { users: [{ id: 'u1-different', email: 'test@b.com' }] };
    const result = preservePrivateUserFields(incoming, current);
    expect(result.users[0].passwordHash).toBe('secret');
  });
});
