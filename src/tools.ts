// Copilot Remote — Custom tools for Copilot SDK
// These tools are registered with the session so Copilot can interact with Telegram.
import { defineTool } from '@github/copilot-sdk';

export function createTelegramTools(callbacks: {
  sendNotification: (text: string) => Promise<void>;
  sendFile: (path: string, caption?: string) => Promise<void>;
}) {
  const notify = defineTool('send_notification', {
    description:
      'Send a notification message to the user on Telegram. Use this when you want to alert the user about something important, like a long-running task completing.',
    parameters: {
      type: 'object',
      properties: {
        message: { type: 'string', description: 'The notification message to send' },
      },
      required: ['message'],
    },
    handler: async (args: { message: string }) => {
      await callbacks.sendNotification(args.message);
      return { success: true };
    },
  });

  const sendFile = defineTool('send_file', {
    description:
      'Send a file to the user on Telegram. Supports any file type — documents, images, audio, video. Use this when the user asks you to send/share/deliver a file, or when a task produces output files the user needs.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Absolute path to the file to send' },
        caption: { type: 'string', description: 'Optional caption to display with the file' },
      },
      required: ['path'],
    },
    handler: async (args: { path: string; caption?: string }) => {
      await callbacks.sendFile(args.path, args.caption);
      return { success: true };
    },
  });

  return [notify, sendFile];
}
