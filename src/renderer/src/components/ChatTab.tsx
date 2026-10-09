import { useEffect, useMemo, useState, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { CommandBar } from './CommandBar';
import { useStore, type Agent } from '@/store/store';

// Derive the message shape from the preload-exposed API
type HiveMessage = Awaited<ReturnType<Window['cth']['hiveInbox']>>[number];

export interface ChatTabProps {
  agent: Agent;
}

export function ChatTab({ agent }: ChatTabProps) {
  const { t } = useTranslation();
  const [inbox, setInbox] = useState<HiveMessage[]>([]);
  const [outbox, setOutbox] = useState<HiveMessage[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);

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

    const sorted = Array.from(unique.values()).sort((a, b) => a.created_at < b.created_at ? -1 : 1);
    return sorted;
  }, [inbox, outbox]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  const onSend = async (text: string) => {
    await window.cth.hiveSend({
      to: agent.id,
      act: 'inform',
      subject: 'Chat',
      body: text
    }, 'human');

    // Optimistic UI update could go here, but the 3-second poll will catch it
    // Let's force an immediate reload
    try {
        const inData = await window.cth.hiveInbox(agent.id);
        setInbox(inData);
    } catch {}
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
            const isHuman = m.from === 'human';

            return (
              <div
                key={m.id}
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
                  {isHuman ? 'You' : m.from} • {new Date(m.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
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
                  {m.body}
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
