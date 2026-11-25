import { z } from 'zod';
import raw from './feedback.json';

const ms = z.number().int().min(0).max(5000);
const share = z.number().min(0).max(1);
const schema = z.object({
  /** Share of the target's opening worth at which a hit is shown as 一般／強力／重擊. Presentation only. */
  tiers: z.object({ normal: share, strong: share, heavy: share }),
  /** Market move (rate) from which the market float uses the big style. */
  bigMarket: share,
  timing: z.object({
    baseGap: ms, chainStart: ms, chainGap: ms, attackStart: ms, attackGap: ms, reflectDelay: ms, rankDelay: ms, maxSpan: ms
  })
});

export type FeedbackConfig = z.infer<typeof schema>;

export function readFeedbackConfig(input: unknown = raw): FeedbackConfig {
  const parsed = schema.safeParse(input);
  if (!parsed.success) throw new Error(`演出設定錯誤：${parsed.error.issues.map(issue => `${issue.path.join('.')} ${issue.message}`).join('；')}`);
  const { tiers } = parsed.data;
  if (!(tiers.normal < tiers.strong && tiers.strong < tiers.heavy)) throw new Error('演出設定錯誤：命中分級門檻須遞增');
  return parsed.data;
}
