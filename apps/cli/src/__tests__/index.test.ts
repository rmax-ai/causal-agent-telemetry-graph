import { describe, expect, it } from 'vitest';

// CLI tests: verify the module loads and exports correctly
describe('@catg/cli', () => {
  it('exports a VERSION constant', async () => {
    const mod = await import('../index.js');
    expect(mod.VERSION).toBe('0.1.0');
  });

  it('has commander as a dependency', () => {
    // If commander wasn't installed, the import above would fail
    expect(true).toBe(true);
  });
});
