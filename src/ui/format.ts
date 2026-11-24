const numbers = new Intl.NumberFormat('zh-TW');
const rates = new Intl.NumberFormat('zh-TW', { style: 'percent', maximumFractionDigits: 1 });

export const money = (amount: number) => `${amount < 0 ? '−' : ''}$${numbers.format(Math.abs(amount))}`;
export const percent = (amount: number) => rates.format(amount);
export const signedMoney = (amount: number) => amount > 0 ? `+${money(amount)}` : money(amount);
export const signedPercent = (amount: number) => amount > 0 ? `+${percent(amount)}` : percent(amount);
export const direction = (amount: number) => amount > 0 ? 'gain' : amount < 0 ? 'loss' : 'flat';
export const arrow = (amount: number) => amount > 0 ? '▲' : amount < 0 ? '▼' : '◆';

export function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!);
}
