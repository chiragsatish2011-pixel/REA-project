/**
 * @file mailbox.ts
 * @description Asynchronous Inter-Agent Mailbox and reactive event bus for Nomin Code.
 * Provides peer-to-peer messaging, broadcast routing, and non-blocking reactive wakeups.
 * Modeled on Antigravity reactive wakeups (zero CPU-spinning busy-wait polling loops).
 * Pure Node.js standard library implementation.
 */

import { EventEmitter } from 'node:events';
import * as crypto from 'node:crypto';
import type { MessageFilter, NominAgentMessage, NominMessageType, SwarmRole } from './types.js';

export interface MailboxOptions {
  historyLimit?: number;
  defaultTimeoutMs?: number;
}

export class SwarmMailbox extends EventEmitter {
  private queues: Map<string, NominAgentMessage[]> = new Map();
  private messageHistory: NominAgentMessage[] = [];
  private historyLimit: number;
  private defaultTimeoutMs: number;
  private registeredRecipients: Set<string> = new Set();

  constructor(options: MailboxOptions = {}) {
    super();
    this.historyLimit = options.historyLimit ?? 1000;
    this.defaultTimeoutMs = options.defaultTimeoutMs ?? 30_000;

    // Register standard role queues by default
    const standardRoles: SwarmRole[] = ['Architect', 'Coder', 'Tester', 'Verifier', 'System'];
    for (const role of standardRoles) {
      this.registerRecipient(role);
      this.registerRecipient(role.toLowerCase());
    }
  }

  /**
   * Registers a recipient queue identifier (role or agentId).
   */
  public registerRecipient(recipient: string): void {
    const key = recipient.trim();
    this.registeredRecipients.add(key);
    if (!this.queues.has(key)) {
      this.queues.set(key, []);
    }
  }

  /**
   * Sends an inter-agent message, routes to destination or broadcast, and triggers reactive wakeups.
   */
  public send(
    rawMessage: Omit<NominAgentMessage, 'messageId' | 'timestamp'> & {
      messageId?: string;
      timestamp?: number;
    }
  ): NominAgentMessage {
    const message: NominAgentMessage = {
      messageId: rawMessage.messageId || crypto.randomUUID(),
      conversationId: rawMessage.conversationId,
      senderRole: rawMessage.senderRole,
      senderAgentId: rawMessage.senderAgentId,
      recipientRole: rawMessage.recipientRole,
      recipientAgentId: rawMessage.recipientAgentId,
      timestamp: rawMessage.timestamp || Date.now(),
      messageType: rawMessage.messageType,
      payload: { ...rawMessage.payload },
    };

    // Store in historical audit buffer
    this.messageHistory.push(message);
    if (this.messageHistory.length > this.historyLimit) {
      this.messageHistory.shift();
    }

    if (message.recipientRole === 'broadcast') {
      // Deliver to all known registered recipient queues
      for (const [, queue] of Array.from(this.queues.entries())) {
        queue.push(message);
      }
      this.emit('broadcast', message);
      this.emit('message:*', message);
      return message;
    }

    // Direct routing: Role-based destination
    const roleKey = message.recipientRole;
    this.enqueue(roleKey, message);
    this.enqueue(roleKey.toLowerCase(), message);

    // If a specific agentId was addressed, enqueue there as well
    if (message.recipientAgentId) {
      this.enqueue(message.recipientAgentId, message);
    }

    this.emit(`message:${roleKey}`, message);
    this.emit(`message:${roleKey.toLowerCase()}`, message);
    if (message.recipientAgentId) {
      this.emit(`message:${message.recipientAgentId}`, message);
    }
    this.emit('message:*', message);

    return message;
  }

  private enqueue(recipient: string, message: NominAgentMessage): void {
    if (!this.queues.has(recipient)) {
      this.queues.set(recipient, []);
    }
    this.queues.get(recipient)!.push(message);
  }

  /**
   * Non-blocking queue pop for a recipient. Returns undefined if empty.
   */
  public receive(recipient: string, filter?: MessageFilter): NominAgentMessage | undefined {
    const queue = this.queues.get(recipient);
    if (!queue || queue.length === 0) {
      return undefined;
    }

    if (!filter) {
      return queue.shift();
    }

    const index = queue.findIndex((msg) => this.matchesFilter(msg, filter));
    if (index === -1) {
      return undefined;
    }

    const [matched] = queue.splice(index, 1);
    return matched;
  }

  /**
   * Drains all matching messages currently queued for the recipient.
   */
  public drainQueue(recipient: string, filter?: MessageFilter): NominAgentMessage[] {
    const queue = this.queues.get(recipient);
    if (!queue || queue.length === 0) {
      return [];
    }

    if (!filter) {
      const items = [...queue];
      queue.length = 0;
      return items;
    }

    const matched: NominAgentMessage[] = [];
    const remaining: NominAgentMessage[] = [];

    for (const msg of queue) {
      if (this.matchesFilter(msg, filter)) {
        matched.push(msg);
      } else {
        remaining.push(msg);
      }
    }

    this.queues.set(recipient, remaining);
    return matched;
  }

