import { describe, it, expect } from 'vitest';
import { generateLocalAnswer } from '../../server/chatbot-fallback.js';

describe('Chatbot fallback - French', () => {
  it('responds to greetings', () => {
    const answer = generateLocalAnswer('Bonjour', 'fr', { userName: 'Fatou' });
    expect(answer).toContain('FresCoop AI');
    expect(answer).toContain('Fatou');
  });

  it('responds to price questions', () => {
    const answer = generateLocalAnswer('Quel est le prix des tomates ?', 'fr', { stats: { products: 25 } });
    expect(answer).toContain('tomates');
    expect(answer).toContain('FCFA');
  });

  it('responds to selling questions', () => {
    const answer = generateLocalAnswer('Comment vendre mes produits ?', 'fr', {});
    expect(answer).toContain('Agriculteur');
    expect(answer).toContain('PayDunya');
  });

  it('responds to credit questions', () => {
    const answer = generateLocalAnswer('Comment obtenir un credit ?', 'fr', {});
    expect(answer).toContain('bancabilite');
    expect(answer).toContain('score');
  });

  it('responds to anti-waste questions', () => {
    const answer = generateLocalAnswer('Comment eviter le gaspillage ?', 'fr', {});
    expect(answer).toContain('remise');
    expect(answer).toContain('35%');
  });

  it('responds to payment questions', () => {
    const answer = generateLocalAnswer('Comment payer sur la plateforme ?', 'fr', {});
    expect(answer).toContain('PayDunya');
    expect(answer).toContain('Wave');
  });

  it('provides generic answer for unknown questions', () => {
    const answer = generateLocalAnswer('xyz random gibberish', 'fr', {});
    expect(answer).toContain('FresCoop AI');
    expect(answer.length).toBeGreaterThan(50);
  });
});

describe('Chatbot fallback - Wolof', () => {
  it('responds to Wolof greetings', () => {
    const answer = generateLocalAnswer('Salamaleekum', 'wo', { userName: 'Moussa' });
    expect(answer).toContain('Salamaleekum');
    expect(answer).toContain('FresCoop AI');
  });

  it('responds to price questions in Wolof', () => {
    const answer = generateLocalAnswer('Njeg tomates nata ?', 'wo', { stats: {} });
    expect(answer).toContain('FCFA');
  });

  it('responds to selling in Wolof', () => {
    const answer = generateLocalAnswer('Naata la may jaay sama kirim ?', 'wo', {});
    expect(answer).toContain('jaay');
  });
});
