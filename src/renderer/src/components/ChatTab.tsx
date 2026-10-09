import { useEffect, useMemo, useState, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { CommandBar } from './CommandBar';
import { useStore, type Agent } from '@/store/store';
import { createAnsiStripper } from './ansiText';

// Derive the message shape from the preload-exposed API
type HiveMessage = Awaited<ReturnType<Window['cth']['hiveInbox']>>[number];

export interface ChatTabProps {
  agent: Agent;
}

interface StreamMessage {
  id: string;
  type: 'stream';
  body: string;
  created_at: string; // ISO string to match HiveMessage
}

export function ChatTab({ agent }: ChatTabProps) {
  const { t } = useTranslation();
  const [inbox, setInbox] = useState<HiveMessage[]>([]);
  const [outbox, setOutbox] = useState<HiveMessage[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [streamChunks, setStreamChunks] = useState<StreamMessage[]>([]);
  const stripperRef = useRef(createAnsiStripper());

  useEffect(() => {
    if (!agent.ptyId) return;

    // We collect chunks of output and periodically flush them into a new StreamMessage.
    let buffer = '';
    let flushTimer: any = null;

    const flush = () => {
      if (!buffer.trim()) return;

      const newMsg: StreamMessage = {
        id: `stream-${Date.now()}-${Math.random()}`,
        type: 'stream',
        body: buffer,
        created_at: new Date().toISOString()
      };

      setStreamChunks(prev => {
        // High limit to avoid deleting history while reading it
        const next = [...prev, newMsg];
        if (next.length > 5000) return next.slice(next.length - 5000);
        return next;
      });
      buffer = '';
    };

    const cleanup = window.cth.onPtyData(agent.ptyId, (data) => {
      const stripped = stripperRef.current(data);
      if (stripped) {
        buffer += stripped;
        // Debounce flush
        if (flushTimer) clearTimeout(flushTimer);
        flushTimer = setTimeout(flush, 500); // Flush if no output for 500ms

        // Or flush if it gets too long
        if (buffer.length > 1000) flush();
      }
    });

    return () => {
      cleanup();
      if (flushTimer) clearTimeout(flushTimer);
      flush(); // final flush
    };
  }, [agent.ptyId]);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const [inData, outData] = await Promise.all([
          window.cth.hiveInbox(agent.id),
          window.cth.hiveOutbox(agent.id)
        ]);
        if (alive) {
          setInbox(inData);
          setOutbox(outData);
        }
      } catch { /* keep last good state */ }
    };
    load();
    const timer = setInterval(load, 3000);
    return () => { alive = false; clearInterval(timer); };
  }, [agent.id]);

  // Messages addressed from human to agent appear in agent's inbox
  // Messages addressed from agent to human appear in agent's outbox (or inbox if replying, depending on architecture, so we just aggregate both where sender/recipient involves the human).

  const messages = useMemo(() => {
    // Combine all messages for the agent
    const all = [...inbox, ...outbox];

    // Filter to messages that are part of a conversation involving 'human' or just general conversation.
    // For simplicity, we just take all messages and show them in chronological order.
    // Human messages: from === 'human'
    // Agent responses: from === agent.id or from other internal systems if it makes sense.

    // De-duplicate by ID in case a message is somehow in both
    const unique = new Map<string, HiveMessage>();
    for (const m of all) {
      if (!unique.has(m.id)) {
        unique.set(m.id, m);
      }
    }

    const combined: Array<HiveMessage | StreamMessage> = [...Array.from(unique.values()), ...streamChunks];

    const sorted = combined.sort((a, b) => a.created_at < b.created_at ? -1 : 1);
    return sorted;
  }, [inbox, outbox, streamChunks]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  const enqueueMessage = useStore((s) => s.enqueueMessage);

  const onSend = async (text: string) => {
    if (!text.trim()) return;

    // Instead of using hiveSend directly, we enqueue it exactly as the terminal composer does.
    // This ensures it goes straight into the agent's PTY/input when ready.
    enqueueMessage(agent.id, text);
    void window.cth.trackMessageSent('composer');
  };

  return (
    <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', background: 'var(--cth-paper-200)' }}>
      <div
        ref={scrollRef}
        style={{
          flex: 1,
          overflowY: 'auto',
          padding: '16px',
          display: 'flex',
          flexDirection: 'column',
          gap: '12px'
        }}
      >
        {messages.length === 0 ? (
          <div style={{ margin: 'auto', color: 'var(--cth-ink-500)', fontSize: 13, fontFamily: 'var(--cth-font-ui)' }}>
            No messages yet. Send a message to start the conversation.
          </div>
        ) : (
          messages.map((m) => {
            if ('type' in m && m.type === 'stream') {
              return (
                <div key={m.id} style={{ display: 'flex', flexDirection: 'column', maxWidth: '100%' }}>
                  <div style={{
                    fontSize: 10,
                    color: 'var(--cth-ink-500)',
                    marginBottom: 4,
                    fontFamily: 'var(--cth-font-display)',
                    textTransform: 'uppercase'
                  }}>
                    Stream • {new Date(m.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </div>
                  <div style={{
                    background: 'var(--cth-ink-900)',
                    color: 'var(--cth-cream-100)',
                    padding: '8px 12px',
                    borderRadius: 8,
                    maxWidth: '100%',
                    fontSize: 12,
                    lineHeight: 1.4,
                    fontFamily: 'var(--cth-font-mono)',
                    whiteSpace: 'pre-wrap',
                    wordBreak: 'break-word',
                    overflowX: 'hidden'
                  }}>
                    {m.body.trim()}
                  </div>
                </div>
              );
            }

            const hm = m as HiveMessage;
            const isHuman = hm.from === 'human';

            return (
              <div
                key={hm.id}
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: isHuman ? 'flex-end' : 'flex-start',
                  maxWidth: '100%'
                }}
              >
                <div style={{
                  fontSize: 10,
                  color: 'var(--cth-ink-500)',
                  marginBottom: 4,
                  fontFamily: 'var(--cth-font-display)',
                  textTransform: 'uppercase'
                }}>
                  {isHuman ? 'You' : hm.from} • {new Date(hm.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </div>
                <div style={{
                  background: isHuman ? `var(--cth-${agent.accent})` : 'var(--cth-cream-100)',
                  color: isHuman ? 'var(--cth-ink-900)' : 'var(--cth-ink-900)',
                  padding: '8px 12px',
                  borderRadius: 8,
                  borderBottomRightRadius: isHuman ? 0 : 8,
                  borderBottomLeftRadius: isHuman ? 8 : 0,
                  maxWidth: '85%',
                  fontSize: 13,
                  lineHeight: 1.5,
                  fontFamily: 'var(--cth-font-ui)',
                  boxShadow: '0 1px 2px rgba(0,0,0,0.05)',
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-word',
                  border: isHuman ? 'none' : '1px solid var(--cth-ink-200)'
                }}>
                  {hm.body}
                </div>
              </div>
            );
          })
        )}
      </div>

      <div style={{ padding: '12px', background: 'var(--cth-cream-200)', borderTop: '1px solid var(--cth-ink-300)' }}>
        <CommandBar accent={agent.accent} onSend={onSend} />
      </div>
    </div>
  );
}
