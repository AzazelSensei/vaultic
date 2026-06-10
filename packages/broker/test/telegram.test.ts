import { describe, it, expect, vi, afterEach } from 'vitest';
import { TelegramApprover, type TelegramBotLike } from '../src/approval/telegram.js';

type CallbackCtx = {
  from?: { id: number };
  callbackQuery: { data?: string };
  answerCallbackQuery: ReturnType<typeof vi.fn>;
  editMessageText: ReturnType<typeof vi.fn>;
};

class FakeBot implements TelegramBotLike {
  handler?: (ctx: unknown) => unknown | Promise<unknown>;
  readonly sendMessage = vi.fn(async () => ({}));
  readonly startSpy = vi.fn();
  readonly stopSpy = vi.fn();
  startResult: Promise<void> = Promise.resolve();
  readonly api = { sendMessage: this.sendMessage };

  on(_filter: 'callback_query:data', handler: (ctx: never) => unknown | Promise<unknown>): unknown {
    this.handler = handler as (ctx: unknown) => unknown | Promise<unknown>;
    return this;
  }

  start(options?: { onStart?: (info: unknown) => void | Promise<void> }): Promise<void> {
    this.startSpy(options);
    return this.startResult;
  }

  stop(): Promise<void> {
    this.stopSpy();
    return Promise.resolve();
  }

  async fire(ctx: Partial<CallbackCtx>): Promise<void> {
    if (!this.handler) throw new Error('no handler registered');
    await this.handler({
      answerCallbackQuery: vi.fn(async () => true),
      editMessageText: vi.fn(async () => ({})),
      ...ctx,
    });
  }

  nonceFromLastSend(): string {
    const call = this.sendMessage.mock.calls.at(-1);
    if (!call) throw new Error('sendMessage not called');
    const markup = (call[2] as { reply_markup: { inline_keyboard: Array<Array<{ callback_data: string }>> } })
      .reply_markup;
    const data = markup.inline_keyboard[0][0].callback_data;
    return data.split(':')[1];
  }
}

const ALLOWED = 4242;
const REQ = { ref: 'vault://w/p/e/K', reason: 'reveal' };

