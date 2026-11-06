import Webhook from "@slack/webhook";

export interface SlackMessengerOptions {
  webhookUrl: string;
}

export class SlackMessenger {
  private webhook: Webhook;

  constructor(options: SlackMessengerOptions) {
    this.webhook = new Webhook(options.webhookUrl);
  }

  /** Send a text message to the Slack channel configured by the webhook. */
  async send(text: string): Promise<void> {
    await this.webhook.send({ text });
  }
}