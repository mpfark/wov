import { describe, expect, it } from 'vitest';
import { combat2ClientEnabled } from './feature-flags';

describe('Combat2 frontend client gate', () => {
  it.each([undefined, null, '', 'false', 'TRUE', ' true', 'true ', true, 1])(
    'keeps malformed or absent value %j disabled',
    (value) => expect(combat2ClientEnabled(value)).toBe(false),
  );

  it('enables only for the exact public build value true', () => {
    expect(combat2ClientEnabled('true')).toBe(true);
  });
});
