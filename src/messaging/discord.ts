import { Client, GatewayIntentBits } from "discord.js";

export interface DiscordMessengerOptions {
  token: string;
  channelId: string;
}

export class DiscordMessenger {
  private client: Client;
  private channelId: string;

  constructor(options: DiscordMessengerOptions) {
    this.channelId = options.channelId;
    this.client = new Client({
      intents: [GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent],
    });
  }

  /** Connect the client and keep it ready to send messages. */
  async init(): Promise<void> {
    await this.client.login(this.token);
  }

  /** Send a text message to the configured channel. */
  async send(text: string): Promise<void> {
    if (!this.client.isReady()) {
      throw new Error("Discord client not logged in. Call init() first.");
    }
    const channel = await this.client.channels.fetch(this.channelId);
    if (channel.isTextBased()) {
      await channel.send(text);
    } else {
      throw new Error("Fetched channel is not a text channel");
    }
  }
}