function makeApprover(factory: () => FakeBot) {
  const bot = factory();
  const approver = new TelegramApprover({
    botToken: 'token',
    allowedUserId: ALLOWED,
    botFactory: () => bot,
  });
  return { approver, bot };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('TelegramApprover (fake bot)', () => {
  it('isAvailable yapılandırma gerektirir', () => {
    expect(new TelegramApprover({}).isAvailable()).toBe(false);
    expect(new TelegramApprover({ botToken: 't' }).isAvailable()).toBe(false);
    expect(new TelegramApprover({ botToken: 't', allowedUserId: ALLOWED }).isAvailable()).toBe(true);
  });

  it('doğru nonce + izinli kullanıcı + :y → approved', async () => {
    const { approver, bot } = makeApprover(() => new FakeBot());
    const pending = approver.requestApproval(REQ);
    await vi.waitFor(() => expect(bot.sendMessage).toHaveBeenCalledTimes(1));
    expect(bot.sendMessage.mock.calls[0][0]).toBe(ALLOWED);
    const nonce = bot.nonceFromLastSend();
    const ctx: Partial<CallbackCtx> = {
      from: { id: ALLOWED },
      callbackQuery: { data: `apr:${nonce}:y` },
      answerCallbackQuery: vi.fn(async () => true),
      editMessageText: vi.fn(async () => ({})),
    };
    await bot.fire(ctx);
    expect(await pending).toBe('approved');
    expect(ctx.answerCallbackQuery).toHaveBeenCalled();
    await approver.close();
  });

  it(':n → denied', async () => {
    const { approver, bot } = makeApprover(() => new FakeBot());
    const pending = approver.requestApproval(REQ);
    await vi.waitFor(() => expect(bot.sendMessage).toHaveBeenCalledTimes(1));
    const nonce = bot.nonceFromLastSend();
    await bot.fire({ from: { id: ALLOWED }, callbackQuery: { data: `apr:${nonce}:n` } });
    expect(await pending).toBe('denied');
    await approver.close();
  });

  it('yanlış kullanıcı → promise resolve olmaz, pending kalır', async () => {
    vi.useFakeTimers();
    const { approver, bot } = makeApprover(() => new FakeBot());
    const pending = approver.requestApproval(REQ);
    await vi.waitFor(() => expect(bot.sendMessage).toHaveBeenCalledTimes(1));
    const nonce = bot.nonceFromLastSend();
    const answer = vi.fn(async () => true);
    await bot.fire({ from: { id: ALLOWED + 1 }, callbackQuery: { data: `apr:${nonce}:y` }, answerCallbackQuery: answer });
    expect(answer).toHaveBeenCalled();
    let settled = false;
    void pending.then(() => {
      settled = true;
    });
    await Promise.resolve();
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(120_000);
    expect(await pending).toBe('timeout');
    await approver.close();
  });

  it('bilinmeyen/stale nonce → resolve olmaz ama answerCallbackQuery çağrılır', async () => {
    vi.useFakeTimers();
    const { approver, bot } = makeApprover(() => new FakeBot());
    const pending = approver.requestApproval(REQ);
    await vi.waitFor(() => expect(bot.sendMessage).toHaveBeenCalledTimes(1));
    const answer = vi.fn(async () => true);
    await bot.fire({ from: { id: ALLOWED }, callbackQuery: { data: `apr:deadbeef:y` }, answerCallbackQuery: answer });
    expect(answer).toHaveBeenCalled();
    let settled = false;
    void pending.then(() => {
      settled = true;
    });
    await Promise.resolve();
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(120_000);
    expect(await pending).toBe('timeout');
    await approver.close();
  });

  it('iki eşzamanlı istek → tek bot, tek start; bağımsız çözülür', async () => {
    const bot = new FakeBot();
    const factory = vi.fn(() => bot);
    const approver = new TelegramApprover({ botToken: 'token', allowedUserId: ALLOWED, botFactory: factory });

    const pendingA = approver.requestApproval({ ref: 'vault://a', reason: 'a' });
    const pendingB = approver.requestApproval({ ref: 'vault://b', reason: 'b' });
    await vi.waitFor(() => expect(bot.sendMessage).toHaveBeenCalledTimes(2));

    expect(factory).toHaveBeenCalledTimes(1);
    expect(bot.startSpy).toHaveBeenCalledTimes(1);

    const nonceA = bot.sendMessage.mock.calls[0][2] as { reply_markup: { inline_keyboard: Array<Array<{ callback_data: string }>> } };
    const nonceB = bot.sendMessage.mock.calls[1][2] as { reply_markup: { inline_keyboard: Array<Array<{ callback_data: string }>> } };
    const a = nonceA.reply_markup.inline_keyboard[0][0].callback_data.split(':')[1];
    const b = nonceB.reply_markup.inline_keyboard[0][0].callback_data.split(':')[1];
    expect(a).not.toBe(b);

    await bot.fire({ from: { id: ALLOWED }, callbackQuery: { data: `apr:${a}:y` } });
    expect(await pendingA).toBe('approved');

    let bSettled = false;
    void pendingB.then(() => {
      bSettled = true;
    });
    await Promise.resolve();
    expect(bSettled).toBe(false);

    await bot.fire({ from: { id: ALLOWED }, callbackQuery: { data: `apr:${b}:n` } });
    expect(await pendingB).toBe('denied');
    await approver.close();
  });

  it('timeout → 120 sn sonra timeout, nonce temizlenir', async () => {
    vi.useFakeTimers();
    const { approver, bot } = makeApprover(() => new FakeBot());
    const pending = approver.requestApproval(REQ);
    await vi.waitFor(() => expect(bot.sendMessage).toHaveBeenCalledTimes(1));
    const nonce = bot.nonceFromLastSend();
    await vi.advanceTimersByTimeAsync(120_000);
    expect(await pending).toBe('timeout');
    const answer = vi.fn(async () => true);
    await bot.fire({ from: { id: ALLOWED }, callbackQuery: { data: `apr:${nonce}:y` }, answerCallbackQuery: answer });
    expect(answer).toHaveBeenCalled();
    await approver.close();
  });

  it('sendMessage hata atarsa → hızlı reject (120 sn beklemeden)', async () => {
    const bot = new FakeBot();
    bot.sendMessage.mockRejectedValueOnce(new Error('telegram down'));
    const approver = new TelegramApprover({ botToken: 'token', allowedUserId: ALLOWED, botFactory: () => bot });
    await expect(approver.requestApproval(REQ)).rejects.toThrow(/telegram down/);
    await approver.close();
  });

  it('start reject olursa → hızlı reject (açık mesaj)', async () => {
    const bot = new FakeBot();
    bot.startResult = Promise.reject(new Error('409 conflict'));
    const approver = new TelegramApprover({ botToken: 'token', allowedUserId: ALLOWED, botFactory: () => bot });
    await expect(approver.requestApproval(REQ)).rejects.toThrow(/Telegram bot start failed/);
    await approver.close();
  });
});
