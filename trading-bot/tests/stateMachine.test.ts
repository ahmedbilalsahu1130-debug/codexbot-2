import { nextState } from '../src/portfolio/stateMachine.js';

describe('position state machine', () => {
  it('transitions through normal lifecycle', () => {
    let s = 'NEUTRAL' as const;
    s = nextState(s, 'SIGNAL_ARMED') as typeof s;
    expect(s).toBe('ARMED');
  });
});
