// Phase I18N-3B.2B-MT0 — Local Machine Translation Benchmark Fixtures
import { BenchmarkTargetItem } from './mtBenchmark.types';

export const benchmarkFixtures: BenchmarkTargetItem[] = [
  {
    targetId: 'prose_1',
    targetType: 'block_text',
    text: 'According to Smith et al. [12], the hazard ratio for the treatment group was 0.45 (95% CI, 0.32-0.61; p < 0.001), indicating a statistically significant reduction in mortality. See DOI: 10.1016/j.cell.2021.08.012.',
    expectedTokens: ['[12]', '0.45', '95% CI', '0.32-0.61', 'p < 0.001', '10.1016/j.cell.2021.08.012']
  },
  {
    targetId: 'prose_2',
    targetType: 'block_text',
    text: 'The primary endpoint was evaluated at a baseline mean (SD) of 14.5 (3.2) mg/dL compared to 12.1 (2.8) mg/dL post-intervention.',
    expectedTokens: ['mean (SD)', '14.5', '(3.2)', '12.1', '(2.8)', 'mg/dL']
  },
  {
    targetId: 'figure_caption_1',
    targetType: 'figure_caption',
    text: 'Figure 3. Kaplan-Meier survival curves for the ITT population showing overall survival (OS) benefit (log-rank p = 0.0024).',
    expectedTokens: ['Figure 3.', 'p = 0.0024', '(OS)']
  },
  {
    targetId: 'table_cell_1',
    targetType: 'table_cell',
    text: 'Odds Ratio (OR) = 1.89 (95% CI: 1.12 - 3.14)',
    expectedTokens: ['(OR)', '1.89', '95% CI', '1.12 - 3.14']
  },
  {
    targetId: 'table_cell_2',
    targetType: 'table_cell',
    text: 'Mean difference: -2.34 kg/m² (p-value = 0.041)',
    expectedTokens: ['-2.34', 'kg/m²', 'p-value = 0.041']
  }
];
