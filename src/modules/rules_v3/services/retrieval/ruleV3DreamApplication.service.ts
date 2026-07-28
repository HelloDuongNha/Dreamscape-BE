import {
  buildRuleV3ApplicationText,
  detectRuleV3VerificationKind,
  hasAggregateComparisonSignal,
  hasContextualProbeSignal,
  hasPsychologicalMechanismSignal,
} from './ruleV3ApplicationSignals.service';
import type {
  RuleV3DreamApplicationRole,
  RuleV3VerificationKind,
} from './ruleV3DreamApplication.types';

export type { RuleV3DreamApplicationRole, RuleV3VerificationKind };

// Separates psychological mechanisms, checkable context, and descriptive findings.
export function classifyRuleV3DreamApplication(rule: any): RuleV3DreamApplicationRole {
  const text = buildRuleV3ApplicationText(rule);
  if (hasPsychologicalMechanismSignal(text)) return 'psychological_mechanism';
  if (hasContextualProbeSignal(text)) return 'contextual_probe';
  return 'descriptive_pattern';
}

export function canExplainPsychology(rule: any): boolean {
  return classifyRuleV3DreamApplication(rule) === 'psychological_mechanism';
}

export function classifyRuleV3VerificationKind(rule: any): RuleV3VerificationKind {
  return detectRuleV3VerificationKind(buildRuleV3ApplicationText(rule));
}

export function canGenerateContextQuestion(rule: any): boolean {
  return classifyRuleV3VerificationKind(rule) !== 'none';
}

export function requiresAggregateRuleValidation(rule: any): boolean {
  return hasAggregateComparisonSignal(rule);
}
