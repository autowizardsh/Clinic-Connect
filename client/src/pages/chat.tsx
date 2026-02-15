import { ChatWidget } from "@/components/chat-widget";
import { ThemeProvider } from "@/components/theme-provider";

const isInIframe = window !== window.top;

export default function ChatPage() {
  if (isInIframe) {
    return (
      <ThemeProvider defaultTheme="light">
        <div className="h-screen w-full overflow-hidden">
          <ChatWidget embedded />
        </div>
      </ThemeProvider>
    );
  }

  return (
    <ThemeProvider defaultTheme="light">
      <div className="h-screen bg-gradient-to-br from-primary/5 to-primary/10 flex items-center justify-center p-4">
        <div className="w-full max-w-md h-[600px] bg-background rounded-2xl shadow-2xl overflow-hidden">
          <ChatWidget embedded />
        </div>
      </div>
    </ThemeProvider>
  );
}
