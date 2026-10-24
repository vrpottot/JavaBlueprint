import React, { useState, useRef, useEffect } from 'react';
import {
  Send,
  Bot,
  User,
  Zap,
  CheckCircle2,
  RotateCcw,
  Play,
  AlertTriangle,
} from 'lucide-react';
import { useProjectStore } from '../../store/useProjectStore';
import { streamAIChatMessage } from '../../services/api';
import type { ChatMessage, AIProposal } from '../../types';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import styles from './AIChat.module.scss';


export const AIChat: React.FC = () => {
  const projectId = useProjectStore((s) => s.projectId);
  const initialize = useProjectStore((s) => s.initialize);
  const commitAIProposal = useProjectStore((s) => s.commitAIProposal);
  const addConsoleLog = useProjectStore((s) => s.addConsoleLog);
  const messages = useProjectStore((s) => s.chatMessages);
  const setMessages = useProjectStore((s) => s.setChatMessages);
  const clearChat = useProjectStore((s) => s.clearChatMessages);

  const [inputText, setInputText] = useState('');
  const [isThinking, setIsThinking] = useState(false);
  const [verifyingMsgId, setVerifyingMsgId] = useState<string | null>(null);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, isThinking]);

  const handleSendMessage = async () => {
    const query = inputText.trim();
    if (!query || isThinking) return;

    const userMsg: ChatMessage = {
      id: `user-${Date.now()}`,
      role: 'user',
      timestamp: new Date().toTimeString().split(' ')[0],
      text: query,
    };

    setMessages((prev) => [...prev, userMsg]);
    setInputText('');
    setIsThinking(true);

    const aiMsgId = `ai-${Date.now()}`;
    let accumulatedText = '';

    try {
      let currentProjectId = projectId;
      if (!currentProjectId) {
        await initialize();
        currentProjectId = useProjectStore.getState().projectId;
      }

      if (!currentProjectId) {
        throw new Error('Не удалось инициализировать проект');
      }

      // Initial streaming placeholder
      const initialAiMsg: ChatMessage = {
        id: aiMsgId,
        role: 'assistant',
        timestamp: new Date().toTimeString().split(' ')[0],
        text: '',
        isStreaming: true,
      };
      setMessages((prev) => [...prev, initialAiMsg]);

      const result = await streamAIChatMessage(currentProjectId, query, (delta) => {
        accumulatedText += delta;
        // In-flight cleanup so intermediate proposal/analysis json blocks don't flicker in UI
        const displayChunk = accumulatedText
          .replace(/```json:proposal[\s\S]*?```/g, '')
          .replace(/```json:analysis[\s\S]*?```/g, '');

        setMessages((prev) =>
          prev.map((m) =>
            m.id === aiMsgId ? { ...m, text: displayChunk, isStreaming: true } : m
          )
        );
      });

      // Synchronize structured analysis with "Сводка" panel
      if (result.parsedAnalysis) {
        useProjectStore.getState().applyAIAnalysis(result.parsedAnalysis);
      }

      // Complete stream
      setMessages((prev) =>
        prev.map((m) =>
          m.id === aiMsgId
            ? {
                ...m,
                text: result.fullReply || accumulatedText,
                proposal: result.proposal,
                isStreaming: false,
              }
            : m
        )
      );

      addConsoleLog('info', 'ИИ-ответ успешно получен через стриминг');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setMessages((prev) => {
        const hasAiMsg = prev.some((m) => m.id === aiMsgId);
        if (hasAiMsg) {
          return prev.map((m) =>
            m.id === aiMsgId
              ? {
                  ...m,
                  text: `❌ Ошибка:\n\`\`\`\n${msg}\n\`\`\`\nПроверьте настройки в \`backend/.env\`.`,
                  isStreaming: false,
                }
              : m
          );
        }
        return [
          ...prev,
          {
            id: aiMsgId,
            role: 'assistant',
            timestamp: new Date().toTimeString().split(' ')[0],
            text: `❌ Ошибка:\n\`\`\`\n${msg}\n\`\`\`\nПроверьте настройки в \`backend/.env\`.`,
            isStreaming: false,
          },
        ];
      });
    } finally {
      setIsThinking(false);
    }
  };

  const handleExecuteProposal = async (proposal: AIProposal, msgId: string) => {
    setVerifyingMsgId(msgId);
    setMessages((prev) =>
      prev.map((m) => (m.id === msgId ? { ...m, proposalStatus: 'verifying' } : m))
    );

    try {
      const result = await commitAIProposal(proposal);
      setMessages((prev) =>
        prev.map((m) =>
          m.id === msgId
            ? { ...m, proposalStatus: 'verified', proposalVerificationResult: result.verification }
            : m
        )
      );
      addConsoleLog('success', 'ИИ-предложение успешно верифицировано в Docker и применено!');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setMessages((prev) =>
        prev.map((m) =>
          m.id === msgId
            ? { ...m, proposalStatus: 'failed', proposalVerificationResult: msg }
            : m
        )
      );
      addConsoleLog('error', `Ошибка верификации: ${msg}`);
    } finally {
      setVerifyingMsgId(null);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void handleSendMessage();
    }
  };

  const handleClearChat = () => {
    clearChat();
    addConsoleLog('info', 'История ИИ-чата очищена');
  };

  return (
    <div className={styles.chatContainer}>
      {/* Messages Feed */}
      <div className={styles.messagesList}>
        {messages.length === 0 && (
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', opacity: 0.35, gap: 8, padding: 24, textAlign: 'center' }}>
            <Bot size={28} />
            <span style={{ fontSize: 12 }}>Задайте вопрос или попросите проанализировать код</span>
          </div>
        )}
        {messages.map((msg) => (
          <div
            key={msg.id}
            className={`${styles.messageRow} ${
              msg.role === 'user' ? styles.user : styles.assistant
            }`}
          >
            <div className={styles.messageHeader}>
              <div
                className={`${styles.avatar} ${
                  msg.role === 'assistant' ? styles.ai : styles.userAvatar
                }`}
              >
                {msg.role === 'assistant' ? <Bot size={11} /> : <User size={11} />}
              </div>
              <span>{msg.role === 'assistant' ? 'JavaScope AI' : 'Вы'}</span>
              <span>•</span>
              <span>{msg.timestamp}</span>
            </div>

            <div
              className={`${styles.messageBubble} ${
                msg.role === 'user' ? styles.userBubble : styles.aiBubble
              }`}
            >
              <div className={styles.markdownBody}>
                {msg.text ? (
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>{msg.text}</ReactMarkdown>
                ) : (
                  msg.isStreaming && <span style={{ opacity: 0.6, fontSize: 12 }}>ИИ формирует ответ...</span>
                )}
                {msg.isStreaming && <span className={styles.streamingCursor} />}
              </div>

              {/* Verified AI Proposal Card */}
              {msg.proposal && (
                <div className={styles.proposalCard}>
                  <div className={styles.proposalHeader}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                      <Zap size={13} />
                      <span>Предложена оптимизация AST</span>
                    </div>
                    <span style={{ fontSize: 9.5, opacity: 0.7 }}>#{msg.proposal.revision}</span>
                  </div>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4, margin: '4px 0' }}>
                    {msg.proposal.operations.map((op, idx) => (
                      <div key={idx} className={styles.opItem}>
                        <span style={{ color: 'var(--accent-blue)', fontWeight: 600 }}>{op.type}</span>
                        {op.nodeId && <span style={{ opacity: 0.7 }}> ({op.nodeId})</span>}
                        {op.code && <div style={{ marginTop: 2 }}>{op.code}</div>}
                      </div>
                    ))}
                  </div>

                  {msg.proposalStatus === 'verified' ? (
                    <div className={`${styles.verificationBadge} ${styles.success}`}>
                      <CheckCircle2 size={13} />
                      <span>Успешно верифицировано в Docker! Код обновлён.</span>
                    </div>
                  ) : msg.proposalStatus === 'failed' ? (
                    <div className={`${styles.verificationBadge} ${styles.error}`}>
                      <AlertTriangle size={13} />
                      <span>Верификация отклонена: {String(msg.proposalVerificationResult)}</span>
                    </div>
                  ) : (
                    <button
                      className={styles.verifyActionBtn}
                      disabled={verifyingMsgId === msg.id}
                      onClick={() => handleExecuteProposal(msg.proposal!, msg.id)}
                    >
                      {verifyingMsgId === msg.id ? (
                        <>
                          <RotateCcw size={12} className="spin" />
                          <span>Верификация в Docker sandbox...</span>
                        </>
                      ) : (
                        <>
                          <Play size={12} />
                          <span>Применить и верифицировать (Docker)</span>
                        </>
                      )}
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>
        ))}

        {isThinking && !messages.some((m) => m.isStreaming) && (
          <div className={styles.typingIndicator}>
            <div className={styles.typingDots}>
              <span />
              <span />
              <span />
            </div>
            <span>ИИ анализирует проект...</span>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Chat Input Area */}
      <div className={styles.chatInputArea}>
        <div className={styles.inputWrapper}>
          <textarea
            ref={textareaRef}
            className={styles.chatTextarea}
            rows={2}
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Спросите ИИ о коде, Big O, оптимизации (Enter для отправки)..."
          />
          <button
            className={styles.sendBtn}
            onClick={() => void handleSendMessage()}
            disabled={!inputText.trim() || isThinking}
            title="Отправить сообщение"
          >
            <Send size={13} />
          </button>
        </div>

        <div className={styles.inputFooter}>
          <span>Shift+Enter для новой строки</span>
          <button className={styles.clearChatBtn} onClick={handleClearChat} title="Очистить диалог">
            <RotateCcw size={10} />
            <span>Очистить</span>
          </button>
        </div>
      </div>
    </div>
  );
};
