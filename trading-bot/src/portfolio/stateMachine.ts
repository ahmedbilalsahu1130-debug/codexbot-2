export type PositionLifecycleState =
  | 'NEUTRAL'
  | 'ARMED'
  | 'ENTERING'
  | 'IN_POSITION'
  | 'COOLDOWN'
  | 'DEFENSIVE';

export type PositionStateMachine = {
  state: PositionLifecycleState;
};

export function nextState(
  current: PositionLifecycleState,
  event:
    | 'SIGNAL_ARMED'
    | 'ORDER_SUBMITTED'
    | 'ORDER_FILLED'
    | 'POSITION_CLOSED'
    | 'COOLDOWN_EXPIRED'
    | 'DEFENSIVE_ON'
    | 'DEFENSIVE_OFF'
): PositionLifecycleState {
  if (event === 'DEFENSIVE_ON') {
    return 'DEFENSIVE';
  }

  if (current === 'DEFENSIVE' && event === 'DEFENSIVE_OFF') {
    return 'NEUTRAL';
  }

  if (current === 'NEUTRAL' && event === 'SIGNAL_ARMED') {
    return 'ARMED';
  }

  if (current === 'ARMED' && event === 'ORDER_SUBMITTED') {
    return 'ENTERING';
  }

  if (current === 'ENTERING' && event === 'ORDER_FILLED') {
    return 'IN_POSITION';
  }

  if (current === 'IN_POSITION' && event === 'POSITION_CLOSED') {
    return 'COOLDOWN';
  }

  if (current === 'COOLDOWN' && event === 'COOLDOWN_EXPIRED') {
    return 'NEUTRAL';
  }

  return current;
}
