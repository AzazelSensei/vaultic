import { randomBytes } from 'node:crypto';
import { Bot, InlineKeyboard } from 'grammy';
import type { PollingOptions } from 'grammy';
import type { ApprovalDecision, ApprovalProvider, ApprovalRequest } from './types.js';

const APPROVAL_TIMEOUT_MS = 120_000;
const CALLBACK_PREFIX = 'apr:';
const CALLBACK_FILTER = 'callback_query:data' as const;

interface CallbackContextLike {
  readonly callbackQuery: { readonly data?: string };
  readonly from?: { readonly id: number };
  answerCallbackQuery(other?: unknown): Promise<true>;
  editMessageText(text: string, other?: unknown): Promise<unknown>;
}

export interface TelegramBotLike {
  on(
    filter: typeof CALLBACK_FILTER,
    handler: (ctx: CallbackContextLike) => unknown | Promise<unknown>,
  ): unknown;
  start(options?: PollingOptions): Promise<void>;
  stop(): Promise<void>;
  readonly api: {
    sendMessage(chatId: number, text: string, other?: unknown): Promise<unknown>;
  };
}

interface PendingEntry {
  resolve: (decision: ApprovalDecision) => void;
  reject: (error: Error) => void;
  allowedUserId: number;
  ref: string;
  timer: ReturnType<typeof setTimeout>;
}

export interface TelegramApproverOptions {
  botToken?: string;
  allowedUserId?: number;
  botFactory?: (token: string) => TelegramBotLike;
}

export class TelegramApprover implements ApprovalProvider {
  readonly channel = 'telegram' as const;
  private readonly options: TelegramApproverOptions;
  private readonly pending = new Map<string, PendingEntry>();
  private bot?: TelegramBotLike;
  private startPromise?: Promise<void>;
  private failed = false;
  private stopped = false;

  constructor(options: TelegramApproverOptions) {
    this.options = options;
  }

  isAvailable(): boolean {
    return Boolean(this.options.botToken && this.options.allowedUserId);
  }

  async requestApproval(req: ApprovalRequest): Promise<ApprovalDecision> {
    const { botToken, allowedUserId } = this.options;
    if (!botToken || !allowedUserId) throw new Error('Telegram approver not configured');

    const bot = this.ensureStarted(botToken);
    const nonce = randomBytes(16).toString('hex');

    const decision = new Promise<ApprovalDecision>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(nonce);
        resolve('timeout');
      }, APPROVAL_TIMEOUT_MS);
      this.pending.set(nonce, { resolve, reject, allowedUserId, ref: req.ref, timer });
    });

    this.startPromise?.catch((cause) => {
      const entry = this.pending.get(nonce);
      if (!entry) return;
      clearTimeout(entry.timer);
      this.pending.delete(nonce);
      entry.reject(new Error(`Telegram bot start failed: ${(cause as Error).message}`));
    });

    try {
      const keyboard = new InlineKeyboard()
        .text('Onayla', `${CALLBACK_PREFIX}${nonce}:y`)
        .text('Reddet', `${CALLBACK_PREFIX}${nonce}:n`);
      await bot.api.sendMessage(
        allowedUserId,
        `vaultic onay isteği\nReferans: ${req.ref}\nGerekçe: ${req.reason}\n120 sn içinde yanıtlanmazsa reddedilir.`,
        { reply_markup: keyboard },
      );
    } catch (cause) {
      const entry = this.pending.get(nonce);
      if (entry) {
        clearTimeout(entry.timer);
        this.pending.delete(nonce);
      }
      throw new Error(`Telegram sendMessage failed: ${(cause as Error).message}`);
    }

    return decision;
  }

  async close(): Promise<void> {
    if (this.stopped || !this.bot) return;
    this.stopped = true;
    await this.bot.stop();
  }

  private ensureStarted(token: string): TelegramBotLike {
    if (this.failed) throw new Error('Telegram bot is in a failed state');
    if (this.bot) return this.bot;

    const factory = this.options.botFactory ?? ((t: string): TelegramBotLike => new Bot(t));
    const bot = factory(token);
    bot.on(CALLBACK_FILTER, (ctx) => this.handleCallback(ctx));

    this.startPromise = bot.start().catch((cause) => {
      this.failed = true;
      const error = new Error(`Telegram bot start failed: ${(cause as Error).message}`);
      for (const [nonce, entry] of this.pending) {
        clearTimeout(entry.timer);
        this.pending.delete(nonce);
        entry.reject(error);
      }
      throw error;
    });

    this.bot = bot;
    return bot;
  }

  private async handleCallback(ctx: CallbackContextLike): Promise<void> {
    const data = ctx.callbackQuery.data;
    const nonce = data?.startsWith(CALLBACK_PREFIX) ? data.slice(CALLBACK_PREFIX.length).split(':')[0] : undefined;
    const entry = nonce ? this.pending.get(nonce) : undefined;
    if (!nonce || !entry) {
      await ctx.answerCallbackQuery();
      return;
    }
    if (ctx.from?.id !== entry.allowedUserId) {
      await ctx.answerCallbackQuery({ text: 'not authorized' });
      return;
    }
    this.pending.delete(nonce);
    clearTimeout(entry.timer);
    const approved = data?.endsWith(':y') ?? false;
    await ctx.answerCallbackQuery();
    await ctx.editMessageText(`vaultic: ${entry.ref} — ${approved ? 'ONAYLANDI' : 'REDDEDİLDİ'}`);
    entry.resolve(approved ? 'approved' : 'denied');
  }
}
