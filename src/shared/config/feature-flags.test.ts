import { describe, expect, it } from 'vitest';
import { combat2DeliveryEnabled } from './feature-flags';

describe('Combat2 frontend delivery gate', () => {
  it.each([undefined, null, '', 'false', 'TRUE', ' true', 'true ', true, 1])(
    'keeps malformed or absent value %j disabled',
    (value) => expect(combat2DeliveryEnabled(value)).toBe(false),
  );

  it('enables only for the exact public build value true', () => {
    expect(combat2DeliveryEnabled('true')).toBe(true);
  });
});
