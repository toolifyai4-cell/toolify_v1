import { Telegraf } from "telegraf";

export interface TelegramMessengerOptions {
  token: string;
  chatId: string;
}

export class TelegramMessenger {
  private bot: Telegraf;
  private chatId: string;

  constructor(options: TelegramMessengerOptions) {
    this.chatId = options.chatId;
    this.bot = new Telegraf(options.token);
  }

  /** Send a text message to the configured chat. */
  async send(text: string): Promise<void> {
    await this.bot.telegram.sendMessage(this.chatId, text);
  }
}