  /**
   * Reactive wakeup without busy-waiting polling loops.
   * If a message matching filter is already queued, resolves immediately.
   * Otherwise waits for incoming event on the recipient channel or broadcast.
   */
  public waitForMessage(
    recipient: string,
    filter?: MessageFilter,
    timeoutMs?: number
  ): Promise<NominAgentMessage> {
    const effectiveTimeout = timeoutMs ?? this.defaultTimeoutMs;

    // 1. Check existing queue first (fast path)
    const existing = this.receive(recipient, filter);
    if (existing) {
      return Promise.resolve(existing);
    }

    // 2. Reactive event-driven wait
    return new Promise<NominAgentMessage>((resolve, reject) => {
      let timer: NodeJS.Timeout | null = null;

      const cleanup = () => {
        if (timer) {
          clearTimeout(timer);
          timer = null;
        }
        this.removeListener(`message:${recipient}`, onMessage);
        this.removeListener(`message:${recipient.toLowerCase()}`, onMessage);
        this.removeListener('broadcast', onMessage);
      };

      const onMessage = (msg: NominAgentMessage) => {
        if (this.matchesFilter(msg, filter)) {
          // Remove from queue so it's not double-processed
          const queue = this.queues.get(recipient);
          if (queue) {
            const idx = queue.findIndex((m) => m.messageId === msg.messageId);
            if (idx !== -1) {
              queue.splice(idx, 1);
            }
          }
          cleanup();
          resolve(msg);
        }
      };

      if (effectiveTimeout > 0) {
        timer = setTimeout(() => {
          cleanup();
          reject(new Error(`Timeout after ${effectiveTimeout}ms waiting for message to '${recipient}'`));
        }, effectiveTimeout);
      }

      this.on(`message:${recipient}`, onMessage);
      if (recipient.toLowerCase() !== recipient) {
        this.on(`message:${recipient.toLowerCase()}`, onMessage);
      }
      this.on('broadcast', onMessage);
    });
  }

  /**
   * Subscribes a reactive listener to an agent or role mailbox.
   * Returns an unsubscribe callback.
   */
  public subscribe(
    recipient: string,
    handler: (message: NominAgentMessage) => void | Promise<void>,
    filter?: MessageFilter
  ): () => void {
    const onMessage = async (msg: NominAgentMessage) => {
      if (this.matchesFilter(msg, filter)) {
        try {
          await handler(msg);
        } catch (err) {
          this.emit('error', err);
        }
      }
    };

    const eventName = `message:${recipient}`;
    this.on(eventName, onMessage);
    this.on('broadcast', onMessage);

    return () => {
      this.removeListener(eventName, onMessage);
      this.removeListener('broadcast', onMessage);
    };
  }

  /**
   * Checks if message satisfies a filter specification.
   */
  private matchesFilter(msg: NominAgentMessage, filter?: MessageFilter): boolean {
    if (!filter) return true;

    if (filter.senderRole && msg.senderRole !== filter.senderRole) {
      return false;
    }
    if (filter.recipientRole && msg.recipientRole !== filter.recipientRole) {
      return false;
    }
    if (filter.senderAgentId && msg.senderAgentId !== filter.senderAgentId) {
      return false;
    }
    if (filter.recipientAgentId && msg.recipientAgentId !== filter.recipientAgentId) {
      return false;
    }
    if (filter.taskId && msg.payload.taskId !== filter.taskId) {
      return false;
    }
    if (filter.messageType) {
      if (Array.isArray(filter.messageType)) {
        if (!filter.messageType.includes(msg.messageType)) {
          return false;
        }
      } else if (msg.messageType !== filter.messageType) {
        return false;
      }
    }

    return true;
  }

  /**
   * Returns peek view of the next message in queue without popping it.
   */
  public peek(recipient: string): NominAgentMessage | undefined {
    const queue = this.queues.get(recipient);
    return queue && queue.length > 0 ? queue[0] : undefined;
  }

  /**
   * Returns current pending queue length for recipient.
   */
  public getPendingCount(recipient: string): number {
    return this.queues.get(recipient)?.length || 0;
  }

  /**
   * Returns historical audit log of inter-agent messages.
   */
  public getHistory(filter?: MessageFilter): NominAgentMessage[] {
    if (!filter) {
      return [...this.messageHistory];
    }
    return this.messageHistory.filter((msg) => this.matchesFilter(msg, filter));
  }

  /**
   * Clears all mailboxes and message history.
   */
  public reset(): void {
    for (const queue of Array.from(this.queues.values())) {
      queue.length = 0;
    }
    this.messageHistory.length = 0;
  }
}
