import { useState, useRef, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { MessageSquare, X, Send, Loader2, Globe } from "lucide-react";

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
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
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen && !sessionId) {
      initializeSession();
    }
  }, [isOpen]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

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
        setMessages([
          {
            id: "welcome",
            role: "assistant",
            content: data.welcomeMessage,
          },
        ]);
      }
    } catch (error) {
      console.error("Failed to initialize chat session:", error);
    }
  };

  const sendMessage = async () => {
    if (!input.trim() || isLoading) return;

    const userMessage: Message = {
      id: Date.now().toString(),
      role: "user",
      content: input.trim(),
    };

    setMessages((prev) => [...prev, userMessage]);
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
          try {
            const data = JSON.parse(line.slice(6));
            if (data.content) {
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === assistantMessage.id
                    ? { ...m, content: m.content + data.content }
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
    }
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
      <Button
        onClick={() => setIsOpen(true)}
        className="fixed bottom-6 right-6 h-14 w-14 rounded-full shadow-lg z-50"
        size="icon"
        data-testid="button-open-chat"
      >
        <MessageSquare className="h-6 w-6" />
      </Button>
    );
  }

  const containerClass = embedded
    ? "w-full h-full flex flex-col bg-background"
    : "fixed bottom-6 right-6 w-96 h-[32rem] flex flex-col bg-background rounded-2xl shadow-2xl border z-50 overflow-hidden";

  return (
    <div className={containerClass} data-testid="chat-widget">
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
        {language === "nl" ? "Nederlands" : "English"} • {language === "nl" ? "Klik 🌐 om te wisselen" : "Click 🌐 to switch"}
      </div>

      {/* Messages */}
      <ScrollArea className="flex-1 p-4 chat-messages" ref={scrollRef}>
        <div className="space-y-4">
          {messages.map((message) => (
            <div
              key={message.id}
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
          ))}
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
