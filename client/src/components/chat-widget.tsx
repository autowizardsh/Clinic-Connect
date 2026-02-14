import { useState, useRef, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { MessageSquare, X, Send, Loader2, Globe } from "lucide-react";

interface QuickReply {
  label: string;
  value: string;
}

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  quickReplies?: QuickReply[];
}

interface ChatWidgetProps {
  embedded?: boolean;
  sessionId?: string;
}

export function ChatWidget({ embedded = false, sessionId: propSessionId }: ChatWidgetProps) {
  const [isOpen, setIsOpen] = useState(embedded);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [sessionId, setSessionId] = useState(propSessionId || "");
  const [language, setLanguage] = useState<"en" | "nl">("en");
  const scrollRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen && !sessionId) {
      initializeSession();
    }
  }, [isOpen]);

  useEffect(() => {
    setTimeout(() => {
      bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    }, 50);
  }, [messages, isLoading]);

  useEffect(() => {
    if (isOpen && inputRef.current) {
      inputRef.current.focus();
    }
  }, [isOpen]);

  const initializeSession = async () => {
    try {
      const response = await fetch("/api/chat/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ language }),
      });
      const data = await response.json();
      setSessionId(data.sessionId);
      if (data.welcomeMessage) {
        const welcomeQuickReplies: QuickReply[] = language === "nl"
          ? [
              { label: "Afspraak maken", value: "Ik wil een afspraak maken" },
              { label: "Afspraak verzetten", value: "Ik wil mijn afspraak verzetten" },
              { label: "Afspraak annuleren", value: "Ik wil mijn afspraak annuleren" },
              { label: "Andere vraag", value: "Ik heb een andere vraag" },
            ]
          : [
              { label: "Book an appointment", value: "I would like to book an appointment" },
              { label: "Reschedule appointment", value: "I want to reschedule my appointment" },
              { label: "Cancel appointment", value: "I want to cancel my appointment" },
              { label: "Other question", value: "I have another question" },
            ];
        setMessages([
          {
            id: "welcome",
            role: "assistant",
            content: data.welcomeMessage,
            quickReplies: welcomeQuickReplies,
          },
        ]);
      }
    } catch (error) {
      console.error("Failed to initialize chat session:", error);
    }
  };

  const handleQuickReply = (reply: QuickReply) => {
    setInput(reply.value);
    setMessages((prev) =>
      prev.map((m) => ({ ...m, quickReplies: undefined }))
    );
    setTimeout(() => {
      sendMessageDirect(reply.value);
    }, 50);
  };

  const sendMessageDirect = async (messageText: string) => {
    if (!messageText.trim() || isLoading) return;

    const userMessage: Message = {
      id: Date.now().toString(),
      role: "user",
      content: messageText.trim(),
    };

    setMessages((prev) => [
      ...prev.map((m) => ({ ...m, quickReplies: undefined })),
      userMessage,
    ]);
    setInput("");
    setIsLoading(true);

    try {
      const response = await fetch("/api/chat/message", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId,
          message: userMessage.content,
          language,
        }),
      });

      if (!response.ok) throw new Error("Failed to send message");

      const reader = response.body?.getReader();
      if (!reader) throw new Error("No response body");

      const assistantMessage: Message = {
        id: (Date.now() + 1).toString(),
        role: "assistant",
        content: "",
      };

      setMessages((prev) => [...prev, assistantMessage]);

      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const rawData = line.slice(6);
          if (rawData === "[DONE]") continue;
          try {
            const data = JSON.parse(rawData);
            if (data.content) {
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === assistantMessage.id
                    ? { ...m, content: m.content + data.content }
                    : m
                )
              );
            }
            if (data.quickReplies) {
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === assistantMessage.id
                    ? { ...m, quickReplies: data.quickReplies }
                    : m
                )
              );
            }
          } catch (e) {
            // Ignore parsing errors
          }
        }
      }
    } catch (error) {
      console.error("Failed to send message:", error);
      setMessages((prev) => [
        ...prev,
        {
          id: Date.now().toString(),
          role: "assistant",
          content: language === "nl" 
            ? "Sorry, er is iets misgegaan. Probeer het alstublieft opnieuw."
            : "Sorry, something went wrong. Please try again.",
        },
      ]);
    } finally {
      setIsLoading(false);
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  };

  const sendMessage = async () => {
    if (!input.trim() || isLoading) return;
    setMessages((prev) =>
      prev.map((m) => ({ ...m, quickReplies: undefined }))
    );
    await sendMessageDirect(input.trim());
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  const toggleLanguage = () => {
    const newLang = language === "en" ? "nl" : "en";
    setLanguage(newLang);
  };

  if (!embedded && !isOpen) {
    return (
      <button
        onClick={() => setIsOpen(true)}
        style={{ position: "fixed", bottom: "24px", right: "24px", zIndex: 99999 }}
        className="h-14 w-14 rounded-full shadow-lg bg-primary text-primary-foreground flex items-center justify-center cursor-pointer border-none outline-none"
        data-testid="button-open-chat"
      >
        <MessageSquare className="h-6 w-6" />
      </button>
    );
  }

  const containerStyle = !embedded ? { position: "fixed" as const, bottom: "24px", right: "24px", zIndex: 99999 } : undefined;
  const containerClass = embedded
    ? "w-full h-full flex flex-col bg-background"
    : "w-96 h-[32rem] flex flex-col bg-background rounded-2xl shadow-2xl border overflow-hidden";

  return (
    <div className={containerClass} style={containerStyle} data-testid="chat-widget">
      {/* Header */}
      <div className="bg-primary p-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-white/20 flex items-center justify-center">
            <MessageSquare className="h-5 w-5 text-white" />
          </div>
          <div>
            <div className="text-white font-medium">
              {language === "nl" ? "Tandarts Assistent" : "Dental Assistant"}
            </div>
            <div className="text-white/70 text-sm">
              {language === "nl" ? "Nu online" : "Online now"}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="icon"
            onClick={toggleLanguage}
            className="text-white hover:bg-white/20"
            data-testid="button-toggle-language"
          >
            <Globe className="h-5 w-5" />
          </Button>
          {!embedded && (
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setIsOpen(false)}
              className="text-white hover:bg-white/20"
              data-testid="button-close-chat"
            >
              <X className="h-5 w-5" />
            </Button>
          )}
        </div>
      </div>

      {/* Language indicator */}
      <div className="px-4 py-2 bg-muted text-center text-sm text-muted-foreground">
        {language === "nl" ? "Nederlands" : "English"} {" | "} {language === "nl" ? "Klik op de wereldbol om te wisselen" : "Click globe to switch"}
      </div>

      {/* Messages */}
      <ScrollArea className="flex-1 p-4 chat-messages" ref={scrollRef}>
        <div className="space-y-4">
          {messages.map((message, msgIndex) => {
            const isLastAssistant = message.role === "assistant" && msgIndex === messages.length - 1;
            return (
              <div key={message.id}>
                <div
                  className={`flex ${message.role === "user" ? "justify-end" : "justify-start"} chat-message-animate`}
                >
                  <div
                    className={`max-w-[80%] rounded-lg px-4 py-2 ${
                      message.role === "user"
                        ? "bg-primary text-primary-foreground rounded-tr-none"
                        : "bg-muted rounded-tl-none"
                    }`}
                    data-testid={`message-${message.id}`}
                  >
                    <p className="text-sm whitespace-pre-wrap">{message.content}</p>
                  </div>
                </div>
                {isLastAssistant && message.quickReplies && message.quickReplies.length > 0 && !isLoading && (
                  <div className="flex flex-wrap gap-2 mt-2 pl-1">
                    {message.quickReplies.map((reply, idx) => (
                      <button
                        key={idx}
                        onClick={() => handleQuickReply(reply)}
                        className="text-sm px-3 py-1.5 rounded-full border border-primary text-primary bg-transparent cursor-pointer transition-colors hover:bg-primary hover:text-primary-foreground"
                        data-testid={`quick-reply-${idx}`}
                      >
                        {reply.label}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
          {isLoading && (
            <div className="flex justify-start chat-message-animate">
              <div className="bg-muted rounded-lg rounded-tl-none px-4 py-3">
                <div className="flex gap-1">
                  <div className="w-2 h-2 rounded-full bg-muted-foreground/50 typing-dot" />
                  <div className="w-2 h-2 rounded-full bg-muted-foreground/50 typing-dot" />
                  <div className="w-2 h-2 rounded-full bg-muted-foreground/50 typing-dot" />
                </div>
              </div>
            </div>
          )}
          <div ref={bottomRef} />
        </div>
      </ScrollArea>

      {/* Input */}
      <div className="p-4 border-t">
        <div className="flex gap-2">
          <Input
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={language === "nl" ? "Typ uw bericht..." : "Type your message..."}
            disabled={isLoading}
            className="flex-1"
            data-testid="input-chat-message"
          />
          <Button
            onClick={sendMessage}
            disabled={!input.trim() || isLoading}
            size="icon"
            data-testid="button-send-message"
          >
            {isLoading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Send className="h-4 w-4" />
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}

export default ChatWidget;
