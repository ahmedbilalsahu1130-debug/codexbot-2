export { BreakoutEngine, type BreakoutEngineConfig, type BreakoutEngineOptions } from './engines/breakout.js';
export { ContinuationEngine, type ContinuationEngineConfig, type ContinuationEngineOptions } from './engines/continuation.js';
export { ReversalEngine, type ReversalEngineConfig, type ReversalEngineOptions } from './engines/reversal.js';
export { clamp, buildTradePlan, type PlanBuildInput } from './planner.js';
export {
  RegimeEngine,
  classifyRegime,
  mapRegimeToEngine,
  type RegimeEngineOptions
} from './regimeEngine.js';
export { StrategyPlanner, type StrategyPlannerOptions } from './strategyPlanner.js';
