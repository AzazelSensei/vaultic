import { randomBytes } from 'node:crypto';
import { Bot, InlineKeyboard } from 'grammy';
import type { ApprovalDecision, ApprovalProvider, ApprovalRequest } from './types.js';

const APPROVAL_TIMEOUT_MS = 120_000;
const CALLBACK_PREFIX = 'apr:';

export class TelegramApprover implements ApprovalProvider {
  readonly channel = 'telegram' as const;
  constructor(private readonly options: { botToken?: string; allowedUserId?: number }) {}

  isAvailable(): boolean {
    return Boolean(this.options.botToken && this.options.allowedUserId);
  }

  async requestApproval(req: ApprovalRequest): Promise<ApprovalDecision> {
    const { botToken, allowedUserId } = this.options;
    if (!botToken || !allowedUserId) throw new Error('Telegram approver not configured');
    const bot = new Bot(botToken);
    const nonce = randomBytes(16).toString('hex');

    return new Promise<ApprovalDecision>((resolve) => {
      let settled = false;
      const finish = async (decision: ApprovalDecision) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        await bot.stop();
        resolve(decision);
      };
      const timer = setTimeout(() => void finish('timeout'), APPROVAL_TIMEOUT_MS);

      bot.on('callback_query:data', async (ctx) => {
        if (ctx.from.id !== allowedUserId) return;
        const data = ctx.callbackQuery.data;
        if (!data.startsWith(`${CALLBACK_PREFIX}${nonce}:`)) return;
        await ctx.answerCallbackQuery();
        await ctx.editMessageText(`vaultic: ${req.ref} — ${data.endsWith(':y') ? 'ONAYLANDI' : 'REDDEDİLDİ'}`);
        await finish(data.endsWith(':y') ? 'approved' : 'denied');
      });

      void bot.start({
        onStart: async () => {
          const keyboard = new InlineKeyboard()
            .text('Onayla', `${CALLBACK_PREFIX}${nonce}:y`)
            .text('Reddet', `${CALLBACK_PREFIX}${nonce}:n`);
          await bot.api.sendMessage(
            allowedUserId,
            `vaultic onay isteği\nReferans: ${req.ref}\nGerekçe: ${req.reason}\n120 sn içinde yanıtlanmazsa reddedilir.`,
            { reply_markup: keyboard },
          );
        },
      });
    });
  }
}
